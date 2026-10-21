"""Offline challenge benchmarks from consented human references and recorded measurements.

Run: python tests/quality/evaluate.py benchmark.json --output report.json
Speech, grades, repeated grades and end-of-speech-to-first-audio latency may be
provided independently per row. Missing evidence stays pending, never invented.
"""
import argparse
import json
import math
import unicodedata
from statistics import mean, pvariance


def normalized_words(text):
    # Keep Unicode combining marks: stripping them corrupts Hindi vowel signs.
    # Ignore punctuation/case, but retain meaningful letters, numbers and marks.
    text = unicodedata.normalize('NFC', text).casefold().replace("'", '').replace('’', '')
    return ''.join(character if unicodedata.category(character)[0] in 'LNM' else ' '
                   for character in text).split()


def word_error_counts(reference, transcript):
    expected = normalized_words(reference)
    actual = normalized_words(transcript)
    if not expected:
        raise ValueError('A non-empty reference transcript is required')
    previous = list(range(len(actual) + 1))
    for i, word in enumerate(expected, 1):
        current = [i]
        for j, observed in enumerate(actual, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (word != observed)))
        previous = current
    return previous[-1], len(expected)


def word_error_rate(reference, transcript):
    errors, words = word_error_counts(reference, transcript)
    return errors / words


def number(value, label, maximum=None):
    if isinstance(value, bool):
        raise ValueError(f'{label} must be a number')
    result = float(value)
    if not math.isfinite(result) or result < 0 or (maximum is not None and result > maximum):
        raise ValueError(f'{label} must be finite and within range')
    return result


def percentile(values, quantile):
    if not values:
        return None
    values = sorted(values)
    index = (len(values) - 1) * quantile
    lower = int(index)
    return values[lower] + (values[min(lower + 1, len(values) - 1)] - values[lower]) * (index - lower)


def correlation(pairs):
    if len(pairs) < 2:
        return None
    xs, ys = zip(*pairs)
    mx, my = mean(xs), mean(ys)
    denominator = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    return sum((x - mx) * (y - my) for x, y in pairs) / denominator if denominator else None


def evaluate(rows):
    if not isinstance(rows, list) or not rows:
        raise ValueError('Provide at least one labelled sample')
    results, pairs, grade_errors, speech, repeated, latencies = [], [], [], [], [], []
    verified_speech = verified_grades = verified_repeats = 0
    languages = set()
    sample_ids = set()
    for row in rows:
        result = {'id': row.get('id'), 'cohort': row.get('cohort', 'unspecified')}
        sample_id = row.get('id')
        if sample_id is not None:
            if not isinstance(sample_id, str) or not sample_id.strip() or sample_id in sample_ids:
                raise ValueError('Sample IDs must be unique non-empty strings')
            sample_ids.add(sample_id)
        human = bool(sample_id) and row.get('consent') is True and not row.get('synthetic', False)
        if 'reference' in row or 'transcript' in row:
            if not isinstance(row.get('reference'), str) or not isinstance(row.get('transcript'), str):
                raise ValueError('Speech samples require reference and transcript strings')
            errors, words = word_error_counts(row['reference'], row['transcript'])
            result.update(word_error_rate=round(errors / words, 4), word_errors=errors, reference_words=words)
            speech.append(result)
            if human and row.get('reference_source') == 'human':
                verified_speech += 1
                languages.add(row.get('language', 'unspecified'))
        if row.get('human_score') is not None or row.get('ai_score') is not None:
            if row.get('human_score') is None or row.get('ai_score') is None:
                raise ValueError('Grading comparisons require both human_score and ai_score')
            human_score = number(row['human_score'], 'human_score', 100)
            ai_score = number(row['ai_score'], 'ai_score', 100)
            pairs.append((human_score, ai_score))
            error = abs(human_score - ai_score)
            grade_errors.append(error)
            result['grade_absolute_error'] = error
            if human and row.get('grade_source') in ('faculty', 'peer'):
                verified_grades += 1
        if 'repeated_ai_scores' in row:
            values = row['repeated_ai_scores']
            if not isinstance(values, list) or len(values) < 2:
                raise ValueError('Consistency requires at least two repeated scores')
            values = [number(value, 'repeated_ai_score', 100) for value in values]
            result['consistency'] = {'runs': len(values), 'mean': mean(values), 'population_variance': pvariance(values), 'range': max(values) - min(values)}
            repeated.append(result['consistency'])
            if human and len(values) >= 5 and row.get('model') and row.get('prompt_version'):
                verified_repeats += 1
        if 'response_latency_ms' in row:
            if row.get('latency_boundary') != 'end_of_speech_to_first_audio':
                raise ValueError('Specify latency_boundary=end_of_speech_to_first_audio')
            latencies.append(number(row['response_latency_ms'], 'response_latency_ms'))
        results.append(result)
    groups = sorted({item['cohort'] for item in speech})
    p95 = percentile(latencies, .95)
    return {
        'samples': len(rows), 'speech_samples': len(speech),
        'mean_word_error_rate': round(mean(item['word_error_rate'] for item in speech), 4) if speech else None,
        'corpus_word_error_rate': round(sum(item['word_errors'] for item in speech) / sum(item['reference_words'] for item in speech), 4) if speech else None,
        'human_graded_samples': len(pairs),
        'grade_mean_absolute_error': round(mean(grade_errors), 3) if grade_errors else None,
        'grade_pearson_correlation': correlation(pairs),
        'consistency_transcripts': len(repeated),
        'mean_score_variance': mean(item['population_variance'] for item in repeated) if repeated else None,
        'latency': {'samples': len(latencies), 'p50_ms': percentile(latencies, .5), 'p95_ms': p95,
                    'p95_under_2500ms': p95 < 2500 if p95 is not None else None},
        'evidence_readiness': {
            'speech': {'consented_human_samples': verified_speech, 'minimum': 20,
                       'ready': verified_speech >= 20 and {'en-IN', 'hi-en'} <= languages},
            'grading': {'consented_human_samples': verified_grades, 'minimum': 10, 'ready': verified_grades >= 10},
            'consistency': {'consented_transcripts_with_five_runs': verified_repeats, 'ready': verified_repeats >= 1},
            'note': 'Ready means minimum evidence is present, not that accuracy, fairness or latency targets are met.'},
        'by_recording_condition': {group: {'samples': sum(item['cohort'] == group for item in speech),
            'mean_word_error_rate': round(mean(item['word_error_rate'] for item in speech if item['cohort'] == group), 4)} for group in groups},
        'results': results,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset')
    parser.add_argument('--output')
    args = parser.parse_args()
    with open(args.dataset) as source:
        output = json.dumps(evaluate(json.load(source)), indent=2, allow_nan=False)
    if args.output:
        from pathlib import Path
        Path(args.output).write_text(output + '\n')
    else:
        print(output)

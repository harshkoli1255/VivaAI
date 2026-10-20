"""Offline speech/grade benchmark. Requires consented references and human marks.

Input JSON list: reference, transcript, optional human_score/ai_score (0-100),
optional cohort (a voluntarily supplied recording condition, not an inferred trait).
Run: python tests/quality/evaluate.py benchmark.json
No network calls or model-generated reference labels.
"""
import argparse
import json
import re
from statistics import mean


def word_error_rate(reference, transcript):
    expected = re.findall(r"\w+", reference.casefold())
    actual = re.findall(r"\w+", transcript.casefold())
    if not expected:
        raise ValueError("A non-empty reference transcript is required")
    previous = list(range(len(actual) + 1))
    for i, word in enumerate(expected, 1):
        current = [i]
        for j, observed in enumerate(actual, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (word != observed)))
        previous = current
    return previous[-1] / len(expected)


def evaluate(rows):
    if not rows:
        raise ValueError("Provide at least one labelled sample")
    results, grade_errors = [], []
    for row in rows:
        wer = word_error_rate(row['reference'], row['transcript'])
        result = {'id': row.get('id'), 'cohort': row.get('cohort', 'unspecified'), 'word_error_rate': round(wer, 4)}
        if row.get('human_score') is not None and row.get('ai_score') is not None:
            human, ai = float(row['human_score']), float(row['ai_score'])
            if not (0 <= human <= 100 and 0 <= ai <= 100):
                raise ValueError('Benchmark scores must be finite and within 0-100')
            result['grade_absolute_error'] = abs(human - ai)
            grade_errors.append(result['grade_absolute_error'])
        results.append(result)
    groups = sorted({r['cohort'] for r in results})
    return {'samples': len(results), 'mean_word_error_rate': round(mean(r['word_error_rate'] for r in results), 4),
            'human_graded_samples': len(grade_errors),
            'grade_mean_absolute_error': round(mean(grade_errors), 2) if grade_errors else None,
            'by_recording_condition': {group: {'samples': sum(r['cohort'] == group for r in results),
                'mean_word_error_rate': round(mean(r['word_error_rate'] for r in results if r['cohort'] == group), 4)} for group in groups},
            'results': results}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset')
    args = parser.parse_args()
    with open(args.dataset) as source:
        print(json.dumps(evaluate(json.load(source)), indent=2))

"""Known arithmetic, sparse evidence, invalid numbers and honest readiness status."""
import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('quality_evaluate', Path(__file__).with_name('evaluate.py'))
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


def test_word_counts_and_corpus_weighting():
    result = evaluation.evaluate([{'reference': 'one two', 'transcript': 'one'}, {'reference': 'one two three four', 'transcript': 'one two three four'}])
    assert result['mean_word_error_rate'] == .25
    assert result['corpus_word_error_rate'] == .1667
    assert not result['evidence_readiness']['speech']['ready']


def test_grading_correlation_and_consistency_without_speech():
    rows = [{'human_score': human, 'ai_score': ai, 'repeated_ai_scores': [70, 70, 70, 70, 70]} for human, ai in [(50, 55), (70, 75), (90, 95)]]
    result = evaluation.evaluate(rows)
    assert result['grade_mean_absolute_error'] == 5
    assert result['grade_pearson_correlation'] == 1
    assert result['mean_score_variance'] == 0
    assert result['speech_samples'] == 0
    assert not result['evidence_readiness']['grading']['ready']


@pytest.mark.parametrize('value', [float('nan'), float('inf'), -1, 101, True])
def test_bad_grades_are_rejected(value):
    with pytest.raises(ValueError):
        evaluation.evaluate([{'human_score': value, 'ai_score': 50}])


def test_latency_boundaries_and_percentiles():
    rows = [{'response_latency_ms': value, 'latency_boundary': 'end_of_speech_to_first_audio'} for value in [1000, 2000, 3000]]
    result = evaluation.evaluate(rows)
    assert result['latency']['p50_ms'] == 2000
    assert result['latency']['p95_ms'] == 2900
    assert result['latency']['p95_under_2500ms'] is False
    with pytest.raises(ValueError): evaluation.evaluate([{'response_latency_ms': 100}])


def test_synthetic_samples_cannot_satisfy_human_evidence():
    rows = [{'reference': 'a word', 'transcript': 'a word', 'consent': True, 'reference_source': 'human',
             'synthetic': True, 'language': 'en-IN'} for _ in range(20)]
    assert not evaluation.evaluate(rows)['evidence_readiness']['speech']['ready']


def test_hindi_vowel_marks_are_preserved_in_word_error_rate():
    assert evaluation.word_error_counts('मेरा नाम हर्ष है', 'मेरा नाम राम है') == (1, 4)
    assert evaluation.word_error_counts('किताब', 'कतब') == (1, 1)
    assert evaluation.word_error_rate("Don't panic, threads share memory.", 'dont panic threads share memory') == 0

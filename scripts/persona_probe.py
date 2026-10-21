"""Export three scripted viva transcripts and bounded policy checks.

Default: no network, microphone, database or paid APIs. Fixture labels test policy,
not classifier accuracy. --real-providers tests the configured LLM on synthetic
answers; it can incur API costs and still needs human review for question quality.
"""
import argparse
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))


async def run(real_providers=False):
    # Imports must never inspect the configured application database.
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
    os.environ["APP_ENV"] = "test"
    if not real_providers:
        os.environ['MOCK_MODE'] = 'true'
        os.environ['LLM_PROVIDER'] = 'mock'
        import random
        random.seed(0)
    from app.core.config import settings
    from app.api.routes.websocket_interview import InterviewSession
    from app.services.controller import InterviewController, ControllerState, ClassificationResult, AnswerLabel
    from app.services.classifier import classify_answer
    from app.services.llm_provider import get_llm_provider

    if real_providers and (settings.MOCK_MODE or settings.LLM_PROVIDER == 'mock'):
        raise ValueError('Configure a real provider with MOCK_MODE=false first')
    llm = get_llm_provider()
    # Question helpers need only the LLM; no session, recording or auth is created.
    examiner = SimpleNamespace(llm=llm)
    fixtures = json.loads((ROOT / 'samples/scripted-personas.json').read_text())
    results = []
    next_question = 'Describe one practical debugging example from your project.'
    for fixture in fixtures:
        controller = InterviewController(ControllerState(session_id='scripted-' + fixture['id']))
        controller.tick(61)
        question = fixture['question']
        transcript = [{'speaker': 'ai', 'text': question, 'timestamp_secs': 61}]
        checks = []
        for index, answer in enumerate(fixture['answers']):
            classification = (await classify_answer(question, answer['text'], llm) if real_providers
                else ClassificationResult(AnswerLabel(answer['label']), .95, 'Synthetic fixture label, not a model judgment'))
            elapsed = 90 + index * 30
            decision = controller.on_student_answer(answer['text'], classification, elapsed, 20)
            transcript.append({'speaker': 'student', 'text': answer['text'], 'timestamp_secs': elapsed,
                               'classification': classification.label.value, 'confidence': classification.confidence})
            if decision.action == 'ask_follow_up':
                reply = await InterviewSession._generate_intelligent_follow_up(examiner, question, answer['text'])
            elif decision.action == 'give_hint':
                reply = decision.message or await InterviewSession._generate_intelligent_hint(examiner, question, answer['text'])
            else:
                reply = await InterviewSession._generate_unified_transition(examiner, question, answer['text'], classification, next_question, 'fundamentals')
            checks.append({'expected_action': answer['expected_action'], 'observed_action': decision.action,
                           'passed': decision.action == answer['expected_action'] and bool(reply.strip())})
            transcript.append({'speaker': 'ai', 'text': reply, 'timestamp_secs': elapsed, 'policy_action': decision.action})
            # Hints retain the original question; a follow-up becomes the next question.
            if decision.action == 'ask_follow_up':
                question = reply
            elif decision.action == 'move_on':
                question = next_question
        results.append({'id': fixture['id'], 'passed': all(c['passed'] for c in checks),
                        'checks': checks, 'transcript': transcript})
    return {'generated_at': datetime.now(timezone.utc).isoformat(), 'synthetic': True,
            'mode': 'real_provider_synthetic_text' if real_providers else 'fixture_policy_mock_questions',
            'model': settings.LLM_FAST_MODEL if real_providers else 'mock',
            'passed': all(result['passed'] for result in results), 'personas': results,
            'human_follow_up_review': 'pending',
            'limitations': 'Short scripted text probes, not complete audio vivas. Fixture labels do not test classifier accuracy. Human review of relevance, depth, hints and answer leakage is still required.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--real-providers', action='store_true')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    report = asyncio.run(asyncio.wait_for(run(args.real_providers), timeout=240))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(f"Scripted personas: {'PASS' if report['passed'] else 'FAIL'}; {output}")
    sys.exit(0 if report['passed'] else 1)

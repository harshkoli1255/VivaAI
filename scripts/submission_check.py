"""Read-only submission inventory. Presence is not proof of challenge compliance.

No network or application database access. This never consumes private datasets;
use evaluate.py and the consent-checked demo exporter to inspect those separately.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = {
    'setup': ['README.md', 'docker-compose.yml', '.env.example'],
    'design': ['docs/DESIGN.md', 'output/pdf/vivaai-design.pdf'],
    'streaming_and_retention': ['docs/STREAMING.md', 'scripts/retention.py'],
    'sample_configuration': ['samples/viva-config.json', 'samples/questions.csv', 'samples/questions.json'],
    'test_report': ['TEST_REPORT.md'],
    'persona_probe': ['samples/scripted-personas.json', 'scripts/persona_probe.py', 'docs/validation/scripted-personas.json'],
    'benchmark_tools': ['tests/quality/evaluate.py', 'tests/quality/README.md'],
    'load_results_and_plan': ['docs/validation/transport-load.json', 'docs/CAPACITY.md'],
    'cost_tools': ['scripts/cost_sheet.py', 'docs/cost-inputs.example.json', 'docs/validation/cost-sheet-pending.json'],
    'privacy_note': ['docs/PRIVACY.md'],
    'demo_export_tool': ['scripts/export_demo_bundle.py'],
}

PENDING = [
    'Five complete consented demo vivas with recordings, transcripts and scores',
    'At least ten human-versus-AI grading comparisons with gap and correlation',
    'At least twenty accented English/Hinglish speech clips with human references and WER',
    'Human review of follow-up relevance, no answer leakage and fairness',
    'Real end-of-speech to first-audible-response p50/p95 below target',
    'Representative full-duration PostgreSQL and real-provider load proof at 50/100/150',
    'Measured provider usage and sourced operating costs for one viva and 350',
    'Institution-approved retention period, holds, purge and backup procedures',
    'Published live demonstration or five-minute video and shareable audit screenshots',
    'Container startup verification and pinned tested production image digests',
]


def inventory(root=ROOT):
    files = {name: {'present': [p for p in paths if (root / p).is_file()],
                    'missing': [p for p in paths if not (root / p).is_file()]}
             for name, paths in REQUIRED_FILES.items()}
    return {'generated_at': datetime.now(timezone.utc).isoformat(),
            'scope': 'Local source and evidence-file inventory only; does not validate artifact contents or a deployed system',
            'file_inventory_complete': all(not entry['missing'] for entry in files.values()),
            'challenge_ready': False, 'files': files, 'pending_verification': PENDING,
            'note': 'Review docs/REQUIREMENTS.md. File presence never marks human evidence, latency, privacy or production capacity as satisfied.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output')
    args = parser.parse_args()
    result = inventory()
    encoded = json.dumps(result, indent=2) + '\n'
    if args.output:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(encoded)
    else:
        print(encoded, end='')

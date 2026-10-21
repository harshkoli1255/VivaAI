# Challenge benchmark workflow

Use volunteers who consented to recording and evaluation. Keep human references
separate from model outputs; never generate human labels with AI. Split a held-out
set before tuning prompts. Use anonymous unique sample IDs and store consent
records separately from the benchmark export.

Run `.venv/bin/python tests/quality/evaluate.py /path/to/benchmark.json --output /path/to/report.json`.
The input is an array. Each row can provide speech, grading, consistency, latency,
or a combination. Omit absent measurements; do not insert zeroes for missing data.

```json
[
  {
    "id": "anonymous-sample-id",
    "consent": true,
    "synthetic": false,
    "language": "en-IN",
    "cohort": "quiet headset",
    "reference_source": "human",
    "reference": "VERBATIM HUMAN TRANSCRIPT GOES HERE",
    "transcript": "ACTUAL PROVIDER TRANSCRIPT GOES HERE"
  }
]
```

This is a schema illustration, not a dataset or a valid benchmark result. Remove
placeholder text and provide real consented observations before evaluating it.

For grading rows, add `human_score` and `ai_score` in 0–100 units and
`grade_source: "faculty"` (or `"peer"`). Have two faculty mark the same vivas
independently where possible, resolve disagreements, and document the method.
At least ten consented comparisons are needed; report mean absolute error and
Pearson correlation. Constant marks yield undefined correlation, not zero.

For consistency, add `repeated_ai_scores` containing at least five actual runs
of the identical transcript, `model`, and `prompt_version`. Keep temperature at
zero and report population variance and range; do not substitute mock results
for real-provider repeatability.

For speech, use at least twenty clips across Indian-accented English (`en-IN`)
and Hindi/Hinglish (`hi-en`). Record microphones, noise and other voluntarily
supplied recording conditions in `cohort`. The tool reports per-clip, corpus
word error rate, and condition breakdowns. Small samples do not establish fairness.

Latency rows require `response_latency_ms` and
`latency_boundary: "end_of_speech_to_first_audio"`. Measure actual speech end and
first audible playback using synchronized capture; preserve raw timestamps and
measurement method with the experiment. Server-call or mock WebSocket latency
is not an acceptable replacement. Report p50/p95 and the p95 < 2500 ms target.

`evidence_readiness` checks sample counts and labels, not academic validity.
Synthetic, unconsented and unlabelled references cannot satisfy human evidence.
No human-labelled dataset is included in this repository.

# Network and capacity testing

`.venv/bin/python scripts/transport_load_test.py --levels 50 100 150 --output results.json`
starts a disposable server, provisions revocable test sessions, and drives real
HTTP, WebSocket, mock STT/TTS turns, recording uploads, and durable scoring jobs.
It reports actual peak connections, failures by stage, transport latency, server
CPU and RSS. Credentials and raw tickets are not included in results.
It never targets your existing database or calls a paid provider.

This is an integration load probe, not production speech capacity proof. Repeat
against an isolated representative PostgreSQL deployment with real provider
quotas/audio clients and resource monitoring to satisfy the production requirement.
See `docs/CAPACITY.md` for what must still be measured.

# Cost sheet

Copy `docs/cost-inputs.example.json`, fill actual usage, quoted rates, source URLs
and quote dates, then run `python scripts/cost_sheet.py inputs.json --output costs.json`.
Missing data keeps totals pending. API and self-hosted totals are calculated
separately for one viva and a cohort of 350.

# Scripted interview evidence and submission inventory

Run `.venv/bin/python scripts/persona_probe.py --output docs/validation/scripted-personas.json`
for three short synthetic persona transcripts. Fixture labels deliberately test
controller decisions; they do not establish classifier accuracy or question
quality. Optional `--real-providers` makes model calls on those synthetic answers
and can incur costs. Have a reviewer check relevance, increasing depth, one
bounded nudge, no answer leakage and respectful topic changes in either mode.

The WER normalizer applies Unicode NFC and case folding, removes apostrophes and
replaces other punctuation with word boundaries. It preserves Unicode combining
marks, including Hindi vowel signs. Report this normalization with results;
transliteration and equivalent technical spellings are not silently treated as
identical. Freeze this method before comparing providers.

Run `.venv/bin/python scripts/submission_check.py --output docs/validation/submission-inventory.json`
to inventory submission files. It never treats file presence as sufficient
academic or performance evidence. See `docs/REQUIREMENTS.md` for the full matrix.

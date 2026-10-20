Use consented recordings and verbatim human transcripts covering technical
vocabulary, accents, code switching, pauses, microphones and background noise.
Keep a separate held-out set; do not tune prompts on it. Have faculty label
rubric dimensions independently, resolve disagreements, and record grade units
as 0-100. Never substitute AI-generated grades for faculty labels.

Run `python tests/quality/evaluate.py /path/to/benchmark.json` on a JSON array:

```json
[{"id":"sample-id", "reference":"human verbatim transcript", "transcript":"provider transcript", "cohort":"quiet headset"}]
```

Add optional `human_score` and `ai_score` only when genuine labelled assessments
exist. The report shows word error rate, grade mean absolute error and recording
condition breakdowns with sample counts. Small or unrepresentative groups do not
establish fairness. Establish acceptance thresholds with faculty before release.
No labelled human dataset is included in this repository. Browser tests use
synthetic speech and validate integration, persistence and recovery; they do
not establish human speech accuracy or academic validity.

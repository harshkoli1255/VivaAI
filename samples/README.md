# Sample viva setup

These are authored examples, not student records, faculty-approved questions, or
benchmark labels. Faculty must review the questions before starting an exam.

- `viva-config.json`: POST body for `/api/v1/viva-configs`; includes the standard
  900-second schedule, all five rubric weights and questions for every spoken phase.
- `questions.csv` / `questions.json`: upload examples for
  `/api/v1/viva-configs/{id}/upload-questions`. Uploaded questions remain pending
  until faculty approve them. The JSON file is a question array, not a config body.
- `scripted-personas.json`: synthetic strong, weak and don't-know answer fixtures.
  Expected labels are test inputs, not measured AI or faculty judgments.

Run `.venv/bin/python scripts/persona_probe.py --output docs/validation/scripted-personas.json`
to export policy outcomes and short transcripts without API calls or real data.
`--real-providers` uses the configured model and may incur costs. Its synthetic
question/answer outputs still require human review; it is not a speech or grading
accuracy benchmark and does not replace the five complete recorded demos.

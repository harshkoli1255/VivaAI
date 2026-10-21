# PDF comparison and completion checklist

Reviewed 21 October 2026 against the supplied seven-page AI Viva Challenge.
This is a source-and-evidence audit, not certification or a claim of bug-free
production operation. **Implemented** means the local feature exists and is
covered by the stated checks. **Partial** means implementation or mandatory
validation remains. **Missing evidence** must not be replaced with mock results.

## Required product

| PDF requirement | Status | What exists / what remains |
|---|---|---|
| Faculty subject, topics, difficulty and question bank | Implemented | Faculty setup, CSV/JSON upload, syllabus generation and approval endpoints. Authored importable samples now live in `samples/`. Full manual coverage of every setup option remains advisable. |
| Student ID, rules and recording consent | Implemented | Login and consent UI; backend ownership and consent enforcement; browser regression. Login associates an account; there is no biometric identity proof. |
| Voice interview, roughly two-second replies | Partial | Spoken questions, live cloud interim/final STT, native dictation, review and saved-clip retry. MP3 playback is progressive where MediaSource is supported. Actual end-of-speech-to-audible p50/p95 is not established. |
| Strong/partial/don't-know/off-topic policies | Implemented; quality review pending | Bounded deeper probe, one hint, topic change, redirect and approximately 90-second cap. Short scripted transcripts and checks are reproducible. Human relevance/no-leakage evaluation remains. |
| Depth selects strongest area | Implemented this review | Confident answer labels establish topic strength. Depth prefers approved questions in that topic; generated variants use it if the bank is exhausted. Preference restores from transcript question IDs on rejoin. No evidence means no invented strength. |
| Hard 15-minute limit, visible timer, graceful finish | Implemented | New configs cannot exceed 900 seconds; legacy longer configs also hit the controller's 900-second ceiling. Faculty UI uses the standard 15-minute option. Shorter API durations remain available for tests. |
| Customizable phase structure | Implemented in API; limited UI | Validated contiguous phase intervals with standard defaults. Phase-level editing is not exposed in the simplified faculty UI. |
| Approved questions or traceable variants | Implemented | Approved bank selection, question references, variant flags, and timestamped transcript. AI variants still need human quality review. |
| Five 0–5 dimensions and weighted total /100 | Implemented | Standard 30/25/20/15/10 weights; versioned temperature-zero scorer after the interview. |
| Evidence per dimension and each of 3–5 feedback lines | Implemented | Validated candidate-turn references, both portals' transcript links, and PDF internal excerpt links. Missing evidence requires faculty review; historical links are not fabricated. |
| Low-confidence review and reasoned faculty override | Implemented | Unsupported grades withheld; authorized override wins and logs reviewer/reason/old and new marks. |
| Full audio and audit persistence | Implemented locally; production durability pending | New conversation fragments mix candidate microphone and actually played AI audio; typed sessions capture AI without microphone permission. Historical microphone-only captures remain labelled. Synthetic tone and real-provider browser checks pass. Production storage durability and backup/restore remain unverified. |
| Faculty dashboard, playback, transcript, scores, override | Implemented | Authorized dashboard and review, citation seeking and mark override pass browser regression. |
| Separate live interviewer and offline scorer | Implemented; performance pending | Live classification now selects the configured fast model; offline scoring keeps the strong model. Next-question transitions no longer make an extra LLM call. Measured latency/cost benefits are not claimed. |
| Retry/fallback/queue | Partial | Bounded SDK retries, real TTS fallback/cooldown, durable asynchronous scoring jobs, answer persistence and reconnection. Sustained real-provider throttling/outage at 150 sessions is unverified. |

## Mandatory evidence and tests

| PDF evidence | Status | Evidence / next action |
|---|---|---|
| Five complete recorded demo vivas | Missing evidence | One historical synthetic full-duration run exists, not a complete five-demo package. Consent-checked exporter is prepared; collect and inspect all five. |
| Three scripted personas with transcripts | Prepared and locally checked | `samples/scripted-personas.json`, `scripts/persona_probe.py`, `docs/validation/scripted-personas.json`. Default mode uses fixture labels and mock questions; it tests policy, not classifier accuracy. Optional real-provider mode still needs human review. |
| At least ten AI/human mark comparisons | Missing dataset | Evaluator computes MAE and Pearson correlation; requires consented faculty/peer marks on the same vivas. |
| Five repeated scores per transcript | Partial evidence | Existing real model probe repeated one synthetic transcript five times: 94/100 every run, variance 0. This is a narrow repeatability observation, not agreement with human grading. |
| WER on at least twenty accented English/Hinglish clips | Missing dataset | Evaluator and condition breakdowns prepared. Unicode normalization preserves Hindi vowel marks. Need real clips and verbatim human references. |
| Real response p50/p95; p95 <2.5 seconds | Missing measurement | Evaluator requires the correct timing boundary. Mock message response and server-call times do not satisfy audible response latency. |
| Network drop and rejoin | Locally checked | Browser flow covers offline/reload, no duplicate answers, recording continuity and API restart before scoring. Production/network diversity remains. |
| Muted mic, silence, noise | Partial | Audio readiness, silence handling and low-confidence review paths exist. Actual noisy/muted human-microphone behavior is not comprehensively measured. |
| Prompt injection and off-topic safety | Partial | Unit/provider probes cover grading injection and deterministic redirect. Neutral topic transitions cannot follow candidate instructions or add answers. Broader real-provider adversarial and accent-bias testing remains. |
| Audit screenshots/video | Partial | Local browser screenshots and click/replay checks exist under ignored `test-results/`. Select anonymous screenshots for the shareable submission. |
| 50/100/150 audio load and error/resource table | Partial; target missed at 150 | Real transport with mock providers/SQLite completed 300 short sessions with no drops. p95: 1.09s, 1.58s, 3.09s. This is not real speech or production PostgreSQL evidence; 150 exceeds 2.5s. |
| Breaking point, capacity and quotas | Partial | First mock tested latency degradation at 150, CPU/RSS and capacity formulas recorded. Real-provider errors, GPU where applicable, quotas and full-duration breaking point remain unmeasured. |
| Cost per viva and 350; API vs self-hosted | Tools complete; numbers pending | Calculator/template prepared. Enter measured usage, sourced dated rates and hosting/idle allocations. Unknown totals remain null. |

## Submission and privacy

| Deliverable | Status |
|---|---|
| Repository, README and one-command local setup | Present. Local portal run previously verified; Compose syntax validates. Docker daemon is stopped here, so a container startup is unverified. No commit or push authorized. |
| Live demo or five-minute video | Missing shareable deliverable. Local previews do not count as a public demo link. |
| Architecture and short design document | Present in `docs/DESIGN.md` with Mermaid diagram. A rendered, visually checked three-page version is available at `output/pdf/vivaai-design.pdf`. |
| Sample question bank and rubric configuration | Complete: `samples/viva-config.json`, `questions.csv`, `questions.json`; faculty approval still required. |
| Test Report and reproducible raw results | Present with bounded claims. Latest backend/benchmark suite: 188 pass; browser regression passes with zero page errors. Human datasets and five demo artifacts remain pending. |
| Load results and capacity plan | Present as partial local evidence; production proof pending. |
| Privacy note | Present: storage, access, providers and known limitations. Faculty retention holds and a disabled-by-default, policy-gated operator purge are implemented/tested. Institution must approve retention/appeal window, backups, object versions, providers and external copies. No real records were deleted. |
| Consent, no keys in repository, tool/model credit | Consent/access enforcement and secret-file ignores exist. Benchmark volunteers and sharing need organizer approval. Configured model probe identifies its model; confirm all final deployment providers, versions, licences and costs before submission. |
| Reproducible production images | Partial: moving tags remain; tested digest pinning and deployment checks are outstanding. |

## Optional bonuses (not required for qualification)

| Bonus | Status |
|---|---|
| Code/whiteboard round | Optional collapsed code snippet plus explanation implemented; saved as text, never executed. |
| Tab switches and long silence | Implemented activity signals; not proof of cheating. |
| Reading from screen and multiple-voice detection | Provider-estimated multiple-voice signals implemented for faculty review without changing marks. Reading-from-screen inference is not implemented. |
| Hindi/Hinglish | Live language selection and separate multilingual model implemented; human recognition accuracy/fairness remain unverified. |
| Calibration mode | Faculty CSV comparison page and authorized API implemented; stores independent labels without overriding marks. Mock comparisons are labelled and cannot establish real benchmark readiness. No human dataset exists yet. |
| CSV/Google Sheets export | CSV implemented; direct Google Sheets integration missing. |

## Reproduce without a dataset

```bash
.venv/bin/pytest backend/tests tests/quality -q
.venv/bin/python scripts/persona_probe.py --output docs/validation/scripted-personas.json
.venv/bin/python scripts/submission_check.py --output docs/validation/submission-inventory.json
npm run lint
npm run test:e2e
npm run build
```

Run browser tests and builds sequentially; both use generated Next.js type files.
The inventory is read-only and checks file presence, not challenge compliance.
See `tests/quality/README.md` for benchmark collection, `docs/CAPACITY.md` for real
load requirements, `docs/PRIVACY.md` for privacy decisions, and `TEST_REPORT.md`
for test scope. No overall completion percentage is assigned: software features,
human evidence and operational proof cannot be meaningfully averaged together.

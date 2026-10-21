# VivaAI verification and challenge compliance report

Review date: 21 October 2026. Source: supplied AI Viva Challenge PDF.
All changes remain local, uncommitted and unpushed. No deployment was performed.
See `docs/REQUIREMENTS.md` for the requirement-by-requirement status matrix.

## Current checks

| Check | Result | Scope |
|---|---|---|
| `.venv/bin/pytest backend/tests tests/quality -q` | 188 passed in 93.32s | Isolated SQLite, API/auth, controller, provider contracts, evidence, recordings, durable scoring and benchmark arithmetic |
| `npm run lint` | Pass: zero errors, five existing warnings | Student/faculty/shared code; warnings concern cross-origin portal navigation via `window.location.assign` |
| `npm run test:e2e` | Pass, zero browser page errors | Chrome, synthetic microphone and mock providers, disposable database |
| `npm run build` | Pass: both portal builds and TypeScript | Both production portal builds and TypeScript |
| `python scripts/persona_probe.py --output docs/validation/scripted-personas.json` | Three personas pass | Short virtual-time transcripts; fixture labels test policy, not semantic classifier accuracy |
| `python scripts/submission_check.py --output docs/validation/submission-inventory.json` | All expected source/evidence files present; challenge not ready | File inventory only, with pending evidence explicitly listed |
| `docker compose config --quiet` | Pass | Syntax/interpolation only; Docker daemon not running, no container startup verified |
| `git diff --check` | Pass | Whitespace check; not a functional test |

The browser test initially could not open localhost sockets inside the execution
sandbox. It was rerun with local networking enabled and passed. It checks login
and HttpOnly cookies, readiness/consent, answer submission, editable speech drafts,
clear-answer behavior, late recognition callbacks, offline/reload without duplicate
answers, incremental recording continuity, API restart, separate scoring worker,
student feedback links, faculty transcript/audio playback and evidence seeking,
reasoned mark override, CSRF rejection, logout, and mobile typed answers. Theme
and interactive Three.js preview checks pass. All six schema migrations apply
on a fresh database. Artifacts are local under ignored `test-results/candidate-flow/`.

These tests do not establish human speech accuracy, universal browser/device
support, academic fairness, production uptime or zero bugs.

## Changes completed in this review

- Enforce the 900-second ceiling both in new configuration validation and in the
  controller for legacy longer configurations. Faculty setup presents 15 minutes.
- Prefer the strongest confidently classified topic during depth, retain question
  traceability and rebuild the preference from stored answers on rejoin. Exhausted
  bank choices fall back without repeating questions.
- Replace generated topic-change acknowledgments with neutral deterministic
  transitions. This preserves the selected next question verbatim, removes one
  live LLM request and prevents candidate instructions or answer explanations
  from entering the transition. No measured latency improvement is claimed.
- Route live JSON classification to the configured fast model. Final scoring keeps
  the stronger model at temperature zero. Offline provider-routing tests pass;
  the previous real-provider observations below predate this routing change.
- Add authored CSV/JSON question samples and a complete sample rubric/config.
- Add reproducible three-persona transcript export and a read-only submission
  inventory that does not confuse file presence with compliance.
- Preserve Hindi combining/vowel marks in WER normalization, with regression tests.
- Correct stale README claims about streaming cloud STT, audio storage, audit
  immutability and a zero-penalty interpretation of "I don't know".

Earlier local changes retained: shared Tailwind theme and responsive portals;
visible theme toggle and reduced-motion/WebGL-safe Three.js preview; speech draft
editing and Clear answer; validated per-feedback-line evidence with authorized
transcript links in both portals and internal PDF links; malformed evidence holds
new grades for faculty review. Historical missing citations are never invented.

## Existing real-provider observations (before this review's changes)

`docs/validation/real-provider-probe.json` records a narrow synthetic test of
`qwen/qwen3.8-27b`: a concise correct answer classified strong, supported feedback
used valid candidate citations, the same synthetic transcript scored 94/100 five
times (population variance 0), and injection-only answers were withheld for
faculty review. It is not a human grading comparison or a fairness benchmark.

A previous synthetic real-provider browser run exercised cloud speech review,
preservation of original/corrected transcripts and interruption. ElevenLabs
returned quota exhaustion; configured real Deepgram TTS fallback succeeded.
Replenish quota before relying on ElevenLabs. One-answer tests correctly withheld
unsupported full-rubric grades. Those earlier observations remain historical; the fresh streaming check is described below.

Historical `test-results/candidate-full-duration/result.json` records a 916.4s
synthetic real-provider run, 870.2s audio, six phases and fifteen submissions,
with no browser errors and a review-required outcome. This is not five complete
demo vivas and is not a current fresh timing run.

## Existing isolated transport load evidence

Raw results: `docs/validation/transport-load.json`. These measurements predate
this review's performance-related code changes and have not been rerun.

| Concurrent bots | Completed | Drops | Mock response p95 | Peak backend RSS | Avg CPU (one core = 100%) |
|---|---:|---:|---:|---:|---:|
| 50 | 50 | 0 | 1085.61ms | 168.83MiB | 77.96% |
| 100 | 100 | 0 | 1584.39ms | 226.92MiB | 95.65% |
| 150 | 150 | 0 | 3087.45ms | 263.50MiB | 109.55% |

The probe uses authenticated HTTP/WebSockets, synthetic WAV messages, recording
uploads and durable scoring on a disposable local SQLite/mock-provider server.
All requested bots connected together before answer traffic. Provisioning is
excluded from turn latency. Other development/regression services were active.
The first tested p95 target failure is 150. This is **not** real end-of-speech to
first-audible latency, full-duration production capacity or a real-provider/GPU
error measurement. The older in-process `scripts/load_test.py` excludes even
transport/storage and must not be submitted as cohort-capacity proof.

## What still prevents a complete submission

1. Five complete consented demo recordings, transcripts and scores, plus a
   shareable live demo or five-minute video and anonymous audit screenshots.
2. At least ten consented human/AI grading comparisons and at least twenty
   accented English/Hinglish clips with verbatim human references. No dataset
   exists yet. Tools compute MAE/correlation/WER without inventing labels.
3. Human assessment of relevance, no answer leakage, fairness and language mixing.
   One synthetic five-run consistency probe is only a limited observation.
4. Real speech end-to-audible p50/p95, including the required p95 <2.5 seconds,
   and representative noisy/muted-mic/rejoin conditions. Live cloud STT and progressive MP3 playback are implemented and tested; this does not establish human response percentiles.
5. Full-duration representative PostgreSQL/provider tests at 50/100/150 with
   error breakdown, resource monitoring, quota checks and actual breaking point.
6. Validated cost inputs and per-viva/350-student totals for API and self-hosted
   modes. `scripts/cost_sheet.py` keeps unknown totals pending.
7. Institution-approved retention, appeal window and backup/provider expiration
   procedures. Faculty holds and a policy-gated operator purge are now implemented. No production data was deleted and no arbitrary policy
   was enabled.
8. Production recording durability/restore verification. New browser recordings
   now mix candidate and played AI audio; this feature is no longer missing.
9. Container startup and reproducible tested image digests. A rendered, visually
   checked three-page architecture PDF now exists in output/pdf/vivaai-design.pdf.

Prepared helpers: `scripts/export_demo_bundle.py` (authorized consent-checked
export), `tests/quality/evaluate.py`, `scripts/persona_probe.py`,
`scripts/submission_check.py`, `scripts/cost_sheet.py`, and
`scripts/transport_load_test.py`. Operational plans are in `docs/CAPACITY.md` and
`docs/PRIVACY.md`. Optional bonus features are tracked separately in the matrix.

## Local preview during verification

The preview was preserved while it had active connections. After it became idle,
its SQLite database was backed up privately to preview.before-streaming.db and
its managed supervisor restarted. The refreshed student (3000), faculty (3001)
and backend (8001) services all return HTTP 200. Existing session data was retained.


## Streaming speech, mixed recordings and remaining feature implementation

New files/routes implement:

- Live Deepgram WebSocket transcription with interim/final segments, bounded
  queues/frames/total duration, one-use tickets, consent/ownership/state checks,
  frozen question binding and signed editable drafts. A stopped stream flushes
  through CloseStream. Failure retains a browser clip for complete-file retry.
  Resumption appends to visible edits; Clear answer invalidates capture state.
- Progressive MediaSource MP3 playback, with complete-file WAV/unsupported-browser
  fallback, interruption handling and Web Audio routing. New recordings mix the
  candidate microphone and actual AI playback; typed sessions record only AI
  without requesting microphone permission. Historical candidate-only fragments
  remain labelled. Unrecordable device-speech fallback is disabled during capture.
- Hindi/mixed language selection with a separate multilingual model; human WER
  and fairness validation are still missing. Provider diarization may add review
  signals without changing marks or asserting misconduct.
- An optional collapsed code-snippet field, persisted through reload and saved
  with the candidate explanation; code is never executed.
- Faculty retention holds with mandatory reasons and audit logs. The operator
  retention tool is disabled until an approved policy/period are configured,
  plans by default and requires explicit apply/policy/receipt arguments. Old,
  ended, reviewed, unheld records without pending scoring can qualify; eligibility
  is rechecked. Actual deletion tests ran only against disposable test databases.
- A faculty calibration CSV page/API that compares original stored AI scores with
  independent uploaded marks, computes gap/correlation, stores reviewer provenance
  and never overwrites assessment marks. Mock comparisons are labelled and cannot
  establish real benchmark readiness. No human-labelled dataset was added.
- A reproducible three-page design PDF, rendered and visually checked.

The expanded Chrome mock-provider regression passes with zero page errors,
including live draft before Stop, confirmation, partial edit/resume, clearing,
code submission, calibration upload/results, holds, evidence links, rejoin,
recording reconstruction and restart recovery. Two distinct frequencies in the
saved WAV prove microphone (440Hz) and played AI (880Hz) capture. The final result
is in test-results/candidate-flow/result.json and tones in mixed-audio-proof.json.

A separate short playback probe excludes silent unlock/readiness sounds by
observing blob media only. AI MP3 playback begins before the server sends its last
chunk; raw event times are in test-results/candidate-audio-streaming/. This is not
an end-of-human-speech latency benchmark. Real speech p50/p95 remains pending.

A fresh configured real-provider browser run also passes streaming English
transcription, candidate correction/original preservation, barge-in, mixed audio,
restart recovery and faculty review. It uses synthetic speech and a disposable
SQLite database. ElevenLabs quota is exhausted; the real Deepgram fallback works.
That run predates the final edited-prefix UI refinement, which was verified in
the subsequent mock browser regression. Hindi/mixed recognition quality and
production PostgreSQL/concurrent-provider behavior are not established.

Fresh current checks: full backend/quality suite 188 pass; focused calibration,
streaming and retention suite 18 pass; both production builds pass, including
/calibration; lint has zero errors and the same five navigation warnings. Six
migrations apply cleanly. No commit, push, deployment or real-data purge occurred.

Final safeguard: concurrent AI/candidate transcript writes are serialized through
commit so evidence indices remain distinct. Its regression is included in the
188-test passing suite.


## Download and faculty review regression — 21 October 2026

The reported faculty report download returned 404 for a manually assessed session with no AI score report. PDF export now supports faculty-only marks without inventing AI dimensions, feedback, or scores. Reports label withheld AI marks, remove unsupported accreditation/integrity/grade classifications, and retain reviewer identity and the recorded adjustment reason. Sessions with neither an AI report nor a faculty mark have a disabled download action with an explanation. Failed download responses expose the server's useful error detail without triggering the development console overlay.

Related fixes: shared PDF/JSON downloads attach the link and delay object-URL cleanup; faculty adjustments immediately update the review-status badge; whitespace-only/short justification strings are rejected after trimming; repeated adjustment audit logs use the previous effective mark; dashboard averages use faculty-adjusted marks.

Validation for this change:
- 194 backend and quality tests passed (`.venv/bin/pytest backend/tests tests/quality -q`, 147.36 seconds).
- Faculty production build passed; lint passed with the same five existing cross-portal navigation warnings.
- Full isolated mock browser regression passed with zero page errors, including actual PDF (faculty-only and AI), CSV, and calibration JSON downloads. Raw results: `test-results/candidate-flow/result.json` (local, ignored).
- The exact reported session downloaded through the running local faculty portal in Chrome; its mark and transcript were not modified. The PDF was parsed and its single rendered page visually inspected. Private local evidence remains under `test-results/download-regression/` (ignored).
- Both local portals and API were restarted while idle; all seven saved preview sessions were preserved. No commits or pushes.

This verifies these functional fixes; it does not replace the remaining real-data benchmarks or establish that the whole application is bug-free.


## Portal UI polish — 21 October 2026

Shared component styles now live in Tailwind's components layer so per-screen spacing and sizing utilities work consistently. Native dropdowns retain keyboard and assistive-technology behaviour, with custom theme-aware chevrons inset 16px and 48px reserved for the text. Forced-colour mode restores the native indicator. Mobile form text uses 16px to avoid automatic zoom.

The landing and sign-in screens, portal navigation, setup stepper and form spacing, readiness, results, dashboard, calibration, and faculty review use the refined shared visual language. Tablet dashboards use session cards instead of clipping the wide table; footer actions and transcript badges wrap at narrow widths. Rubric controls stack on small screens. Examiner and banner panels scope their contrast colours so light-theme text stays readable on dark surfaces. Existing Three.js preview interactions and reduced-motion support remain available.

The recording timeline supports keyboard seeking (left/right, Home/End); nested playback buttons no longer trigger the enclosing turn's keyboard handler. The average-mark card now uses a count of scored sessions, including faculty-only marks and legitimate zero scores, rather than hiding marks when no session has the `completed` status.

Validation:
- 37 loaded-page viewport/theme checks across 320, 390, 768, and 1440 pixels: no page overflow or page errors. Dark and light screens, setup steps, and narrow rubric/transcript layouts were visually inspected. Raw local screenshots are ignored under `test-results/ui-polish/`.
- Both final production builds passed; lint passed with five existing cross-portal navigation warnings.
- Six focused backend report/statistics regressions passed, including the scored-session count.
- Final full isolated mock browser flow passed with zero page errors, including keyboard timeline seeking, streaming draft edits, recording recovery, feedback evidence, mobile typed answers, and PDF/CSV/calibration downloads.
- An earlier attempt caught a Next.js development hot-refresh initialization race during concurrent preview startup. The unchanged-source rerun after builds/startup settled passed; this was not hidden by filtering browser errors.
- No existing preview marks or transcripts changed. No commits or pushes.

Machine-readable summary: `docs/validation/ui-polish.json`. These are Chrome checks, not a claim of exhaustive cross-browser or bug-free coverage.


## Versioned viva management and portal shortcuts — 21 October 2026

Faculty now have a searchable viva library, including latest versions, paused enrollment, version history, approved/pending question counts, session counts, per-viva review/CSV filtering, duplication, student invitation links, and question-bank downloads. The shared editor loads an existing viva, edits its details/questions/rubric, imports a staged JSON bank requiring approval, restores unsaved work within the same tab, and explicitly opens or pauses enrollment on publication. Course codes persist with the configuration.

Every published edit creates a new configuration ID/revision. Previous configurations and question IDs remain intact for scheduled/running/completed interviews, reconnects, transcript foreign keys, and delayed scoring. The previous version closes to new enrollment. Pausing enrollment also preserves existing interviews. Old bank mutation endpoints and asynchronous question-generation persistence reject changes to used or superseded banks. Enrollment and publication share a database lock; edit timestamps detect stale drafts. Two concurrent publishers produce one success and one conflict, rather than an overwrite.

Student improvements: invitations survive sign-in and select the intended viva; unavailable invitations require an explicit new selection; saved interviews are available from readiness; viva/history search uses course metadata; personal assessment PDFs download from feedback with the existing authorization checks.

Validation:
- 198 backend and quality tests passed in 111.54 seconds, including preservation of old questions, rubric, timing, transcript references, new-enrollment routing, stale/concurrent edits, private faculty data, and filtered CSV output.
- Both production builds passed, including `/setup/[id]` and `/setup/[id]/duplicate`. Lint passed with the same five existing cross-portal navigation warnings.
- `tests/e2e/viva_management.py` passed using an isolated mock database and synthetic student. A live student remained connected while faculty paused enrollment and published a new revision, then submitted an answer and resumed with the original configuration. Draft restore, duplicate publication, JSON import/export, version history, invitation sign-in, student report download, and mobile layout passed with zero page errors.
- The existing full candidate browser flow also passed, including streaming transcription, edited-draft resets, both-sided recordings, offline/reload/API-restart recovery, evidence links, faculty playback, all download types, and mobile typed answers.
- The additive migration `b73d0a8e214f` applied to a fresh database in both browser suites. The idle preview was backed up before its development schema upgrade; the existing saved vivas/interviews were not edited during implementation.

Machine-readable summary: `docs/validation/viva-management.json`. These tests do not replace the remaining human-dataset and production-capacity benchmarks. No commits or pushes.

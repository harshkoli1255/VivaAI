# Privacy, audio and retention

## Capture and access

The candidate records consent before capture. New browser recordings mix the
microphone and the AI audio actually played into a single Web Audio stream.
Repeated questions and interrupted playback are captured as heard. Typed sessions
record AI playback without requesting microphone access. Unplayed/muted AI audio
is not invented in the recording. Browser system-speech fallback is disabled
while audit recording is active because it cannot be captured by Web Audio.

New fragments declare `recording_kind=conversation`; old and unsynchronised
legacy microphone fragments retain `candidate`. This is capture metadata, not
cryptographic proof that a candidate used the intended microphone. IndexedDB
stores pending fragments; acknowledged bytes persist in the database. An abrupt
device shutdown can still lose the final unacknowledged fragment.

Transcripts, questions, scores, evidence links, faculty overrides and audit logs
are stored per session. Production requires PostgreSQL; local previews/tests use
separate SQLite files. Legacy whole-file audio may use private S3/MinIO. Students
can access their own sessions; faculty can review authorized cohort records.
REST credentials remain in HttpOnly cookies; recording playback is authenticated.

## Providers and streaming

Live speech uses a short-lived, one-use ticket over WSS in production, with
ownership/consent/active-session checks and bounded duration, payload and queue
sizes. Audio fragments go immediately to Deepgram. Interim text is an editable
draft and is not graded; a signed final receipt preserves original recognition
when the student confirms corrections. A stopped/failed stream does not silently
fall back to mock speech. The saved-clip retry uses complete-container STT.

English uses the configured English model; Hindi/mixed input uses the separately
configured multilingual model. Provider diarization can flag two voice clusters
with enough words for faculty review. These are probabilistic clusters within a
clip, not identified people or proof of misconduct, and do not change marks.
Interviewer/scorer providers receive relevant transcript context; TTS receives
question text. Provider regions, retention and account contracts require review.

## Retention feature (disabled pending institutional policy)

There is **no approved retention period enabled**. `RETENTION_DAYS=0` and an empty
`RETENTION_POLICY_ID` disable planning/deletion. Faculty can add/remove a retention
hold with a reason; changes are audited and visible in the review page.

Once an institution approves the period and policy ID, `scripts/retention.py`
plans eligible records by default. Only ended, old, reviewed/overridden, unheld
records without queued/processing scoring jobs qualify. Apply requires an explicit
matching policy ID and a new private receipt path. Eligibility is rechecked under
a row lock. The operation removes current database child records and known local/
legacy object audio, and records deleted/skipped/failed outcomes. An unavailable
legacy object store prevents claiming a successful purge. No actual student or
preview record was deleted in this work; deletion tests use disposable databases.

The live-data purge is not a global erasure guarantee. Institution procedures must
also cover backups, object versions, cached provider copies, private exports,
browser pending fragments/drafts, audit-receipt retention and appeal windows.
Cross-store deletion is not one atomic transaction; failures require operator
inspection and retry. Do not automatically schedule or enable the tool until the
institution approves its scope, settings, access and recovery procedure.

## Benchmarks and calibration

Application recording consent alone does not establish approval to publish a
benchmark dataset. Use consenting volunteers, anonymous IDs, separate consent
records, restricted exports and a held-out set. Calibration uploads retain the
faculty reviewer and comparison in audit logs and do not change marks. Mock AI
scores are labelled development evidence and cannot make the calibration benchmark
ready. Do not commit private recordings, exports, labels, API keys or credentials.
No regulatory certification or accreditation is claimed.

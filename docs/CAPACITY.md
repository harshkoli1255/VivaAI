# Capacity plan and measured boundary

## Measured local integration run — 21 October 2026

Run: `.venv/bin/python scripts/transport_load_test.py --levels 50 100 150 --output results.json`.
Raw results and per-bot outcomes are in `validation/transport-load.json`.
The run used one local Uvicorn process, SQLite, mock STT/TTS/LLM, three synthetic
WAV answer turns per bot, actual WebSockets and authenticated recording uploads.
All requested bots reached simultaneous connected state before answer traffic.
Provisioning/authentication setup is excluded from per-turn latency. Local
preview servers and regression work were also active; the machine was not an
isolated performance lab.

| Concurrent bots | Completed | Drops | Mock response p95 | Peak backend RSS | Avg backend CPU (one core=100%) |
|---|---:|---:|---:|---:|---:|
| 50 | 50 | 0 | 1085.61 ms | 168.83 MiB | 77.96% |
| 100 | 100 | 0 | 1584.39 ms | 226.92 MiB | 95.65% |
| 150 | 150 | 0 | 3087.45 ms | 263.50 MiB | 109.55% |

The first tested level crossing 2500ms was **150**. This is a measured degradation
boundary for this limited local setup, not a provider capacity or real speech
breaking point. The response metric is audio-message send to first returned mock
audio chunk; it excludes audible browser playback and human speech recognition.
Provider STT/TTS/LLM error rates and GPU usage are unmeasured, not zero.

## Production validation plan

1. Use a separate representative PostgreSQL deployment, private storage, and a
   configured paid-provider project. Start with one live API process per worker
   and an independent scoring worker pool. Size from measurements; no fixed
   server count is claimed sufficient here.
2. Run real audio clients at 50, 100 and 150 simultaneous sessions for the entire
   15-minute timeline. Include pauses, muted microphones, reconnects and noise.
   Repeat levels, preserve raw timestamps, and record provider errors separately.
3. Measure end-of-speech to first audible playback p50/p95, dropped sessions,
   queue wait, provider retries/429s, event-loop lag, database latency/locks,
   CPU/RAM and any self-hosted GPU utilization. Increase concurrency until a
   documented target fails; do not report a guessed breaking point.
4. Set concurrency and admission limits from the worst passing repeated level.
   Reserve provider quota for active interviews and separate scoring demand.
   Candidate answers persist before provider calls; exhausted retries surface
   review/recovery states instead of invented speech or marks.
5. Calculate effective provider quotas: with A live answers/minute/student,
   interviewer demand is at least `150 × A` requests/minute, plus classification
   if separate. STT must sustain 150 live streams or answer-upload throughput;
   TTS character/token quotas depend on measured speech. For scoring duration S
   seconds and desired queue drain D seconds, minimum scorer concurrency is
   `ceil(150 × S / D)` before retry headroom. Confirm vendor account limits.

## Recording and database budget

At 32 kbit/s, 900 seconds is roughly 3.6 MB/student before container overhead;
150 sessions are about 540 MB. The 50 MB/session cap instead gives a worst-case
7.5 GB for 150 and 17.5 GB for all 350. At the current 250ms recording chunks, 150 students can
produce approximately 600 writes/second and 540,000 fragments in 15 minutes.
These are arithmetic estimates, not measured storage performance.

The current normal recording path writes immutable fragments into the database.
Before rollout, measure WAL/replication, connection pools, backups, restore and
reconstruction costs. Consider moving fragment bytes to private object storage
while retaining manifest metadata in PostgreSQL if measurements demand it.
Do not claim the optional legacy S3 whole-file path solves this automatically.

## Cost and rollout gate

Fill `cost-inputs.example.json` with measured usage, sourced current quotes and
quote dates. `scripts/cost_sheet.py` calculates one-viva and 350-student totals
for API and self-hosted modes. The supplied pending sheet intentionally has no
numeric total because rates/usage were not validated.

Release for a cohort only after the representative 150-client run meets latency,
error, recovery and audit targets and institutional privacy/retention decisions
are recorded. This document is a plan with local evidence, not a deployment claim.

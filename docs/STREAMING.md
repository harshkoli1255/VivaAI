# Streaming speech and conversation recording

## Live draft path

1. A signed-in consenting candidate requests a fresh one-use WebSocket ticket.
2. The browser opens `/ws/speech/{session_id}`, sends `start` with the current
   question reference and `en`, `hi`, or `multi`, and waits for `ready`.
3. MediaRecorder emits short encoded container fragments every 250ms. Binary
   frames go to a bounded server queue and directly to Deepgram's live endpoint.
   Browser buffered bytes, per-frame/total bytes, setup, stream and finalization
   times are bounded. A second speech connection for a session is rejected.
4. Interim text appears while capture continues. Stop sends the last fragment
   first, then `stop`. The provider receives `CloseStream` to flush final words.
5. Finalized segments are accumulated; interim revisions replace the preview and
   are not appended repeatedly. The final signed draft binds to the question at
   capture start. Nothing is graded until the candidate confirms the answer.
6. Continue snapshots the visible edited prefix and appends new speech to it.
   Clear answer invalidates the capture generation and removes draft state;
   late callbacks cannot restore deleted text. A failed clip can be retried via
   the authenticated whole-file endpoint, or the candidate can type instead.

The English model remains `DEEPGRAM_STT_MODEL`. Hindi/mixed uses
`DEEPGRAM_MULTILINGUAL_MODEL` (default `nova-3`); this avoids treating Nova-2's
Spanish/English `multi` mode as Hindi support. Language selections are provider
capabilities, not a validated WER or fairness claim.

## Spoken output and audit audio

The browser uses MediaSource audio/mpeg where supported to begin AI playback
before the final provider chunk. WAV and unsupported browsers retain complete-file
playback. Barge-in discards remaining playback, and recording reflects the audio
actually played. Web Audio routes AI media to both speakers and a recording bus;
the microphone connects to that same bus without being fed to speakers.

DurableRecorder stores the mixed stream in IndexedDB and uploads immutable,
idempotent fragments. New captures declare `conversation`; historical captures
remain `candidate`. Existing authenticated reconstruction/seek/playback works
without combining separate input/output files. Typed sessions still record AI
speech without microphone permission. Device-only Web Speech synthesis cannot be
captured, so that fallback is disabled while recording; question text and retry
remain available if cloud audio fails.

## Validation scope

- Backend tests verify interim results before input completion, segment assembly,
  signed question binding, single-use tickets, ownership/consent/state limits,
  non-penalizing voice signals and immutable recording-kind metadata.
- Chrome synthetic browser tests verify interim text before Stop, no grading of
  draft text, edited resumption and clearing, progressive playback before the
  final chunk, and saved 440Hz microphone plus 880Hz AI tones after reload/restart.
- Real-provider synthetic English browser testing exercises the new live socket,
  candidate correction, original transcript preservation, TTS fallback, barge-in,
  mixed capture, restart recovery and faculty review.

A synthetic playback observation is not human end-of-speech p50/p95, accented or
Hinglish accuracy, or 150-student production capacity proof. Those remain pending.

Provider references:
- https://developers.deepgram.com/reference/speech-to-text/listen-streaming
- https://developers.deepgram.com/docs/understand-endpointing-interim-results
- https://developers.deepgram.com/docs/models-languages-overview/

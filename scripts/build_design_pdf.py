"""Rebuild the three-page submission design with vector artwork (no real data)."""
from pathlib import Path
import math
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import simpleSplit
from reportlab.lib.pagesizes import A4

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'output/pdf/vivaai-design.pdf'
INK, MUTED, BLUE, PALE = map(HexColor, ['#14243D', '#51647B', '#2854D8', '#F0F4FD'])
PAGE_W, PAGE_H = A4
c = canvas.Canvas(str(TARGET), pagesize=A4)
c.setTitle('VivaAI - Architecture and Design')
c.setAuthor('VivaAI project')


def header(number, title, subtitle):
    c.setFillColor(INK); c.rect(0, PAGE_H - 118, PAGE_W, 118, fill=1, stroke=0)
    c.setFillColor(HexColor('#9FB6FF')); c.setFont('Helvetica-Bold', 10)
    c.drawString(42, PAGE_H - 37, 'VIVAAI / TECHNICAL DESIGN')
    c.setFillColor(white); c.setFont('Helvetica-Bold', 23); c.drawString(42, PAGE_H - 72, title)
    c.setFont('Helvetica', 10); c.drawString(42, PAGE_H - 95, subtitle)
    c.setFillColor(MUTED); c.setFont('Helvetica', 8)
    c.drawString(42, 25, 'AI Viva Challenge | Local implementation | 21 October 2026')
    c.drawRightString(PAGE_W - 42, 25, f'{number} / 3')


def paragraph(title, body, y):
    c.setFillColor(BLUE); c.setFont('Helvetica-Bold', 12); c.drawString(42, y, title)
    y -= 19
    c.setFillColor(INK); c.setFont('Helvetica', 10)
    for line in simpleSplit(body, 'Helvetica', 10, PAGE_W - 84):
        c.drawString(42, y, line); y -= 14
    return y - 18


def box(x, y, w, h, lines, dark=False):
    c.setFillColor(INK if dark else PALE); c.setStrokeColor(HexColor('#CAD6EE'))
    c.roundRect(x, y, w, h, 9, fill=1, stroke=not dark)
    c.setFillColor(white if dark else INK)
    for i, text in enumerate(lines):
        c.setFont('Helvetica-Bold' if i == 0 else 'Helvetica', 9 if i == 0 else 8)
        c.drawCentredString(x + w/2, y + h - 17 - i*13, text)


def arrow(x1,y1,x2,y2):
    c.setStrokeColor(BLUE); c.setFillColor(BLUE); c.setLineWidth(1.3)
    c.line(x1,y1,x2,y2)
    angle = math.atan2(y2-y1,x2-x1)
    p = c.beginPath(); p.moveTo(x2,y2)
    p.lineTo(x2-6*math.cos(angle-.45), y2-6*math.sin(angle-.45))
    p.lineTo(x2-6*math.cos(angle+.45), y2-6*math.sin(angle+.45)); p.close()
    c.drawPath(p,fill=1,stroke=0)


header(1, 'One conversation. Reviewable evidence.', 'Student and faculty portals with an independent assessment backend')
y = paragraph('Purpose', 'Conduct a structured 15-minute technical viva, adapt follow-ups, and produce evidence-backed marks. Faculty retain review and override authority. The product integrates speech and model providers; it does not train an examiner model.', PAGE_H-151)
box(42, 555, 240, 60, ['Student Next.js portal', 'Live drafts, editable answers, optional code', 'Microphone + played AI audio -> one recorder'])
box(313,555,240,60,['Faculty Next.js portal','Transcript/audio, evidence, overrides','Calibration CSV and retention holds'])
box(159,443,277,65,['FastAPI + deterministic controller','REST cookie gateway; single-use WebSocket tickets','Separate interview and live-transcription sockets'],True)
arrow(162,555,222,508); arrow(433,555,375,508)
box(42,337,151,62,['Live speech providers','Deepgram interim/final STT','Progressive MP3 TTS playback'])
box(222,337,151,62,['Fast interviewer model','Classifier + bounded follow-ups','Neutral topic transitions'])
box(402,337,151,62,['Persistent state','PostgreSQL in production','Local SQLite for tests/preview'])
arrow(200,443,118,399); arrow(297,443,297,399); arrow(399,443,478,399)
box(159,233,277,62,['Durable scoring queue + workers','Complete transcript; stronger model; temperature 0','Validated rubric/feedback citations + faculty review'],True)
arrow(478,337,436,264); arrow(297,337,297,295)
paragraph('Data boundary', 'Audio fragments, transcripts, question references, scoring reasons and audit events live in the application database. Legacy whole-file audio can use private S3/MinIO. Normal recording does not yet use incremental object storage. Keys remain on the server; access checks protect every session and playback route.', 188)
c.showPage()
header(2, 'Interview and evidence contracts', 'Timing and authorization belong to application code, not model instructions')
y = paragraph('A bounded 15-minute flow', 'Warm-up 0-1 min; fundamentals 1-5; depth 5-10; applied reasoning 10-13; wrap-up 13-14.5; scoring begins after the conversation. The controller enforces a 900-second ceiling, including legacy longer configurations. Phase intervals are configurable through the API.', PAGE_H-153)
y = paragraph('Adaptive questioning', 'Strong answers receive one deeper probe; partial answers receive one diagnostic nudge before moving on; uncertainty changes topic; off-topic or overlong answers are redirected. Depth prefers the strongest confidently demonstrated topic. Approved bank IDs or generated-variant flags keep questions traceable. Candidate code is text only and never executed.', y)
y = paragraph('Live speech, editing and audio', 'MediaRecorder sends short container fragments over an authenticated WebSocket. The server forwards them immediately to the speech provider and returns interim text. Stop flushes a signed final draft; the student reviews and confirms it. Resuming appends to the visible edited draft. Clear answer resets capture and rejects stale callbacks. A saved-clip retry is available after stream failure.', y)
y = paragraph('What is recorded', 'Web Audio mixes candidate microphone input with the AI audio actually played, including repeat playback and interruption. Immutable fragments synchronize through IndexedDB and authenticated uploads. Typed sessions record AI playback without requesting a microphone. Historical microphone captures remain labelled candidate-only; new captures declare conversation mode. Unsupported unrecordable device-speech fallback is disabled during audit recording.', y)
y = paragraph('Defensible scoring', 'Five 0-5 dimensions use 30/25/20/15/10 weights for conceptual understanding, reasoning, problem solving, practical knowledge and communication. The versioned final scorer runs at temperature zero. Each rubric reason and each of 3-5 feedback lines cites candidate evidence. Invalid evidence or low confidence withholds an automated grade for faculty review. Faculty overrides always win and record a reason.', y)
paragraph('Access and review', 'Session ownership, consent and account validity gate audio and transcripts. Speech tickets expire and can be redeemed once; capture has duration, byte and queue bounds. Provider speaker clusters are review signals only. Calibration stores independent labels without changing marks. Accent, grammar and language mixing are not technical marking criteria.', y)
c.showPage()
header(3, 'Operations and validation boundary', 'Separate implemented behavior from evidence still required for rollout')
y=paragraph('Resilience', 'Answers persist before provider calls. Recording fragments are idempotent, recover across reload and survive API restarts after acknowledgement. Scoring runs in an independently claimable durable job queue. Bounded retries, a real TTS fallback and rejoin states handle provider or network failures. Final unacknowledged device data can still be lost on abrupt shutdown.', PAGE_H-153)
y=paragraph('Retention controls', 'Faculty can add or remove an audited retention hold. The operator retention tool plans by default and refuses deletion until a positive retention period and approved policy ID are configured. Only old, ended, reviewed, unheld sessions without pending scoring qualify. Eligibility is rechecked under a lock. Purge receipts record outcomes. No real records were deleted during development; backups, provider retention, object versions and external exports need separate institutional procedures.', y)
y=paragraph('Local evidence', 'Backend and provider-contract tests cover authorization, streaming, evidence integrity, scoring, holds, calibration and isolated deletion. Browser checks use synthetic inputs and disposable databases. They verify interim drafts before Stop, candidate confirmation, edited resumption, both audio frequencies in saved playback, progressive AI playback before the final chunk, offline/reload recovery and faculty controls. These observations are not human speech or grading benchmarks.', y)
y=paragraph('Capacity and cost', 'The recorded local 50/100/150 transport probe used SQLite and mock providers. The 150-bot p95 exceeded 2.5 seconds; it is not real speech capacity proof. Production needs full-duration representative PostgreSQL/provider runs, measured quotas, error/resource tables and a breaking point. A cost calculator supports sourced API/self-hosted inputs, but actual usage and rates remain to be validated.', y)
y=paragraph('Required external evidence', 'Still needed: five complete demo vivas; at least ten independent human/AI marking comparisons; at least twenty accented English/Hinglish clips with verbatim references; real end-of-speech-to-first-audible latency percentiles; human review of follow-up quality and fairness; production capacity, approved retention settings, operating costs and a shareable live demo or video. No values are invented for missing evidence.', y)
paragraph('Reproduce and inspect', 'README.md contains local setup. TEST_REPORT.md records commands and their scope. docs/REQUIREMENTS.md maps the challenge. samples/ supplies question banks and a rubric. tests/quality/ and scripts/ provide persona, benchmark, export, load, cost, submission-inventory and retention tools. All project changes remain uncommitted until user verification.', y)
c.save()
print(TARGET)

"""Faculty-labelled comparisons against existing consented AI score reports."""
import csv
import io
import math
import statistics
import uuid
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from app.core.security import require_faculty
from app.db.session import get_db
from app.models.models import VivaSession, ScoreReport, AuditLog

router = APIRouter()


def metrics(pairs):
    if not pairs:
        raise ValueError('At least one comparison is required')
    human, ai = zip(*pairs)
    mean_h, mean_a = statistics.mean(human), statistics.mean(ai)
    denominator = math.sqrt(sum((x - mean_h) ** 2 for x in human) * sum((y - mean_a) ** 2 for y in ai))
    correlation = sum((x - mean_h) * (y - mean_a) for x, y in pairs) / denominator if denominator else None
    return {'comparisons': len(pairs), 'minimum_required': 10, 'minimum_count_met': len(pairs) >= 10,
            'mean_absolute_gap': statistics.mean(abs(x - y) for x, y in pairs),
            'mean_ai_minus_human': statistics.mean(y - x for x, y in pairs),
            'pearson_correlation': correlation}


@router.post('')
async def compare_marks(file: UploadFile = File(...), db=Depends(get_db), current=Depends(require_faculty)):
    content = await file.read(256 * 1024 + 1)
    if len(content) > 256 * 1024:
        raise HTTPException(413, 'Calibration file must be under 256 KB')
    try:
        reader = csv.DictReader(io.StringIO(content.decode('utf-8-sig')))
        if not {'session_id', 'faculty_score'} <= set(reader.fieldnames or []):
            raise ValueError('Required CSV columns: session_id,faculty_score')
        rows = list(reader)
        if not 1 <= len(rows) <= 1000:
            raise ValueError('Provide between 1 and 1000 comparisons')
        parsed = [(uuid.UUID(row['session_id'].strip()), float(row['faculty_score'])) for row in rows]
        if len({identity for identity, _ in parsed}) != len(parsed):
            raise ValueError('Each session may appear only once')
        if any(not math.isfinite(mark) or not 0 <= mark <= 100 for _, mark in parsed):
            raise ValueError('Faculty scores must be finite numbers from 0 to 100')
    except (UnicodeError, ValueError, TypeError, AttributeError, KeyError, csv.Error) as exc:
        raise HTTPException(422, 'Use unique valid session IDs and numeric faculty_score values from 0 to 100') from exc
    reports = (await db.execute(select(VivaSession, ScoreReport).join(ScoreReport, ScoreReport.session_id == VivaSession.id)
                                .where(VivaSession.id.in_([identity for identity, _ in parsed])))).all()
    by_id = {session.id: (session, report) for session, report in reports}
    if len(by_id) != len(parsed) or any(not session.consent_given or report.low_confidence_flag or report.model_used == 'faculty'
                                      for session, report in reports):
        raise HTTPException(409, 'Every comparison needs a consented session with a supported AI score. Resolve missing or review-required reports first.')
    comparisons = []
    for identity, mark in parsed:
        _, report = by_id[identity]
        comparisons.append({'session_id': str(identity), 'faculty_score': mark, 'ai_score': report.total_score,
                            'gap': report.total_score - mark, 'model': report.model_used, 'prompt_version': report.prompt_version})
    summary = metrics([(row['faculty_score'], row['ai_score']) for row in comparisons])
    summary['contains_mock_scores'] = any(row['model'].lower().startswith('mock') for row in comparisons)
    summary['benchmark_ready'] = summary['minimum_count_met'] and not summary['contains_mock_scores']
    # Calibration labels are separate evidence; actual assessment marks are unchanged.
    for row in comparisons:
        db.add(AuditLog(session_id=uuid.UUID(row['session_id']), actor_id=uuid.UUID(current['sub']),
                       action='calibration_comparison', detail=row))
    await db.commit()
    return {'summary': summary, 'comparisons': comparisons,
            'scope': 'Uploaded faculty labels compared with original AI marks, not faculty overrides. Count alone does not establish validity, fairness or study/sharing consent.'}

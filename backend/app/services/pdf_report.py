"""
PDF grade report generator for VivaAI using ReportLab.
"""
from __future__ import annotations

import io
import html
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

def _esc(val: Any) -> str:
    if val is None:
        return ""
    return html.escape(str(val))

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
    KeepTogether,
)


def generate_session_pdf_report(
    session_id: str,
    student_name: str,
    student_id: Optional[str],
    viva_title: str,
    subject: str,
    started_at: Optional[datetime],
    ended_at: Optional[datetime],
    total_score: Optional[float],
    override_score: Optional[float],
    override_reason: Optional[str],
    review_status: str,
    rubric_entries: Dict[str, Dict[str, Any]],
    rubric_weights: Dict[str, float],
    feedback_lines: Optional[List[str]],
    proctoring_events: Optional[List[Any]],
    reviewer_name: Optional[str] = None,
    feedback_evidence: Optional[List[Dict[str, Any]]] = None,
    score_withheld: bool = False,
) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
    )

    story = []
    styles = getSampleStyleSheet()

    # Color Palette - Academic Obsidian / Emerald
    c_primary = colors.HexColor("#0f766e")      # Deep teal / emerald
    c_dark = colors.HexColor("#0f172a")         # Slate 900
    c_muted = colors.HexColor("#475569")        # Slate 600
    c_light = colors.HexColor("#f8fafc")        # Slate 50
    c_border = colors.HexColor("#cbd5e1")       # Slate 300
    c_accent = colors.HexColor("#14b8a6")

    # Typography styles
    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=c_dark,
    )
    subtitle_style = ParagraphStyle(
        "DocSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=12,
        textColor=c_primary,
        textTransform="uppercase",
    )
    meta_label_style = ParagraphStyle(
        "MetaLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=c_muted,
    )
    meta_val_style = ParagraphStyle(
        "MetaVal",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor=c_dark,
    )
    heading_style = ParagraphStyle(
        "SectionHeading",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        textColor=c_dark,
    )
    body_style = ParagraphStyle(
        "BodyDark",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=11.5,
        textColor=c_dark,
    )
    body_muted = ParagraphStyle(
        "BodyMuted",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=11,
        textColor=c_muted,
    )

    # 1. Header Banner Table
    header_data = [
        [
            Paragraph("VIVAAI ACADEMIC ORAL EXAMINATION REPORT", title_style),
            Paragraph("ASSESSMENT & REVIEW RECORD", subtitle_style),
        ],
        [
            Paragraph("Technical Viva Assessment & Audit Record", body_muted),
            Paragraph(f"Issued: {datetime.now(timezone.utc).strftime('%d %b %Y, %H:%M UTC')}", meta_val_style),
        ],
    ]
    header_table = Table(header_data, colWidths=[380, 160])
    header_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
        ])
    )
    story.append(header_table)
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=2, color=c_primary, spaceAfter=12))

    # 2. Candidate & Session Overview Grid
    effective_score = override_score if override_score is not None else (None if score_withheld else total_score)
    score_label = f"<b>{effective_score:.1f} / 100</b>" if effective_score is not None else "Withheld - faculty review required"

    meta_grid = [
        [
            Paragraph("Candidate Name:", meta_label_style),
            Paragraph(_esc(student_name), meta_val_style),
            Paragraph("Total Score Awarded:", meta_label_style),
            Paragraph(score_label, ParagraphStyle("ScoreBig", parent=meta_val_style, fontName="Helvetica-Bold", fontSize=11, textColor=c_primary)),
        ],
        [
            Paragraph("Student Registration ID:", meta_label_style),
            Paragraph(_esc(student_id or "STU-UNASSIGNED"), meta_val_style),
            Paragraph("Faculty Review Status:", meta_label_style),
            Paragraph(_esc(review_status.replace("_", " ").title()), meta_val_style),
        ],
        [
            Paragraph("Curriculum Assessment:", meta_label_style),
            Paragraph(f"{_esc(viva_title)} ({_esc(subject)})", meta_val_style),
            Paragraph("Recorded activity signals:", meta_label_style),
            Paragraph(f"{len(proctoring_events or [])} events (not a misconduct finding)", meta_val_style),
        ],
        [
            Paragraph("Session UID:", meta_label_style),
            Paragraph(_esc(session_id[:24]) + "...", meta_val_style),
            Paragraph("Examination Timestamp:", meta_label_style),
            Paragraph(started_at.strftime("%Y-%m-%d %H:%M UTC") if started_at else "Standard Session", meta_val_style),
        ],
    ]
    meta_table = Table(meta_grid, colWidths=[120, 160, 120, 140])
    meta_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), c_light),
            ("BOX", (0, 0), (-1, -1), 1, c_border),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, c_border),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ])
    )
    story.append(meta_table)
    story.append(Spacer(1, 14))

    # 3. Weighted Rubric Dimensions Table
    story.append(Paragraph("Evaluated Rubric Breakdown & Evidence Citations", heading_style))
    story.append(Spacer(1, 6))

    rubric_rows = [
        [
            Paragraph("<b>Assessment Dimension</b>", body_style),
            Paragraph("<b>Weight</b>", body_style),
            Paragraph("<b>Score</b>", body_style),
            Paragraph("<b>Performance Justification & Verbatim Turn Citations</b>", body_style),
        ]
    ]

    dimension_labels = {
        "conceptual": "Conceptual Understanding",
        "depth_reasoning": "Depth & Reasoning",
        "problem_solving": "Problem Solving",
        "practical_project": "Practical Application",
        "communication": "Technical Communication",
    }

    for dim_key, dim_title in dimension_labels.items():
        if dim_key not in rubric_entries:
            continue
        entry = rubric_entries.get(dim_key, {})
        weight = rubric_weights.get(dim_key, 20)
        raw_score = entry.get("score")
        if raw_score is None:
            score_str = "—"
        elif raw_score <= 5:
            score_str = f"{raw_score:.1f}/5 ({raw_score * 20:.0f}%)"
        else:
            score_str = f"{raw_score:.1f}/100"

        reason = entry.get("reason") or "No dimension justification recorded."
        citations = entry.get("turn_ids") or []
        escaped_citations = [_esc(c) for c in citations[:4]]
        citation_str = f"<br/><font color='#0f766e'><b>Citations:</b> Turns [{', '.join(escaped_citations)}]</font>" if citations else ""

        desc_p = Paragraph(f"{_esc(reason)}{citation_str}", body_style)

        rubric_rows.append([
            Paragraph(f"<b>{dim_title}</b>", body_style),
            Paragraph(f"{weight:.0f}%", body_style),
            Paragraph(f"<b>{score_str}</b>", body_style),
            desc_p,
        ])

    rubric_table = Table(rubric_rows, colWidths=[120, 50, 80, 290])
    rubric_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
            ("BOX", (0, 0), (-1, -1), 1, c_border),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, c_border),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ])
    )
    if rubric_entries:
        story.append(rubric_table)
    else:
        story.append(Paragraph("No AI rubric assessment is available. The faculty mark does not imply individual dimension scores.", body_muted))
    if score_withheld:
        story.append(Paragraph("AI assessment requires faculty review. AI dimension marks shown here are provisional and are not awarded marks.", body_muted))
    story.append(Spacer(1, 14))

    # 4. Qualitative Academic Feedback
    if feedback_lines:
        story.append(Paragraph("Examiner Qualitative Feedback & Growth Recommendations", heading_style))
        story.append(Spacer(1, 6))
        feedback_paragraphs = []
        for index, line in enumerate(feedback_lines):
            item = feedback_evidence[index] if feedback_evidence and index < len(feedback_evidence) else {}
            citations = item.get("citations", [])
            links = ' | '.join(
                f'<link href="#evidence-{_esc(citation["turn_id"])}" color="#3558e8">'
                f'Turn {citation["turn_index"] + 1} at {citation["timestamp_secs"]:.1f}s</link>'
                for citation in citations)
            feedback_paragraphs.append(f'• {_esc(line.strip())}<br/>' + (links or 'Evidence not recorded'))
        fb_content = '<br/><br/>'.join(feedback_paragraphs)
        fb_table = Table([[Paragraph(fb_content, body_style)]], colWidths=[540])
        fb_table.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), c_light),
                ("BOX", (0, 0), (-1, -1), 0.5, c_border),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ])
        )
        story.append(fb_table)
        story.append(Spacer(1, 14))

    # 5. Faculty Sovereign Override (if present)
    if override_score is not None:
        story.append(Paragraph("Faculty Sovereign Mark Adjustment Log", heading_style))
        story.append(Spacer(1, 4))
        esc_override_reason = _esc(override_reason or "Evaluator calibration.")
        ai_label = "Unavailable" if total_score is None else ("Withheld (requires review)" if score_withheld else f"{total_score:.1f}/100")
        ov_text = f"<b>Faculty Mark:</b> {override_score:.1f}/100 | <b>Original AI Score:</b> {ai_label}<br/><b>Academic Justification:</b> {esc_override_reason}"
        ov_table = Table([[Paragraph(ov_text, body_style)]], colWidths=[540])
        ov_table.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fef3c7")),
                ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#f59e0b")),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ])
        )
        story.append(ov_table)
        story.append(Spacer(1, 14))

    # Linked excerpts are resolved from the authorized transcript, not model text.
    excerpts = {citation["turn_id"]: citation for item in (feedback_evidence or []) for citation in item.get("citations", [])}
    if excerpts:
        story.append(Paragraph("Transcript evidence", heading_style))
        for citation in sorted(excerpts.values(), key=lambda row: row["turn_index"]):
            story.append(Paragraph(f'<a name="evidence-{_esc(citation["turn_id"])}"/>'
                f'<b>Turn {citation["turn_index"] + 1} — {citation["timestamp_secs"]:.1f}s</b><br/>'
                + _esc(citation["text"]), body_style))
            story.append(Spacer(1, 10))

    # Record actual review state without implying accreditation or a signature.
    sign_block = [[
        Paragraph("<b>Review status</b><br/>" + _esc(review_status), body_muted),
        Paragraph("<b>Faculty reviewer</b><br/>" + _esc(reviewer_name or "No faculty adjustment recorded"), body_muted),
    ]]
    sign_table = Table(sign_block, colWidths=[270, 270])
    sign_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ])
    )
    story.append(KeepTogether([sign_table]))

    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes

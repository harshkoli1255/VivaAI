"""Resolve persisted model indices against the authorized session transcript.

Old reports without feedback citations remain explicitly unlinked. No inferred
or fabricated links are added to historical feedback.
"""


def feedback_evidence(report, turns):
    candidates = {turn.turn_index: turn for turn in turns
                  if turn.speaker == "student" and turn.text.strip()}
    groups = report.feedback_turn_ids or []
    result = []
    for index, text in enumerate(report.feedback_lines or []):
        claimed = groups[index] if index < len(groups) and isinstance(groups[index], list) else []
        citations = []
        for turn_index in claimed:
            turn = candidates.get(turn_index) if type(turn_index) is int else None
            if turn is not None:
                citations.append({"turn_id": str(turn.id), "turn_index": turn.turn_index,
                                  "timestamp_secs": turn.timestamp_secs, "text": turn.text})
        result.append({"text": text, "citations": citations,
                       "evidence_status": "linked" if citations else "not_recorded"})
    return result

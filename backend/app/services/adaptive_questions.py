"""Deterministic question coverage and bounded difficulty adaptation."""
import re
from difflib import SequenceMatcher


def normalized(text):
    return " ".join(re.findall(r"\w+", text.lower()))


def repeats(text, asked):
    candidate = normalized(text)
    return any(candidate == normalized(old) or SequenceMatcher(None, candidate, normalized(old)).ratio() > .88
               for old in asked if old.strip())


class AdaptiveQuestions:
    def __init__(self, turns=(), initial_difficulty="medium"):
        self.asked = [t.text for t in turns if t.speaker == "ai"]
        self.asked += [(t.answer_metadata or {}).get("question_text", "") for t in turns if t.speaker == "student"]
        self.recent = []
        self.level = {"easy": 0, "medium": 1, "hard": 2}.get(initial_difficulty, 1)
        self.topics = []
        for turn in turns:
            if turn.speaker == "student" and turn.answer_label:
                self.observe(turn.answer_label.value, turn.classifier_confidence or 0)

    @property
    def difficulty(self):
        return ["easy", "medium", "hard"][self.level]

    def observe(self, label, confidence):
        # A single uncertain classification cannot raise or lower difficulty.
        if confidence < .7:
            return
        self.recent = (self.recent + [label])[-2:]
        if self.recent == ["strong", "strong"]:
            self.level = min(2, self.level + 1)
            self.recent = []
        elif len(self.recent) == 2 and all(x in ("partial", "dont_know") for x in self.recent):
            self.level = max(0, self.level - 1)
            self.recent = []

    def choose(self, questions, asked_ids):
        available = [q for q in questions if q["id"] not in asked_ids and not repeats(q["text"], self.asked)]
        if not available:
            return None
        levels = {"easy": 0, "medium": 1, "hard": 2}
        chosen = min(available, key=lambda q: (
            bool(q.get("topic") and q["topic"] in self.topics[-2:]),
            abs(levels.get(q.get("difficulty"), 1) - self.level)))
        self.topics.append(chosen.get("topic", ""))
        self.asked.append(chosen["text"])
        asked_ids.add(chosen["id"])
        return chosen

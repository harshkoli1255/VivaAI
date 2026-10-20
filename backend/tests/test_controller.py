"""
Unit tests for the interview controller state machine.
Tests: phase transitions, policy decisions, timeout, silence detection.
"""
import pytest
import time
from app.services.controller import (
    InterviewController, ControllerState, ControllerLabel,
    ClassificationResult, PolicyDecision, Phase, DEFAULT_PHASE_TIMINGS,
)


def make_controller(session_id="test-session", elapsed=0.0) -> InterviewController:
    state = ControllerState(session_id=session_id, elapsed_secs=elapsed)
    return InterviewController(state)


class TestPhaseTransitions:

    def test_starts_in_warm_up(self):
        ctrl = make_controller()
        assert ctrl.state.phase == Phase.warm_up

    def test_transitions_to_fundamentals_at_60s(self):
        ctrl = make_controller()
        decision = ctrl.tick(61.0)
        assert decision is not None
        assert decision.action == "end_phase"
        assert ctrl.state.phase == Phase.fundamentals

    def test_transitions_to_depth_at_300s(self):
        ctrl = make_controller()
        ctrl.tick(61.0)   # → fundamentals
        decision = ctrl.tick(301.0)
        assert ctrl.state.phase == Phase.depth

    def test_transitions_to_applied_at_600s(self):
        ctrl = make_controller()
        ctrl.tick(61.0)   # → fundamentals
        ctrl.tick(301.0)  # → depth
        ctrl.tick(601.0)  # → applied
        assert ctrl.state.phase == Phase.applied

    def test_ends_at_900s(self):
        ctrl = make_controller()
        decision = ctrl.tick(900.0)
        assert decision is not None
        assert decision.action == "end_interview"
        assert not ctrl.state.is_active

    def test_hard_cutoff_past_900(self):
        ctrl = make_controller()
        decision = ctrl.tick(950.0)
        assert decision.action == "end_interview"

    def test_no_transition_before_boundary(self):
        ctrl = make_controller()
        decision = ctrl.tick(59.9)
        assert decision is None
        assert ctrl.state.phase == Phase.warm_up

    def test_custom_phase_timings(self):
        state = ControllerState(
            session_id="test",
            phase_timings={
                Phase.warm_up: {"start": 0, "end": 30},  # shorter warm-up
                Phase.fundamentals: {"start": 30, "end": 200},
                Phase.depth: {"start": 200, "end": 500},
                Phase.applied: {"start": 500, "end": 700},
                Phase.wrap_up: {"start": 700, "end": 800},
                Phase.scoring: {"start": 800, "end": 900},
            }
        )
        ctrl = InterviewController(state)
        ctrl.tick(31.0)
        assert ctrl.state.phase == Phase.fundamentals

    def test_phase_transition_deferred_when_student_is_speaking(self):
        ctrl = make_controller()
        assert ctrl.state.phase == Phase.warm_up
        # Student began speaking at t=55s
        ctrl.state.student_speaking_since = 55.0
        # Tick at boundary t=61s
        decision = ctrl.tick(61.0)
        assert decision is None
        assert ctrl.state.phase == Phase.warm_up

    def test_missing_vad_end_cannot_hold_a_phase_past_answer_limit(self):
        ctrl = make_controller()
        ctrl.state.student_speaking_since = 55.0
        assert ctrl.tick(61.0) is None
        decision = ctrl.tick(145.0)
        assert decision.action == 'end_phase'
        assert ctrl.state.phase == Phase.fundamentals
        assert ctrl.state.student_speaking_since is None

    def test_long_live_answer_redirects_within_same_phase(self):
        ctrl = make_controller(elapsed=100.0)
        ctrl.state.phase = Phase.fundamentals
        ctrl.state.student_speaking_since = 100.0
        decision = ctrl.tick(190.0)
        assert decision.action == 'redirect'
        assert ctrl.state.student_speaking_since is None


class TestPolicyDecisions:

    def test_strong_answer_returns_follow_up(self):
        ctrl = make_controller()
        clf = ClassificationResult(label=ControllerLabel.strong, confidence=0.9)
        decision = ctrl.on_student_answer("test answer", clf, 30.0, 20.0)
        assert decision.action == "ask_follow_up"

    def test_partial_first_gives_hint(self):
        ctrl = make_controller()
        clf = ClassificationResult(label=ControllerLabel.partial, confidence=0.7)
        decision = ctrl.on_student_answer("partial", clf, 30.0, 20.0)
        assert decision.action == "give_hint"
        assert ctrl.state.hint_given is True

    def test_partial_second_moves_on(self):
        ctrl = make_controller()
        clf = ClassificationResult(label=ControllerLabel.partial, confidence=0.7)
        ctrl.on_student_answer("first", clf, 30.0, 20.0)  # hint given
        decision = ctrl.on_student_answer("second", clf, 55.0, 20.0)
        assert decision.action == "move_on"
        assert ctrl.state.hint_given is False  # reset

    def test_dont_know_moves_on(self):
        ctrl = make_controller()
        clf = ClassificationResult(label=ControllerLabel.dont_know, confidence=0.95)
        decision = ctrl.on_student_answer("I don't know", clf, 30.0, 15.0)
        assert decision.action == "move_on"
        assert ctrl.state.consecutive_dont_knows == 1

    def test_off_topic_redirects(self):
        ctrl = make_controller()
        clf = ClassificationResult(label=ControllerLabel.off_topic, confidence=0.8)
        decision = ctrl.on_student_answer("something irrelevant", clf, 30.0, 20.0)
        assert decision.action == "redirect"
        assert decision.message is not None

    def test_long_answer_redirects(self):
        ctrl = make_controller()
        clf = ClassificationResult(label=ControllerLabel.strong, confidence=0.9)
        decision = ctrl.on_student_answer("long answer", clf, 30.0, 100.0)  # >90s
        assert decision.action == "redirect"

    def test_stt_low_confidence_counted(self):
        ctrl = make_controller()
        clf = ClassificationResult(label=ControllerLabel.partial, confidence=0.7)
        ctrl.on_student_answer("answer", clf, 30.0, 20.0, stt_confidence=0.4)
        assert ctrl.state.stt_low_conf_count == 1

    def test_stt_high_confidence_not_counted(self):
        ctrl = make_controller()
        clf = ClassificationResult(label=ControllerLabel.partial, confidence=0.7)
        ctrl.on_student_answer("answer", clf, 30.0, 20.0, stt_confidence=0.9)
        assert ctrl.state.stt_low_conf_count == 0


class TestSilenceDetection:

    def test_silence_after_threshold_triggers_prompt(self):
        ctrl = make_controller()
        # Simulate student last spoke at t=10
        ctrl.state.last_student_turn_at = 10.0
        # Tick at t=30 (20s silence)
        decision = ctrl.tick(30.0)
        assert decision is not None
        assert decision.action == "prompt_silence"

    def test_no_silence_prompt_before_threshold(self):
        ctrl = make_controller()
        ctrl.state.last_student_turn_at = 10.0
        decision = ctrl.tick(22.0)  # only 12s silence
        assert decision is None or decision.action != "prompt_silence"

    def test_silence_prompt_disabled_when_student_is_speaking(self):
        ctrl = make_controller()
        ctrl.state.last_student_turn_at = 10.0
        # Student is actively answering
        ctrl.state.student_speaking_since = 25.0
        # Tick at t=35s (25s since last turn, but student is speaking)
        decision = ctrl.tick(35.0)
        assert decision is None or decision.action != "prompt_silence"
        assert ctrl.state.long_silence_count == 0


class TestStateSnapshot:

    def test_snapshot_roundtrip(self):
        ctrl = make_controller(elapsed=150.0)
        ctrl.state.tab_switch_count = 2
        snapshot = ctrl.to_snapshot()
        restored = InterviewController.from_snapshot(snapshot)
        assert restored.state.session_id == ctrl.state.session_id
        assert restored.state.tab_switch_count == 2

    def test_resume_from_snapshot_phase(self):
        ctrl = make_controller()
        ctrl.tick(61.0)  # advance to fundamentals
        snapshot = ctrl.to_snapshot()
        restored = InterviewController.from_snapshot(snapshot)
        assert restored.state.phase == Phase.fundamentals


class TestTabSwitch:

    def test_tab_switch_increments_counter(self):
        ctrl = make_controller()
        ctrl.on_tab_switch()
        ctrl.on_tab_switch()
        assert ctrl.state.tab_switch_count == 2

    def test_tab_switch_records_correlated_proctoring_event(self):
        ctrl = make_controller()
        event = ctrl.on_tab_switch(elapsed_secs=45.2, question_id="q1", question_text="Coffman conditions")
        assert event["event_type"] == "tab_switch"
        assert event["timestamp_secs"] == 45.2
        assert event["question_id"] == "q1"
        assert event["question_text"] == "Coffman conditions"
        assert len(ctrl.state.proctoring_events) == 1

    def test_silence_records_correlated_proctoring_event(self):
        ctrl = make_controller()
        ctrl.state.last_student_turn_at = 10.0
        ctrl.state.current_question_id = "q2"
        ctrl.tick(30.0)  # > 15s silence
        assert len(ctrl.state.proctoring_events) == 1
        assert ctrl.state.proctoring_events[0]["event_type"] == "long_silence"
        assert ctrl.state.proctoring_events[0]["timestamp_secs"] == 30.0
        assert ctrl.state.proctoring_events[0]["question_id"] == "q2"


class TestDynamicProgression:

    def test_strong_answer_probing_follow_up_then_advances(self):
        ctrl = make_controller()
        clf = ClassificationResult(label=ControllerLabel.strong, confidence=0.95)

        # 1st strong answer -> probing follow-up
        decision1 = ctrl.on_student_answer("precise answer", clf, 30.0, 20.0)
        assert decision1.action == "ask_follow_up"
        assert ctrl.state.follow_up_count == 1

        # 2nd strong answer on the follow-up -> move on to next topic
        decision2 = ctrl.on_student_answer("in-depth response to follow-up", clf, 55.0, 25.0)
        assert decision2.action == "move_on"
        assert ctrl.state.follow_up_count == 0
        assert decision2.message is not None

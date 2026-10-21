"""
In-process mock concurrency smoke test (50, 100, 150 tasks).
Measures controller/classifier/scorer calls without HTTP, WebSockets, audio,
database writes, or real providers. This does not prove live viva capacity
or measure end-of-speech to first-audio latency.
"""
import asyncio
import time
import random
import statistics
from typing import List, Dict

try:
    from app.services.controller import InterviewController, ControllerState, ClassificationResult, AnswerLabel
    from app.services.llm_provider import MockLLMProvider
    from app.services.classifier import classify_answer
    from app.services.scorer import score_session
except ImportError:
    import sys
    sys.path.insert(0, "backend")
    from app.services.controller import InterviewController, ControllerState, ClassificationResult, AnswerLabel
    from app.services.llm_provider import MockLLMProvider
    from app.services.classifier import classify_answer
    from app.services.scorer import score_session


async def simulate_bot_session(bot_id: int) -> Dict:
    """Exercise three canned answers and one mock scoring call."""
    start_time = time.perf_counter()
    latencies: List[float] = []
    dropped = False
    errors = 0

    llm = MockLLMProvider()
    state = ControllerState(session_id=f"bot-{bot_id}")
    controller = InterviewController(state)

    sample_questions = [
        "Explain the critical section problem.",
        "How do condition variables work in thread synchronization?",
        "Describe virtual memory page fault handling.",
    ]

    sample_answers = [
        "A critical section is a part of the program where shared resources are accessed and needs mutual exclusion.",
        "Condition variables allow threads to sleep until notified by another thread holding the lock.",
        "A page fault traps to the OS kernel to load the missing page frame from swap or disk.",
    ]

    turns = []
    for i, (q, a) in enumerate(zip(sample_questions, sample_answers)):
        turn_start = time.perf_counter()
        try:
            # Simulate classification
            clf = await classify_answer(q, a, llm)
            # Simulate controller decision
            decision = controller.on_student_answer(
                text=a,
                classification=clf,
                elapsed_secs=(i + 1) * 60,
                duration_secs=20,
            )
            turns.append({"turn_index": i, "speaker": "student", "text": a})
            latencies.append((time.perf_counter() - turn_start) * 1000)
        except Exception:
            errors += 1
            dropped = True

    # Scoring phase
    try:
        score_start = time.perf_counter()
        await score_session(
            session_id=f"bot-{bot_id}",
            turns=turns,
            rubric_weights={
                "conceptual": 30, "depth_reasoning": 25,
                "problem_solving": 20, "practical_project": 15, "communication": 10
            },
            llm=llm,
        )
        latencies.append((time.perf_counter() - score_start) * 1000)
    except Exception:
        errors += 1

    total_duration = (time.perf_counter() - start_time) * 1000
    return {
        "bot_id": bot_id,
        "latencies": latencies,
        "errors": errors,
        "dropped": dropped,
        "total_ms": total_duration,
    }


async def run_batch(concurrent_count: int) -> Dict:
    """Runs a batch of concurrent bots and aggregates stats."""
    tasks = [simulate_bot_session(i) for i in range(concurrent_count)]
    results = await asyncio.gather(*tasks)

    all_latencies = []
    total_errors = 0
    total_dropped = 0

    for r in results:
        all_latencies.extend(r["latencies"])
        total_errors += r["errors"]
        if r["dropped"]:
            total_dropped += 1

    all_latencies.sort()
    p50 = statistics.median(all_latencies) if all_latencies else 0
    p95 = all_latencies[int(len(all_latencies) * 0.95)] if all_latencies else 0
    error_rate = (total_errors / (concurrent_count * 4)) * 100

    return {
        "sessions": concurrent_count,
        "p50_ms": round(p50, 1),
        "p95_ms": round(p95, 1),
        "error_rate": round(error_rate, 2),
        "dropped": total_dropped,
    }


async def main():
    print("=" * 70)
    print("VivaAI In-Process Mock Concurrency Smoke Test (50, 100, 150 Tasks)")
    print("No network, speech providers, database, or live viva capacity measurement.")
    print("=" * 70)

    session_counts = [50, 100, 150]
    results_table = []

    for count in session_counts:
        print(f"Running simulation for {count} concurrent sessions...")
        res = await run_batch(count)
        results_table.append(res)

    print("\n" + "=" * 70)
    print(f"{'Sessions':<12} | {'p50 Latency (ms)':<18} | {'p95 Latency (ms)':<18} | {'Error Rate':<12} | {'Dropped'}")
    print("-" * 70)
    for r in results_table:
        print(f"{r['sessions']:<12} | {r['p50_ms']:<18} | {r['p95_ms']:<18} | {r['error_rate']:>5.2f}%      | {r['dropped']}")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())

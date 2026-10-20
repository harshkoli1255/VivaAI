"""Run independently of HTTP workers: python -m app.workers.scoring_worker."""
import asyncio
from app.services.scoring_jobs import run_scoring_worker

if __name__ == '__main__':
    asyncio.run(run_scoring_worker())

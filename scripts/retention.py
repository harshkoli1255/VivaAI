"""Plan retention by default; --apply requires explicit approved policy settings.

No data is removed without --apply. Use a new private --receipt file when applying.
This is an operator tool, never an automatically enabled cleanup job.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
import uuid
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))


async def main(args):
    from app.core.config import settings
    from app.db.session import AsyncSessionLocal
    from app.services.retention import plan, purge_one
    if args.apply and (not args.policy_id or args.policy_id != settings.RETENTION_POLICY_ID or not args.receipt):
        raise ValueError('--apply requires matching --policy-id and a new private --receipt file')
    receipt = Path(args.receipt) if args.receipt else None
    if receipt and receipt.exists():
        raise ValueError('Choose a new receipt file; never overwrite an audit receipt')
    async with AsyncSessionLocal() as db:
        result = await plan(db)
        result.update(applied=False, outcomes=[])
        if not args.apply:
            print(json.dumps(result, indent=2)); return
        # Persist the plan before modifying records. UUIDs only, no names/transcripts.
        descriptor = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(descriptor)
        def save(): receipt.write_text(json.dumps(result, indent=2) + '\n')
        save()
        from app.services.storage import get_audio_storage
        storage = get_audio_storage()
        async def delete_audio(row):
            def remove():
                session_id = str(row.id)
                if row.audio_s3_key:
                    # Legacy keys may exist in S3 even when a local fallback works.
                    # Never claim successful deletion when the object store is offline.
                    if not storage._s3_available or not storage.client:
                        raise RuntimeError('Legacy object storage unavailable; record retained for retry')
                    if not row.audio_s3_key.startswith(f'sessions/{session_id}/'):
                        raise RuntimeError('Unexpected legacy audio key; manual review required')
                    storage.client.delete_object(Bucket=storage.bucket, Key=row.audio_s3_key)
                    try:
                        storage.client.head_object(Bucket=storage.bucket, Key=row.audio_s3_key)
                    except Exception as exc:
                        code = getattr(exc, 'response', {}).get('Error', {}).get('Code')
                        if code not in ('404', 'NoSuchKey', 'NotFound'): raise
                    else:
                        raise RuntimeError('Object deletion not confirmed')
                for pattern in (f'{session_id}.*', f'sessions_{session_id}_*'):
                    for path in storage.local_dir.glob(pattern):
                        if path.is_file(): path.unlink()
            await asyncio.to_thread(remove)
        result['applied'] = True
        for identity in result['eligible_session_ids']:
            try:
                purged = await purge_one(db, uuid.UUID(identity), delete_audio)
                result['outcomes'].append({'session_id': identity, 'status': 'deleted' if purged else 'skipped_after_recheck'})
            except Exception as exc:
                await db.rollback()
                result['outcomes'].append({'session_id': identity, 'status': 'failed', 'error_type': type(exc).__name__})
            save()
        print(f'Retention run recorded in {receipt}; inspect outcomes and separately handle backups/providers/exports.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--policy-id')
    parser.add_argument('--receipt')
    asyncio.run(main(parser.parse_args()))

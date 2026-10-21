'use client';

import { FileText } from 'lucide-react';
import { formatTime } from '@/lib/utils';

export interface EvidenceCitation {
  turn_id: string;
  turn_index: number;
  timestamp_secs: number;
  text: string;
}
export interface FeedbackItem {
  text: string;
  citations: EvidenceCitation[];
  evidence_status: 'linked' | 'not_recorded';
}

export function FeedbackEvidence({ items, onSelect }: { items: FeedbackItem[]; onSelect: (citation: EvidenceCitation) => void }) {
  return <ul className="space-y-4">
    {items.map((item, index) => <li key={`${index}-${item.text}`} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-page)] p-4">
      <p className="text-sm leading-relaxed text-[var(--text-primary)]">{item.text}</p>
      {item.citations.length ? <div className="mt-3 flex flex-wrap gap-2">{item.citations.map(citation => <button
        type="button" key={citation.turn_id} onClick={() => onSelect(citation)}
        className="turn-citation inline-flex min-h-10 items-center gap-2" title={citation.text}
        aria-label={`Read evidence for feedback ${index + 1}: turn ${citation.turn_index + 1} at ${formatTime(citation.timestamp_secs)}`}>
        <FileText className="h-3.5 w-3.5" />Turn {citation.turn_index + 1}<span className="opacity-75">{formatTime(citation.timestamp_secs)}</span>
      </button>)}</div> : <p className="mt-2 text-xs text-[var(--text-muted)]">Evidence was not recorded for this historical or faculty-authored feedback.</p>}
    </li>)}
  </ul>;
}

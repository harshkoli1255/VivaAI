'use client';

interface DimensionScores {
  conceptual: number;
  depth_reasoning: number;
  problem_solving: number;
  practical_project: number;
  communication: number;
}

interface ScoreRadarChartProps {
  scores: DimensionScores;
  weights?: DimensionScores;
}

const dimensions = [
  { key: 'conceptual', label: 'Conceptual understanding', color: '#5778ee' },
  { key: 'depth_reasoning', label: 'Depth & reasoning', color: '#6c9cc6' },
  { key: 'problem_solving', label: 'Problem solving', color: '#52a58d' },
  { key: 'practical_project', label: 'Practical knowledge', color: '#d59a56' },
  { key: 'communication', label: 'Communication', color: '#ac85bd' },
] as const;

export function ScoreRadarChart({ scores, weights = { conceptual: 30, depth_reasoning: 25, problem_solving: 20, practical_project: 15, communication: 10 } }: ScoreRadarChartProps) {
  return <div className="space-y-5 py-2">
    {dimensions.map(({ key, label, color }) => {
      const raw = scores[key];
      const valid = typeof raw === 'number' && Number.isFinite(raw);
      const value = valid ? Math.max(0, Math.min(5, raw > 5 ? raw / 20 : raw)) : null;
      return <div key={key}>
        <div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="font-medium text-[var(--text-primary)]">{label}<span className="ml-2 font-normal text-[var(--text-muted)]">{weights[key]}%</span></span><span className="shrink-0 font-semibold tabular-nums">{value === null ? '—' : `${value.toFixed(1)} / 5`}</span></div>
        <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={5} aria-valuenow={value ?? undefined} className="h-2 overflow-hidden rounded-full bg-[var(--bg-muted)]"><div className="h-full rounded-full" style={{ width: `${(value ?? 0) * 20}%`, backgroundColor: color }} /></div>
      </div>;
    })}
  </div>;
}

export default ScoreRadarChart;

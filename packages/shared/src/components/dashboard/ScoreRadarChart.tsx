'use client';

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from '@/components/providers/ThemeProvider';

interface DimensionScores {
  conceptual: number;
  depth_reasoning: number;
  problem_solving: number;
  practical_project: number;
  communication: number;
}

interface ScoreRadarChartProps {
  scores: DimensionScores;
  weights?: {
    conceptual: number;
    depth_reasoning: number;
    problem_solving: number;
    practical_project: number;
    communication: number;
  };
}

export function ScoreRadarChart({
  scores,
  weights = {
    conceptual: 30,
    depth_reasoning: 25,
    problem_solving: 20,
    practical_project: 15,
    communication: 10,
  },
}: ScoreRadarChartProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const normalize = (val: number) => {
    if (typeof val !== 'number' || Number.isNaN(val)) return 0;
    return Math.min(100, Math.max(0, val <= 5 ? Math.round((val / 5) * 100) : Math.round(val)));
  };

  // Correctly handle both 0-5 raw rubric scales and 0-100 percentage scales
  const radarData = [
    {
      subject: 'Conceptual Depth',
      score: normalize(scores.conceptual),
      weight: weights.conceptual,
    },
    {
      subject: 'Applied Nuance',
      score: normalize(scores.depth_reasoning),
      weight: weights.depth_reasoning,
    },
    {
      subject: 'Problem Solving',
      score: normalize(scores.problem_solving),
      weight: weights.problem_solving,
    },
    {
      subject: 'Practical Code',
      score: normalize(scores.practical_project),
      weight: weights.practical_project,
    },
    {
      subject: 'Communication',
      score: normalize(scores.communication),
      weight: weights.communication,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Radar Graphic */}
      <div className="w-full h-64 flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="56%" data={radarData}>
            <PolarGrid stroke="var(--border-default)" strokeDasharray="3 3" />
            <PolarAngleAxis
              dataKey="subject"
              tick={(props: { payload?: { value?: string }; x?: string | number; y?: string | number; cx?: number }) => {
                const numX = typeof props.x === 'number' ? props.x : Number(props.x) || 0;
                const numCx = typeof props.cx === 'number' ? props.cx : (props.cx ? Number(props.cx) : 143);
                let anchor: 'start' | 'end' | 'middle' = 'middle';
                let adjustedX = numX;
                if (numX < numCx - 20) {
                  anchor = 'start';
                  adjustedX = Math.max(4, numX - 65);
                } else if (numX > numCx + 20) {
                  anchor = 'end';
                  adjustedX = Math.min(numCx * 2 - 4, numX + 65);
                }
                return (
                  <text
                    x={adjustedX}
                    y={props.y}
                    textAnchor={anchor}
                    fill="var(--text-secondary)"
                    fontSize={10}
                    fontWeight={500}
                  >
                    {props.payload?.value}
                  </text>
                );
              }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
              stroke="var(--border-subtle)"
            />
            <Radar
              name="Evaluated Score"
              dataKey="score"
              stroke={isDark ? '#2dd4bf' : '#0f5b4a'}
              fill={isDark ? '#14b8a6' : '#0f5b4a'}
              fillOpacity={isDark ? 0.25 : 0.2}
              strokeWidth={2}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Structured Rubric Breakdown Bars */}
      <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)]">
        {radarData.map((item) => (
          <div key={item.subject} className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--text-primary)]">
                {item.subject}
                <span className="ml-1.5 text-[11px] text-[var(--text-muted)] font-mono">
                  (Weight: {item.weight}%)
                </span>
              </span>
              <span className="font-mono font-bold text-[var(--primary)]">
                {item.score}%
              </span>
            </div>
            <div className="h-2 w-full bg-[var(--bg-muted)] rounded-full overflow-hidden border border-[var(--border-subtle)]">
              <div
                className="h-full bg-[var(--primary)] rounded-full transition-all duration-300"
                style={{ width: `${item.score}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ScoreRadarChart;

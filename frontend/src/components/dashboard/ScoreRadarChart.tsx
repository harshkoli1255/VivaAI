'use client';

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';

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
  // Normalize raw 0-5 scores to 0-100 percentage scale for visual radar representation
  const radarData = [
    {
      subject: 'Conceptual Depth',
      score: Math.min(100, Math.round((scores.conceptual / 5) * 100)),
      weight: weights.conceptual,
    },
    {
      subject: 'Applied Depth',
      score: Math.min(100, Math.round((scores.depth_reasoning / 5) * 100)),
      weight: weights.depth_reasoning,
    },
    {
      subject: 'Problem Solving',
      score: Math.min(100, Math.round((scores.problem_solving / 5) * 100)),
      weight: weights.problem_solving,
    },
    {
      subject: 'Practical Code',
      score: Math.min(100, Math.round((scores.practical_project / 5) * 100)),
      weight: weights.practical_project,
    },
    {
      subject: 'Communication',
      score: Math.min(100, Math.round((scores.communication / 5) * 100)),
      weight: weights.communication,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Radar Graphic */}
      <div className="w-full h-64 flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
            <PolarGrid stroke="rgba(255, 255, 255, 0.1)" strokeDasharray="3 3" />
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fill: '#64748b', fontSize: 9 }}
              stroke="rgba(255, 255, 255, 0.08)"
            />
            <Radar
              name="Evaluated Score"
              dataKey="score"
              stroke="#38bdf8"
              fill="#0284c7"
              fillOpacity={0.35}
              strokeWidth={2}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Structured Rubric Breakdown Bars */}
      <div className="space-y-3 pt-3 border-t border-slate-800">
        {radarData.map((item) => (
          <div key={item.subject} className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">
                {item.subject}
                <span className="ml-1.5 text-[10px] font-mono text-slate-400">
                  (Weight: {item.weight}%)
                </span>
              </span>
              <span className="font-mono font-bold text-sky-400">
                {item.score}%
              </span>
            </div>
            <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${item.score}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface HistogramProps {
  scores: number[];
  bins?: number;
}

export default function Histogram({ scores, bins = 40 }: HistogramProps) {
  const histData = useMemo(() => {
    if (scores.length === 0) return [];

    const validScores = scores.filter((s) => !isNaN(s));
    if (validScores.length === 0) return [];

    const min = Math.min(...validScores);
    const max = Math.max(...validScores);
    const range = max - min || 1;
    const binWidth = range / bins;

    const counts: { bin: string; count: number; from: number; to: number }[] = [];
    for (let i = 0; i < bins; i++) {
      const from = min + i * binWidth;
      const to = from + binWidth;
      counts.push({
        bin: from.toFixed(3),
        count: 0,
        from,
        to,
      });
    }

    for (const s of validScores) {
      const idx = Math.min(Math.floor((s - min) / binWidth), bins - 1);
      counts[idx].count++;
    }

    return counts;
  }, [scores, bins]);

  if (histData.length === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">No scores to display</div>;
  }

  // Summary stats
  const validScores = scores.filter((s) => !isNaN(s));
  const mean = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  const sorted = [...validScores].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  const sd = Math.sqrt(validScores.reduce((s, v) => s + (v - mean) ** 2, 0) / validScores.length);

  return (
    <div>
      {/* Summary stats */}
      <div className="flex items-center gap-6 mb-3 text-xs text-muted-foreground">
        <span>N = <span className="font-mono font-medium text-foreground">{validScores.length}</span></span>
        <span>Mean = <span className="font-mono font-medium text-foreground">{mean.toFixed(4)}</span></span>
        <span>Median = <span className="font-mono font-medium text-foreground">{median.toFixed(4)}</span></span>
        <span>SD = <span className="font-mono font-medium text-foreground">{sd.toFixed(4)}</span></span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={histData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="bin"
            tick={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
            interval={Math.floor(bins / 8)}
            stroke="hsl(var(--muted-foreground))"
          />
          <YAxis
            tick={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
            stroke="hsl(var(--muted-foreground))"
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload;
              return (
                <div className="bg-card border border-border rounded px-2 py-1 shadow-md text-xs">
                  <div className="font-mono">
                    {d.from.toFixed(3)} – {d.to.toFixed(3)}
                  </div>
                  <div className="font-medium">{d.count} pairs</div>
                </div>
              );
            }}
          />
          <Bar dataKey="count" radius={[1, 1, 0, 0]}>
            {histData.map((entry, index) => (
              <Cell
                key={index}
                fill={
                  entry.from > 0.2
                    ? "hsl(207, 70%, 45%)"
                    : entry.from > 0.1
                    ? "hsl(207, 50%, 65%)"
                    : "hsl(210, 14%, 72%)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="text-xs text-center text-muted-foreground mt-1">
        Size-corrected ipTM score
      </div>
    </div>
  );
}

import { useMemo, useState, useRef } from "react";

interface HeatmapProps {
  matrix: number[][];
  labels: string[];
  categories: string[];
  categoryColors: Record<string, string>;
}

// White-to-blue color scale
function getColor(value: number, minVal: number, maxVal: number): string {
  if (isNaN(value)) return "#f0f0f0";
  const range = maxVal - minVal || 1;
  const t = Math.max(0, Math.min(1, (value - minVal) / range));
  // White (245,248,255) to deep blue (30,80,180)
  const r = Math.round(245 - t * 215);
  const g = Math.round(248 - t * 168);
  const b = Math.round(255 - t * 75);
  return `rgb(${r},${g},${b})`;
}

function getTextColor(value: number, minVal: number, maxVal: number): string {
  if (isNaN(value)) return "#999";
  const range = maxVal - minVal || 1;
  const t = (value - minVal) / range;
  return t > 0.5 ? "#fff" : "#333";
}

const CATEGORY_BAND_COLORS: Record<string, string> = {
  capsule: "#f59e0b",
  divisome: "#3b82f6",
  elongasome: "#10b981",
  hydrolase: "#ef4444",
  PBP: "#8b5cf6",
  PG_synthesis: "#06b6d4",
  PG_modification: "#f97316",
  custom: "#6b7280",
  unknown: "#9ca3af",
};

export default function Heatmap({ matrix, labels, categories, categoryColors }: HeatmapProps) {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const n = labels.length;

  // Compute min/max of off-diagonal values
  const { minVal, maxVal } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const v = matrix[i]?.[j];
        if (!isNaN(v) && v !== undefined) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    return { minVal: min === Infinity ? 0 : min, maxVal: max === -Infinity ? 1 : max };
  }, [matrix, n]);

  // Map labels to short gene names
  const geneNames = useMemo(() => {
    return labels.map((l) => {
      const parts = l.split("_");
      return parts.length >= 3 ? parts.slice(2).join("_") : parts.pop() || l;
    });
  }, [labels]);

  // Map labels to categories
  const labelCategories = useMemo(() => {
    return labels.map((l) => {
      // Extract SPD locus from label
      const parts = l.split("_");
      if (parts.length >= 2) {
        const spd = `${parts[0]}_${parts[1]}`;
        // Find from categories or default
      }
      // For simplicity, try to match partial
      for (const cat of categories) {
        // We'd need metadata map here; use a heuristic
      }
      return "unknown";
    });
  }, [labels, categories]);

  if (n === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">No data to display</div>;
  }

  // Determine cell size based on number of proteins
  const cellSize = n > 50 ? 8 : n > 30 ? 12 : n > 20 ? 16 : 22;
  const labelWidth = n > 40 ? 50 : 70;
  const categoryBandWidth = 6;
  const totalSize = cellSize * n;

  const handleMouseEnter = (i: number, j: number, e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const value = matrix[i]?.[j];
    const text = `${geneNames[i]} × ${geneNames[j]}: ${isNaN(value) ? "N/A" : value.toFixed(4)}`;
    setTooltip({
      x: e.clientX - rect.left + 10,
      y: e.clientY - rect.top - 20,
      text,
    });
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="overflow-auto max-h-[600px] max-w-full">
        <svg
          width={labelWidth + categoryBandWidth + totalSize + 60}
          height={labelWidth + categoryBandWidth + totalSize + 60}
          className="select-none"
        >
          {/* Column labels (rotated) */}
          {geneNames.map((name, j) => (
            <text
              key={`col-${j}`}
              x={0}
              y={0}
              transform={`translate(${labelWidth + categoryBandWidth + j * cellSize + cellSize / 2}, ${labelWidth - 2}) rotate(-45)`}
              textAnchor="end"
              className="fill-foreground"
              fontSize={cellSize > 14 ? 9 : 7}
              fontFamily="JetBrains Mono, monospace"
            >
              {name}
            </text>
          ))}

          {/* Row labels */}
          {geneNames.map((name, i) => (
            <text
              key={`row-${i}`}
              x={labelWidth - 4}
              y={labelWidth + categoryBandWidth + i * cellSize + cellSize / 2 + 3}
              textAnchor="end"
              className="fill-foreground"
              fontSize={cellSize > 14 ? 9 : 7}
              fontFamily="JetBrains Mono, monospace"
            >
              {name}
            </text>
          ))}

          {/* Matrix cells */}
          {matrix.map((row, i) =>
            row.map((val, j) => (
              <rect
                key={`${i}-${j}`}
                x={labelWidth + categoryBandWidth + j * cellSize}
                y={labelWidth + categoryBandWidth + i * cellSize}
                width={cellSize}
                height={cellSize}
                fill={i === j ? "#e0e0e0" : getColor(val, minVal, maxVal)}
                className="heatmap-cell"
                onMouseEnter={(e) => handleMouseEnter(i, j, e)}
                onMouseLeave={() => setTooltip(null)}
              />
            ))
          )}

          {/* Color legend */}
          <defs>
            <linearGradient id="heatmap-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={getColor(minVal, minVal, maxVal)} />
              <stop offset="50%" stopColor={getColor((minVal + maxVal) / 2, minVal, maxVal)} />
              <stop offset="100%" stopColor={getColor(maxVal, minVal, maxVal)} />
            </linearGradient>
          </defs>

          {/* Legend bar */}
          <rect
            x={labelWidth + categoryBandWidth + totalSize + 10}
            y={labelWidth + categoryBandWidth}
            width={16}
            height={Math.min(totalSize, 200)}
            fill="url(#heatmap-gradient)"
            transform={`rotate(90, ${labelWidth + categoryBandWidth + totalSize + 18}, ${labelWidth + categoryBandWidth + Math.min(totalSize, 200) / 2})`}
            rx={2}
          />
          <text
            x={labelWidth + categoryBandWidth}
            y={labelWidth + categoryBandWidth + totalSize + 30}
            fontSize={8}
            className="fill-muted-foreground"
            fontFamily="JetBrains Mono, monospace"
          >
            {minVal.toFixed(2)}
          </text>
          <text
            x={labelWidth + categoryBandWidth + totalSize - 30}
            y={labelWidth + categoryBandWidth + totalSize + 30}
            fontSize={8}
            className="fill-muted-foreground"
            fontFamily="JetBrains Mono, monospace"
          >
            {maxVal.toFixed(2)}
          </text>
          <text
            x={labelWidth + categoryBandWidth + totalSize / 2 - 25}
            y={labelWidth + categoryBandWidth + totalSize + 45}
            fontSize={8}
            className="fill-muted-foreground"
          >
            size-corrected ipTM
          </text>
        </svg>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-foreground text-background text-xs px-2 py-1 rounded shadow-lg z-50 font-protein whitespace-nowrap"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

/**
 * SVG sparkline.
 *
 * Built from first principles rather than pulled from a charting library: the
 * prototype only needs a single curve with an area wash, and a bespoke
 * component keeps the bundle free of a charting dependency while rendering
 * identically for EWMA burn curves, revenue trends, and vitals histories.
 */

import { useId } from "react";

export interface SparklineProps {
  values: number[];
  /** Stroke colour for the curve. */
  stroke?: string;
  /** Area wash colour; omit for a bare line. */
  fill?: string;
  height?: number;
  /** Marks the final point with a filled dot. */
  showEndPoint?: boolean;
  className?: string;
  ariaLabel?: string;
}

const VIEW_WIDTH = 120;

export default function Sparkline({
  values,
  stroke = "#14416b",
  fill = "rgba(34,211,238,0.16)",
  height = 34,
  showEndPoint = true,
  className,
  ariaLabel,
}: SparklineProps) {
  const gradientId = useId();
  const series = values.filter((value) => Number.isFinite(value));

  if (series.length < 2) {
    return (
      <div
        className={`flex items-center justify-center text-[10px] uppercase tracking-wider text-ink-400 ${className ?? ""}`}
        style={{ height }}
      >
        No trend data
      </div>
    );
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const inset = 3;
  const innerHeight = height - inset * 2;

  const toX = (index: number) => (index / (series.length - 1)) * VIEW_WIDTH;
  const toY = (value: number) => inset + (1 - (value - min) / span) * innerHeight;

  const linePath = series.map((value, index) => `${index === 0 ? "M" : "L"}${toX(index).toFixed(2)},${toY(value).toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${VIEW_WIDTH},${height} L0,${height} Z`;
  const lastX = toX(series.length - 1);
  const lastY = toY(series[series.length - 1]);

  return (
    <svg
      className={className}
      viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel ?? "Trend sparkline"}
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fill} />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        </>
      ) : null}
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      {showEndPoint ? <circle cx={lastX} cy={lastY} r={2.4} fill={stroke} /> : null}
    </svg>
  );
}

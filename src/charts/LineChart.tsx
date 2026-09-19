/**
 * Multi-series SVG line chart.
 *
 * Written from scratch so it can shade a clinical reference band and read out
 * individual points on hover, which is what both the longitudinal biomarker
 * trends and the shortage burn-rate drill-down need. Series are index-aligned:
 * every series shares the same x positions, which matches how the prototype
 * stores dated readings.
 */

import { useMemo, useState } from "react";
import { cx } from "@/utils/format";

export interface LinePoint {
  label: string;
  value: number;
}

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  points: LinePoint[];
  /** Render as a dashed guide, used for the pre-surge baseline. */
  dashed?: boolean;
  /** Fill beneath the curve. */
  area?: boolean;
}

export interface LineChartProps {
  series: LineSeries[];
  /** Shaded reference band, e.g. a biomarker's normal physiological range. */
  band?: { min: number; max: number; label?: string };
  height?: number;
  /** Formats axis ticks and tooltip values. */
  valueFormat?: (value: number) => string;
  /** Formats the x axis labels; defaults to the point label. */
  labelFormat?: (label: string) => string;
  emptyMessage?: string;
  ariaLabel?: string;
}

const VIEW_WIDTH = 720;
const PADDING = { top: 18, right: 20, bottom: 36, left: 62 };

/** Human-friendly tick spacing for an arbitrary numeric range. */
function niceStep(range: number, tickCount: number): number {
  const rough = range / Math.max(tickCount, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough || 1));
  const candidates = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude);
  return candidates.find((candidate) => candidate >= rough) ?? magnitude * 10;
}

export default function LineChart({
  series,
  band,
  height = 300,
  valueFormat = (value) => String(Math.round(value * 10) / 10),
  labelFormat,
  emptyMessage = "No data to plot yet.",
  ariaLabel = "Chart",
}: LineChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const usable = useMemo(() => (series ?? []).filter((item) => item.points.length > 0), [series]);
  const pointCount = usable.reduce((longest, item) => Math.max(longest, item.points.length), 0);

  const geometry = useMemo(() => {
    if (usable.length === 0 || pointCount < 2) return null;

    const innerWidth = VIEW_WIDTH - PADDING.left - PADDING.right;
    const innerHeight = height - PADDING.top - PADDING.bottom;

    const values: number[] = [];
    for (const item of usable) for (const point of item.points) values.push(point.value);
    if (band) values.push(band.min, band.max);

    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    // Breathing room so points never touch the frame.
    const headroom = (max - min) * 0.12;
    min -= headroom;
    max += headroom;

    const step = niceStep(max - min, 4);
    const tickStart = Math.floor(min / step) * step;
    const ticks: number[] = [];
    for (let value = tickStart; value <= max + step; value += step) {
      if (value >= min) ticks.push(Number(value.toFixed(6)));
    }

    const toX = (index: number) => PADDING.left + (index / (pointCount - 1)) * innerWidth;
    const toY = (value: number) => PADDING.top + (1 - (value - min) / (max - min)) * innerHeight;

    const paths = usable.map((item) => {
      const commands = item.points
        .map((point, index) => `${index === 0 ? "M" : "L"}${toX(index).toFixed(2)},${toY(point.value).toFixed(2)}`)
        .join(" ");
      const areaPath =
        item.area && item.points.length > 1
          ? `${commands} L${toX(item.points.length - 1).toFixed(2)},${(PADDING.top + innerHeight).toFixed(2)} L${toX(0).toFixed(2)},${(PADDING.top + innerHeight).toFixed(2)} Z`
          : null;
      return { ...item, commands, areaPath };
    });

    return { innerWidth, innerHeight, min, max, ticks, toX, toY, paths };
  }, [usable, pointCount, band, height]);

  if (!geometry) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-rule text-xs text-ink-400"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    );
  }

  const { innerWidth, innerHeight, ticks, toX, toY, paths } = geometry;
  const plotBottom = PADDING.top + innerHeight;
  const activeX = activeIndex === null ? null : toX(activeIndex);
  const formatLabel = labelFormat ?? ((value: string) => value);

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
      className="w-full"
      role="img"
      aria-label={ariaLabel}
      onMouseLeave={() => setActiveIndex(null)}
    >
      {/* Reference band drawn first so curves sit above it. */}
      {band ? (
        <g>
          <rect
            x={PADDING.left}
            y={Math.max(PADDING.top, toY(band.max))}
            width={innerWidth}
            height={Math.max(0, Math.min(plotBottom, toY(band.min)) - Math.max(PADDING.top, toY(band.max)))}
            fill="rgba(28,107,60,0.07)"
            stroke="rgba(28,107,60,0.35)"
            strokeDasharray="3 3"
          />
          {band.label ? (
            <text
              x={PADDING.left + 6}
              y={Math.max(PADDING.top + 12, toY(band.max) + 13)}
              className="fill-risk-normal"
              style={{ fontSize: 10, letterSpacing: "0.04em" }}
            >
              {band.label}
            </text>
          ) : null}
        </g>
      ) : null}

      {/* Horizontal gridlines and y ticks. */}
      {ticks.map((tick) => (
        <g key={`tick-${tick}`}>
          <line
            x1={PADDING.left}
            x2={PADDING.left + innerWidth}
            y1={toY(tick)}
            y2={toY(tick)}
            stroke="rgba(20,24,29,0.10)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={PADDING.left - 8}
            y={toY(tick) + 3.5}
            textAnchor="end"
            className="fill-ink-400"
            style={{ fontSize: 11 }}
          >
            {valueFormat(tick)}
          </text>
        </g>
      ))}

      {/* Series. */}
      {paths.map((item) =>
        item.areaPath ? (
          <path key={`${item.key}-area`} d={item.areaPath} fill={item.color} opacity={0.14} stroke="none" />
        ) : null,
      )}
      {paths.map((item) => (
        <path
          key={item.key}
          d={item.commands}
          fill="none"
          stroke={item.color}
          strokeWidth={2}
          strokeDasharray={item.dashed ? "5 4" : undefined}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* Point markers. */}
      {paths.map((item) =>
        item.points.length <= 12 ? (
          <g key={`${item.key}-dots`}>
            {item.points.map((point, index) => (
              <circle
                key={`${item.key}-dot-${index}`}
                cx={toX(index)}
                cy={toY(point.value)}
                r={activeIndex === index ? 4.5 : 3}
                fill={item.color}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
            ))}
          </g>
        ) : null,
      )}

      {/* X axis labels: first, middle and last to avoid collisions. */}
      {[0, Math.floor((pointCount - 1) / 2), pointCount - 1]
        .filter((index, position, list) => index >= 0 && list.indexOf(index) === position)
        .map((index) => {
          const anchor = index === 0 ? "start" : index === pointCount - 1 ? "end" : "middle";
          return (
            <text
              key={`x-${index}`}
              x={toX(index)}
              y={height - 12}
              textAnchor={anchor}
              className="fill-ink-400"
              style={{ fontSize: 11 }}
            >
              {formatLabel(usable[0].points[index]?.label ?? "")}
            </text>
          );
        })}

      {/* Hover targets: one full-height column per x position. */}
      {Array.from({ length: pointCount }, (_, index) => {
        const columnWidth = innerWidth / Math.max(pointCount - 1, 1);
        return (
          <rect
            key={`hit-${index}`}
            x={toX(index) - columnWidth / 2}
            y={PADDING.top}
            width={columnWidth}
            height={innerHeight}
            fill="transparent"
            onMouseEnter={() => setActiveIndex(index)}
            onFocus={() => setActiveIndex(index)}
            tabIndex={0}
          />
        );
      })}

      {/* Readout for the hovered column. */}
      {activeIndex !== null && activeX !== null ? (
        <g pointerEvents="none">
          <line
            x1={activeX}
            x2={activeX}
            y1={PADDING.top}
            y2={plotBottom}
            stroke="rgba(20,24,29,0.35)"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          {paths.map((item) => {
            const point = item.points[activeIndex];
            if (!point) return null;
            const text = `${item.label}: ${valueFormat(point.value)}`;
            const width = Math.max(96, text.length * 6.4);
            const boxX = Math.min(Math.max(activeX + 10, PADDING.left), PADDING.left + innerWidth - width);
            const boxY = Math.max(PADDING.top + 4, toY(point.value) - 26 + paths.indexOf(item) * 0);
            return (
              <g key={`tip-${item.key}`}>
                <rect x={boxX} y={boxY} width={width} height={20} fill="#ffffff" stroke={item.color} />
                <text x={boxX + 8} y={boxY + 14} className="fill-ink-900" style={{ fontSize: 11 }}>
                  {text}
                </text>
              </g>
            );
          })}
          <text
            x={Math.min(Math.max(activeX, PADDING.left), PADDING.left + innerWidth)}
            y={PADDING.top + 12}
            textAnchor="middle"
            className="fill-ink-500"
            style={{ fontSize: 11 }}
          >
            {formatLabel(usable[0].points[activeIndex]?.label ?? "")}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

/** Shared legend row for charts with more than one series. */
export function ChartLegend({ series, className }: { series: { key: string; label: string; color: string }[]; className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-500", className)}>
      {series.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

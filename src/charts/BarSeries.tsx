/**
 * Horizontal bar series and a donut breakdown.
 *
 * Bars use plain layout rather than SVG so labels stay selectable and the rows
 * reflow naturally on narrow screens. The donut is SVG because it needs arc
 * maths.
 */

import { cx } from "@/utils/format";

export interface BarItem {
  key: string;
  label: string;
  value: number;
  color?: string;
  /** Secondary line shown beneath the label, e.g. a unit or a count. */
  hint?: string;
}

export interface BarSeriesProps {
  items: BarItem[];
  /** Fixed maximum for the bar scale; defaults to the largest value. */
  max?: number;
  valueFormat?: (value: number) => string;
  className?: string;
  emptyMessage?: string;
}

export function BarSeries({
  items,
  max,
  valueFormat = (value) => String(value),
  className,
  emptyMessage = "Nothing to show yet.",
}: BarSeriesProps) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-xs text-ink-400">{emptyMessage}</p>;
  }

  const scaleMax = max ?? Math.max(...items.map((item) => item.value), 1);

  return (
    <ul className={cx("space-y-2.5", className)}>
      {items.map((item) => {
        const ratio = scaleMax > 0 ? Math.min(1, item.value / scaleMax) : 0;
        return (
          <li key={item.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-xs font-medium text-ink-700">{item.label}</span>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-900">
                {valueFormat(item.value)}
              </span>
            </div>
            <div className="h-2 overflow-hidden border border-rule-soft bg-canvas">
              <div
                className="h-full transition-[width] duration-500"
                style={{ width: `${Math.max(ratio * 100, item.value > 0 ? 2 : 0)}%`, background: item.color ?? "#14416b" }}
              />
            </div>
            {item.hint ? <p className="mt-1 text-[11px] text-ink-400">{item.hint}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface DonutProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  className?: string;
}

export function Donut({
  segments,
  size = 168,
  thickness = 18,
  centerLabel,
  centerValue,
  className,
}: DonutProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className={cx("flex items-center gap-5", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full -rotate-90" role="img" aria-label="Distribution">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e3e5e9" strokeWidth={thickness} />
          {total > 0
            ? segments.map((segment) => {
                const length = (segment.value / total) * circumference;
                const dash = `${length} ${circumference - length}`;
                const element = (
                  <circle
                    key={segment.key}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth={thickness}
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                    strokeLinecap="butt"
                  />
                );
                offset += length;
                return element;
              })
            : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-serif text-2xl font-semibold tabular-nums text-ink-900">{centerValue ?? total}</span>
          {centerLabel ? (
            <span className="text-[10px] uppercase tracking-widest text-ink-500">{centerLabel}</span>
          ) : null}
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center justify-between gap-3 text-xs">
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: segment.color }} />
              <span className="truncate text-ink-700">{segment.label}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-ink-900">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

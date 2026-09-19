/**
 * Semicircular gauge for a 0 - 100 risk score.
 *
 * The arc is assembled from plain SVG path maths rather than a charting
 * library, which keeps the control room's headline visual dependency free.
 */

import { cx } from "@/utils/format";

export interface GaugeArcProps {
  /** Score from 0 to 100. */
  value: number;
  label?: string;
  /** Colour of the filled arc. */
  color?: string;
  /** Optional named thresholds drawn as notches on the track. */
  thresholds?: { at: number; label: string }[];
  size?: number;
  className?: string;
}

const START_ANGLE = 180;
const END_ANGLE = 360;

function polar(cx0: number, cy0: number, radius: number, angleDeg: number): { x: number; y: number } {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: cx0 + radius * Math.cos(radians), y: cy0 + radius * Math.sin(radians) };
}

/** Arc path from one angle to another, sweeping clockwise over the top. */
function arcPath(
  cx0: number,
  cy0: number,
  radius: number,
  fromAngle: number,
  toAngle: number,
): string {
  const start = polar(cx0, cy0, radius, fromAngle);
  const end = polar(cx0, cy0, radius, toAngle);
  const largeArc = Math.abs(toAngle - fromAngle) > 180 ? 1 : 0;
  return `M${start.x.toFixed(2)},${start.y.toFixed(2)} A${radius},${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)},${end.y.toFixed(2)}`;
}

export default function GaugeArc({
  value,
  label,
  color = "#14416b",
  thresholds,
  size = 220,
  className,
}: GaugeArcProps) {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const height = size * 0.62;
  const center = { x: size / 2, y: height - 10 };
  const radius = size / 2 - 16;
  const strokeWidth = Math.max(10, size * 0.075);

  const sweep = (score: number) => START_ANGLE + ((END_ANGLE - START_ANGLE) * score) / 100;

  return (
    <div className={cx("relative", className)} style={{ width: size }}>
      <svg
        viewBox={`0 0 ${size} ${height}`}
        className="w-full"
        role="img"
        aria-label={`${label ?? "Score"}: ${clamped.toFixed(1)} out of 100`}
      >
        <path
          d={arcPath(center.x, center.y, radius, START_ANGLE, END_ANGLE)}
          fill="none"
          stroke="#e3e5e9"
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
        />
        <path
          d={arcPath(center.x, center.y, radius, START_ANGLE, Math.max(sweep(clamped), START_ANGLE + 0.5))}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
        />
        {thresholds?.map((threshold) => {
          const outer = polar(center.x, center.y, radius + strokeWidth / 2, sweep(threshold.at));
          const inner = polar(center.x, center.y, radius - strokeWidth / 2, sweep(threshold.at));
          return (
            <line
              key={threshold.label}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="#ffffff"
              strokeWidth={2}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 text-center">
        <div className="font-serif text-3xl font-semibold tabular-nums text-ink-900">{clamped.toFixed(1)}</div>
        {label ? <div className="text-[11px] uppercase tracking-widest text-ink-500">{label}</div> : null}
      </div>
    </div>
  );
}

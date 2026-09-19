/**
 * Icon set.
 *
 * Every glyph is hand-authored geometry on a 24x24 grid with a 1.6 stroke, so
 * the prototype carries no icon-font or icon-library dependency while still
 * rendering crisply at 16px in the navigation rail.
 */

import type { ReactNode } from "react";

export type IconName =
  | "dashboard"
  | "shortage"
  | "sandbox"
  | "analytics"
  | "governance"
  | "queue"
  | "prescribe"
  | "report"
  | "emar"
  | "vitals"
  | "stock"
  | "register"
  | "calendar"
  | "invoice"
  | "pos"
  | "reconcile"
  | "trends"
  | "alert"
  | "bell"
  | "refresh"
  | "upload"
  | "download"
  | "print"
  | "check"
  | "close"
  | "chevronDown"
  | "search"
  | "plus"
  | "lock"
  | "info"
  | "swap"
  | "bolt"
  | "shield"
  | "bed"
  | "user";

const PATHS: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="4.5" rx="1.5" />
      <rect x="13.5" y="10.5" width="7.5" height="10.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  shortage: (
    <>
      <path d="M3 17.5 8 11l4 3.5L21 5" />
      <path d="M15.5 5H21v5.5" />
      <path d="M3 21h18" />
    </>
  ),
  sandbox: (
    <>
      <path d="M9 3h6v4H9z" />
      <path d="M5 21V11a7 7 0 0 1 14 0v10" />
      <path d="M3 21h18" />
      <path d="M12 11v6" />
      <path d="M9.5 14.5 12 17l2.5-2.5" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </>
  ),
  governance: (
    <>
      <path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6z" />
      <path d="M9 12.5 11 15l4-5" />
    </>
  ),
  queue: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M17 9h5" />
      <path d="M17 13h5" />
      <path d="M17 17h3" />
    </>
  ),
  prescribe: (
    <>
      <rect x="2.5" y="9" width="12" height="6" rx="3" transform="rotate(-45 8.5 12)" />
      <path d="M14 15 20.5 21.5" />
      <path d="M13.5 18.5 18 14" />
    </>
  ),
  report: (
    <>
      <path d="M6 2.5h7l5 5v14H6z" />
      <path d="M13 2.5v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </>
  ),
  emar: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 3v3h6V3" />
      <path d="M12 10v6" />
      <path d="M9 13h6" />
    </>
  ),
  vitals: (
    <>
      <path d="M2 12h4l2-5 3.5 10L14 12h8" />
    </>
  ),
  stock: (
    <>
      <path d="M3 8 12 3l9 5v8l-9 5-9-5z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </>
  ),
  register: (
    <>
      <circle cx="10" cy="8" r="3.4" />
      <path d="M3.5 20.5c0-3.4 2.9-5.6 6.5-5.6s6.5 2.2 6.5 5.6" />
      <path d="M18 8h4" />
      <path d="M20 6v4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),
  invoice: (
    <>
      <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </>
  ),
  pos: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19" />
      <path d="M6 14.5h4" />
    </>
  ),
  reconcile: (
    <>
      <path d="M4 8h13l-3-3" />
      <path d="M20 16H7l3 3" />
    </>
  ),
  trends: (
    <>
      <path d="M3 20h18" />
      <path d="M3 20V4" />
      <path d="M6.5 16.5 11 11l3.5 2.5L20 6" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 21 20H3z" />
      <path d="M12 9.5v5" />
      <path d="M12 17.3h.01" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 3.5V9h-5.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 16v3.5h16V16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12" />
      <path d="M7.5 11.5 12 16l4.5-4.5" />
      <path d="M4 16v3.5h16V16" />
    </>
  ),
  print: (
    <>
      <path d="M7 9V3h10v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  chevronDown: <path d="M6 9.5 12 15.5l6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5v6" />
      <path d="M12 7.6h.01" />
    </>
  ),
  swap: (
    <>
      <path d="M4 7h12l-3-3" />
      <path d="M20 17H8l3 3" />
    </>
  ),
  bolt: <path d="M13.5 2.5 5 13.5h5l-1 8L19 10h-5.5z" />,
  shield: (
    <>
      <path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6z" />
    </>
  ),
  bed: (
    <>
      <path d="M3 20V8" />
      <path d="M3 12h13a4 4 0 0 1 4 4v4" />
      <path d="M3 20h18" />
      <circle cx="8" cy="9.5" r="2.2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20.5c0-3.6 3.2-6 7.5-6s7.5 2.4 7.5 6" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export default function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

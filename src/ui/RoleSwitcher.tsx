/**
 * Role switcher.
 *
 * A single dropdown in the top bar moves the session between all six portals.
 * Switching a role also resets the active view to that role's landing page and
 * loads its default persona, so a judge can hop roles without getting stranded
 * on a screen the new role cannot access.
 */

import { useRef, useState } from "react";
import type { Role } from "@/types";
import { ROLE_META } from "@/ui/theme";
import { HOME_VIEW, NAV_BY_ROLE, ROLE_DEFAULTS } from "@/ui/navigation";
import { useApp } from "@/store/AppStore";
import { useClickOutside } from "@/ui/hooks";
import Icon from "@/ui/Icon";
import { cx } from "@/utils/format";

const ROLE_ORDER: Role[] = ["admin", "doctor", "nurse", "receptionist", "cashier", "patient"];

export default function RoleSwitcher() {
  const { state, actions } = useApp();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setOpen(false), open);

  const current = state.session.role;
  const meta = ROLE_META[current];

  const switchRole = (role: Role) => {
    const defaults = ROLE_DEFAULTS[role];
    actions.setRole(role);
    actions.setActivePatient(defaults.patientId);
    actions.setView(HOME_VIEW[role]);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-lg border border-white/12 bg-white/[0.04] py-1.5 pl-2 pr-3 transition hover:border-white/25 hover:bg-white/[0.07]"
      >
        <span
          className="grid h-7 w-7 place-items-center rounded-md text-[11px] font-bold text-surface-900"
          style={{ background: meta.accent }}
        >
          {meta.label.slice(0, 2).toUpperCase()}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-xs font-semibold leading-tight text-white">{meta.label} portal</span>
          <span className="block text-[10px] leading-tight text-slate-400">Switch role</span>
        </span>
        <Icon name="chevronDown" size={14} className={cx("text-slate-400 transition", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute right-0 z-40 mt-2 w-[22rem] animate-rise-in overflow-hidden rounded-xl border border-white/12 bg-surface-800/98 shadow-2xl backdrop-blur"
        >
          <div className="border-b border-white/10 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Demo role switching
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              Every portal reads the same seeded database, so a prescription written as a doctor is visible to the
              nurse and the cashier straight away.
            </p>
          </div>
          <ul className="max-h-[24rem] overflow-y-auto p-1.5">
            {ROLE_ORDER.map((role) => {
              const roleMeta = ROLE_META[role];
              const isActive = role === current;
              return (
                <li key={role}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => switchRole(role)}
                    className={cx(
                      "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition",
                      isActive ? "bg-white/[0.07]" : "hover:bg-white/[0.05]",
                    )}
                  >
                    <span
                      className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-[11px] font-bold text-surface-900"
                      style={{ background: roleMeta.accent }}
                    >
                      {roleMeta.label.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{roleMeta.label}</span>
                        <span className="text-[10px] text-slate-500">{NAV_BY_ROLE[role].length} modules</span>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">{roleMeta.persona}</span>
                      <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                        {roleMeta.summary}
                      </span>
                    </span>
                    {isActive ? <Icon name="check" size={16} className="mt-1 shrink-0 text-accent" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

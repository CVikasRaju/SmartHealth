/**
 * User account & session menu.
 *
 * Displays the authenticated user's profile, role entitlement, and hospital
 * affiliation. Enforces strict privacy by requiring an explicit sign-out / switch
 * account flow rather than unauthenticated arbitrary role hopping.
 */

import { useRef, useState } from "react";
import { ROLE_META } from "@/ui/theme";
import { useApp } from "@/store/AppStore";
import { useSession } from "@/store/SessionProvider";
import { useClickOutside } from "@/ui/hooks";
import Icon from "@/ui/Icon";
import { Button } from "@/ui/primitives";
import { cx, displayName } from "@/utils/format";

export default function RoleSwitcher() {
  const { state, profile } = useApp();
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setOpen(false), open);

  const currentRole = state.session.role;
  const meta = ROLE_META[currentRole];
  const hospital = (state.db.hospitals ?? []).find((h) => h.id === state.session.hospitalId);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="User Account & Session"
        className="flex items-center gap-2.5 rounded-sm border border-rule-strong bg-paper py-1 pl-1.5 pr-2.5 transition hover:bg-canvas"
      >
        <span
          className="grid h-7 w-7 place-items-center rounded-xs text-[11px] font-bold text-white shadow-xs"
          style={{ background: meta.accent }}
        >
          {meta.label.slice(0, 2).toUpperCase()}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-xs font-semibold leading-tight text-ink-900">{meta.label}</span>
          <span className="block text-[10px] leading-tight text-ink-400">
            {profile?.fullName ? displayName(profile.fullName) : meta.persona.split("·")[0].trim()}
          </span>
        </span>
        <Icon name="chevronDown" size={14} className={cx("text-ink-400 transition", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="User Account Information"
          className="absolute right-0 z-40 mt-2 w-[22rem] animate-rise-in overflow-hidden rounded border border-rule-strong bg-paper shadow-sheet"
        >
          {/* User profile header */}
          <div className="border-b border-rule bg-canvas p-4">
            <div className="flex items-center gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded text-sm font-bold text-white"
                style={{ background: meta.accent }}
              >
                {meta.label.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-900">
                  {profile?.fullName ?? meta.persona.split("·")[0].trim()}
                </p>
                <p className="truncate text-xs text-ink-500">{profile?.email ?? "Authenticated User"}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule-soft pt-2">
              <span
                className="rounded border border-rule bg-paper px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: meta.accent }}
              >
                {meta.label}
              </span>
              <span className="text-[11px] font-medium text-ink-600">
                {currentRole === "superadmin"
                  ? "Health Network Governance"
                  : hospital
                  ? hospital.name
                  : "KMC Hospital Mangalore"}
              </span>
            </div>
          </div>

          {/* Privacy & Scope Information */}
          <div className="space-y-3 p-4">
            <div className="rounded-xl border border-rule/70 bg-canvas/40 p-3 text-[11px] leading-relaxed text-ink-600">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-ink-800">
                <Icon name="check" size={13} className="text-risk-normal" />
                Zero-Trust Data Isolation Active
              </p>
              <p>
                {currentRole === "superadmin"
                  ? "Super Admin is strictly isolated from patient health records (Zero PHI Access) to ensure regulatory compliance."
                  : currentRole === "admin"
                  ? "Hospital Admin is scoped to institutional operations, drug shortage management, and administrative staffing."
                  : currentRole === "patient"
                  ? "Patient Portal is restricted solely to your personal medical records and test reports."
                  : "Clinical access is logged on the immutable audit trail."}
              </p>
            </div>

            {/* Explicit Sign Out / Switch Account */}
            <div className="pt-2">
              <Button
                size="sm"
                variant="secondary"
                fullWidth
                onClick={() => {
                  setOpen(false);
                  void signOut();
                }}
              >
                <Icon name="close" size={13} />
                Sign out / Switch Account
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

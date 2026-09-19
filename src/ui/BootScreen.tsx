/**
 * Boot screen.
 *
 * Shown while a credential or the hospital record is being fetched, and when
 * that fetch fails. It uses the same institutional chrome as the rest of the
 * application so the transition into the record is not jarring.
 */

import { BRANDING } from "@/config/branding";
import Icon from "@/ui/Icon";
import { Button } from "@/ui/primitives";

export default function BootScreen({
  title,
  detail,
  onRetry,
  onSignOut,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
  onSignOut?: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="h-1 shrink-0 bg-accent" />
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-lg border border-rule bg-paper shadow-panel">
          <div className="border-b border-rule px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center border border-accent bg-accent text-white">
                <Icon name="vitals" size={19} />
              </span>
              <div className="leading-tight">
                <p className="font-serif text-xl font-semibold tracking-tight text-ink-900">{BRANDING.name}</p>
                <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400">{BRANDING.documentTitle}</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-6">
            <p className="sm-eyebrow">{onRetry || onSignOut ? "Interrupted" : "Please wait"}</p>
            <h1 className="mt-1.5 font-serif text-lg text-ink-900">{title}</h1>
            {detail ? <p className="mt-2 text-xs leading-relaxed text-ink-500">{detail}</p> : null}

            {onRetry || onSignOut ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {onRetry ? (
                  <Button variant="primary" onClick={onRetry}>
                    <Icon name="refresh" size={13} />
                    Try again
                  </Button>
                ) : null}
                {onSignOut ? (
                  <Button variant="secondary" onClick={onSignOut}>
                    <Icon name="lock" size={13} />
                    Go to Sign In
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 inline-flex items-center gap-2 text-[11px] text-ink-400">
                <span className="h-3 w-3 animate-spin border border-ink-300 border-t-accent" />
                Working
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Diagnostic for the backtest.
 *
 *   npx tsx scripts/diagnose-backtest.ts
 *
 * Prints the twelve scored days leading into each stockout event: the shelf,
 * the days of cover the score saw, the score itself, and which of the two
 * methods had raised a flag. Used to establish *why* a replay behaves the way
 * it does, rather than assuming it.
 */

import { SEED_CONSUMPTION_PROFILES, createSeedMedicines } from "../src/data/mockData";
import { runBacktest } from "../src/engine/backtestEngine";

const result = runBacktest({ medicines: createSeedMedicines(), profiles: SEED_CONSUMPTION_PROFILES });

console.log(
  `\n  ${result.events.length} events, ${result.method.warnings} SPS warnings, ${result.baseline.warnings} rule warnings\n`,
);

const shown = new Map<string, number>();

for (const event of result.events) {
  const molecule = result.molecules.find((item) => item.medicineId === event.medicineId);
  if (!molecule) continue;

  const count = shown.get(event.medicineId) ?? 0;
  if (count >= 1) continue;
  shown.set(event.medicineId, count + 1);

  console.log(`  ${molecule.brandName} — stockout on day ${event.day} (${event.unitsShort} units unserved)`);

  const from = Math.max(0, event.day - 13);
  for (const point of molecule.timeline.filter((item) => item.day >= from && item.day <= event.day + 1)) {
    const marks = [
      point.flagged ? "SPS" : "   ",
      point.baselineFlagged ? "rule" : "    ",
      point.stockout ? "<-- STOCKOUT" : "",
    ].join(" ");
    console.log(
      `    day ${String(point.day).padStart(3)}  onHand ${String(point.onHand).padStart(5)}` +
        `  cover ${String(point.coverDays).padStart(6)}d  SPS ${String(point.sps).padStart(5)}  ${marks}`,
    );
  }
  console.log("");
}

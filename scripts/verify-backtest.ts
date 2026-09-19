/**
 * Forecast backtest verification.
 *
 *   npm run verify:backtest
 *
 * Runs a full year replay against the seeded formulary, prints the headline
 * comparison, and asserts the invariants that make the numbers trustworthy:
 * that the replay actually produces stockouts (otherwise the exercise is
 * vacuous), that the counters reconcile, that recall cannot fall as the warning
 * window widens, and that two runs of the same seed are identical.
 */

import { SEED_CONSUMPTION_PROFILES, createSeedMedicines } from "../src/data/mockData";
import { runBacktest } from "../src/engine/backtestEngine";

let failures = 0;
function assert(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

const medicines = createSeedMedicines();
const input = { medicines, profiles: SEED_CONSUMPTION_PROFILES };
const result = runBacktest(input);

console.log(`\n  Replay window   ${result.window.days} days (${result.window.scoredDays} scored after ${result.options.warmupDays} warm-up)`);
console.log(`  Stockout events ${result.events.length} across ${medicines.length} molecules`);
console.log("");
console.log("  Metric                                  SPS      reorder rule");
console.log("  ------------------------------------------------------------");
// A threshold rule has no date estimate, so its cell is printed as `n/a`
// rather than being credited with a number it cannot produce.
const cell = (value: string | number | null): string => (value === null ? "n/a" : String(value));
const row = (label: string, a: string | number | null, b: string | number | null): void =>
  console.log(`  ${label.padEnd(36)}${cell(a).padStart(8)}${cell(b).padStart(16)}`);
row("events caught / total", `${result.method.caught}/${result.method.events}`, `${result.baseline.caught}/${result.baseline.events}`);
row("recall %", result.method.recall, result.baseline.recall);
row("warnings raised", result.method.warnings, result.baseline.warnings);
row("false alarms", result.method.falseAlarms, result.baseline.falseAlarms);
row("false alarms / month", result.method.falseAlarmsPerMonth, result.baseline.falseAlarmsPerMonth);
row("precision %", result.method.precision, result.baseline.precision);
row("median days of warning", result.method.medianDaysEarly, result.baseline.medianDaysEarly);
row("median stockout date error (d)", result.method.medianDateErrorDays, result.baseline.medianDateErrorDays);
console.log("");

console.log("  Recall as the warning window widens");
for (const point of result.horizonCurve) {
  console.log(
    `    ${String(point.horizonDays).padStart(2)} days   SPS ${String(point.methodRecall).padStart(5)}%   rule ${String(point.baselineRecall).padStart(5)}%`,
  );
}
console.log("");

console.log("  Molecules with the most stockout events");
for (const molecule of result.molecules.filter((item) => item.events > 0).slice(0, 6)) {
  console.log(
    `    ${molecule.brandName.padEnd(32)} events ${String(molecule.events).padStart(2)}  ` +
      `SPS recall ${String(molecule.method.recall).padStart(5)}%  rule ${String(molecule.baseline.recall).padStart(5)}%  ` +
      `mean demand ${molecule.meanDailyDemand}/day`,
  );
}
console.log("");

/* -------- Invariants -------- */

assert("the replay produces stockout events", result.events.length > 0, `events = ${result.events.length}`);
assert(
  "the replay is not a stockout-only scenario",
  result.events.length < medicines.length * 12,
  `${result.events.length} events would mean the ordering policy could never keep up`,
);
assert("every event is either caught or missed", result.method.caught + result.method.missed === result.method.events);
assert("every warning is a hit or a false alarm", result.method.warnings === result.method.hits + result.method.falseAlarms);
assert("recall is a percentage", result.method.recall >= 0 && result.method.recall <= 100);
assert("precision is a percentage", result.method.precision >= 0 && result.method.precision <= 100);

const recallMonotonic = result.horizonCurve.every(
  (point, index) => index === 0 || point.methodRecall >= result.horizonCurve[index - 1].methodRecall - 0.001,
);
assert("recall cannot fall as the warning window widens", recallMonotonic);
assert(
  "the baseline also scores (the comparison is real)",
  result.baseline.warnings > 0,
  "a threshold rule that never fires would make the comparison meaningless",
);

const second = runBacktest(input);
assert(
  "the same seed reproduces the same result",
  JSON.stringify(second) === JSON.stringify(result),
  "the replay is not deterministic",
);

console.log(
  failures === 0
    ? "\n  all backtest invariants held\n"
    : `\n  ${failures} backtest invariant(s) failed\n`,
);
if (failures > 0) process.exitCode = 1;

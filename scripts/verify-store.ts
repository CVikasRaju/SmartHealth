/**
 * Store verification.
 *
 * Checks the reducer actions the API relies on: a bootstrap replaces the record
 * wholesale, and a reconciliation patch replaces rows in place without
 * reordering the lists the portals scroll.
 *
 *   npm run verify:store
 */

import { createInitialAppState } from "../src/data/mockData";
import { appReducer } from "../src/store/reducer";

let failures = 0;
function assert(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

const base = createInitialAppState();

/* Replacing the whole state, as a bootstrap does. */
const replaced = appReducer(base, {
  type: "state/replaceAll",
  db: { ...base.db, counters: { ...base.db.counters, treatment: 42 } },
  session: { role: "doctor", staffId: "staff-doctor-2", patientId: "patient-3" },
  activeView: "doctor.queue",
});
assert("replaceAll swaps the session", replaced.session.role === "doctor" && replaced.session.staffId === "staff-doctor-2");
assert("replaceAll swaps the view", replaced.activeView === "doctor.queue");
assert("replaceAll takes the new counters", replaced.db.counters.treatment === 42);

/* Merging a row the client already holds: replace in place, keep the position. */
const before = base.db.medicines.map((m) => m.currentStock);
const targetIndex = base.db.medicines.length - 1;
const target = base.db.medicines[targetIndex];

const merged = appReducer(base, {
  type: "state/merge",
  collections: { medicines: [{ ...target, currentStock: target.currentStock + 7 }] },
  counters: { audit: 99 },
});
assert("merge keeps the collection length", merged.db.medicines.length === base.db.medicines.length);
assert(
  "merge replaces the row in place",
  merged.db.medicines[targetIndex].id === target.id &&
    merged.db.medicines[targetIndex].currentStock === target.currentStock + 7,
);
assert(
  "merge leaves sibling rows untouched",
  merged.db.medicines.every((m, i) => i === targetIndex || m.currentStock === before[i]),
);
assert("merge advances the counters", merged.db.counters.audit === 99);

/* Merging a row the client does not hold: append, never duplicate. */
const stamped = { ...target, id: "med-new", brandName: "Novel" };
const appended = appReducer(base, { type: "state/merge", collections: { medicines: [stamped] } });
assert("merge appends an unknown row", appended.db.medicines.length === base.db.medicines.length + 1);
assert("merge preserves row identity", appended.db.medicines.some((m) => m.id === "med-new"));

const mergedTwice = appReducer(appended, { type: "state/merge", collections: { medicines: [stamped] } });
assert("merge is idempotent", mergedTwice.db.medicines.length === appended.db.medicines.length);

/* An empty patch must be inert. */
const inert = appReducer(base, { type: "state/merge", collections: {} });
assert("an empty patch changes nothing", inert.db.medicines.length === base.db.medicines.length);

/* Nested child replacement, as a ward transfer produces. */
const withWards = merged.db.medicines[targetIndex].wardStock.map((w, i) =>
  i === 0 ? { ...w, quantity: w.quantity + 3 } : w,
);
const wardMerged = appReducer(merged, {
  type: "state/merge",
  collections: { medicines: [{ ...target, wardStock: withWards }] },
});
assert(
  "merge replaces nested child rows",
  wardMerged.db.medicines[targetIndex].wardStock[0].quantity === withWards[0].quantity,
);

/* The original state must not be mutated. */
assert("the reducer stays pure", base.db.medicines[targetIndex].currentStock === before[targetIndex]);
assert("the replaced state stayed separate", replaced.db.medicines[0].id === base.db.medicines[0].id);

console.log(failures === 0 ? "\n  all reducer checks passed\n" : `\n  ${failures} failed\n`);
if (failures > 0) process.exitCode = 1;

/**
 * Disruption scenario presets for the admin sandbox.
 *
 * These are the shocks a hospital supply chain actually faces in this region:
 * a seasonal infection wave, a wholesaler failing to deliver, a cold-chain
 * failure writing off part of a holding, and combinations of the three.
 *
 * The sandbox never mutates live inventory. It clones the formulary, applies a
 * preset, and re-runs the full forecast so a planner can see which molecules
 * escalate before committing to anything.
 */

import type { ScenarioInput } from "@/types";

export const PENALTY_PRESETS: ScenarioInput[] = [
  {
    id: "seasonal-respiratory-surge",
    label: "Seasonal respiratory surge",
    description:
      "An infection wave lifts antibiotic and bronchodilator consumption for a fortnight while regional stock stays normal. This is the most common driver of an unforecast stockout.",
    demandSurgePct: 45,
    leadTimeSlippageDays: 0,
    regionalPressureDelta: 3,
    stockWriteOffPct: 0,
  },
  {
    id: "primary-distributor-default",
    label: "Primary distributor default",
    description:
      "The main wholesaler stops honouring the contracted lead time. Every molecule on that vendor's book slips, which is what pushes a comfortable cover level into the danger band.",
    demandSurgePct: 10,
    leadTimeSlippageDays: 6,
    regionalPressureDelta: 6,
    stockWriteOffPct: 0,
  },
  {
    id: "cold-chain-failure",
    label: "Cold-chain failure",
    description:
      "A refrigeration excursion in the central store writes off a third of the holding of temperature-sensitive items. Demand is unchanged; supply simply disappears.",
    demandSurgePct: 0,
    leadTimeSlippageDays: 2,
    regionalPressureDelta: 1,
    stockWriteOffPct: 35,
  },
  {
    id: "regional-epidemic-wave",
    label: "Regional epidemic wave",
    description:
      "Neighbouring facilities draw down the same district quota at the same time, so replenishment competes with everyone else while demand doubles.",
    demandSurgePct: 80,
    leadTimeSlippageDays: 4,
    regionalPressureDelta: 8,
    stockWriteOffPct: 0,
  },
  {
    id: "compound-crisis",
    label: "Compound crisis",
    description:
      "A surge, a vendor failure and a partial write-off land together. Used to find the molecules that break first so pre-emptive orders can be placed against them.",
    demandSurgePct: 60,
    leadTimeSlippageDays: 8,
    regionalPressureDelta: 7,
    stockWriteOffPct: 20,
  },
];

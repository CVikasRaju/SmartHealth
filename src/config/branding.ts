/**
 * Institution identity.
 *
 * Every place the product names itself reads from here, so rebranding the
 * prototype is a single-file change: swap the name, monogram, tagline and
 * accent below and the masthead, document title, exported report headers and
 * footer all follow.
 */

export const BRANDING = {
  /** Product name shown in the masthead for the institution. */
  name: "SmartMedic",

  /** Monogram used on the letterhead seal. */
  monogram: "SM",

  /** One-line description under the name. */
  tagline: "Hospital operations · shortage intelligence · report simplifier",

  /** The document class this application represents. */
  documentTitle: "Hospital Operations Record",

  /** Owning unit, printed on exported summaries. */
  organisation: "SmartMedic Health Network · Formulary & Clinical Governance",

  /** Institutional accent. Mirrors `colors.accent` in tailwind.config.js. */
  accent: "#14416b",

  /** Printed in the footer and on every exported report. */
  provenance: "Demonstration dataset. Not connected to any live clinical system.",

  /** Bumped when the seeded dataset shape changes, so a stale demo reseeds. */
  version: "1.0.0",
} as const;

export type Branding = typeof BRANDING;

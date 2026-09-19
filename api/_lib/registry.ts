/**
 * Collection registry.
 *
 * The domain model is camelCase; Postgres columns are snake_case. Rather than
 * hand-writing a mapper per table, this registry declares the few things that
 * are genuinely irregular:
 *
 *   * the table a collection lives in (only `reports` differs from its name);
 *   * which nested arrays are real child tables rather than JSONB columns;
 *   * the handful of fields that are nested value objects in TypeScript but
 *     flat columns in SQL (`referenceRange`).
 *
 * Everything else is converted mechanically in both directions, so adding a
 * scalar field to a domain type and its migration is enough to persist it.
 */

export type CollectionName =
  | "hospitals"
  | "staff"
  | "patients"
  | "medicines"
  | "appointments"
  | "treatments"
  | "administrations"
  | "vitals"
  | "invoices"
  | "reports"
  | "transferProposals"
  | "alerts"
  | "auditLog";

export const COLLECTION_NAMES: CollectionName[] = [
  "hospitals",
  "staff",
  "patients",
  "medicines",
  "appointments",
  "treatments",
  "administrations",
  "vitals",
  "invoices",
  "reports",
  "transferProposals",
  "alerts",
  "auditLog",
];

export interface ChildSpec {
  /** Key on the parent domain object that holds the child rows. */
  key: string;
  table: string;
  /** Column on the child table pointing back at the parent. */
  parentColumn: string;
  /** Column used to restore the authored child order on read. */
  orderBy: string;
  toRow(child: Record<string, unknown>, index: number, parentId: string): Record<string, unknown>;
  fromRow(row: Record<string, unknown>): Record<string, unknown>;
}

export interface CollectionSpec {
  table: string;
  children: ChildSpec[];
  /**
   * Order rows are loaded in. Child tables keep an explicit `ordinal` so the
   * authored display order survives a round trip through the database.
   */
  orderBy: string;
  ascending: boolean;
}

/* ------------------------------------------------------------------ */
/* Key conversion                                                      */
/* ------------------------------------------------------------------ */

export function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

/** Postgres renders timestamptz with an offset; normalise to the ISO-Z form. */
function normalise(value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return value;
}

/**
 * Convert a domain object into a row, dropping undefined values so that column
 * defaults apply and so a partial patch never overwrites a column with null.
 */
export function toColumns(
  value: Record<string, unknown>,
  skip: string[] = [],
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || skip.includes(key)) continue;
    row[camelToSnake(key)] = raw;
  }
  return row;
}

/** Convert a row back into a domain object, camelCasing and tidying values. */
export function fromColumns(row: Record<string, unknown>): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(row)) {
    value[snakeToCamel(key)] = normalise(raw);
  }
  return value;
}

/** Numeric columns arrive as strings over PostgREST; coerce them back. */
function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim().length > 0) return Number(value);
  return 0;
}

function optionalNum(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return num(value);
}

/* ------------------------------------------------------------------ */
/* Child mappers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Build the row projection for a plain child table: every scalar field is
 * converted mechanically, the parent link is stamped on, and an ordinal is
 * recorded when the table has one.
 */
function plainChild(options: {
  parentColumn: string;
  ordinal?: boolean;
}): ChildSpec["toRow"] {
  return (child, index, parentId) => {
    const row = toColumns(child);
    row[options.parentColumn] = parentId;
    if (options.ordinal) row.ordinal = index;
    return row;
  };
}

/**
 * Report fields are the one irregular child: the reference range is an object
 * in the domain model but four columns plus a display string in SQL, so it is
 * flattened on write and rebuilt on read.
 */
const REPORT_FIELD_SPEC: ChildSpec = {
  key: "extractedFields",
  table: "report_fields",
  parentColumn: "report_id",
  orderBy: "ordinal",
  toRow: (field, index, reportId) => {
    const range = (field.referenceRange ?? {}) as Record<string, unknown>;
    const row = toColumns(field, ["referenceRange"]);
    row.report_id = reportId;
    row.ordinal = index;
    row.ref_min = range.min ?? null;
    row.ref_max = range.max ?? null;
    row.ref_text = typeof range.text === "string" ? range.text : "";
    row.ref_critical_low = range.criticalLow ?? null;
    row.ref_critical_high = range.criticalHigh ?? null;
    row.confidence = field.confidence ?? null;
    return row;
  },
  fromRow: (row) => {
    const field = fromColumns(row);
    const criticalLow = optionalNum(row.ref_critical_low);
    const criticalHigh = optionalNum(row.ref_critical_high);
    delete field.ordinal;
    delete field.reportId;
    delete field.refMin;
    delete field.refMax;
    delete field.refText;
    delete field.refCriticalLow;
    delete field.refCriticalHigh;

    field.value = Number.isFinite(Number(row.value)) ? num(row.value) : 0;
    field.confidence = num(row.confidence);
    field.referenceRange = {
      min: num(row.ref_min),
      max: num(row.ref_max),
      text: typeof row.ref_text === "string" ? row.ref_text : "",
      ...(criticalLow === undefined ? {} : { criticalLow }),
      ...(criticalHigh === undefined ? {} : { criticalHigh }),
    };
    return field;
  },
};

/* ------------------------------------------------------------------ */
/* Collection specs                                                    */
/* ------------------------------------------------------------------ */

export const COLLECTIONS: Record<CollectionName, CollectionSpec> = {
  hospitals: { table: "hospitals", children: [], orderBy: "created_at", ascending: false },
  staff: { table: "staff", children: [], orderBy: "employee_id", ascending: true },
  patients: { table: "patients", children: [], orderBy: "registered_at", ascending: false },
  medicines: {
    table: "medicines",
    children: [
      {
        key: "wardStock",
        table: "ward_stock",
        parentColumn: "medicine_id",
        // Ward stock has no ordinal column: the ward name is the natural key
        // and its display order carries no meaning, unlike a prescription's
        // line order. Writing the index the other child tables use was the
        // seed's first failure against the live schema.
        orderBy: "ward",
        toRow: plainChild({ parentColumn: "medicine_id" }),
        fromRow: (row) => {
          const holding = fromColumns(row);
          delete holding.medicineId;
          delete holding.updatedAt;
          holding.quantity = num(row.quantity);
          holding.parLevel = num(row.par_level);
          return holding;
        },
      },
    ],
    orderBy: "sku",
    ascending: true,
  },
  appointments: { table: "appointments", children: [], orderBy: "scheduled_for", ascending: true },
  treatments: {
    table: "treatments",
    children: [
      {
        key: "prescriptions",
        table: "prescriptions",
        parentColumn: "treatment_id",
        orderBy: "ordinal",
        toRow: plainChild({ parentColumn: "treatment_id", ordinal: true }),
        fromRow: (row) => {
          const line = fromColumns(row);
          delete line.treatmentId;
          delete line.ordinal;
          line.quantity = num(row.quantity);
          line.durationDays = num(row.duration_days);
          return line;
        },
      },
    ],
    orderBy: "created_at",
    ascending: false,
  },
  administrations: {
    table: "administrations",
    children: [],
    orderBy: "scheduled_for",
    ascending: true,
  },
  vitals: { table: "vitals", children: [], orderBy: "recorded_at", ascending: false },
  invoices: {
    table: "invoices",
    children: [
      {
        key: "items",
        table: "invoice_items",
        parentColumn: "invoice_id",
        orderBy: "ordinal",
        toRow: plainChild({ parentColumn: "invoice_id", ordinal: true }),
        fromRow: (row) => {
          const item = fromColumns(row);
          delete item.invoiceId;
          delete item.ordinal;
          item.quantity = num(row.quantity);
          item.unitPrice = num(row.unit_price);
          return item;
        },
      },
      {
        key: "transactions",
        table: "payment_transactions",
        parentColumn: "invoice_id",
        orderBy: "processed_at",
        toRow: plainChild({ parentColumn: "invoice_id" }),
        fromRow: (row) => {
          const transaction = fromColumns(row);
          delete transaction.invoiceId;
          transaction.amountPaid = num(row.amount_paid);
          return transaction;
        },
      },
    ],
    orderBy: "created_at",
    ascending: false,
  },
  reports: {
    table: "medical_reports",
    children: [REPORT_FIELD_SPEC],
    orderBy: "report_date",
    ascending: false,
  },
  transferProposals: {
    table: "transfer_proposals",
    children: [],
    orderBy: "decided_at",
    ascending: false,
  },
  alerts: { table: "alerts", children: [], orderBy: "created_at", ascending: false },
  auditLog: { table: "audit_log", children: [], orderBy: "at", ascending: false },
};

/** Numeric columns that must be coerced back from PostgREST's string form. */
const NUMERIC_COLUMNS: Partial<Record<CollectionName, string[]>> = {
  medicines: ["unitPrice", "safetyStockDays"],
  vitals: ["temperatureC"],
  invoices: ["taxPct"],
  reports: ["ocrConfidence"],
  transferProposals: ["estimatedSpsDrop"],
  alerts: ["sps"],
};

/** Parent columns that are always plain integers in Postgres. */
const INTEGER_COLUMNS: Partial<Record<CollectionName, string[]>> = {
  medicines: ["currentStock", "allocatedStock", "reorderThreshold", "economicOrderQuantity"],
  appointments: ["queuePosition"],
};

/** Coerce a hydrated parent object's numeric fields to numbers. */
export function coerceParent(collection: CollectionName, value: Record<string, unknown>): void {
  for (const key of NUMERIC_COLUMNS[collection] ?? []) {
    if (key in value) value[key] = num(value[key]);
  }
  for (const key of INTEGER_COLUMNS[collection] ?? []) {
    if (key in value && value[key] !== null) value[key] = num(value[key]);
  }
}

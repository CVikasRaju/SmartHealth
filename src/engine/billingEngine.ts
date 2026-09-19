/**
 * Revenue cycle engine.
 *
 * Invoice totals are always derived, never stored, so a corrected line item can
 * never leave a stale balance behind. Every monetary value is rounded to paise
 * at the boundary to avoid floating point drift across a multi-line invoice.
 */

import type {
  Invoice,
  InvoiceItem,
  InvoiceTotals,
  PaymentMethod,
  PaymentStatus,
  PaymentTransaction,
} from "@/types";

/** Default GST-style tax applied to the taxable subtotal. */
export const DEFAULT_TAX_PCT = 5;

/** Round to two decimal places (paise). */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function lineSubtotal(item: InvoiceItem): number {
  return roundMoney(item.quantity * item.unitPrice);
}

/** Subtotal, tax, grand total, amount paid and balance for one invoice. */
export function computeInvoiceTotals(invoice: Invoice): InvoiceTotals {
  const subtotal = roundMoney(invoice.items.reduce((sum, item) => sum + lineSubtotal(item), 0));
  const taxAmount = roundMoney((subtotal * invoice.taxPct) / 100);
  const grandTotal = roundMoney(subtotal + taxAmount);
  const amountPaid = roundMoney(invoice.transactions.reduce((sum, txn) => sum + txn.amountPaid, 0));
  const balanceDue = roundMoney(Math.max(0, grandTotal - amountPaid));

  return { subtotal, taxAmount, grandTotal, amountPaid, balanceDue };
}

/**
 * Derive the settlement status from what has actually been collected. A refund
 * is the only status that is asserted rather than derived.
 */
export function derivePaymentStatus(invoice: Invoice): PaymentStatus {
  if (invoice.paymentStatus === "refunded") return "refunded";
  const { grandTotal, amountPaid } = computeInvoiceTotals(invoice);
  if (grandTotal <= 0) return "paid";
  if (amountPaid <= 0) return "unpaid";
  if (amountPaid < grandTotal - 0.01) return "partially_paid";
  return "paid";
}

/** Split a payment across the outstanding balance without over-collecting. */
export function splitPayment(
  invoice: Invoice,
  method: PaymentMethod,
  requestedAmount: number,
  reference: string,
  processedBy: string,
): PaymentTransaction {
  const { balanceDue } = computeInvoiceTotals(invoice);
  const amountPaid = roundMoney(Math.min(Math.max(requestedAmount, 0), balanceDue));

  return {
    id: `txn-${Math.random().toString(36).slice(2, 10)}`,
    paymentMethod: method,
    amountPaid,
    reference: reference.trim() || `REF-${Date.now().toString(36).toUpperCase()}`,
    processedAt: new Date().toISOString(),
    processedBy,
  };
}

export interface MethodBreakdown {
  method: PaymentMethod;
  amount: number;
  count: number;
}

export interface RevenueSummary {
  billed: number;
  collected: number;
  outstanding: number;
  /** Collected since midnight local time. */
  collectedToday: number;
  invoices: number;
  byMethod: MethodBreakdown[];
  byStatus: Record<PaymentStatus, number>;
}

const EMPTY_STATUS: Record<PaymentStatus, number> = {
  unpaid: 0,
  partially_paid: 0,
  paid: 0,
  refunded: 0,
};

/** Aggregate the revenue cycle across every invoice on file. */
export function summariseRevenue(invoices: Invoice[]): RevenueSummary {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const byMethodMap = new Map<PaymentMethod, MethodBreakdown>();
  const byStatus: Record<PaymentStatus, number> = { ...EMPTY_STATUS };

  let billed = 0;
  let collected = 0;
  let collectedToday = 0;

  for (const invoice of invoices) {
    const totals = computeInvoiceTotals(invoice);
    billed = roundMoney(billed + totals.grandTotal);
    collected = roundMoney(collected + totals.amountPaid);
    byStatus[derivePaymentStatus(invoice)] += 1;

    for (const txn of invoice.transactions) {
      const entry = byMethodMap.get(txn.paymentMethod) ?? {
        method: txn.paymentMethod,
        amount: 0,
        count: 0,
      };
      entry.amount = roundMoney(entry.amount + txn.amountPaid);
      entry.count += 1;
      byMethodMap.set(txn.paymentMethod, entry);

      if (new Date(txn.processedAt).getTime() >= today.getTime()) {
        collectedToday = roundMoney(collectedToday + txn.amountPaid);
      }
    }
  }

  return {
    billed,
    collected,
    outstanding: roundMoney(Math.max(0, billed - collected)),
    collectedToday,
    invoices: invoices.length,
    byMethod: Array.from(byMethodMap.values()).sort((a, b) => b.amount - a.amount),
    byStatus,
  };
}

/** Human-readable invoice number from the database counter. */
export function nextInvoiceNumber(sequence: number): string {
  return `INV-${new Date().getFullYear()}-${String(sequence).padStart(4, "0")}`;
}

/** Compact description used on invoice lines created from clinical activity. */
export function describeConsultation(department: string): string {
  return `${department} consultation`;
}

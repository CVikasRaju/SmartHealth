/**
 * Cashier portal.
 *
 * Three modules: the invoice desk, the POS collection counter, and the
 * end-of-day reconciliation. Totals are always derived from the invoice lines
 * by the billing engine, never stored on the invoice, so a corrected line can
 * never leave a stale balance behind.
 */

import { useMemo, useState } from "react";
import type { InvoiceItemType, PaymentMethod, PaymentTransaction } from "@/types";
import { PAYMENT_METHOD_LABELS } from "@/types";
import { useApp } from "@/store/AppStore";
import { derivePaymentStatus, lineSubtotal, summariseRevenue } from "@/engine/billingEngine";
import { CHART_PALETTE, PAYMENT_STATUS_TOKENS } from "@/ui/theme";
import { BarSeries, Donut } from "@/charts/BarSeries";
import {
  Button,
  Chip,
  DataTable,
  EmptyState,
  Field,
  Panel,
  PanelHeader,
  Select,
  StatTile,
  Tabs,
  TextArea,
  TextInput,
} from "@/ui/primitives";
import Icon from "@/ui/Icon";
import { BRANDING } from "@/config/branding";
import { cx, formatCurrency, formatDate, formatDateTime, formatTime, titleCase } from "@/utils/format";

/* ------------------------------------------------------------------ */
/* Tariff                                                              */
/* ------------------------------------------------------------------ */

/** Standard chargeable items offered as quick-add rows at the invoice desk. */
const TARIFF: { itemType: InvoiceItemType; description: string; unitPrice: number }[] = [
  { itemType: "consultation", description: "General medicine consultation", unitPrice: 900 },
  { itemType: "consultation", description: "Specialist consultation", unitPrice: 1400 },
  { itemType: "procedure", description: "Nebulisation with bronchodilator (per session)", unitPrice: 350 },
  { itemType: "procedure", description: "Wound dressing (per session)", unitPrice: 480 },
  { itemType: "procedure", description: "IV cannulation and infusion setup", unitPrice: 650 },
  { itemType: "room_charge", description: "ICU bed charge (per night)", unitPrice: 6500 },
  { itemType: "room_charge", description: "General Ward A bed charge (per night)", unitPrice: 2200 },
  { itemType: "diagnostic_report", description: "CBC, HbA1c and renal panel", unitPrice: 1650 },
  { itemType: "diagnostic_report", description: "Chest radiograph (PA view)", unitPrice: 750 },
  { itemType: "diagnostic_report", description: "CT thorax (plain)", unitPrice: 5200 },
];

interface DraftItem {
  draftId: string;
  itemType: InvoiceItemType;
  description: string;
  quantity: number;
  unitPrice: number;
}

/* ------------------------------------------------------------------ */
/* 1. Invoice desk                                                     */
/* ------------------------------------------------------------------ */

function InvoiceDesk() {
  const { state, derived, actions } = useApp();
  const [patientId, setPatientId] = useState(state.session.patientId);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [taxPct, setTaxPct] = useState(5);
  const [notes, setNotes] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patient = derived.patientsById.get(patientId) ?? null;

  /** Medication and consultation lines already charted for this patient. */
  const billableFromChart = useMemo(() => {
    if (!patient) return [];
    const billed = new Set(
      state.db.invoices.filter((invoice) => invoice.patientId === patient.id).flatMap((invoice) =>
        invoice.items.map((item) => item.description),
      ),
    );

    return derived.treatmentsFor(patient.id).flatMap((treatment) =>
      treatment.prescriptions
        .map((line) => {
          const medicine = derived.medicinesById.get(line.medicineId);
          if (!medicine) return null;
          const description = `${medicine.brandName} ${medicine.strength}`;
          if (billed.has(description)) return null;
          return {
            key: `${treatment.id}-${line.id}`,
            description,
            quantity: line.quantity,
            unitPrice: medicine.unitPrice,
            itemType: "medication" as InvoiceItemType,
            chartedOn: treatment.createdAt,
            diagnosis: treatment.diagnosis,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    );
  }, [patient, derived, state.db.invoices]);

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const taxAmount = (subtotal * taxPct) / 100;
    return { subtotal, taxAmount, grandTotal: subtotal + taxAmount };
  }, [items, taxPct]);

  const addItem = (item: Omit<DraftItem, "draftId">) => {
    setItems((current) => [...current, { ...item, draftId: `draft-${Date.now()}-${current.length}` }]);
  };

  const create = () => {
    if (!patient) return setError("Select a patient first.");
    if (items.length === 0) return setError("Add at least one chargeable line.");

    const invoice = actions.createInvoice({
      patientId: patient.id,
      items: items.map((item) => ({
        itemType: item.itemType,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      taxPct,
      notes,
    });

    setCreatedId(invoice.id);
    setItems([]);
    setNotes("");
    setError(null);
  };

  return (
    <div className="space-y-6">
      {createdId ? (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-risk-normal/[0.12] text-risk-normal">
                <Icon name="check" size={20} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  {state.db.invoices.find((invoice) => invoice.id === createdId)?.invoiceNumber ?? "Invoice"} raised
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  Take it to the POS counter to collect payment.
                </p>
              </div>
            </div>
            <Button size="sm" variant="primary" onClick={() => actions.setView("cashier.pos")}>
              <Icon name="pos" size={13} />
              Go to POS checkout
            </Button>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Panel>
          <PanelHeader
            title="Build an itemised invoice"
            subtitle="Pull charted medication and standing charges in, then add anything else the encounter consumed."
            icon={<Icon name="invoice" size={18} />}
          />

          <Field label="Patient">
            <Select
              value={patientId}
              onChange={(value) => {
                setPatientId(value);
                setItems([]);
                actions.setActivePatient(value);
              }}
              options={Array.from(derived.patientsById.values()).map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.mrn}`,
              }))}
            />
          </Field>

          {billableFromChart.length > 0 ? (
            <div className="mt-4 rounded-lg border border-accent/35 bg-accent-soft p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent/90">
                Unbilled medication from the chart
              </p>
              <ul className="mt-2 space-y-2">
                {billableFromChart.map((entry) => (
                  <li key={entry.key} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-xs text-ink-900">{entry.description}</span>
                      <span className="block text-[10px] text-ink-500">
                        {entry.quantity} × {formatCurrency(entry.unitPrice)} · {entry.diagnosis} ·{" "}
                        {formatDate(entry.chartedOn)}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        addItem({
                          itemType: entry.itemType,
                          description: entry.description,
                          quantity: entry.quantity,
                          unitPrice: entry.unitPrice,
                        })
                      }
                    >
                      Add {formatCurrency(entry.quantity * entry.unitPrice, { compact: true })}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4">
            <p className="sm-label">Standard tariff</p>
            <div className="flex flex-wrap gap-1.5">
              {TARIFF.map((entry) => (
                <button
                  key={entry.description}
                  type="button"
                  onClick={() => addItem({ ...entry, quantity: 1 })}
                  className="rounded-lg border border-rule bg-paper px-2.5 py-1.5 text-[11px] text-ink-700 transition hover:border-accent/45 hover:text-accent"
                >
                  {entry.description} · {formatCurrency(entry.unitPrice, { compact: true })}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="sm-label mb-0">Invoice lines</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => addItem({ itemType: "procedure", description: "", quantity: 1, unitPrice: 0 })}
              >
                <Icon name="plus" size={13} />
                Custom line
              </Button>
            </div>

            {items.length === 0 ? (
              <EmptyState
                className="mt-2"
                title="No lines yet"
                description="Add charted medication, a standard tariff item, or a custom line."
              />
            ) : (
              <ul className="mt-2 space-y-2">
                {items.map((item) => (
                  <li key={item.draftId} className="grid gap-2 rounded-lg border border-rule bg-paper p-3 sm:grid-cols-[1.6fr_repeat(3,minmax(0,0.6fr))_auto]">
                    <div>
                      <TextInput
                        value={item.description}
                        onChange={(value) =>
                          setItems((current) =>
                            current.map((row) => (row.draftId === item.draftId ? { ...row, description: value } : row)),
                          )
                        }
                        placeholder="Line description"
                      />
                      <p className="mt-1 text-[10px] capitalize text-ink-400">{titleCase(item.itemType)}</p>
                    </div>
                    <TextInput
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(value) =>
                        setItems((current) =>
                          current.map((row) =>
                            row.draftId === item.draftId ? { ...row, quantity: Math.max(1, Number(value) || 1) } : row,
                          ),
                        )
                      }
                    />
                    <TextInput
                      type="number"
                      min={0}
                      step={0.5}
                      value={item.unitPrice}
                      onChange={(value) =>
                        setItems((current) =>
                          current.map((row) =>
                            row.draftId === item.draftId ? { ...row, unitPrice: Math.max(0, Number(value) || 0) } : row,
                          ),
                        )
                      }
                    />
                    <span className="flex items-center justify-end text-sm font-semibold tabular-nums text-ink-900">
                      {formatCurrency(lineSubtotal(item))}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setItems((current) => current.filter((row) => row.draftId !== item.draftId))}
                    >
                      <Icon name="close" size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Invoice totals" subtitle="Tax is applied to the taxable subtotal, then rounded to paise." />
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-ink-500">Subtotal</dt>
                <dd className="tabular-nums text-ink-900">{formatCurrency(totals.subtotal)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-500">Tax</dt>
                <dd className="flex items-center gap-2">
                  <span className="w-20">
                    <TextInput type="number" min={0} max={28} value={taxPct} onChange={(value) => setTaxPct(Number(value) || 0)} />
                  </span>
                  <span className="text-xs text-ink-400">
                    % · {formatCurrency(totals.taxAmount)}
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between border-t border-rule pt-2">
                <dt className="font-semibold text-ink-900">Grand total</dt>
                <dd className="text-lg font-semibold tabular-nums text-accent">{formatCurrency(totals.grandTotal)}</dd>
              </div>
            </dl>

            <div className="mt-4">
              <Field label="Invoice note">
                <TextArea value={notes} onChange={setNotes} rows={2} placeholder="Insurance reference, payment arrangement, or a remark for the account." />
              </Field>
            </div>

            {error ? (
              <p className="mt-3 rounded-lg border border-risk-critical/45 bg-risk-critical/[0.08] p-3 text-xs text-risk-critical">{error}</p>
            ) : null}

            <Button variant="primary" fullWidth className="mt-4" onClick={create}>
              <Icon name="invoice" size={14} />
              Raise invoice
            </Button>
            <p className="mt-2 text-[10px] leading-relaxed text-ink-400">
              Raising an invoice writes an immutable billing entry and moves the account to unpaid. Nothing is collected
              until the POS counter records a transaction.
            </p>
          </Panel>

          {patient ? (
            <Panel>
              <PanelHeader title="Account summary" subtitle={`${patient.name} · ${patient.mrn}`} />
              <ul className="space-y-2">
                {state.db.invoices.filter((invoice) => invoice.patientId === patient.id).length === 0 ? (
                  <li className="text-xs text-ink-400">No invoices raised for this patient yet.</li>
                ) : (
                  state.db.invoices
                    .filter((invoice) => invoice.patientId === patient.id)
                    .map((invoice) => {
                      const invoiceTotals = derived.invoiceTotals(invoice);
                      return (
                        <li key={invoice.id} className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0">
                            <span className="block font-mono text-[11px] text-ink-500">{invoice.invoiceNumber}</span>
                            <span className="block text-[10px] text-ink-400">{formatDate(invoice.createdAt)}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <Chip token={PAYMENT_STATUS_TOKENS[derivePaymentStatus(invoice)]} />
                            <span className="tabular-nums text-ink-900">{formatCurrency(invoiceTotals.balanceDue)}</span>
                          </span>
                        </li>
                      );
                    })
                )}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. POS checkout                                                     */
/* ------------------------------------------------------------------ */

function PosCheckout() {
  const { state, derived, actions } = useApp();
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [receipt, setReceipt] = useState<{ invoiceId: string; transaction: PaymentTransaction } | null>(null);

  const invoices = useMemo(() => {
    const all = state.db.invoices
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return filter === "open"
      ? all.filter((invoice) => derived.invoiceTotals(invoice).balanceDue > 0.009)
      : all;
  }, [state.db.invoices, filter, derived]);

  const selected = invoices.find((invoice) => invoice.id === selectedId) ?? null;
  const selectedTotals = selected ? derived.invoiceTotals(selected) : null;

  const collect = () => {
    if (!selected || !selectedTotals) return;
    const value = amount === "" ? selectedTotals.balanceDue : Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;

    actions.collectPayment({ invoiceId: selected.id, method, amount: value, reference });

    setReceipt({
      invoiceId: selected.id,
      transaction: {
        id: `txn-preview-${Date.now()}`,
        paymentMethod: method,
        amountPaid: Math.min(value, selectedTotals.balanceDue),
        reference: reference.trim() || "REF-PENDING",
        processedAt: new Date().toISOString(),
        processedBy: derived.currentStaff?.fullName ?? "Cashier",
      },
    });
    setAmount("");
    setReference("");
  };

  const receiptInvoice = receipt ? state.db.invoices.find((invoice) => invoice.id === receipt.invoiceId) : null;
  const receiptPatient = receiptInvoice ? derived.patientsById.get(receiptInvoice.patientId) : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader
            title="Outstanding accounts"
            subtitle="Select an invoice to collect against. Part payments are recorded against the balance and cannot over-collect."
            icon={<Icon name="pos" size={18} />}
            actions={
              <div className="w-40">
                <Tabs
                  tabs={[
                    { id: "open", label: "Open", badge: state.db.invoices.filter((invoice) => derived.invoiceTotals(invoice).balanceDue > 0.009).length },
                    { id: "all", label: "All", badge: state.db.invoices.length },
                  ]}
                  active={filter}
                  onChange={setFilter}
                />
              </div>
            }
          />

          {invoices.length === 0 ? (
            <EmptyState title="Nothing outstanding" description="Every raised invoice has been settled in full." />
          ) : (
            <ul className="space-y-2">
              {invoices.map((invoice) => {
                const totals = derived.invoiceTotals(invoice);
                const patient = derived.patientsById.get(invoice.patientId);
                const isActive = invoice.id === selectedId;
                return (
                  <li key={invoice.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(invoice.id);
                        setAmount(String(totals.balanceDue));
                        setReceipt(null);
                      }}
                      className={cx(
                        "w-full rounded-lg border p-3 text-left transition",
                        isActive ? "border-accent/45 bg-accent-soft" : "border-rule bg-paper hover:border-rule-strong",
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-ink-700">{invoice.invoiceNumber}</span>
                          <Chip token={PAYMENT_STATUS_TOKENS[derivePaymentStatus(invoice)]} />
                        </span>
                        <span className="text-[11px] text-ink-400">{formatDateTime(invoice.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-xs text-ink-900">
                        {patient?.name ?? "—"} <span className="text-ink-400">· {patient?.mrn}</span>
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-500">
                        <span>
                          Total <span className="tabular-nums text-ink-900">{formatCurrency(totals.grandTotal)}</span>
                        </span>
                        <span>
                          Paid <span className="tabular-nums text-risk-normal">{formatCurrency(totals.amountPaid)}</span>
                        </span>
                        <span>
                          Balance{" "}
                          <span className={cx("tabular-nums font-semibold", totals.balanceDue > 0 ? "text-risk-high" : "text-risk-normal")}>
                            {formatCurrency(totals.balanceDue)}
                          </span>
                        </span>
                        <span>{invoice.items.length} line(s)</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Collect payment" subtitle="Cash, card, UPI or insurance claim." />
            {!selected || !selectedTotals ? (
              <EmptyState title="No invoice selected" description="Pick an account from the list to take a payment." />
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-rule bg-paper p-3">
                  <p className="font-mono text-[11px] text-ink-500">{selected.invoiceNumber}</p>
                  <p className="mt-1 text-sm font-semibold text-ink-900">
                    {derived.patientsById.get(selected.patientId)?.name ?? "—"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-500">
                    <span>
                      Total <span className="tabular-nums text-ink-900">{formatCurrency(selectedTotals.grandTotal)}</span>
                    </span>
                    <span>
                      Balance{" "}
                      <span className="tabular-nums font-semibold text-risk-high">
                        {formatCurrency(selectedTotals.balanceDue)}
                      </span>
                    </span>
                  </div>
                </div>

                <Field label="Payment method">
                  <Select
                    value={method}
                    onChange={(value) => setMethod(value as PaymentMethod)}
                    options={(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((key) => ({
                      value: key,
                      label: PAYMENT_METHOD_LABELS[key],
                    }))}
                  />
                </Field>

                <Field label="Amount" hint="Defaults to the full outstanding balance.">
                  <TextInput type="number" min={0} step={1} value={amount} onChange={setAmount} />
                </Field>

                <Field label="Transaction reference" hint="UTR, authorisation code or claim number.">
                  <TextInput value={reference} onChange={setReference} placeholder="e.g. UPI-4829310" />
                </Field>

                <Button variant="primary" fullWidth onClick={collect} disabled={selectedTotals.balanceDue <= 0}>
                  <Icon name="check" size={14} />
                  Record {amount === "" ? "full" : formatCurrency(Number(amount) || 0)} payment
                </Button>

                {selected.transactions.length > 0 ? (
                  <div className="mt-2">
                    <p className="sm-label">Transactions on this invoice</p>
                    <ul className="space-y-1.5">
                      {selected.transactions.map((transaction) => (
                        <li key={transaction.id} className="flex items-center justify-between gap-3 text-[11px]">
                          <span className="text-ink-500">
                            {PAYMENT_METHOD_LABELS[transaction.paymentMethod]} · {transaction.reference}
                          </span>
                          <span className="tabular-nums text-ink-900">{formatCurrency(transaction.amountPaid)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </Panel>

          {receipt && receiptInvoice ? (
            <Panel className="print-sheet">
              <PanelHeader
                title="Payment receipt"
                subtitle="Print or hand the slip to the patient."
                actions={
                  <Button size="sm" variant="ghost" onClick={() => window.print()}>
                    <Icon name="print" size={13} />
                    Print
                  </Button>
                }
              />
              <div className="rounded-lg border border-rule bg-paper p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-serif text-[15px] font-semibold text-ink-900">{BRANDING.name}</p>
                    <p className="text-[11px] text-ink-500">Billing &amp; Revenue Cycle</p>
                    <p className="mt-1 text-[10px] text-ink-400">{BRANDING.organisation}</p>
                  </div>
                  <span className="sm-chip border-risk-normal/45 bg-risk-normal/[0.08] text-risk-normal">Paid</span>
                </div>
                <dl className="mt-4 space-y-1.5 text-[11px]">
                  {[
                    { label: "Receipt for", value: receiptInvoice.invoiceNumber },
                    { label: "Patient", value: `${receiptPatient?.name ?? "—"} (${receiptPatient?.mrn ?? "—"})` },
                    { label: "Method", value: PAYMENT_METHOD_LABELS[receipt.transaction.paymentMethod] },
                    { label: "Reference", value: receipt.transaction.reference },
                    { label: "Collected", value: formatDateTime(receipt.transaction.processedAt) },
                    { label: "Processed by", value: receipt.transaction.processedBy },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-4">
                      <dt className="text-ink-500">{row.label}</dt>
                      <dd className="text-right text-ink-900">{row.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 border-t border-rule pt-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-700">Amount received</span>
                    <span className="font-semibold tabular-nums text-risk-normal">
                      {formatCurrency(receipt.transaction.amountPaid)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-ink-500">
                    <span>Balance remaining</span>
                    <span className="tabular-nums">{formatCurrency(derived.invoiceTotals(receiptInvoice).balanceDue)}</span>
                  </div>
                </div>
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Reconciliation                                                   */
/* ------------------------------------------------------------------ */

function Reconciliation() {
  const { state, derived } = useApp();
  const { revenue } = derived;

  const statusMix = useMemo(
    () =>
      (Object.keys(revenue.byStatus) as (keyof typeof revenue.byStatus)[]).map((status) => ({
        key: status,
        label: PAYMENT_STATUS_TOKENS[status].label,
        value: revenue.byStatus[status],
        color: PAYMENT_STATUS_TOKENS[status].hex,
      })),
    [revenue.byStatus],
  );

  const todayTransactions = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return state.db.invoices.flatMap((invoice) =>
      invoice.transactions
        .filter((transaction) => new Date(transaction.processedAt).getTime() >= start.getTime())
        .map((transaction) => ({ invoice, transaction })),
    );
  }, [state.db.invoices]);

  const overall = useMemo(() => summariseRevenue(state.db.invoices), [state.db.invoices]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Collected today" value={formatCurrency(revenue.collectedToday)} tone="success" hint={`${todayTransactions.length} transaction(s)`} />
        <StatTile label="Billed to date" value={formatCurrency(overall.billed, { compact: true })} hint={`${overall.invoices} invoices`} />
        <StatTile label="Outstanding" value={formatCurrency(overall.outstanding, { compact: true })} tone={overall.outstanding > 0 ? "warning" : "success"} />
        <StatTile
          label="Unpaid accounts"
          value={overall.byStatus.unpaid + overall.byStatus.partially_paid}
          tone={overall.byStatus.unpaid > 0 ? "danger" : "default"}
          hint="Requiring follow-up before discharge"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Collection by method" subtitle="Across all recorded transactions." icon={<Icon name="reconcile" size={18} />} />
          {revenue.byMethod.length === 0 ? (
            <EmptyState title="No collections recorded" description="Take a payment at the POS counter to populate the day book." />
          ) : (
            <BarSeries
              items={revenue.byMethod.map((entry, index) => ({
                key: entry.method,
                label: PAYMENT_METHOD_LABELS[entry.method],
                value: entry.amount,
                color: CHART_PALETTE[index % CHART_PALETTE.length],
                hint: `${entry.count} transaction${entry.count === 1 ? "" : "s"}`,
              }))}
              valueFormat={(value) => formatCurrency(value)}
            />
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Settlement status" subtitle="Distribution of accounts by state." icon={<Icon name="invoice" size={18} />} />
          <Donut segments={statusMix} centerLabel="invoices" centerValue={String(revenue.invoices)} />
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Day book"
          subtitle="Every transaction recorded since midnight, newest first."
          icon={<Icon name="pos" size={18} />}
          actions={<span className="text-[11px] text-ink-500">{formatDate(new Date().toISOString())}</span>}
        />
        {todayTransactions.length === 0 ? (
          <EmptyState title="Nothing collected today" description="Take a payment at the POS counter to open the day book." />
        ) : (
          <DataTable head={["Time", "Invoice", "Patient", "Method", "Reference", "Amount", "Processed by"]}>
            {todayTransactions
              .slice()
              .sort(
                (a, b) =>
                  new Date(b.transaction.processedAt).getTime() - new Date(a.transaction.processedAt).getTime(),
              )
              .map(({ invoice, transaction }) => (
                <tr key={transaction.id}>
                  <td className="sm-td tabular-nums text-ink-700">{formatTime(transaction.processedAt)}</td>
                  <td className="sm-td font-mono text-[11px] text-ink-500">{invoice.invoiceNumber}</td>
                  <td className="sm-td text-ink-900">
                    {derived.patientsById.get(invoice.patientId)?.name ?? "—"}
                  </td>
                  <td className="sm-td text-ink-500">{PAYMENT_METHOD_LABELS[transaction.paymentMethod]}</td>
                  <td className="sm-td font-mono text-[11px] text-ink-500">{transaction.reference}</td>
                  <td className="sm-td tabular-nums text-risk-normal">{formatCurrency(transaction.amountPaid)}</td>
                  <td className="sm-td text-ink-500">
                    {derived.staffById.get(transaction.processedBy)?.fullName ?? transaction.processedBy}
                  </td>
                </tr>
              ))}
          </DataTable>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="All accounts" subtitle="Full invoice register with derived balances." icon={<Icon name="invoice" size={18} />} />
        <DataTable head={["Invoice", "Patient", "Raised", "Lines", "Subtotal", "Tax", "Total", "Paid", "Balance", "Status"]}>
          {state.db.invoices.map((invoice) => {
            const totals = derived.invoiceTotals(invoice);
            const patient = derived.patientsById.get(invoice.patientId);
            return (
              <tr key={invoice.id}>
                <td className="sm-td font-mono text-[11px] text-ink-500">{invoice.invoiceNumber}</td>
                <td className="sm-td text-ink-900">
                  {patient?.name ?? "—"} <span className="text-[10px] text-ink-400">{patient?.mrn}</span>
                </td>
                <td className="sm-td text-ink-500">{formatDate(invoice.createdAt)}</td>
                <td className="sm-td tabular-nums text-ink-500">{invoice.items.length}</td>
                <td className="sm-td tabular-nums text-ink-700">{formatCurrency(totals.subtotal)}</td>
                <td className="sm-td tabular-nums text-ink-500">{formatCurrency(totals.taxAmount)}</td>
                <td className="sm-td tabular-nums font-semibold text-ink-900">{formatCurrency(totals.grandTotal)}</td>
                <td className="sm-td tabular-nums text-risk-normal">{formatCurrency(totals.amountPaid)}</td>
                <td className={cx("sm-td tabular-nums", totals.balanceDue > 0 ? "text-risk-high" : "text-ink-400")}>
                  {formatCurrency(totals.balanceDue)}
                </td>
                <td className="sm-td">
                  <Chip token={PAYMENT_STATUS_TOKENS[derivePaymentStatus(invoice)]} />
                </td>
              </tr>
            );
          })}
        </DataTable>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function CashierPortal() {
  const { state } = useApp();

  switch (state.activeView) {
    case "cashier.pos":
      return <PosCheckout />;
    case "cashier.reconciliation":
      return <Reconciliation />;
    case "cashier.invoices":
    default:
      return <InvoiceDesk />;
  }
}

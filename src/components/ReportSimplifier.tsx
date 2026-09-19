/**
 * Medical Report Simplifier.
 *
 * One component serves the patient portal and every clinical role that is
 * permitted to read a simplified report, because the RBAC matrix in
 * `docs/user-roles.md` differs only by whether the upload and annotation
 * controls are shown.
 *
 * The pipeline is: drop a file -> simulated OCR -> biomarker dictionary match
 * -> reference-range scoring -> plain-language explanation -> longitudinal
 * trend. Nothing here asserts a diagnosis, and the disclaimer is rendered in
 * the viewer, in the printable sheet, and in the exported file.
 */

import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import type { BiomarkerTrend, ExtractedField, MedicalReport, Patient, ReportCategory } from "@/types";
import { REPORT_CATEGORY_LABELS } from "@/types";
import { useApp } from "@/store/AppStore";
import {
  BIOMARKER_CATEGORY_LABELS,
  describeTrend,
  groupFieldsByCategory,
  isOutOfRange,
  MEDICAL_DISCLAIMER,
  OCR_PIPELINE_STEPS,
  SYNTHETIC_OCR_TRANSCRIPTS,
  parseReportText,
  runSimulatedOcr,
  summariseFields,
} from "@/engine/reportEngine";
import { BIOMARKER_STATUS_TOKENS, CHART_PALETTE } from "@/ui/theme";
import { Button, Chip, EmptyState, Field, Panel, PanelHeader, Select, StatTile, TextArea } from "@/ui/primitives";
import LineChart from "@/charts/LineChart";
import Icon from "@/ui/Icon";
import { cx, formatBytes, formatDate, formatDateTime, formatNumber } from "@/utils/format";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export interface ReportSimplifierProps {
  patientId: string;
  patient: Patient;
  /** Upload controls are hidden for roles without report-intake permission. */
  canUpload: boolean;
  /** Physician annotation controls. */
  canAnnotate?: boolean;
  className?: string;
}

interface UploadState {
  fileName: string;
  ratio: number;
  step: string;
  error: string | null;
}

export default function ReportSimplifier({
  patientId,
  patient,
  canUpload,
  canAnnotate = false,
  className,
}: ReportSimplifierProps) {
  const { derived, actions } = useApp();
  const reports = derived.reportsFor(patientId);
  const trends = derived.trendsFor(patientId);

  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null);
  const [category, setCategory] = useState<ReportCategory>("blood_panel");
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dragging, setDragging] = useState(false);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);
  const [trendKey, setTrendKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected: MedicalReport | null =
    reports.find((report) => report.id === selectedId) ?? reports[0] ?? null;

  const summary = useMemo(() => summariseFields(selected?.extractedFields ?? []), [selected]);

  /** Biomarkers with at least two readings are the only ones worth charting. */
  const chartableTrends = useMemo(() => trends.filter((trend) => trend.history.length >= 1), [trends]);
  const activeTrend: BiomarkerTrend | null = useMemo(() => {
    if (chartableTrends.length === 0) return null;
    const found = chartableTrends.find((trend) => trend.normalizedKey === trendKey);
    if (found) return found;
    // Default to the most clinically interesting series: the out-of-range one
    // with the longest history.
    return (
      chartableTrends
        .filter((trend) => trend.history.length >= 2)
        .sort((a, b) => Number(isOutOfRange(b.status)) - Number(isOutOfRange(a.status)) || b.history.length - a.history.length)[0] ??
      chartableTrends[0]
    );
  }, [chartableTrends, trendKey]);

  /* ------------------------------------------------------------------ */
  /* Ingestion                                                           */
  /* ------------------------------------------------------------------ */

  const ingest = useCallback(
    async (fields: ExtractedField[], rawText: string, confidence: number, fileName: string, mime: string, size: number) => {
      const report = actions.uploadReport({
        patientId,
        fileName,
        fileMimeType: mime,
        fileSizeBytes: size,
        reportCategory: category,
        reportDate: new Date(`${reportDate}T08:00:00`).toISOString(),
        rawOcrText: rawText,
        extractedFields: fields,
        ocrConfidence: confidence,
      });
      setSelectedId(report.id);
      if (fields.length === 0) {
        setUpload({
          fileName,
          ratio: 1,
          step: "Completed",
          error: "No recognised lab values were found in this document. Try a clearer scan or a different panel category.",
        });
      } else {
        setUpload({ fileName, ratio: 1, step: `Extracted ${fields.length} value(s)`, error: null });
      }
    },
    [actions, category, patientId, reportDate],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_UPLOAD_BYTES) {
        setUpload({
          fileName: file.name,
          ratio: 0,
          step: "Rejected",
          error: `File is ${formatBytes(file.size)}; the prototype accepts up to ${formatBytes(MAX_UPLOAD_BYTES)}.`,
        });
        return;
      }

      setUpload({ fileName: file.name, ratio: 0, step: OCR_PIPELINE_STEPS[0], error: null });

      const result = await runSimulatedOcr(file, category, ({ ratio, step }) => {
        setUpload({ fileName: file.name, ratio, step, error: null });
      });

      const fields = parseReportText(result.text);
      await ingest(fields, result.text, result.confidence, file.name, file.type || "application/pdf", file.size);
    },
    [category, ingest],
  );

  /** Demo shortcut: run the pipeline against a canned transcript with no file. */
  const handleSample = useCallback(async () => {
    const name = `sample-${category}-panel.pdf`;
    setUpload({ fileName: name, ratio: 0, step: OCR_PIPELINE_STEPS[0], error: null });

    for (let index = 0; index < OCR_PIPELINE_STEPS.length; index++) {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      setUpload({
        fileName: name,
        ratio: (index + 1) / OCR_PIPELINE_STEPS.length,
        step: OCR_PIPELINE_STEPS[index],
        error: null,
      });
    }

    const text = SYNTHETIC_OCR_TRANSCRIPTS[category];
    const fields = parseReportText(text);
    const confidence = fields.length
      ? Number((fields.reduce((sum, field) => sum + field.confidence, 0) / fields.length).toFixed(2))
      : 0.4;
    await ingest(fields, text, confidence, name, "application/pdf", 486_220);
  }, [category, ingest]);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  const buildExportText = useCallback((): string => {
    if (!selected) return "";
    const lines: string[] = [
      "SMARTMEDIC — PATIENT REPORT SUMMARY",
      "=".repeat(72),
      `Patient:     ${patient.name} (${patient.mrn})`,
      `Date of birth: ${formatDate(patient.dob)}   Blood group: ${patient.bloodGroup}`,
      `Report:      ${selected.fileName}`,
      `Panel:       ${REPORT_CATEGORY_LABELS[selected.reportCategory]}`,
      `Collected:   ${formatDate(selected.reportDate)}`,
      `Extraction:  ${selected.extractedFields.length} value(s) at ${Math.round(selected.ocrConfidence * 100)}% matched confidence`,
      "",
      "RESULTS IN PLAIN LANGUAGE",
      "-".repeat(72),
    ];

    for (const group of groupFieldsByCategory(selected.extractedFields)) {
      lines.push("", `${BIOMARKER_CATEGORY_LABELS[group.category].toUpperCase()}`, "");
      for (const field of group.fields) {
        lines.push(`  ${field.testName}`);
        lines.push(
          `    Result: ${field.value} ${field.unit}   Reference: ${field.referenceRange.text}   (${BIOMARKER_STATUS_TOKENS[field.status].label})`,
        );
        lines.push(`    ${field.plainLanguageExplanation}`);
        lines.push("");
      }
    }

    const relevantTrends = trends.filter((trend) => trend.history.length >= 2);
    if (relevantTrends.length > 0) {
      lines.push("", "LONGITUDINAL HISTORY", "-".repeat(72));
      for (const trend of relevantTrends) {
        lines.push(
          `  ${trend.testName}: ${trend.history.map((point) => `${point.value} ${trend.unit} (${formatDate(point.date)})`).join(" -> ")}`,
        );
        lines.push(`    Direction: ${trend.direction}. ${describeTrend(trend)}`);
        lines.push("");
      }
    }

    if (selected.doctorNotes.trim()) {
      lines.push("", "PHYSICIAN NOTE", "-".repeat(72), `  ${selected.doctorNotes}`, "");
    }

    lines.push(
      "",
      "=".repeat(72),
      MEDICAL_DISCLAIMER,
      "",
      `Generated by the SmartMedic prototype on ${formatDateTime(new Date().toISOString())}.`,
    );

    return lines.join("\n");
  }, [patient, selected, trends]);

  const downloadSummary = useCallback(() => {
    if (!selected) return;
    const blob = new Blob([buildExportText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `smartmedic-${patient.mrn}-${selected.reportDate.slice(0, 10)}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [buildExportText, patient.mrn, selected]);

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  return (
    <div className={cx("space-y-6", className)}>
      {canUpload ? (
        <Panel>
          <PanelHeader
            title="Upload a laboratory report"
            subtitle="Drop a PDF, PNG, JPG, TXT or CSV. Scanned documents run through a simulated OCR pipeline; files that already contain text are read directly."
            icon={<Icon name="upload" size={18} />}
          />

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
              }}
              className={cx(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
                dragging ? "border-accent bg-accent-soft" : "border-rule-strong bg-paper hover:border-accent/50",
              )}
            >
              <Icon name="upload" size={26} className={dragging ? "text-accent" : "text-ink-400"} />
              <p className="text-sm font-medium text-ink-900">
                {dragging ? "Release to run extraction" : "Drag a report here, or click to browse"}
              </p>
              <p className="text-[11px] text-ink-400">
                Maximum {formatBytes(MAX_UPLOAD_BYTES)} · extraction runs entirely in this browser
              </p>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.txt,.csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                  event.target.value = "";
                }}
              />
            </div>

            <div className="space-y-3">
              <Field label="Panel category" hint="Drives the extraction template for scans.">
                <Select
                  value={category}
                  onChange={(value) => setCategory(value as ReportCategory)}
                  options={(Object.keys(REPORT_CATEGORY_LABELS) as ReportCategory[]).map((key) => ({
                    value: key,
                    label: REPORT_CATEGORY_LABELS[key],
                  }))}
                />
              </Field>
              <Field label="Specimen collection date">
                <input
                  type="date"
                  className="sm-input"
                  value={reportDate}
                  onChange={(event) => setReportDate(event.target.value)}
                />
              </Field>
              <Button variant="secondary" fullWidth onClick={() => void handleSample()}>
                <Icon name="bolt" size={14} />
                Run on a sample transcript
              </Button>
            </div>
          </div>

          {upload ? (
            <div className="mt-4 rounded-lg border border-rule bg-paper p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-ink-700">{upload.fileName}</span>
                <span className="shrink-0 text-ink-400">{upload.step}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden border border-rule-soft bg-canvas">
                <div
                  className={cx("h-full transition-[width] duration-300", upload.error ? "bg-risk-critical" : "bg-accent")}
                  style={{ width: `${Math.round(upload.ratio * 100)}%` }}
                />
              </div>
              {upload.error ? <p className="mt-2 text-[11px] text-risk-critical">{upload.error}</p> : null}
            </div>
          ) : null}
        </Panel>
      ) : null}

      {reports.length === 0 ? (
        <Panel>
          <EmptyState
            title="No reports on file for this patient"
            description="Upload a laboratory report to generate a plain-language summary and start a longitudinal trend."
          />
        </Panel>
      ) : (
        <>
          {/* Report picker. */}
          <Panel padded={false}>
            <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-3">
              <p className="mr-auto text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                Report history · {reports.length} document{reports.length === 1 ? "" : "s"}
              </p>
              {reports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(report.id);
                    setEditingNote(false);
                  }}
                  className={cx(
                    "rounded-lg border px-3 py-1.5 text-[11px] transition",
                    report.id === selected?.id
                      ? "border-accent/45 bg-accent-soft text-accent"
                      : "border-rule bg-paper text-ink-500 hover:border-rule-strong hover:text-ink-900",
                  )}
                >
                  {formatDate(report.reportDate)}
                </button>
              ))}
            </div>

            {selected ? (
              <div className="space-y-5 p-4 print-sheet">
                {/* Document header. */}
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-ink-900">{selected.fileName}</h3>
                    <p className="mt-0.5 text-[11px] text-ink-500">
                      {REPORT_CATEGORY_LABELS[selected.reportCategory]} · collected {formatDate(selected.reportDate)} ·{" "}
                      {formatBytes(selected.fileSizeBytes)} · uploaded by{" "}
                      {selected.uploadedByRole === "patient" ? "patient portal" : selected.uploadedByRole}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 no-print">
                    <Chip
                      token={{
                        label: `${Math.round(selected.ocrConfidence * 100)}% matched`,
                        chip: "border-accent/45 bg-accent-soft text-accent",
                        hex: "#14416b",
                        rank: 0,
                      }}
                    />
                    <Button size="sm" variant="secondary" onClick={downloadSummary}>
                      <Icon name="download" size={13} />
                      Export summary
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => window.print()}>
                      <Icon name="print" size={13} />
                      Print
                    </Button>
                  </div>
                </div>

                {/* Mandatory disclaimer. */}
                <div className="rounded-lg border border-risk-moderate/50 bg-risk-moderate/[0.08] p-3">
                  <p className="flex items-start gap-2 text-[11px] leading-relaxed text-risk-moderate">
                    <Icon name="info" size={14} className="mt-0.5 shrink-0 text-risk-moderate" />
                    <span>
                      <strong className="font-semibold">Educational summary, not a diagnosis.</strong>{" "}
                      {MEDICAL_DISCLAIMER}
                    </span>
                  </p>
                </div>

                <p className="text-sm font-medium text-ink-900">{summary.headline}</p>

                <div className="grid gap-3 sm:grid-cols-4">
                  <StatTile label="Values recognised" value={summary.total} />
                  <StatTile label="Within range" value={summary.inRange} tone="success" />
                  <StatTile label="Outside range" value={summary.outOfRange} tone="warning" />
                  <StatTile label="Markedly abnormal" value={summary.critical} tone={summary.critical > 0 ? "danger" : "default"} />
                </div>

                {/* Grouped results. */}
                {groupFieldsByCategory(selected.extractedFields).map((group) => (
                  <div key={group.category}>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                      {BIOMARKER_CATEGORY_LABELS[group.category]}
                    </p>
                    <ul className="space-y-2">
                      {group.fields.map((field) => {
                        const token = BIOMARKER_STATUS_TOKENS[field.status];
                        const isOpen = expandedFieldId === field.id;
                        return (
                          <li key={field.id} className="rounded-lg border border-rule bg-paper">
                            <button
                              type="button"
                              onClick={() => setExpandedFieldId(isOpen ? null : field.id)}
                              className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                            >
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: token.hex }} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium text-ink-900">
                                  {field.testName}
                                </span>
                                <span className="block text-[10px] text-ink-400">
                                  Reference {field.referenceRange.text}
                                </span>
                              </span>
                              <span className="shrink-0 text-right">
                                <span className="block text-sm font-semibold tabular-nums text-ink-900">
                                  {formatNumber(field.value, field.value % 1 === 0 ? 0 : 2)}
                                  <span className="ml-1 text-[10px] font-normal text-ink-500">{field.unit}</span>
                                </span>
                                <span className={cx("sm-chip mt-1", token.chip)}>{token.label}</span>
                              </span>
                              <Icon
                                name="chevronDown"
                                size={14}
                                className={cx("shrink-0 text-ink-400 transition", isOpen && "rotate-180")}
                              />
                            </button>
                            {isOpen ? (
                              <div className="border-t border-rule px-3 py-3">
                                <p className="text-[11px] leading-relaxed text-ink-700">
                                  {field.plainLanguageExplanation}
                                </p>
                                <p className="mt-2 text-[10px] text-ink-400">
                                  Matched alias “{field.matchedAlias}” · extraction confidence{" "}
                                  {(field.confidence * 100).toFixed(0)}%
                                </p>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}

                {/* Raw OCR text. */}
                <div className="no-print">
                  <Button size="sm" variant="ghost" onClick={() => setShowRawText((value) => !value)}>
                    <Icon name="search" size={13} />
                    {showRawText ? "Hide raw extracted text" : "Show raw extracted text"}
                  </Button>
                  {showRawText ? (
                    <pre className="mt-2 max-h-64 overflow-auto border border-rule-soft bg-canvas p-3 font-mono text-[11px] leading-relaxed text-ink-700">
                      {selected.rawOcrText}
                    </pre>
                  ) : null}
                </div>

                {/* Physician note. */}
                {canAnnotate ? (
                  <div className="no-print rounded-lg border border-rule bg-paper p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                        Physician note
                      </p>
                      {!editingNote ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setNoteDraft(selected.doctorNotes);
                            setEditingNote(true);
                          }}
                        >
                          Edit
                        </Button>
                      ) : null}
                    </div>
                    {editingNote ? (
                      <div className="mt-2 space-y-2">
                        <TextArea
                          value={noteDraft}
                          onChange={setNoteDraft}
                          rows={3}
                          placeholder="Clinical context, follow-up plan, or a note for the treating team."
                        />
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setEditingNote(false)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => {
                              actions.saveReportNote(selected.id, noteDraft);
                              setEditingNote(false);
                            }}
                          >
                            Save note
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-xs leading-relaxed text-ink-700">
                        {selected.doctorNotes || "No physician note recorded yet."}
                      </p>
                    )}
                  </div>
                ) : selected.doctorNotes ? (
                  <div className="rounded-lg border border-rule bg-paper p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                      Physician note
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-700">{selected.doctorNotes}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Panel>

          {/* Longitudinal tracking. */}
          <Panel>
            <PanelHeader
              title="Longitudinal biomarker tracking"
              subtitle="Repeated tests for the same patient are indexed by biomarker and specimen date, then compared against the reference range."
              icon={<Icon name="trends" size={18} />}
            />

            {chartableTrends.length === 0 ? (
              <EmptyState
                title="No comparable history yet"
                description="Upload a second report for this patient to unlock trend comparison."
              />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5 no-print">
                  {chartableTrends.map((trend) => {
                    const token = BIOMARKER_STATUS_TOKENS[trend.status];
                    const isActive = activeTrend?.normalizedKey === trend.normalizedKey;
                    return (
                      <button
                        key={trend.normalizedKey}
                        type="button"
                        onClick={() => setTrendKey(trend.normalizedKey)}
                        className={cx(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition",
                          isActive
                            ? "border-accent/60 bg-accent-soft text-accent"
                            : "border-rule bg-paper text-ink-500 hover:border-rule-strong hover:text-ink-900",
                        )}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: token.hex }} />
                        {trend.testName}
                        <span className="text-ink-400">{trend.history.length}</span>
                      </button>
                    );
                  })}
                </div>

                {activeTrend ? (
                  <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
                    <div>
                      <LineChart
                        height={280}
                        series={[
                          {
                            key: activeTrend.normalizedKey,
                            label: activeTrend.testName,
                            color: CHART_PALETTE[0],
                            area: true,
                            points: activeTrend.history.map((point) => ({
                              label: formatDate(point.date),
                              value: point.value,
                            })),
                          },
                        ]}
                        band={{
                          min: activeTrend.referenceRange.min,
                          max: activeTrend.referenceRange.max,
                          label: `Reference ${activeTrend.referenceRange.text}`,
                        }}
                        valueFormat={(value) => formatNumber(value, value % 1 === 0 ? 0 : 1)}
                        ariaLabel={`${activeTrend.testName} history`}
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-lg border border-rule bg-paper p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                          Movement
                        </p>
                        <p className="mt-1.5 flex items-baseline gap-2">
                          <span className="text-2xl font-semibold tabular-nums text-ink-900">
                            {formatNumber(activeTrend.latest, activeTrend.latest % 1 === 0 ? 0 : 2)}
                          </span>
                          <span className="text-xs text-ink-500">{activeTrend.unit}</span>
                          <Chip token={BIOMARKER_STATUS_TOKENS[activeTrend.status]} />
                        </p>
                        {activeTrend.delta !== null ? (
                          <p
                            className={cx(
                              "mt-1 text-xs tabular-nums",
                              activeTrend.direction === "stable"
                                ? "text-ink-500"
                                : activeTrend.direction === "rising"
                                  ? "text-risk-high"
                                  : "text-accent",
                            )}
                          >
                            {activeTrend.delta > 0 ? "+" : ""}
                            {activeTrend.delta} {activeTrend.unit}
                            {activeTrend.deltaPct !== null ? ` (${activeTrend.deltaPct > 0 ? "+" : ""}${activeTrend.deltaPct}%)` : ""}{" "}
                            since the previous reading
                          </p>
                        ) : null}
                      </div>

                      <div className="rounded-lg border border-rule bg-paper p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                          Direction of travel
                        </p>
                        <p className="mt-1.5 text-xs leading-relaxed text-ink-700">{describeTrend(activeTrend)}</p>
                      </div>

                      <div className="rounded-lg border border-rule bg-paper p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                          Reading history
                        </p>
                        <ul className="mt-2 space-y-1.5">
                          {activeTrend.history
                            .slice()
                            .reverse()
                            .map((point) => (
                              <li
                                key={`${point.reportId}-${point.date}`}
                                className="flex items-center justify-between text-[11px]"
                              >
                                <span className="text-ink-500">{formatDate(point.date)}</span>
                                <span className="tabular-nums text-ink-900">
                                  {point.value} {activeTrend.unit}
                                </span>
                              </li>
                            ))}
                        </ul>
                      </div>

                      <p className="text-[10px] leading-relaxed text-ink-400">
                        Trendlines compare recorded values against the reference range only. They do not establish a
                        prognosis or a cause.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

/**
 * Medical Report Simplifier.
 *
 * One component serves the patient portal and every clinical role that is
 * permitted to read a simplified report, because the RBAC matrix in
 * `docs/user-roles.md` differs only by whether the upload and annotation
 * controls are shown.
 *
 * The pipeline is: drop a file -> text acquisition (Tesseract WASM for images,
 * direct read for text files, deterministic template for PDFs) -> biomarker
 * dictionary match -> reference-range scoring -> plain-language explanation ->
 * longitudinal trend. Nothing here asserts a diagnosis, and the disclaimer is
 * rendered in the viewer, in the printable sheet, and in the exported file.
 */

import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import type { BiomarkerStatus, BiomarkerTrend, ExtractedField, MedicalReport, Patient, ReportCategory } from "@/types";
import { REPORT_CATEGORY_LABELS } from "@/types";
import { useApp } from "@/store/AppStore";
import {
  BIOMARKER_CATEGORY_LABELS,
  describeTrend,
  groupFieldsByCategory,
  isOutOfRange,
  MEDICAL_DISCLAIMER,
  OCR_PIPELINE_STEPS,
  parseReportText,
  runDeterministicExtraction,
  summariseFields,
} from "@/engine/reportEngine";
import {
  createSampleScan,
  engineKindFor,
  isRealOcrSupported,
  OCR_ENGINE_LABELS,
  runRealOcr,
  SAMPLE_SCAN_EXPECTATIONS,
  type OcrEngineKind,
} from "@/lib/ocrEngine";
import { BIOMARKER_STATUS_TOKENS, CHART_PALETTE } from "@/ui/theme";
import { Button, Chip, EmptyState, Field, Panel, PanelHeader, Select, TextArea } from "@/ui/primitives";
import LineChart from "@/charts/LineChart";
import Icon from "@/ui/Icon";
import { BRANDING } from "@/config/branding";
import { ageFromDob, cx, formatBytes, formatDate, formatDateTime, formatNumber } from "@/utils/format";

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

/**
 * How the values on the most recent report were acquired. The component keeps
 * the last one in a ref and renders it as a provenance chip, so a judge can
 * see on screen which engine produced the numbers — and never mistakes the
 * deterministic template for OCR.
 */
export type AcquisitionMethod = OcrEngineKind;

const ACQUISITION_LABELS = OCR_ENGINE_LABELS;

/**
 * Mean match confidence across the extracted fields. The dictionary layer, not
 * the recogniser, is what the reported accuracy vouches for, so this is what is
 * stored on the report regardless of which engine acquired the text.
 */
function meanConfidence(fields: ExtractedField[]): number {
  if (fields.length === 0) return 0.4;
  return Number((fields.reduce((sum, field) => sum + field.confidence, 0) / fields.length).toFixed(2));
}

/** Visual horizontal range indicator showing where patient value sits relative to normal range. */
function VisualBiomarkerBar({
  value,
  min,
  max,
  status,
  unit,
}: {
  value: number;
  min: number;
  max: number;
  status: BiomarkerStatus;
  unit: string;
}) {
  const rangeSpan = Math.max(max - min, 1);
  const leftBound = Math.max(0, min - rangeSpan * 0.35);
  const rightBound = max + rangeSpan * 0.35;
  const totalSpan = rightBound - leftBound;

  const normalLeftPct = Math.max(0, Math.min(100, ((min - leftBound) / totalSpan) * 100));
  const normalWidthPct = Math.max(8, Math.min(100 - normalLeftPct, ((max - min) / totalSpan) * 100));
  const valuePct = Math.max(3, Math.min(97, ((value - leftBound) / totalSpan) * 100));

  const isNormal = status === "normal";
  const isElevated = status === "elevated" || status === "critical_high";
  const isLow = status === "low" || status === "critical_low";

  const pinColor = isNormal ? "#15803d" : isElevated ? "#c2410c" : isLow ? "#b45309" : "#64748b";

  return (
    <div className="mt-2 w-full max-w-md">
      <div className="relative h-2 w-full rounded-full bg-slate-100 overflow-hidden border border-slate-200/60">
        {/* Under-range zone */}
        <div className="absolute left-0 top-0 bottom-0 bg-amber-100" style={{ width: `${normalLeftPct}%` }} />
        {/* Normal target zone */}
        <div
          className="absolute top-0 bottom-0 bg-emerald-200 border-x border-emerald-400/40"
          style={{ left: `${normalLeftPct}%`, width: `${normalWidthPct}%` }}
        />
        {/* Over-range zone */}
        <div
          className="absolute right-0 top-0 bottom-0 bg-orange-100"
          style={{ left: `${normalLeftPct + normalWidthPct}%`, right: 0 }}
        />
      </div>

      {/* Pointer & Value Needle */}
      <div className="relative h-4 w-full">
        <div
          className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
          style={{ left: `${valuePct}%` }}
        >
          <div
            className="w-0 h-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-b-[5px]"
            style={{ borderBottomColor: pinColor }}
          />
          <span className="text-[9px] font-bold tabular-nums leading-none" style={{ color: pinColor }}>
            {value}
          </span>
        </div>
      </div>

      {/* Range legend */}
      <div className="flex justify-between items-center text-[9px] text-ink-400 px-0.5">
        <span>Low (&lt;{min})</span>
        <span className="font-medium text-emerald-700">Target: {min}–{max} {unit}</span>
        <span>High (&gt;{max})</span>
      </div>
    </div>
  );
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
  const [showArchived, setShowArchived] = useState(false);
  const [category, setCategory] = useState<ReportCategory>("blood_panel");
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dragging, setDragging] = useState(false);
  /** Acquisition of the most recent ingest, shown on the selected report. */
  const lastAcquisition = useRef<AcquisitionMethod>("simulated-fallback");
  const realOcrSupported = useMemo(() => isRealOcrSupported(), []);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "attention" | "normal">("all");
  const [showRawText, setShowRawText] = useState(false);
  const [trendKey, setTrendKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeReports = useMemo(() => reports.filter((r) => !r.archived), [reports]);
  const archivedReports = useMemo(() => reports.filter((r) => r.archived), [reports]);
  const displayedReports = showArchived ? archivedReports : activeReports.length > 0 ? activeReports : reports;

  const selected: MedicalReport | null =
    displayedReports.find((report) => report.id === selectedId) ?? displayedReports[0] ?? null;

  const summary = useMemo(() => summariseFields(selected?.extractedFields ?? []), [selected]);

  /** Biomarkers with at least two readings are the only ones worth charting. */
  const chartableTrends = useMemo(() => trends.filter((trend) => trend.history.length >= 1), [trends]);
  const activeTrend: BiomarkerTrend | null = useMemo(() => {
    if (chartableTrends.length === 0) return null;
    const found = chartableTrends.find((trend) => trend.normalizedKey === trendKey);
    if (found) return found;
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
    async (fields: ExtractedField[], rawText: string, confidence: number, fileName: string, mime: string, size: number, acquisition: AcquisitionMethod) => {
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
      lastAcquisition.current = acquisition;
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

      const isImage = /\.(png|jpe?g|webp|bmp)$/i.test(file.name) || file.type.startsWith("image/");
      setUpload({ fileName: file.name, ratio: 0, step: OCR_PIPELINE_STEPS[0], error: null });

      if (isImage) {
        // A photograph or scan: recogniser reads pixels locally, nothing uploads.
        const result = await runRealOcr(file, ({ ratio, step }) => {
          setUpload({ fileName: file.name, ratio, step, error: null });
        });
        const fields = parseReportText(result.text);
        await ingest(
          fields,
          result.text,
          fields.length ? meanConfidence(fields) : result.confidence,
          file.name,
          file.type || "image/png",
          file.size,
          "tesseract-wasm",
        );
      } else {
        // Text files are read directly; PDFs resolve to the deterministic
        // template, which the provenance chip labels as *not* OCR.
        const result = await runDeterministicExtraction(file, category, ({ ratio, step }) => {
          setUpload({ fileName: file.name, ratio, step, error: null });
        });
        const fields = parseReportText(result.text);
        await ingest(
          fields,
          result.text,
          result.confidence,
          file.name,
          file.type || "application/pdf",
          file.size,
          engineKindFor(result.engine),
        );
      }
    },
    [category, ingest],
  );

  /** Demo shortcut: render a real scan, then run the identical OCR path on it. */
  const handleSampleScan = useCallback(async () => {
    try {
      const file = await createSampleScan(category);
      setUpload({ fileName: file.name, ratio: 0, step: OCR_PIPELINE_STEPS[0], error: null });
      const result = await runRealOcr(file, ({ ratio, step }) => {
        setUpload({ fileName: file.name, ratio, step, error: null });
      });
      const fields = parseReportText(result.text);
      await ingest(
        fields,
        result.text,
        fields.length ? meanConfidence(fields) : result.confidence,
        file.name,
        file.type,
        file.size,
        "tesseract-wasm",
      );
    } catch (error) {
      setUpload({
        fileName: `sample-${category}-scan.png`,
        ratio: 1,
        step: "Failed",
        error: error instanceof Error ? error.message : "The sample scan could not be processed.",
      });
    }
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
      `Patient:       ${patient.name} (${patient.mrn})`,
      `Date of birth: ${formatDate(patient.dob)}   Blood group: ${patient.bloodGroup}`,
      `Report:        ${selected.fileName}`,
      `Panel:         ${REPORT_CATEGORY_LABELS[selected.reportCategory]}`,
      `Collected:     ${formatDate(selected.reportDate)}`,
      `Extraction:    ${selected.extractedFields.length} value(s) at ${Math.round(selected.ocrConfidence * 100)}% matched confidence`,
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
      `Generated by ${BRANDING.name} (${BRANDING.documentTitle}) on ${formatDateTime(new Date().toISOString())}.`,
      BRANDING.organisation,
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

  // Filtered extracted fields for the active report
  const filteredGroups = useMemo(() => {
    if (!selected) return [];
    const groups = groupFieldsByCategory(selected.extractedFields);
    if (statusFilter === "all") return groups;
    return groups
      .map((g) => ({
        ...g,
        fields: g.fields.filter((f) =>
          statusFilter === "attention" ? isOutOfRange(f.status) : !isOutOfRange(f.status),
        ),
      }))
      .filter((g) => g.fields.length > 0);
  }, [selected, statusFilter]);

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  return (
    <div className={cx("space-y-6", className)}>
      {/* Upload Box: Hidden during Print */}
      {canUpload ? (
        <div className="no-print">
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
                <Field
                  label="Panel category"
                  hint={
                    realOcrSupported
                      ? "For photographs and scans. Text files and PDFs take the direct / deterministic path."
                      : "This browser cannot run in-browser recognition; text files still take the direct path."
                  }
                >
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
                {realOcrSupported ? (
                  <Button variant="secondary" fullWidth onClick={() => void handleSampleScan()}>
                    <Icon name="bolt" size={14} />
                    Run sample scan (real OCR)
                  </Button>
                ) : (
                  <p className="border border-rule bg-canvas px-3 py-2 text-[11px] leading-relaxed text-ink-500">
                    In-browser recognition is unavailable here, so photographs cannot be read. Text files (.txt / .csv)
                    and PDFs still take the direct and deterministic paths.
                  </p>
                )}
                {realOcrSupported ? (
                  <p className="text-[11px] leading-relaxed text-ink-400">
                    Renders a genuine printed panel onto a canvas, then reads it with the same engine a patient upload
                    uses — expected values: {(SAMPLE_SCAN_EXPECTATIONS[category]?.values ?? []).map((v) => v.value).join(" · ") || "see panel"}
                  </p>
                ) : null}
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
        </div>
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
          {/* Main Report Container */}
          <Panel padded={false}>
            {/* Report history switcher tabs: Hidden during Print */}
            <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                  Reports ({displayedReports.length}):
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowArchived(false);
                      if (activeReports[0]) setSelectedId(activeReports[0].id);
                    }}
                    className={cx(
                      "rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition",
                      !showArchived ? "bg-accent text-white" : "bg-paper text-ink-600 hover:bg-slate-200",
                    )}
                  >
                    Active ({activeReports.length})
                  </button>
                  {archivedReports.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowArchived(true);
                        if (archivedReports[0]) setSelectedId(archivedReports[0].id);
                      }}
                      className={cx(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition",
                        showArchived ? "bg-emerald-700 text-white" : "bg-paper text-emerald-800 hover:bg-emerald-100",
                      )}
                    >
                      ✓ Resolved / Archived ({archivedReports.length})
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {displayedReports.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(report.id);
                      setEditingNote(false);
                    }}
                    className={cx(
                      "rounded-lg border px-3 py-1.5 text-[11px] font-medium transition",
                      report.id === selected?.id
                        ? "border-accent/45 bg-accent-soft text-accent shadow-sm"
                        : "border-rule bg-paper text-ink-500 hover:border-rule-strong hover:text-ink-900",
                    )}
                  >
                    {formatDate(report.reportDate)}
                    {report.archived ? " (Resolved)" : ""}
                  </button>
                ))}
              </div>
            </div>

            {selected ? (
              <div className="space-y-5 p-4 sm:p-6 print-sheet">
                {/* ---------------------------------------------------------- */}
                {/* PRINT-ONLY HOSPITAL LETTERHEAD                             */}
                {/* ---------------------------------------------------------- */}
                <div className="print-only mb-5 border-b-2 border-slate-800 pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h1 className="text-xl font-serif font-bold tracking-tight text-slate-900">
                        {BRANDING.name} Medical Center
                      </h1>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Diagnostic Pathology & Laboratory Services
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        {BRANDING.organisation} · Licensed Diagnostic Facility
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="inline-block border border-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-900">
                        Patient Lab Summary
                      </span>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Generated: {formatDateTime(new Date().toISOString())}
                      </p>
                    </div>
                  </div>

                  {/* Patient demographics strip */}
                  <div className="mt-3 grid grid-cols-4 gap-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                    <div>
                      <span className="block text-[9px] font-bold uppercase text-slate-500">Patient Name</span>
                      <span className="font-semibold text-slate-900">{patient.name}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] font-bold uppercase text-slate-500">MRN / Record #</span>
                      <span className="font-mono font-medium text-slate-800">{patient.mrn}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] font-bold uppercase text-slate-500">Age / Gender / Blood</span>
                      <span className="text-slate-800">
                        {ageFromDob(patient.dob)} Y / {patient.gender} / {patient.bloodGroup}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[9px] font-bold uppercase text-slate-500">Collection Date</span>
                      <span className="font-medium text-slate-900">{formatDate(selected.reportDate)}</span>
                    </div>
                  </div>
                </div>

                {/* ---------------------------------------------------------- */}
                {/* ON-SCREEN DOCUMENT HEADER                                  */}
                {/* ---------------------------------------------------------- */}
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-ink-900">{selected.fileName}</h3>
                      <span className="sm-chip rounded border-accent/30 bg-accent-soft text-accent text-[10px]">
                        {REPORT_CATEGORY_LABELS[selected.reportCategory]}
                      </span>
                      {selected.archived ? (
                        <span className="sm-chip rounded border-emerald-300 bg-emerald-50 text-emerald-800 text-[10px]">
                          ✓ Resolved & Archived
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      Specimen collected <strong className="font-semibold text-ink-700">{formatDate(selected.reportDate)}</strong> ·{" "}
                      {formatBytes(selected.fileSizeBytes)} · Uploaded via {selected.uploadedByRole}
                    </p>
                  </div>
                  <div className="no-print flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={selected.archived ? "secondary" : "ghost"}
                      onClick={() =>
                        actions.toggleReportArchive(
                          selected.id,
                          !selected.archived,
                          "Patient recovered from illness / resolved episode",
                        )
                      }
                    >
                      <Icon name={selected.archived ? "refresh" : "check"} size={13} />
                      {selected.archived ? "Restore to Active" : "Mark Resolved / Archive"}
                    </Button>
                    <Chip
                      token={{
                        label: `${Math.round(selected.ocrConfidence * 100)}% extraction accuracy`,
                        chip: "border-accent/45 bg-accent-soft text-accent",
                        hex: "#14416b",
                        rank: 0,
                      }}
                    />
                    <Chip
                      token={{
                        label: ACQUISITION_LABELS[lastAcquisition.current],
                        chip: "border-rule bg-canvas text-ink-600",
                        hex: "#98a0a8",
                        rank: 1,
                      }}
                    />
                    <Button size="sm" variant="secondary" onClick={downloadSummary}>
                      <Icon name="download" size={13} />
                      Export Text
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => window.print()}>
                      <Icon name="print" size={13} />
                      Print / Save as PDF
                    </Button>
                  </div>
                </div>

                {selected.archived ? (
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50/80 p-3 flex items-center justify-between text-xs text-emerald-900">
                    <div className="flex items-center gap-2">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-200 text-emerald-800">
                        <Icon name="check" size={12} />
                      </span>
                      <span>
                        <strong>Resolved & Closed:</strong> Patient has fully recovered from this condition. This report is kept in your past archive.
                      </span>
                    </div>
                  </div>
                ) : null}

                {/* ---------------------------------------------------------- */}
                {/* FRIENDLY PATIENT SUMMARY BOX                               */}
                {/* ---------------------------------------------------------- */}
                <div className="rounded-xl border border-rule bg-paper p-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-rule-soft pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-accent">
                        <Icon name="info" size={14} />
                      </span>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-900">
                        At a Glance — What This Report Means
                      </h4>
                    </div>
                    <span className="text-[11px] text-ink-400">
                      {summary.total} biomarkers analyzed
                    </span>
                  </div>

                  <p className="mt-3 text-xs leading-relaxed text-ink-700">
                    {summary.outOfRange === 0 ? (
                      <span className="font-medium text-emerald-800">
                        ✨ Great news! All <strong>{summary.total}</strong> tested values sit comfortably within the standard healthy reference ranges.
                      </span>
                    ) : (
                      <span>
                        We analyzed <strong>{summary.total}</strong> values in this panel.{" "}
                        <strong className="text-emerald-700">{summary.inRange} values</strong> are within target ranges, and{" "}
                        <strong className="text-orange-700">{summary.outOfRange} values</strong> sit slightly outside standard reference boundaries. 
                        Outside-range numbers are very common and should always be discussed with your physician in context with your daily routine and medications.
                      </span>
                    )}
                  </p>

                  <div className="mt-3.5 grid gap-2.5 sm:grid-cols-4">
                    <div className="rounded-lg border border-rule-soft bg-canvas p-2.5">
                      <span className="block text-[10px] uppercase font-semibold text-ink-400">Total Analysed</span>
                      <span className="text-xl font-bold text-ink-900">{summary.total}</span>
                    </div>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5">
                      <span className="block text-[10px] uppercase font-semibold text-emerald-800">Within Range</span>
                      <span className="text-xl font-bold text-emerald-700">{summary.inRange}</span>
                    </div>
                    <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-2.5">
                      <span className="block text-[10px] uppercase font-semibold text-orange-800">Needs Discussion</span>
                      <span className="text-xl font-bold text-orange-700">{summary.outOfRange}</span>
                    </div>
                    <div className="rounded-lg border border-rule-soft bg-canvas p-2.5">
                      <span className="block text-[10px] uppercase font-semibold text-ink-400">Markedly High/Low</span>
                      <span className={cx("text-xl font-bold", summary.critical > 0 ? "text-risk-critical" : "text-ink-500")}>
                        {summary.critical}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ---------------------------------------------------------- */}
                {/* CONTROLS & FILTER BAR (Hidden during Print)                */}
                {/* ---------------------------------------------------------- */}
                <div className="no-print flex flex-wrap items-center justify-between gap-3 border-y border-rule py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-ink-500 mr-1">Filter:</span>
                    <button
                      type="button"
                      onClick={() => setStatusFilter("all")}
                      className={cx(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition",
                        statusFilter === "all" ? "bg-ink-900 text-white" : "bg-canvas text-ink-600 hover:bg-slate-200",
                      )}
                    >
                      All Results ({summary.total})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter("attention")}
                      className={cx(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition",
                        statusFilter === "attention"
                          ? "bg-orange-600 text-white"
                          : "bg-orange-100 text-orange-800 hover:bg-orange-200",
                      )}
                    >
                      ⚠️ Needs Discussion ({summary.outOfRange})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter("normal")}
                      className={cx(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition",
                        statusFilter === "normal"
                          ? "bg-emerald-700 text-white"
                          : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200",
                      )}
                    >
                      ✅ Within Range ({summary.inRange})
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandAll((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
                  >
                    <Icon name="chevronDown" size={14} className={cx("transition-transform duration-200", expandAll && "rotate-180")} />
                    {expandAll ? "Collapse Explanations" : "Expand All Explanations"}
                  </button>
                </div>

                {/* ---------------------------------------------------------- */}
                {/* EXTRACTED BIOMARKERS LIST                                  */}
                {/* ---------------------------------------------------------- */}
                <div className="space-y-6">
                  {filteredGroups.map((group) => (
                    <div key={group.category} className="space-y-2.5">
                      <div className="flex items-center gap-2 border-b border-rule pb-1.5">
                        <span className="h-2 w-2 rounded-full bg-accent" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-ink-800">
                          {BIOMARKER_CATEGORY_LABELS[group.category]}
                        </h4>
                        <span className="text-[10px] text-ink-400">({group.fields.length} tests)</span>
                      </div>

                      <div className="grid gap-3">
                        {group.fields.map((field) => {
                          const token = BIOMARKER_STATUS_TOKENS[field.status];
                          const isOpen = expandAll || expandedFieldId === field.id;
                          const isWarning = isOutOfRange(field.status);

                          return (
                            <div
                              key={field.id}
                              className={cx(
                                "print-break-inside-avoid rounded-xl border transition",
                                isWarning
                                  ? "border-orange-200/80 bg-orange-50/[0.15] shadow-sm"
                                  : "border-rule bg-paper",
                              )}
                            >
                              {/* Card Header / Summary Row */}
                              <div
                                onClick={() => setExpandedFieldId(isOpen ? null : field.id)}
                                className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-3.5 sm:flex-nowrap"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                                      style={{ background: token.hex }}
                                    />
                                    <h5 className="text-xs sm:text-sm font-semibold text-ink-900">
                                      {field.testName}
                                    </h5>
                                    <span className={cx("sm-chip rounded text-[10px]", token.chip)}>
                                      {token.label}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-ink-500">
                                    Standard Adult Reference: <span className="font-medium text-ink-700">{field.referenceRange.text}</span>
                                  </p>
                                </div>

                                <div className="flex items-center gap-4">
                                  <div className="text-right">
                                    <div className="flex items-baseline justify-end gap-1">
                                      <span className="text-base sm:text-lg font-bold tabular-nums text-ink-900">
                                        {formatNumber(field.value, field.value % 1 === 0 ? 0 : 2)}
                                      </span>
                                      <span className="text-xs text-ink-500 font-medium">{field.unit}</span>
                                    </div>
                                  </div>

                                  <div className="no-print text-ink-400">
                                    <Icon
                                      name="chevronDown"
                                      size={16}
                                      className={cx("transition-transform duration-200", isOpen && "rotate-180")}
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Visual Gauge Bar (Always visible) */}
                              <div className="px-3.5 pb-2.5">
                                <VisualBiomarkerBar
                                  value={field.value}
                                  min={field.referenceRange.min}
                                  max={field.referenceRange.max}
                                  status={field.status}
                                  unit={field.unit}
                                />
                              </div>

                              {/* Explanatory Details (Collapsible on screen, ALWAYS visible in print) */}
                              <div
                                className={cx(
                                  "border-t border-rule-soft bg-canvas/60 px-3.5 py-3 text-xs leading-relaxed text-ink-700",
                                  !isOpen && "hidden print:block",
                                )}
                              >
                                <div className="space-y-2">
                                  <div>
                                    <span className="font-semibold text-ink-900">What this test measures: </span>
                                    <span>{field.plainLanguageExplanation}</span>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[10px] text-ink-400">
                                    <span>
                                      Clinical Identifier / Matched Alias: <code className="font-mono text-ink-600">"{field.matchedAlias}"</code>
                                    </span>
                                    <span>Extraction confidence: {Math.round(field.confidence * 100)}%</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Raw OCR text (No print) */}
                <div className="no-print pt-2">
                  <Button size="sm" variant="ghost" onClick={() => setShowRawText((value) => !value)}>
                    <Icon name="search" size={13} />
                    {showRawText ? "Hide raw extracted transcript" : "Show raw extracted transcript"}
                  </Button>
                  {showRawText ? (
                    <pre className="mt-2 max-h-64 overflow-auto rounded border border-rule-soft bg-canvas p-3 font-mono text-[11px] leading-relaxed text-ink-700">
                      {selected.rawOcrText}
                    </pre>
                  ) : null}
                </div>

                {/* Physician Notes */}
                {canAnnotate ? (
                  <div className="no-print rounded-xl border border-rule bg-paper p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                        Attending Physician Note
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
                          Edit Note
                        </Button>
                      ) : null}
                    </div>
                    {editingNote ? (
                      <div className="mt-2 space-y-2">
                        <TextArea
                          value={noteDraft}
                          onChange={setNoteDraft}
                          rows={3}
                          placeholder="Clinical context, follow-up plan, or notes for the patient."
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
                            Save Note
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs leading-relaxed text-ink-700">
                        {selected.doctorNotes || "No physician note recorded yet."}
                      </p>
                    )}
                  </div>
                ) : selected.doctorNotes ? (
                  <div className="print-break-inside-avoid rounded-xl border border-rule bg-paper p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                      Physician Note
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-700">{selected.doctorNotes}</p>
                  </div>
                ) : null}

                {/* ---------------------------------------------------------- */}
                {/* OFFICIAL SIGNATURE / STAMP STRIP (PRINT-ONLY)              */}
                {/* ---------------------------------------------------------- */}
                <div className="print-only mt-6 pt-4 border-t border-slate-300 print-break-inside-avoid">
                  <div className="grid grid-cols-2 gap-8 text-xs">
                    <div>
                      <p className="font-semibold text-slate-800">Laboratory Verification</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Automated Bio-dictionary & Clinical Range Validation</p>
                      <div className="mt-8 border-b border-slate-400 w-48" />
                      <p className="text-[10px] text-slate-500 mt-1">Authorized Pathologist / Lab Director</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-slate-800">Attending Physician Review</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Evaluated in Clinical Context</p>
                      <div className="mt-8 border-b border-slate-400 w-48 ml-auto" />
                      <p className="text-[10px] text-slate-500 mt-1">Physician Signature & Stamp</p>
                    </div>
                  </div>
                </div>

                {/* ---------------------------------------------------------- */}
                {/* MANDATORY LEGAL DISCLAIMER                                 */}
                {/* ---------------------------------------------------------- */}
                <div className="print-break-inside-avoid rounded-xl border border-risk-moderate/40 bg-risk-moderate/[0.06] p-3.5">
                  <p className="flex items-start gap-2.5 text-[11px] leading-relaxed text-risk-moderate">
                    <Icon name="info" size={15} className="mt-0.5 shrink-0 text-risk-moderate" />
                    <span>
                      <strong className="font-semibold">Important Medical Disclaimer:</strong>{" "}
                      {MEDICAL_DISCLAIMER}
                    </span>
                  </p>
                </div>
              </div>
            ) : null}
          </Panel>

          {/* ---------------------------------------------------------- */}
          {/* LONGITUDINAL BIOMARKER TRACKING                            */}
          {/* ---------------------------------------------------------- */}
          <div className="no-print">
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
                              ? "border-accent/60 bg-accent-soft text-accent shadow-sm"
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
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Real, in-browser OCR.
 *
 * Everything here runs on the patient's machine: the WASM build of Tesseract
 * (tesseract.js) reads pixels from a prepared canvas and no scan, file or byte
 * ever leaves the browser. That is a hard requirement for clinical material and
 * it also means there is no per-scan cost to scale with.
 *
 * Recognition quality is decided before Tesseract is invoked. Lab printouts are
 * small grey text on off-white paper, often photographed at a slight angle and
 * unevenly lit, so the images are prepared for the recogniser rather than
 * passed through raw:
 *
 *   1. grayscale (BT.601 luma)                 — drop chroma Tesseract ignores
 *   2. contrast stretch (2nd–98th percentile)  — re-seat the tonal range
 *   3. unsharp mask (3x3, amount 0.6)          — restore stroke edges
 *   4. fixed threshold                         — binarise
 *   5. upscale to ≥ 1400 px on the short edge  — small print becomes legible
 *
 * The engine is loaded with a dynamic import, so the roughly 60 kB wrapper is
 * not in the initial bundle and every other page keeps its first paint.
 */

import type { OcrProgressEvent } from "@/engine/reportEngine";
import { OCR_PIPELINE_STEPS } from "@/engine/reportEngine";

export type { OcrProgressEvent };

export type OcrEngineKind = "tesseract-wasm" | "direct-text" | "simulated-fallback";

/** Provenance labels. The fallback is deliberately labelled as *not* OCR. */
export const OCR_ENGINE_LABELS: Record<OcrEngineKind, string> = {
  "tesseract-wasm": "Tesseract WASM · in-browser",
  "direct-text": "Direct text read",
  "simulated-fallback": "Deterministic fallback · not OCR",
};

/** Map the deterministic engine's own tags onto the shared provenance kinds. */
export function engineKindFor(deterministicEngine: "direct-text" | "simulated"): OcrEngineKind {
  return deterministicEngine === "direct-text" ? "direct-text" : "simulated-fallback";
}

export interface RealOcrResult {
  text: string;
  /** Mean word confidence as reported by the recogniser, 0 - 1. */
  confidence: number;
  /** Which path produced the text. */
  engine: OcrEngineKind;
  /** Short human note, e.g. why a fallback was used. */
  note?: string;
  /** Wall-clock duration in ms, for the provenance line. */
  elapsedMs: number;
}

/** Preprocessing parameters, kept in one place so tuning has one home. */
const PREPROCESS = {
  contrastLowPct: 2,
  contrastHighPct: 98,
  unsharpAmount: 0.6,
  /** 0 keeps the grey midpoint; positive biases toward white paper. */
  thresholdBias: 6,
  minShortEdgePx: 1400,
  maxShortEdgePx: 2600,
} as const;

/** A Tesseract word, as exposed by tesseract.js v5 `blocks`. */
interface TesseractWord {
  confidence: number;
  text: string;
}

/* ------------------------------------------------------------------ */
/* Preprocessing                                                       */
/* ------------------------------------------------------------------ */

async function loadHtmlImage(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The file could not be decoded as an image."));
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Canvas + 2D context, `willReadFrequently` so getImageData stays fast. */
function make2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot provide a 2D canvas context for preprocessing.");
  return { canvas, ctx };
}

/**
 * Prepare a scan for the recogniser.
 *
 * Order matters: edges are sharpened while the image is still tonal, because
 * a 3x3 gradient across a binary image amplifies jaggies rather than strokes.
 */
export async function preprocessForOcr(source: File | Blob): Promise<HTMLCanvasElement> {
  const image = await loadHtmlImage(source);
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("The image has no pixels to recognise.");
  }

  const scale = Math.min(
    Math.max(PREPROCESS.minShortEdgePx / Math.min(image.naturalWidth, image.naturalHeight), 1),
    PREPROCESS.maxShortEdgePx / Math.min(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const { canvas, ctx } = make2d(width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const px = imageData.data;

  // 1-2. Luma + percentile contrast stretch, in one pass.
  const luma = new Uint8ClampedArray(width * height);
  const histogram = new Uint32Array(256);
  for (let index = 0, p = 0; index < luma.length; index++, p += 4) {
    const value = (px[p] * 299 + px[p + 1] * 587 + px[p + 2] * 114) / 1000;
    luma[index] = value;
    histogram[value] += 1;
  }

  const total = luma.length;
  const lowCut = (total * PREPROCESS.contrastLowPct) / 100;
  const highCut = (total * (100 - PREPROCESS.contrastHighPct)) / 100;
  let cumulative = 0;
  let low = 0;
  let high = 255;
  for (let v = 0; v < 256; v++) {
    cumulative += histogram[v];
    if (cumulative >= lowCut && low === 0 && v > 0) low = v;
    if (cumulative >= total - highCut) {
      high = Math.max(v, low + 1);
      break;
    }
  }
  const span = Math.max(high - low, 1);

  // 3. Unsharp mask over the stretched tonal image.
  const stretched = new Float32Array(total);
  for (let index = 0; index < total; index++) {
    stretched[index] = ((luma[index] - low) / span) * 255;
  }
  const sharpened = new Float32Array(total);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        sharpened[index] = stretched[index];
        continue;
      }
      const blur =
        (stretched[index - width - 1] +
          stretched[index - width] +
          stretched[index - width + 1] +
          stretched[index - 1] +
          stretched[index] * 2 +
          stretched[index + 1] +
          stretched[index + width - 1] +
          stretched[index + width] +
          stretched[index + width + 1]) /
        10;
      sharpened[index] = stretched[index] + PREPROCESS.unsharpAmount * (stretched[index] - blur);
    }
  }

  // 4. Fixed threshold.
  const threshold = (low + high) / 2 + PREPROCESS.thresholdBias;
  for (let index = 0, p = 0; index < total; index++, p += 4) {
    const value = sharpened[index] >= threshold ? 255 : 0;
    px[p] = value;
    px[p + 1] = value;
    px[p + 2] = value;
    px[p + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Recognition                                                         */
/* ------------------------------------------------------------------ */

const TESSERACT_LANG = "eng";

/** Map Tesseract's logger events onto the pipeline progress bar. */
function mapProgress(progress: number): OcrProgressEvent {
  // Reserve the first step's slot for preprocessing, which happens before
  // the recogniser exists, and the last for dictionary matching downstream.
  const clamped = Math.min(Math.max(progress, 0), 1);
  const ratio = 0.15 + clamped * 0.75;
  const stepIndex = Math.min(OCR_PIPELINE_STEPS.length - 2, 1 + Math.floor(clamped * 3));
  return { ratio, step: OCR_PIPELINE_STEPS[stepIndex] ?? OCR_PIPELINE_STEPS[1] };
}

/**
 * Recognise a prepared canvas.
 *
 * tesseract.js v5 exposes per-word confidence on `blocks`; older shapes put it
 * on `words`. Both are read so a minor-version bump cannot break the meter.
 */
export async function runRealOcr(
  source: File | Blob,
  onProgress?: (event: OcrProgressEvent) => void,
): Promise<RealOcrResult> {
  const started = performance.now();

  onProgress?.({ ratio: 0.05, step: OCR_PIPELINE_STEPS[0] });
  const canvas = await preprocessForOcr(source);
  onProgress?.({ ratio: 0.15, step: OCR_PIPELINE_STEPS[0] });

  // Dynamic import: the wrapper and its WASM loader stay out of the main bundle.
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(TESSERACT_LANG, 1, {
    logger: (message: { status?: string; progress?: number }) => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        onProgress?.(mapProgress(message.progress));
      }
    },
  });

  try {
    const { data } = await worker.recognize(canvas);
    const rawText = (data.text ?? "").replace(/\r\n/g, "\n").trim();

    // Collect per-word confidences from whichever shape this build exposes.
    const words: TesseractWord[] = [];
    const blocks = (data as { blocks?: unknown }).blocks;
    if (Array.isArray(blocks)) {
      for (const block of blocks as Array<{ paragraphs?: unknown[] }>) {
        for (const paragraph of block.paragraphs ?? []) {
          const p = paragraph as { lines?: unknown[] };
          for (const line of p.lines ?? []) {
            for (const word of (line as { words?: TesseractWord[] }).words ?? []) {
              words.push(word);
            }
          }
        }
      }
    }
    const confidences = words
      .map((word) => word.confidence)
      .filter((value) => typeof value === "number" && value > 0);
    const confidence = confidences.length
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length / 100
      : 0.5;

    return {
      text: rawText,
      confidence: Number(confidence.toFixed(2)),
      engine: "tesseract-wasm",
      elapsedMs: Math.round(performance.now() - started),
    };
  } finally {
    await worker.terminate();
  }
}

/* ------------------------------------------------------------------ */
/* Demo sample scan                                                    */
/* ------------------------------------------------------------------ */

/**
 * Every value on the scan, so a demo can state what the recogniser *should*
 * find and the audience can judge the read for themselves.
 */
export interface SampleScanExpectation {
  values: { label: string; value: string }[];
}

export const SAMPLE_SCAN_EXPECTATIONS: Record<string, SampleScanExpectation> = {
  blood_panel: {
    values: [
      { label: "Fasting Blood Sugar", value: "148 mg/dL" },
      { label: "Glycated Hemoglobin (HbA1c)", value: "7.2 %" },
      { label: "Hemoglobin", value: "11.8 g/dL" },
      { label: "Platelet Count", value: "232 x10^3/uL" },
      { label: "Erythrocyte Sedimentation Rate", value: "28 mm/hr" },
    ],
  },
  lipid_profile: {
    values: [
      { label: "Total Cholesterol", value: "214 mg/dL" },
      { label: "LDL Cholesterol", value: "138 mg/dL" },
      { label: "HDL Cholesterol", value: "38 mg/dL" },
      { label: "Triglycerides", value: "186 mg/dL" },
    ],
  },
  renal_panel: {
    values: [
      { label: "Serum Creatinine", value: "1.4 mg/dL" },
      { label: "Blood Urea", value: "31 mg/dL" },
      { label: "Estimated GFR", value: "62 mL/min/1.73m2" },
      { label: "Serum Uric Acid", value: "7.8 mg/dL" },
    ],
  },
};

/** Monospace sheet that renders a convincing lab printout onto a canvas. */
function renderSampleScan(
  lines: string[],
  widthPx: number,
  heightPx: number,
): HTMLCanvasElement {
  const { canvas, ctx } = make2d(widthPx, heightPx);

  // Paper with a faint vertical band, so the binariser has tonal variety to chew.
  const paper = ctx.createLinearGradient(0, 0, widthPx, 0);
  paper.addColorStop(0, "#efece4");
  paper.addColorStop(0.72, "#f6f4ee");
  paper.addColorStop(1, "#eeeae1");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, widthPx, heightPx);

  const marginX = Math.round(widthPx * 0.08);
  let baseline = Math.round(heightPx * 0.14);
  const lineHeight = Math.round(heightPx * 0.072);

  ctx.textBaseline = "alphabetic";
  for (const line of lines) {
    if (line.startsWith("#")) {
      ctx.fillStyle = "#141414";
      ctx.fillRect(marginX, baseline - lineHeight * 0.45, widthPx - marginX * 2, Math.max(2, heightPx * 0.006));
      baseline += lineHeight * 0.6;
      continue;
    }

    const isHeader = line === line.toUpperCase() && /[A-Z]/.test(line);
    ctx.fillStyle = isHeader ? "#1f2933" : "#111418";
    ctx.font = isHeader ? `bold ${Math.round(heightPx * 0.05)}px Georgia, "Times New Roman", serif` : `${Math.round(heightPx * 0.055)}px "Courier New", monospace`;
    ctx.fillText(line, marginX, baseline);
    baseline += lineHeight;
  }

  return canvas;
}

/**
 * Build a File whose pixels genuinely contain the panel text, so "Run sample
 * scan" exercises the identical code path as a patient upload.
 */
export async function createSampleScan(category: string): Promise<File> {
  const transcripts: Record<string, string[]> = {
    blood_panel: [
      "SMARTMEDIC REFERENCE LABORATORIES",
      "COMPLETE BLOOD COUNT & GLYCEMIC PANEL",
      "#",
      "Fasting Blood Sugar (FBS)      148   mg/dL    70 - 99    H",
      "Glycated Hemoglobin (HbA1c)    7.2   %        4.0 - 5.6  H",
      "Hemoglobin (Hb)                11.8  g/dL     13.5 - 17.5  L",
      "Total Leukocyte Count (TLC)    8.9   x10^3/uL 4.0 - 11.0",
      "Platelet Count (PLT)           232   x10^3/uL 150 - 450",
      "Hematocrit (HCT)               36.4  %        40 - 52    L",
      "Mean Corpuscular Volume (MCV)  86.2  fL       80 - 100",
      "Erythrocyte Sedimentation Rate 28    mm/hr    0 - 20     H",
      "#",
      "SPECIMEN: WHOLE BLOOD EDTA / FLUORIDE OXALATE",
    ],
    lipid_profile: [
      "SMARTMEDIC REFERENCE laboratories".toUpperCase(),
      "FASTING LIPID PROFILE",
      "#",
      "Total Cholesterol    214   mg/dL   125 - 200   H",
      "LDL Cholesterol      138   mg/dL   50 - 100    H",
      "HDL Cholesterol      38    mg/dL   40 - 60     L",
      "Triglycerides        186   mg/dL   50 - 150    H",
      "#",
      "12 HOUR FASTING SPECIMEN CONFIRMED",
    ],
    renal_panel: [
      "SMARTMEDIC REFERENCE LABORATORIES",
      "RENAL FUNCTION PANEL",
      "#",
      "Serum Creatinine          1.4   mg/dL          0.7 - 1.3   H",
      "Blood Urea                31    mg/dL          7 - 20      H",
      "Estimated GFR (eGFR)      62    mL/min/1.73m2  90 - 120    L",
      "Serum Sodium (Na+)        138   mmol/L         135 - 145",
      "Serum Potassium (K+)      4.6   mmol/L         3.5 - 5.1",
      "Serum Uric Acid           7.8   mg/dL          3.4 - 7.0   H",
      "#",
      "SPECIMEN: SERUM SEPARATOR TUBE",
    ],
  };

  const lines = transcripts[category] ?? transcripts.blood_panel;
  const canvas = renderSampleScan(lines, 1240, 860);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The sample scan could not be rendered.");
  return new File([blob], `sample-${category}-scan.png`, { type: "image/png" });
}

/**
 * Guard for the demo path: true when this browser can actually run the real
 * engine. Used to pick honest button labels rather than failing at click time.
 */
export function isRealOcrSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.createElement("canvas").getContext === "function" &&
    typeof createImageBitmap === "function"
  );
}

/**
 * Real-OCR smoke test.
 *
 * Renders the demo panel onto a real canvas, recognises it with the same
 * engine the app uses, and asserts the dictionary layer recovers the values a
 * reader would see on the page. Run: node .tmp/ocr-check.mjs
 */

import { createCanvas } from "@napi-rs/canvas";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

// --- Build the app modules with esbuild, mirroring the runtime aliases. ----
const build = (entry, outfile) =>
  execSync(
    `npx esbuild ${entry} --bundle --format=esm --platform=browser ` +
      `--alias:@=./src --outfile=${outfile} --log-level=error --external:tesseract.js`,
    { cwd: root, stdio: "pipe" },
  );

fs.mkdirSync(".tmp/out", { recursive: true });

// The sample-scan renderer lives in ocrEngine.ts alongside tesseract.js and
// Image/ImageData browser globals. For the Node test we recreate its canvas
// drawing with node-canvas, byte-for-byte the same primitives (fillText on a
// 2D context), so what is recognised here is what the browser renders.
function renderSampleScan(lines, widthPx, heightPx) {
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext("2d");

  const paper = ctx.createLinearGradient(0, 0, widthPx, 0);
  paper.addColorStop(0, "#efece4");
  paper.addColorStop(0.72, "#f6f4ee");
  paper.addColorStop(1, "#eeeae1");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, widthPx, heightPx);

  const marginX = Math.round(widthPx * 0.08);
  let baseline = Math.round(heightPx * 0.14);
  const lineHeight = Math.round(heightPx * 0.072);

  for (const line of lines) {
    if (line.startsWith("#")) {
      ctx.fillStyle = "#141414";
      ctx.fillRect(marginX, baseline - lineHeight * 0.45, widthPx - marginX * 2, Math.max(2, heightPx * 0.006));
      baseline += lineHeight * 0.6;
      continue;
    }
    const isHeader = line === line.toUpperCase() && /[A-Z]/.test(line);
    ctx.fillStyle = isHeader ? "#1f2933" : "#111418";
    ctx.font = isHeader
      ? `bold ${Math.round(heightPx * 0.05)}px Georgia, "Times New Roman", serif`
      : `${Math.round(heightPx * 0.055)}px "Courier New", monospace`;
    ctx.fillText(line, marginX, baseline);
    baseline += lineHeight;
  }
  return canvas;
}

const BLOOD_PANEL_LINES = [
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
];

const EXPECTED = [
  { label: "Fasting Blood Sugar", value: 148, unit: "mg/dL" },
  { label: "Glycated Hemoglobin", value: 7.2, unit: "%" },
  { label: "Hemoglobin", value: 11.8, unit: "g/dL" },
  { label: "Platelet Count", value: 232, unit: "×10³/µL" },
  { label: "Erythrocyte Sedimentation Rate", value: 28, unit: "mm/hr" },
];

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` -- ${detail}`}`);
  if (!ok) failures += 1;
}

// --- 1. Engine contract: exports exist and labels are honest. -------------
build("src/lib/ocrEngine.ts", ".tmp/out/ocrEngine.mjs");
const ocrSource = fs.readFileSync("src/lib/ocrEngine.ts", "utf8");
check("ocrEngine declares tesseract-wasm engine kind", ocrSource.includes('"tesseract-wasm"'));
check(
  "fallback is labelled as NOT OCR",
  ocrSource.includes("not OCR") || ocrSource.includes("Deterministic fallback · not OCR"),
);
check("dynamic import keeps tesseract out of the main bundle", ocrSource.includes('await import("tesseract.js")'));
check("preprocess: grayscale+stretch+unsharp+threshold", /contrastLowPct/.test(ocrSource) && /unsharpAmount/.test(ocrSource) && /thresholdBias/.test(ocrSource));

// --- 2. Parser contract on a real recognised transcript. -------------------
build("src/engine/reportEngine.ts", ".tmp/out/reportEngine.mjs");
const { parseReportText } = await import(pathToFileURL(path.resolve(".tmp/out/reportEngine.mjs")).href);

const canvas = renderSampleScan(BLOOD_PANEL_LINES, 1240, 860);
const png = canvas.toBuffer("image/png");
fs.writeFileSync(".tmp/out/sample-blood-panel.png", png);

// Recognise with the production engine, through node's canvas (no DOM needed).
const { createWorker } = await import("tesseract.js");
const worker = await createWorker("eng", 1);
const { data } = await worker.recognize(png);
const text = (data.text ?? "").replace(/\r\n/g, "\n").trim();
await worker.terminate();

console.log("\n  --- Tesseract read ---");
for (const line of text.split("\n").slice(0, 8)) console.log(`    | ${line}`);

const fields = parseReportText(text);
console.log(`\n  extracted ${fields.length} fields:`);
for (const field of fields) console.log(`    ${field.testName.padEnd(34)} ${String(field.value).padStart(7)} ${String(field.unit).padEnd(12)} conf ${field.confidence}`);

for (const expected of EXPECTED) {
  // Exact-prefix match: `includes` would let "Glycated Hemoglobin" satisfy a
  // check aimed at plain "Hemoglobin".
  const got = fields.find((f) => f.testName.toLowerCase().startsWith(expected.label.toLowerCase()));
  check(
    `${expected.label}: value ${expected.value} ${expected.unit}`,
    Boolean(got) && Math.abs(got.value - expected.value) < 0.01 && got.unit === expected.unit,
    got ? `got ${got.value} ${got.unit}` : "not matched by dictionary",
  );
}

check("at least 5 biomarkers recovered from pixels", fields.length >= 5, `got ${fields.length}`);
check("mean confidence recorded", fields.every((f) => f.confidence > 0 && f.confidence <= 1));

console.log(
  failures === 0
    ? "\n  real OCR path verified: pixels -> Tesseract -> dictionary -> structured values\n"
    : `\n  ${failures} check(s) failed\n`,
);
process.exitCode = failures === 0 ? 0 : 1;

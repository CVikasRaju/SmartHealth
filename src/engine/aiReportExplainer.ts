/**
 * AI-Powered Medical Report Explanation & Clinical Synthesis Engine.
 *
 * Supports:
 *   - OpenRouter API (sk-or-v1-..., with free models like gemini-2.0-flash-exp:free, llama-3.3-70b:free, deepseek-r1:free, gpt-4o-mini)
 *   - Google Gemini API (AIzaSy..., gemini-1.5-flash / gemini-2.0-flash)
 *   - High-grade local clinical intelligence synthesizer (Zero setup / offline fallback)
 */

import type { ExtractedField, MedicalReport, Patient } from "@/types";

export const AI_API_KEY_STORAGE_KEY = "smartmedic.ai.api_key";
export const GEMINI_API_KEY_STORAGE_KEY = "smartmedic.gemini.api_key";

export type AiProvider = "openrouter" | "gemini" | "openai" | "local";

export interface OrganSystemInsight {
  system: string;
  name: string;
  status: "optimal" | "attention" | "concerning";
  statusLabel: string;
  score: number; // 0 - 100
  summary: string;
  testedBiomarkers: string[];
  findings: string[];
}

export interface AiReportAnalysis {
  executiveSummary: string;
  overallHealthStatus: "all_normal" | "mild_deviations" | "attention_needed";
  overallHealthHeadline: string;
  organSystems: OrganSystemInsight[];
  correlatedPatterns: string[];
  doctorQuestions: string[];
  lifestyleTips: string[];
  redFlags: string[];
  generatedAt: string;
  modelUsed: string;
}

/**
 * Detect AI Provider based on API key prefix.
 */
export function detectAiProvider(key: string): AiProvider {
  const trimmed = key.trim();
  if (!trimmed) return "local";
  if (trimmed.startsWith("sk-or-")) return "openrouter";
  if (trimmed.startsWith("AIzaSy") || trimmed.startsWith("AIza")) return "gemini";
  if (trimmed.startsWith("sk-")) return "openrouter"; // Default sk- keys to OpenRouter / OpenAI
  return "gemini";
}

/**
 * Retrieve the active AI API key from localStorage, Vite env, or process env.
 */
export function getStoredAiApiKey(): string {
  if (typeof window !== "undefined") {
    const fromStorage =
      window.localStorage.getItem(AI_API_KEY_STORAGE_KEY) ||
      window.localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY);
    if (fromStorage && fromStorage.trim().length > 0) {
      return fromStorage.trim();
    }
  }
  return (
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_OPENROUTER_API_KEY) ||
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_GEMINI_API_KEY) ||
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_OPENAI_API_KEY) ||
    (typeof process !== "undefined" && process.env?.OPENROUTER_API_KEY) ||
    (typeof process !== "undefined" && process.env?.GEMINI_API_KEY) ||
    ""
  ).trim();
}

/** Legacy alias for backwards compatibility */
export const getStoredGeminiApiKey = getStoredAiApiKey;

/**
 * Persist or clear the user's AI API key in browser storage.
 */
export function setStoredAiApiKey(key: string): void {
  if (typeof window !== "undefined") {
    const trimmed = key.trim();
    if (trimmed) {
      window.localStorage.setItem(AI_API_KEY_STORAGE_KEY, trimmed);
      window.localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, trimmed);
    } else {
      window.localStorage.removeItem(AI_API_KEY_STORAGE_KEY);
      window.localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
    }
  }
}

/** Legacy alias for backwards compatibility */
export const setStoredGeminiApiKey = setStoredAiApiKey;

/**
 * Generate a comprehensive clinical AI analysis for a medical report.
 */
export async function generateAiReportAnalysis(
  report: MedicalReport,
  patient?: Patient,
): Promise<AiReportAnalysis> {
  const apiKey = getStoredAiApiKey();
  const provider = detectAiProvider(apiKey);

  if (apiKey) {
    try {
      if (provider === "openrouter") {
        const liveResult = await callOpenRouterReportAnalysis(report, patient, apiKey);
        if (liveResult) return liveResult;
      } else {
        const liveResult = await callGeminiReportAnalysis(report, patient, apiKey);
        if (liveResult) return liveResult;
      }
    } catch (err) {
      console.warn(`${provider} API call failed, falling back to local clinical engine:`, err);
    }
  }

  // Fallback: Highly nuanced, deterministic local clinical synthesizer
  return synthesizeClinicalReportAnalysis(report, patient);
}

/**
 * Answers a free-form patient question about their medical report using AI.
 */
export const OPENROUTER_FREE_MODELS = [
  "google/gemini-2.0-flash-001",
  "google/gemini-2.0-flash-lite-preview-02-05:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "deepseek/deepseek-chat:free",
  "mistralai/mistral-small-24b-instruct-2501:free",
  "openrouter/auto",
  "google/gemini-2.0-flash-exp:free",
];

export async function askAiAboutReport(
  question: string,
  report: MedicalReport,
  patient?: Patient,
): Promise<string> {
  const apiKey = getStoredAiApiKey();
  const provider = detectAiProvider(apiKey);

  if (apiKey) {
    try {
      if (provider === "openrouter") {
        const answer = await callOpenRouterReportChat(question, report, patient, apiKey);
        if (answer) return answer;
      } else {
        const answer = await callGeminiReportChat(question, report, patient, apiKey);
        if (answer) return answer;
      }
    } catch (err) {
      console.warn(`${provider} Chat request failed:`, err);
      const errMsg = err instanceof Error ? err.message : String(err);
      const local = synthesizeLocalAnswer(question, report, patient);
      return `⚠️ **Live AI Connection Notice:** Could not complete request via ${provider === "openrouter" ? "OpenRouter" : "Gemini"} API (\`${errMsg}\`).\n\n*SmartMedic Built-in Clinical Intelligence Response:*\n\n${local}`;
    }
  }

  return synthesizeLocalAnswer(question, report, patient);
}

/* ------------------------------------------------------------------ */
/* OpenRouter API Integration with Multi-Model Failover                */
/* ------------------------------------------------------------------ */

async function callOpenRouterReportAnalysis(
  report: MedicalReport,
  patient: Patient | undefined,
  apiKey: string,
): Promise<AiReportAnalysis | null> {
  const fields = report.extractedFields ?? [];
  const systemPrompt = `You are an expert, compassionate clinical AI assistant explaining a patient's laboratory medical report.
Analyze the lab results and respond strictly in valid JSON matching this exact TypeScript structure without markdown fences:
{
  "executiveSummary": "2-3 paragraphs explaining the big picture of this lab report in warm, empathetic, clear everyday human language.",
  "overallHealthStatus": "all_normal" | "mild_deviations" | "attention_needed",
  "overallHealthHeadline": "Short uplifting or clear 1-line headline",
  "organSystems": [
    {
      "system": "glycemic" | "renal" | "hepatic" | "lipid" | "hematology" | "thyroid",
      "name": "Human-friendly System Name (e.g., Kidney Filtration & Hydration)",
      "status": "optimal" | "attention" | "concerning",
      "statusLabel": "Short badge text",
      "score": number between 30 and 98,
      "summary": "1-2 sentences on how this organ system is doing",
      "testedBiomarkers": ["List of test names"],
      "findings": ["Specific findings in plain words"]
    }
  ],
  "correlatedPatterns": ["Insights explaining how 2 or more tests relate to each other"],
  "doctorQuestions": ["3-5 clear, respectful questions the patient can ask their doctor"],
  "lifestyleTips": ["3-4 practical nutrition, hydration, and activity pointers"],
  "redFlags": ["Emergency symptoms to watch for if applicable, or empty list"]
}`;

  const userPrompt = `Patient: ${patient?.name ?? "Patient"} (${patient?.gender ?? "Adult"})
Report: ${report.fileName} (${report.reportCategory.replace("_", " ")})
Biomarkers:
${fields
  .map(
    (f) =>
      `- ${f.testName}: ${f.value} ${f.unit} (Standard Reference: ${f.referenceRange.text}, Status: ${f.status})`,
  )
  .join("\n")}`;

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
  let lastError = "";

  for (const modelName of OPENROUTER_FREE_MODELS) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": origin,
          "X-Title": "SmartMedic Health AI",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });

      if (resp.status === 401) {
        throw new Error("Invalid OpenRouter API Key (401 Unauthorized). Please check your key at openrouter.ai/keys.");
      }

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        lastError = `OpenRouter (${modelName}) HTTP ${resp.status}: ${errText || resp.statusText}`;
        continue; // Try next model candidate
      }

      const json = await resp.json();
      const rawText = json.choices?.[0]?.message?.content;
      if (!rawText) continue;

      const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned) as AiReportAnalysis;
      parsed.generatedAt = new Date().toISOString();
      parsed.modelUsed = `OpenRouter (${modelName})`;
      return parsed;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("401") || msg.includes("Invalid OpenRouter API Key")) {
        throw err;
      }
      lastError = msg;
    }
  }

  throw new Error(lastError || "All OpenRouter models failed to respond.");
}

async function callOpenRouterReportChat(
  question: string,
  report: MedicalReport,
  patient: Patient | undefined,
  apiKey: string,
): Promise<string | null> {
  const fields = report.extractedFields ?? [];
  const systemPrompt = `You are SmartMedic AI, a friendly, highly knowledgeable, and empathetic medical educator.
You are chatting with ${patient?.name ?? "a patient"} to answer their exact questions about their laboratory report.

PATIENT'S LAB REPORT DATA:
Document: ${report.fileName} (${report.reportCategory.replace("_", " ")})
Values:
${fields
  .map((f) => `- ${f.testName}: ${f.value} ${f.unit} (Normal: ${f.referenceRange.text}, Status: ${f.status})`)
  .join("\n")}

INSTRUCTIONS:
1. Answer the user's exact specific question directly and thoughtfully.
2. If they ask a general question (e.g. "what is food", "what is a liver enzyme", "how does fasting work"), explain the underlying physiological science clearly in everyday terms and link it to the biomarkers in their report.
3. If they ask about a specific biomarker (e.g. glucose, creatinine, SGPT, cholesterol), explain that specific value from their report, what it measures, and what everyday factors can influence it.
4. If they ask about diet or exercise, give tailored, safe, practical nutritional tips matching their results.
5. Keep the tone warm, conversational, human, and clear. Avoid robotic medical jargon.
6. Emphasize that this AI output is strictly for informational and educational purposes. Do not diagnose, prescribe, or suggest changing medications. Always remind the patient to review and verify all laboratory findings with their attending doctor or physician.`;

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
  let lastError = "";

  for (const modelName of OPENROUTER_FREE_MODELS) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": origin,
          "X-Title": "SmartMedic Health AI",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: question },
          ],
          temperature: 0.3,
        }),
      });

      if (resp.status === 401) {
        throw new Error("Invalid OpenRouter API Key (401 Unauthorized). Please check your key at openrouter.ai/keys.");
      }

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        lastError = `OpenRouter (${modelName}) HTTP ${resp.status}: ${errText || resp.statusText}`;
        continue;
      }

      const json = await resp.json();
      const content = json.choices?.[0]?.message?.content;
      if (content) return content;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("401") || msg.includes("Invalid OpenRouter API Key")) {
        throw err;
      }
      lastError = msg;
    }
  }

  throw new Error(lastError || "All OpenRouter models failed to respond.");
}

/* ------------------------------------------------------------------ */
/* Google Gemini REST API Integration                                 */
/* ------------------------------------------------------------------ */

async function callGeminiReportAnalysis(
  report: MedicalReport,
  patient: Patient | undefined,
  apiKey: string,
): Promise<AiReportAnalysis | null> {
  const fields = report.extractedFields ?? [];
  const prompt = `You are an expert, compassionate clinical AI assistant explaining a patient's laboratory medical report.
Analyze the following patient lab results:
Patient Name: ${patient?.name ?? "Patient"}
Age/Gender: ${patient ? patient.gender : "Adult"}
Report Category: ${report.reportCategory}
Biomarkers Tested:
${fields
  .map(
    (f) =>
      `- ${f.testName}: ${f.value} ${f.unit} (Standard Reference: ${f.referenceRange.text}, Status: ${f.status})`,
  )
  .join("\n")}

Respond strictly in valid JSON matching this exact TypeScript structure:
{
  "executiveSummary": "2-3 paragraphs explaining the big picture of this lab report in warm, empathetic, clear everyday human language. Never sound robotic.",
  "overallHealthStatus": "all_normal" | "mild_deviations" | "attention_needed",
  "overallHealthHeadline": "Short uplifting or clear 1-line headline summarizing findings",
  "organSystems": [
    {
      "system": "glycemic" | "renal" | "hepatic" | "lipid" | "hematology" | "thyroid",
      "name": "Human-friendly System Name (e.g., Kidney Filtration & Hydration)",
      "status": "optimal" | "attention" | "concerning",
      "statusLabel": "Short badge text",
      "score": number between 30 and 98,
      "summary": "1-2 sentences on how this organ system is doing",
      "testedBiomarkers": ["List of test names"],
      "findings": ["Specific findings in plain words"]
    }
  ],
  "correlatedPatterns": ["Insights explaining how 2 or more tests relate to each other"],
  "doctorQuestions": ["3-5 clear, respectful questions the patient can ask their doctor"],
  "lifestyleTips": ["3-4 practical nutrition, hydration, and activity pointers"],
  "redFlags": ["Emergency symptoms to watch for if applicable, or empty list"]
}

Important: Do NOT include markdown code fences (\`\`\`json). Output raw JSON only. Do not diagnose diseases; frame as educational guidance.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Gemini API error (${resp.status}): ${errText || resp.statusText}`);
  }

  const json = await resp.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  const parsed = JSON.parse(text) as AiReportAnalysis;
  parsed.generatedAt = new Date().toISOString();
  parsed.modelUsed = "Google Gemini 1.5 Flash (Live AI)";
  return parsed;
}

async function callGeminiReportChat(
  question: string,
  report: MedicalReport,
  patient: Patient | undefined,
  apiKey: string,
): Promise<string | null> {
  const fields = report.extractedFields ?? [];
  const prompt = `You are SmartMedic AI, a friendly, highly knowledgeable, and empathetic medical educator.
You are chatting with ${patient?.name ?? "a patient"} to explain their laboratory report.

PATIENT'S LAB REPORT DATA:
Document: ${report.fileName} (${report.reportCategory.replace("_", " ")})
Values:
${fields
  .map((f) => `- ${f.testName}: ${f.value} ${f.unit} (Normal: ${f.referenceRange.text}, Status: ${f.status})`)
  .join("\n")}

USER'S MESSAGE: "${question}"

INSTRUCTIONS:
1. If the user says a greeting (like 'hello', 'hi', 'hey'), greet them warmly by name (${patient?.name ?? "there"}), briefly mention what report you have open, and ask what specific test, diet, or lifestyle question they'd like help with.
2. If they ask about a specific biomarker (e.g. glucose, creatinine, SGPT, cholesterol), explain that specific value from their report, what it measures, and what everyday factors can influence it.
3. If they ask about diet or exercise, give tailored, safe, practical nutritional tips matching their results.
4. Keep the tone warm, conversational, human, and clear. Avoid robotic medical jargon.
5. Emphasize that this AI output is strictly for informational and educational purposes. Do not diagnose, prescribe, or suggest changing medications. Always remind the patient to review and verify all laboratory findings with their attending doctor or physician.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Gemini Chat error (${resp.status}): ${errText || resp.statusText}`);
  }

  const json = await resp.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

/* ------------------------------------------------------------------ */
/* Local Clinical Synthesizer Engine (Deterministic Baseline)          */
/* ------------------------------------------------------------------ */

export function synthesizeClinicalReportAnalysis(
  report: MedicalReport,
  patient?: Patient,
): AiReportAnalysis {
  const fields = report.extractedFields ?? [];
  const abnormal = fields.filter((f) => f.status !== "normal");
  const critical = fields.filter(
    (f) => f.status === "critical_low" || f.status === "critical_high",
  );

  const byCategory = new Map<string, ExtractedField[]>();
  for (const f of fields) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }

  const organSystems: OrganSystemInsight[] = [];
  const correlatedPatterns: string[] = [];
  const doctorQuestions: string[] = [];
  const lifestyleTips: string[] = [];
  const redFlags: string[] = [];

  // 1. Glycemic & Metabolic Health
  const glycemic = byCategory.get("glycemic") ?? [];
  if (glycemic.length > 0) {
    const fbs = glycemic.find((f) => f.normalizedKey === "fbs");
    const ppbs = glycemic.find((f) => f.normalizedKey === "ppbs");
    const hba1c = glycemic.find((f) => f.normalizedKey === "hba1c");
    const out = glycemic.filter((f) => f.status !== "normal");

    let status: "optimal" | "attention" | "concerning" = "optimal";
    let score = 95;
    const findings: string[] = [];

    if (out.length > 0) {
      status = out.some((f) => f.status === "critical_high" || f.status === "critical_low")
        ? "concerning"
        : "attention";
      score = status === "concerning" ? 45 : 70;
    }

    if (fbs && fbs.status === "elevated") {
      findings.push(
        `Fasting glucose is elevated at ${fbs.value} ${fbs.unit} (standard range: ${fbs.referenceRange.text}), showing the body retains more sugar than typical overnight.`,
      );
    }
    if (ppbs && ppbs.status === "elevated") {
      findings.push(
        `Post-meal glucose is higher than reference at ${ppbs.value} ${ppbs.unit}, indicating slower post-prandial carbohydrate clearance.`,
      );
    }
    if (hba1c && hba1c.status === "elevated") {
      findings.push(
        `HbA1c of ${hba1c.value}% reflects that average circulating blood sugar over the preceding 60–90 days has trended above target thresholds.`,
      );
    }
    if (findings.length === 0) {
      findings.push(
        `All tested blood sugar markers (${glycemic.map((f) => f.testName).join(", ")}) are well-balanced within normal reference ranges.`,
      );
    }

    if ((fbs && fbs.status === "elevated") || (hba1c && hba1c.status === "elevated")) {
      correlatedPatterns.push(
        "Metabolic Glycemic Elevation: Both resting glucose and long-term glycated hemoglobin markers demonstrate an active pattern of elevated sugar retention.",
      );
      doctorQuestions.push(
        "Given my current blood glucose and HbA1c values, do you recommend an updated glycemic control strategy or a formal dietary consultation?",
      );
      lifestyleTips.push(
        "Focus on complex carbohydrates with high dietary fiber (whole grains, lentils, green vegetables) and steady 30-minute daily post-meal brisk walks to enhance insulin sensitivity.",
      );
    }

    organSystems.push({
      system: "glycemic",
      name: "Metabolic & Blood Glucose Regulation",
      status,
      statusLabel: status === "optimal" ? "Healthy Control" : status === "attention" ? "Mild Elevation" : "Requires Attention",
      score,
      summary:
        status === "optimal"
          ? "Your metabolic and blood sugar regulation is operating smoothly within healthy physiological parameters."
          : "Your body is managing blood sugar with some elevated strain, suggesting benefit from dietary adjustments and medical review.",
      testedBiomarkers: glycemic.map((f) => f.testName),
      findings,
    });
  }

  // 2. Renal (Kidney) Health
  const renal = byCategory.get("renal") ?? [];
  if (renal.length > 0) {
    const creat = renal.find((f) => f.normalizedKey === "creatinine" || f.normalizedKey === "serum_creatinine");
    const urea = renal.find((f) => f.normalizedKey === "bun" || f.normalizedKey === "blood_urea");
    const uric = renal.find((f) => f.normalizedKey === "uric_acid");
    const out = renal.filter((f) => f.status !== "normal");

    let status: "optimal" | "attention" | "concerning" = "optimal";
    let score = 95;
    const findings: string[] = [];

    if (out.length > 0) {
      status = out.some((f) => f.status === "critical_high" || f.status === "critical_low")
        ? "concerning"
        : "attention";
      score = status === "concerning" ? 40 : 68;
    }

    if (creat && creat.status === "elevated") {
      findings.push(
        `Serum Creatinine is ${creat.value} ${creat.unit} (normal: ${creat.referenceRange.text}), suggesting the kidneys may be filtering blood wastes at a reduced clearance rate or reflecting recent dehydration/heavy exertion.`,
      );
      doctorQuestions.push(
        "My creatinine level is elevated — should we test eGFR or urine microalbumin to assess baseline filtration, and what is my optimal daily fluid intake?",
      );
      lifestyleTips.push(
        "Ensure consistent hydration (2 to 2.5 liters of water daily unless restricted by your doctor) and avoid unnecessary OTC NSAID painkillers (like ibuprofen) which can strain kidneys.",
      );
    }
    if (urea && urea.status === "elevated") {
      findings.push(
        `Blood Urea Nitrogen (BUN) is elevated at ${urea.value} ${urea.unit}, which often correlates with protein breakdown or reduced fluid volume.`,
      );
    }
    if (uric && uric.status === "elevated") {
      findings.push(
        `Uric Acid is elevated at ${uric.value} ${uric.unit}, which can predispose to joint stiffness or crystallisation if prolonged.`,
      );
      lifestyleTips.push(
        "Moderate consumption of high-purine foods (red meats, shellfish, sugary soft drinks) to help lower circulating uric acid.",
      );
    }
    if (findings.length === 0) {
      findings.push("Kidney filtration markers are healthy, indicating efficient waste elimination.");
    }

    if (creat && creat.status === "elevated" && urea && urea.status === "elevated") {
      correlatedPatterns.push(
        "Prerenal/Renal Clearance Correlation: Both Creatinine and Urea are elevated in tandem, warranting review of hydration status and kidney function.",
      );
    }

    organSystems.push({
      system: "renal",
      name: "Kidney Filtration & Renal Function",
      status,
      statusLabel: status === "optimal" ? "Optimal Filtration" : status === "attention" ? "Moderate Strain" : "Decreased Clearance",
      score,
      summary:
        status === "optimal"
          ? "Kidneys are filtering metabolic byproducts effectively and fluid balance markers are intact."
          : "Filtration markers show mild elevation; your doctor can assess if this is hydration-related or requires renal protection.",
      testedBiomarkers: renal.map((f) => f.testName),
      findings,
    });
  }

  // 3. Hepatic (Liver) Function
  const hepatic = byCategory.get("hepatic") ?? [];
  if (hepatic.length > 0) {
    const alt = hepatic.find((f) => f.normalizedKey === "sgpt" || f.normalizedKey === "alt");
    const ast = hepatic.find((f) => f.normalizedKey === "sgot" || f.normalizedKey === "ast");
    const out = hepatic.filter((f) => f.status !== "normal");

    let status: "optimal" | "attention" | "concerning" = "optimal";
    let score = 95;
    const findings: string[] = [];

    if (out.length > 0) {
      status = out.some((f) => f.status === "critical_high") ? "concerning" : "attention";
      score = status === "concerning" ? 50 : 72;
    }

    if (alt && alt.status === "elevated") {
      findings.push(
        `SGPT / ALT is elevated at ${alt.value} ${alt.unit} (normal: ${alt.referenceRange.text}), pointing to mild liver cell irritation, fatty deposition, or medication processing.`,
      );
    }
    if (ast && ast.status === "elevated") {
      findings.push(
        `SGOT / AST is elevated at ${ast.value} ${ast.unit}, an enzyme found in liver and muscle tissues that rises with cellular turnover.`,
      );
    }
    if (findings.length === 0) {
      findings.push("Liver enzymes and biliary clearance markers sit in the ideal reference zone.");
    }

    if ((alt && alt.status === "elevated") || (ast && ast.status === "elevated")) {
      correlatedPatterns.push(
        "Transaminase Enzyme Rise: Liver enzyme markers suggest mild hepatic metabolic irritation, frequently seen with fatty liver changes, alcohol, or medications.",
      );
      doctorQuestions.push(
        "Are my liver enzyme elevations consistent with fatty liver or any current medications, and would an ultrasound scan be helpful?",
      );
      lifestyleTips.push(
        "Minimize alcohol intake, reduce saturated fats and refined sugars, and incorporate antioxidant-rich foods like leafy greens and berries.",
      );
    }

    organSystems.push({
      system: "hepatic",
      name: "Liver Function & Detoxification",
      status,
      statusLabel: status === "optimal" ? "Normal Liver Health" : status === "attention" ? "Enzyme Elevation" : "Active Irritation",
      score,
      summary:
        status === "optimal"
          ? "Liver enzyme levels are normal, indicating healthy detoxification and metabolic clearance."
          : "Liver enzymes are slightly elevated, indicating that your liver is working harder under metabolic or dietary strain.",
      testedBiomarkers: hepatic.map((f) => f.testName),
      findings,
    });
  }

  // 4. Lipid & Cardiovascular Health
  const lipid = byCategory.get("lipid") ?? [];
  if (lipid.length > 0) {
    const tc = lipid.find((f) => f.normalizedKey === "total_cholesterol" || f.normalizedKey === "cholesterol");
    const ldl = lipid.find((f) => f.normalizedKey === "ldl");
    const hdl = lipid.find((f) => f.normalizedKey === "hdl");
    const tg = lipid.find((f) => f.normalizedKey === "triglycerides");
    const out = lipid.filter((f) => f.status !== "normal");

    let status: "optimal" | "attention" | "concerning" = "optimal";
    let score = 95;
    const findings: string[] = [];

    if (out.length > 0) {
      status = out.some((f) => f.status === "critical_high") ? "concerning" : "attention";
      score = status === "concerning" ? 50 : 70;
    }

    if (tc && tc.status === "elevated") findings.push(`Total Cholesterol is ${tc.value} ${tc.unit} (normal: ${tc.referenceRange.text}).`);
    if (ldl && ldl.status === "elevated") findings.push(`LDL ("bad") cholesterol is ${ldl.value} ${ldl.unit}, indicating elevated arterial lipid carriage.`);
    if (hdl && hdl.status === "low") findings.push(`HDL ("protective") cholesterol is ${hdl.value} ${hdl.unit}, below optimal cardiovascular protective thresholds.`);
    if (tg && tg.status === "elevated") findings.push(`Triglycerides are ${tg.value} ${tg.unit}, showing higher levels of circulating storage fats.`);
    if (findings.length === 0) findings.push("Lipid profile is well-balanced with healthy protective cholesterol ratios.");

    if ((ldl && ldl.status === "elevated") || (tg && tg.status === "elevated")) {
      correlatedPatterns.push(
        "Lipid Imbalance (Dyslipidemia): Elevation in circulating LDL and/or Triglycerides points to cardiovascular risk factors that respond well to dietary and aerobic routine changes.",
      );
      doctorQuestions.push(
        "Based on my lipid profile and cardiovascular risk score, is lifestyle management sufficient or should we discuss lipid-lowering therapy?",
      );
      lifestyleTips.push(
        "Increase soluble fiber (oats, flaxseeds, legumes) and replace trans/saturated fats with healthy monounsaturated fats (olive oil, nuts, seeds).",
      );
    }

    organSystems.push({
      system: "lipid",
      name: "Cardiovascular & Lipid Health",
      status,
      statusLabel: status === "optimal" ? "Cardio-Protective" : status === "attention" ? "Moderate Dyslipidemia" : "Cardiovascular Attention",
      score,
      summary:
        status === "optimal"
          ? "Your lipid profile is in good balance, supporting long-term cardiovascular and arterial health."
          : "Elevated lipid numbers indicate a need to review dietary fats and discuss cardiovascular prevention strategies.",
      testedBiomarkers: lipid.map((f) => f.testName),
      findings,
    });
  }

  // 5. Hematology (Blood Counts)
  const hematology = byCategory.get("hematology") ?? [];
  if (hematology.length > 0) {
    const hb = hematology.find((f) => f.normalizedKey === "hemoglobin" || f.normalizedKey === "hb");
    const wbc = hematology.find((f) => f.normalizedKey === "wbc" || f.normalizedKey === "tlc");
    const plt = hematology.find((f) => f.normalizedKey === "platelets" || f.normalizedKey === "plt");
    const out = hematology.filter((f) => f.status !== "normal");

    let status: "optimal" | "attention" | "concerning" = "optimal";
    let score = 95;
    const findings: string[] = [];

    if (out.length > 0) {
      status = out.some((f) => f.status === "critical_high" || f.status === "critical_low")
        ? "concerning"
        : "attention";
      score = status === "concerning" ? 45 : 72;
    }

    if (hb && hb.status === "low") {
      findings.push(
        `Hemoglobin is ${hb.value} ${hb.unit} (normal: ${hb.referenceRange.text}), pointing to decreased oxygen-carrying red blood cells (anemia).`,
      );
      doctorQuestions.push(
        "My hemoglobin is on the lower side — do you recommend testing serum ferritin/iron studies, B12, or folic acid?",
      );
      lifestyleTips.push(
        "Include iron-rich foods (spinach, beetroot, pomegranate, lentils, eggs) paired with vitamin C (citrus fruits) to optimize iron absorption.",
      );
    }
    if (wbc && wbc.status === "elevated") {
      findings.push(
        `White Blood Cell count is ${wbc.value} ${wbc.unit}, showing active immune mobilization in response to inflammation or recent infection.`,
      );
    }
    if (plt && (plt.status === "low" || plt.status === "critical_low")) {
      findings.push(
        `Platelet count is ${plt.value} ${plt.unit}, which may affect blood clotting capacity if significantly depressed.`,
      );
      redFlags.push("Unusual bruising, prolonged gum bleeding, or petechiae (small red pinpoint skin spots).");
    }
    if (findings.length === 0) {
      findings.push("Complete blood counts are balanced, indicating robust oxygen capacity and immune stability.");
    }

    organSystems.push({
      system: "hematology",
      name: "Blood Counts & Immune Vitality (CBC)",
      status,
      statusLabel: status === "optimal" ? "Robust Blood Vitality" : status === "attention" ? "Mild Anemia / Reactivity" : "Hematologic Deviation",
      score,
      summary:
        status === "optimal"
          ? "Red blood cells, white blood cells, and platelets are all within healthy physiological margins."
          : "Blood cell counts show variations that should be correlated with your overall energy, recent infections, or nutrition.",
      testedBiomarkers: hematology.map((f) => f.testName),
      findings,
    });
  }

  // 6. Thyroid Health
  const thyroid = byCategory.get("thyroid") ?? [];
  if (thyroid.length > 0) {
    const tsh = thyroid.find((f) => f.normalizedKey === "tsh");
    const out = thyroid.filter((f) => f.status !== "normal");

    let status: "optimal" | "attention" | "concerning" = "optimal";
    let score = 95;
    const findings: string[] = [];

    if (out.length > 0) {
      status = "attention";
      score = 70;
    }

    if (tsh && tsh.status === "elevated") {
      findings.push(
        `TSH is elevated at ${tsh.value} ${tsh.unit} (normal: ${tsh.referenceRange.text}), suggesting the pituitary is stimulating a sluggish thyroid (hypothyroid trend).`,
      );
      doctorQuestions.push(
        "My TSH is elevated — would you suggest checking Free T3 and Free T4 or Anti-TPO antibodies to evaluate thyroid hormone output?",
      );
    } else if (tsh && tsh.status === "low") {
      findings.push(
        `TSH is suppressed at ${tsh.value} ${tsh.unit}, which can reflect hyperactive thyroid hormone levels.`,
      );
    } else {
      findings.push("Thyroid stimulating hormone is in standard balance.");
    }

    organSystems.push({
      system: "thyroid",
      name: "Thyroid & Metabolic Pace",
      status,
      statusLabel: status === "optimal" ? "Euthyroid (Normal)" : "Thyroid Regulation Shift",
      score,
      summary:
        status === "optimal"
          ? "Thyroid hormone signaling is well-regulated, supporting normal metabolic rate."
          : "Thyroid regulation shows mild deviation; your doctor can evaluate if symptoms like fatigue, weight shifts, or temperature intolerance are present.",
      testedBiomarkers: thyroid.map((f) => f.testName),
      findings,
    });
  }

  // Default questions if none added
  if (doctorQuestions.length === 0) {
    doctorQuestions.push(
      "Are all these lab results consistent with my ongoing wellness goals and current medication regimen?",
      "When do you recommend our next routine check-up panel?",
    );
  }

  if (lifestyleTips.length === 0) {
    lifestyleTips.push(
      "Maintain consistent daily hydration (at least 8 glasses of water daily).",
      "Engage in 150 minutes of moderate aerobic physical activity weekly (e.g. brisk walking, cycling, swimming).",
      "Aim for 7–8 hours of restorative, uninterrupted sleep to support cellular recovery and immune resilience.",
    );
  }

  // Overall Headline & Summary
  let overallHealthStatus: "all_normal" | "mild_deviations" | "attention_needed" = "all_normal";
  let overallHealthHeadline = "✨ All tested biomarkers sit comfortably in healthy reference ranges!";
  let executiveSummary = "";

  const patientName = patient?.name ? `${patient.name}'s` : "This";

  if (critical.length > 0) {
    overallHealthStatus = "attention_needed";
    overallHealthHeadline = `⚠️ ${critical.length} biomarker${critical.length === 1 ? "" : "s"} show significant variation requiring clinical discussion.`;
    executiveSummary = `${patientName} laboratory panel evaluates ${fields.length} key physiological markers across ${organSystems.length} bodily systems. While several baseline systems are operating normally, ${abnormal.length} markers sit outside standard adult reference ranges, with ${critical.length} requiring prompt review with your doctor. A personalized consultation with your physician will provide the clinical context for these numbers.`;
  } else if (abnormal.length > 0) {
    overallHealthStatus = "mild_deviations";
    overallHealthHeadline = `🔍 ${abnormal.length} of ${fields.length} biomarkers show mild variations to review with your doctor.`;
    executiveSummary = `${patientName} laboratory panel provides a reassuring look across ${organSystems.length} bodily systems. ${fields.length - abnormal.length} of your ${fields.length} tested markers are well within standard target zones. ${abnormal.length} markers demonstrate mild deviations from typical population averages. In clinical practice, mild out-of-range readings are very frequent and are best interpreted alongside your daily routine, diet, and symptoms.`;
  } else {
    executiveSummary = `Excellent report! Across all ${fields.length} analyzed parameters for ${patient?.name ?? "you"}, your values sit comfortably within standard laboratory reference ranges. Your organ systems — including metabolism, kidney filtration, liver clearance, and blood counts — show healthy physiological balance.`;
  }

  return {
    executiveSummary,
    overallHealthStatus,
    overallHealthHeadline,
    organSystems,
    correlatedPatterns,
    doctorQuestions,
    lifestyleTips,
    redFlags,
    generatedAt: new Date().toISOString(),
    modelUsed: "SmartMedic Clinical Intelligence Synthesizer v2.4 (Local)",
  };
}

/* ------------------------------------------------------------------ */
/* Conversational Local Fallback Assistant                            */
/* ------------------------------------------------------------------ */

function synthesizeLocalAnswer(
  question: string,
  report: MedicalReport,
  patient?: Patient,
): string {
  const q = question.toLowerCase().trim();
  const fields = report.extractedFields ?? [];
  const abnormal = fields.filter((f) => f.status !== "normal");
  const pName = patient?.name ? patient.name.split(" ")[0] : "there";

  // 1. Greetings & Pleasantries
  if (
    q === "hello" ||
    q === "hi" ||
    q === "hey" ||
    q.startsWith("hello") ||
    q.startsWith("hi ") ||
    q.startsWith("hey ") ||
    q.includes("good morning") ||
    q.includes("good afternoon") ||
    q.includes("good evening") ||
    q.includes("who are you") ||
    q.includes("what can you do")
  ) {
    return `Hello ${pName}! 👋 I'm your SmartMedic AI Health Assistant.\n\nI have reviewed your **${report.fileName}** (${report.reportCategory.replace("_", " ")} panel with ${fields.length} biomarkers).\n\nFeel free to ask me anything about your results, such as:\n• *"What does my Fasting Blood Sugar or HbA1c mean?"*\n• *"Why is my Creatinine or Liver SGPT elevated?"*\n• *"What foods should I eat or avoid?"*\n• *"What questions should I ask my doctor?"*\n\nHow can I help you understand your report today?`;
  }

  // 2. Specific Biomarker Inquiries
  const matchedField = fields.find((f) => {
    const name = f.testName.toLowerCase();
    const alias = (f.matchedAlias || "").toLowerCase();
    const key = f.normalizedKey.toLowerCase();
    return q.includes(key) || q.includes(name) || (alias.length > 2 && q.includes(alias));
  });

  if (matchedField) {
    const isOutOf = matchedField.status !== "normal";
    return `Here is what your report shows for **${matchedField.testName}**:\n\n• **Your Result:** **${matchedField.value} ${matchedField.unit}**\n• **Healthy Reference Range:** ${matchedField.referenceRange.text} ${matchedField.unit}\n• **Status:** ${isOutOf ? "⚠️ " + matchedField.status.replace("_", " ").toUpperCase() : "✅ WITHIN NORMAL RANGE"}\n\n**What this test measures:**\n${matchedField.plainLanguageExplanation}\n\n${
      isOutOf
        ? `Since this value sits outside typical population boundaries, you can ask your doctor: *"What factors might be contributing to my ${matchedField.testName} of ${matchedField.value}, and do we need a follow-up re-test?"*`
        : `This reading is in a healthy physiological zone!`
    }`;
  }

  // 3. Fasting Blood Sugar / Glucose / Diabetes
  if (q.includes("sugar") || q.includes("glucose") || q.includes("diabetes") || q.includes("fbs") || q.includes("hba1c")) {
    const fbs = fields.find((f) => f.normalizedKey === "fbs");
    const hba1c = fields.find((f) => f.normalizedKey === "hba1c");
    let text = `### Blood Sugar & Metabolic Health in Your Report\n\n`;
    if (fbs) text += `• **Fasting Blood Sugar (FBS):** ${fbs.value} ${fbs.unit} (Normal: ${fbs.referenceRange.text})\n`;
    if (hba1c) text += `• **HbA1c (3-Month Average):** ${hba1c.value} % (Normal: ${hba1c.referenceRange.text})\n\n`;
    text += `**What it means:** Fasting blood sugar shows how your body balances resting glucose, while HbA1c reflects your average sugar levels over the past 60–90 days.\n\n**Daily Tips:** Focus on high-fiber whole grains (oats, brown rice, millets), lentils, and fresh greens. Taking a 15-minute brisk walk after meals significantly assists glucose uptake.`;
    return text;
  }

  // 4. Kidney / Renal / Creatinine / Urea
  if (q.includes("kidney") || q.includes("creatinine") || q.includes("urea") || q.includes("bun") || q.includes("egfr") || q.includes("renal")) {
    const creat = fields.find((f) => f.normalizedKey === "creatinine" || f.normalizedKey === "serum_creatinine");
    const egfr = fields.find((f) => f.normalizedKey === "egfr");
    let text = `### Kidney Filtration in Your Report\n\n`;
    if (creat) text += `• **Serum Creatinine:** ${creat.value} ${creat.unit} (Normal: ${creat.referenceRange.text})\n`;
    if (egfr) text += `• **Estimated GFR:** ${egfr.value} ${egfr.unit}\n\n`;
    text += `**What it means:** Creatinine is a natural waste byproduct from muscle metabolism that healthy kidneys filter into urine. Temporary rises can happen with dehydration, heavy physical exercise, or reduced clearance.\n\n**Recommendation:** Maintain steady daily hydration (2 to 2.5L water) and discuss with your doctor whether any adjustments to fluids or medications are advised.`;
    return text;
  }

  // 5. Liver / Hepatic / SGPT / SGOT / Bilirubin
  if (q.includes("liver") || q.includes("sgpt") || q.includes("sgot") || q.includes("alt") || q.includes("ast") || q.includes("hepatic")) {
    const alt = fields.find((f) => f.normalizedKey === "sgpt" || f.normalizedKey === "alt");
    const ast = fields.find((f) => f.normalizedKey === "sgot" || f.normalizedKey === "ast");
    let text = `### Liver Function in Your Report\n\n`;
    if (alt) text += `• **SGPT / ALT:** ${alt.value} ${alt.unit} (Normal: ${alt.referenceRange.text})\n`;
    if (ast) text += `• **SGOT / AST:** ${ast.value} ${ast.unit} (Normal: ${ast.referenceRange.text})\n\n`;
    text += `**What it means:** ALT and AST are liver cellular enzymes. Mild elevations commonly occur with fatty liver changes, alcohol, heavy meals, or routine medications processing.\n\n**Recommendation:** Minimize alcohol, reduce deep-fried oily foods, and emphasize colorful vegetables and lean protein.`;
    return text;
  }

  // 6. Cholesterol / Lipids / Heart
  if (q.includes("cholesterol") || q.includes("lipid") || q.includes("triglyceride") || q.includes("ldl") || q.includes("hdl") || q.includes("heart")) {
    const tc = fields.find((f) => f.normalizedKey === "total_cholesterol" || f.normalizedKey === "cholesterol");
    const ldl = fields.find((f) => f.normalizedKey === "ldl");
    const hdl = fields.find((f) => f.normalizedKey === "hdl");
    const tg = fields.find((f) => f.normalizedKey === "triglycerides");
    let text = `### Lipid & Heart Profile in Your Report\n\n`;
    if (tc) text += `• **Total Cholesterol:** ${tc.value} ${tc.unit} (Normal: ${tc.referenceRange.text})\n`;
    if (ldl) text += `• **LDL ("Bad" Cholesterol):** ${ldl.value} ${ldl.unit}\n`;
    if (hdl) text += `• **HDL ("Protective" Cholesterol):** ${hdl.value} ${hdl.unit}\n`;
    if (tg) text += `• **Triglycerides:** ${tg.value} ${tg.unit}\n\n`;
    text += `**What it means:** Your lipid profile reflects circulating fats in your bloodstream. High LDL or Triglycerides can deposit in arteries over time, while HDL helps remove excess cholesterol.\n\n**Actionable Tips:** Add soluble fiber (flaxseeds, beans, apples) and replace saturated butter/palm oil with olive or mustard oil.`;
    return text;
  }

  // 7. Diet / Foods / Nutrition vs Definitions
  if (
    q === "what is food" ||
    q.startsWith("what is food") ||
    q.startsWith("define food") ||
    q.includes("meaning of food") ||
    q.includes("what is nutrition")
  ) {
    return `### What Is Food & How It Relates to Your Lab Results\n\n**Food** refers to any nourishing substance containing essential macronutrients (**carbohydrates, proteins, fats**) and micronutrients (**vitamins, minerals, water**) that your body absorbs and metabolizes to produce energy, build tissues, and sustain vital life functions.\n\nIn relation to your **${report.fileName}**:\n• **Carbohydrates:** Converted to glucose; directly impacts your Fasting Blood Sugar and HbA1c.\n• **Fats & Lipids:** Fuel cellular membranes and hormone production; reflected in Total Cholesterol, LDL, and Triglycerides.\n• **Proteins & Nitrogen:** Essential for muscle repair; filtered by your kidneys and reflected in Serum Creatinine and Blood Urea.\n\n*Would you like specific dietary recommendations tailored to your lab numbers?*`;
  }

  if (
    q.includes("what should i eat") ||
    q.includes("what to eat") ||
    q.includes("diet plan") ||
    q.includes("foods to avoid") ||
    q.includes("what foods") ||
    q.includes("meal plan") ||
    q.includes("nutrition tips") ||
    q.includes("healthy food")
  ) {
    return `### Nutrition Guidance Based on Your Lab Results\n\nBased on your **${fields.length} biomarkers** (${abnormal.length} markers for discussion):\n\n1. **Whole Foods First:** Emphasize leafy greens, seasonal vegetables, legumes, and whole grains.\n2. **Hydration:** Aim for 2 to 2.5 liters of clean water daily to assist renal waste filtration.\n3. **Refined Sugars:** Minimize soda, sweets, packaged juices, and refined white flour pastries.\n4. **Healthy Fats:** Choose handfuls of almonds, walnuts, and healthy cooking oils over trans-fat deep-fried snacks.\n\n*Be sure to share your dietary goals with your doctor or clinical dietitian for a personalized meal plan.*`;
  }

  // 8. Exercise / Workout / Gym
  if (q.includes("exercise") || q.includes("walk") || q.includes("gym") || q.includes("workout") || q.includes("run") || q.includes("cardio")) {
    return `### Physical Activity Recommendations\n\n• **Brisk Walking:** 30 minutes of brisk walking 5 days a week helps muscles clear circulating glucose and raises protective HDL cholesterol.\n• **Post-Meal Steps:** Taking 1,000–1,500 steps (10–15 minutes) after lunch and dinner helps smooth glucose spikes.\n• **Strength Training:** Light resistance training 2 times a week supports metabolic rate.\n\n*If you ever experience chest pain, dizziness, or shortness of breath, pause and consult your physician.*`;
  }

  // 9. Worried / Serious / Normal
  if (q.includes("worry") || q.includes("serious") || q.includes("scared") || q.includes("danger") || q.includes("panic")) {
    if (abnormal.length === 0) {
      return `Rest assured! All ${fields.length} biomarkers tested in this report are in the standard healthy zone. There are no abnormal markers found. Keep maintaining your healthy routine!`;
    }
    return `There is no reason to panic. Out of ${fields.length} biomarkers tested, ${abnormal.length} show mild variations outside reference limits.\n\nLab ranges represent statistical 95% population averages. Mild variations frequently occur due to recent hydration, sleep, stress, meals, or medications. These numbers provide a helpful guide for your doctor to fine-tune your wellness plan during your next visit.`;
  }

  // 10. Doctor Questions
  if (q.includes("doctor") || q.includes("ask") || q.includes("appointment") || q.includes("consult")) {
    return `### Top Questions to Ask Your Doctor\n\n1. *"How do these lab results compare with my previous health history?"*\n2. *"For the markers that are slightly outside reference ranges (${abnormal.slice(0, 3).map((f) => f.testName).join(", ") || "none"}), what lifestyle or dietary changes do you recommend first?"*\n3. *"When would you like me to schedule a follow-up re-test?"*`;
  }

  // 11. Prescriptions / Medications
  if (q.includes("medicine") || q.includes("tablet") || q.includes("drug") || q.includes("pill") || q.includes("prescribe")) {
    return `As an AI medical educator, I cannot prescribe, recommend, or alter any medications. All medication decisions, dosages, and prescriptions must be made directly by your attending physician who knows your complete medical history.`;
  }

  // 12. General Conversational Response
  return `Regarding your question: "${question}"\n\nIn this ${report.fileName} report, we have **${fields.length} biomarkers** analyzed (**${fields.length - abnormal.length} within normal target**, **${abnormal.length} for discussion**).\n\nIf you have a specific biomarker in mind (like Blood Sugar, Creatinine, Liver enzymes, or Cholesterol) or want food/exercise guidance, please let me know!\n\n*Note: AI interpretations are for informational understanding only. Always review your laboratory report with your doctor.*`;
}

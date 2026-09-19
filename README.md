# SmartMedic · Clinical Operations & Shortage Intelligence Platform

> **A unified healthcare operations platform that connects regional multi-hospital governance, predictive medicine shortage intelligence, clinical workflows, and an AI-powered medical report simplifier.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.4-646cff.svg)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38bdf8.svg)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20RLS-3ecf8e.svg)](https://supabase.com/)
[![Tests](https://img.shields.io/badge/Tests-59%2F59%20Passed-brightgreen.svg)]()

---

## 🏥 Executive Overview

Modern healthcare systems suffer from two chronic bottlenecks:
1. **Critical Drug Stockouts**: Traditional ERPs rely on static reorder points that fail during sudden demand surges or supplier lead-time slippages, leading to preventable treatment interruptions.
2. **Clinical Data Silos & Patient Jargon**: Doctors spend precious minutes navigating fragmented systems, while patients receive lab reports filled with frightening medical jargon without clear explanations.

**SmartMedic** solves both by pairing an **EWMA-based Shortage Probability Engine (SPS)** with **7 tailored, zero-trust role portals** and a **live AI Medical Report Simplifier** powered by Gemini 2.5 and OpenRouter.

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             SmartMedic Architecture                              │
└──────────────────────────────────────────────────────────────────────────────────┘
                                       │
     ┌─────────────────────────────────┴─────────────────────────────────┐
     ▼                                                                   ▼
┌──────────────────────────────────────────────┐ ┌──────────────────────────────────────────────┐
│       Clinical & Operational Portals         │ │      Shortage Intelligence & AI Engine       │
├──────────────────────────────────────────────┤ ├──────────────────────────────────────────────┤
│ 1. Super Admin (Regional Network Governance) │ │ • Shortage Probability Score (SPS Engine)    │
│ 2. Hospital Admin (Shortage Control Room)    │ │ • Triangulated 4-Leg Supply Forecasting      │
│ 3. Doctor (CPOE Prescribing & Stock Guards)  │ │ • Inter-Ward Redistribution Optimizer        │
│ 4. Nurse (Bedside eMAR Rounds & Vitals)      │ │ • Disaster & Surge Scenario Sandbox          │
│ 5. Receptionist (OPD Triage & Registration)  │ │ • Tesseract OCR + Biomarker Extraction Layer │
│ 6. Cashier (Itemized Invoicing & POS Desk)   │ │ • Live Gemini 2.5 / OpenRouter Patient AI    │
│ 7. Patient (Plain-Language Health Records)   │ │ • Zero-PHI Security & Scoped API Handlers    │
└──────────────────────────────────────────────┘ └──────────────────────────────────────────────┘
```

---

## 🌟 Key Subsystems & Features

### 1. 🔮 Predictive Shortage Intelligence Engine
- **Shortage Probability Score (SPS)**: Evaluates the entire hospital formulary continuously using a 4-leg triangulated formula:
  $$\text{SPS} = \min\left(100, \max\left(0, \left[1 - \frac{\text{DIR}}{\text{LT}_{\text{dynamic}} + \text{SS}_{\text{days}}}\right] \times 100 + \Psi\right)\right)$$
- **EWMA Consumption Velocity**: Adapts to real-time burn velocity ($\alpha = 0.35$) rather than stale monthly averages.
- **Stranded Stock Recovery**: Detects unallocated stock sitting above ward par levels and automatically generates **approvable inter-ward redistributions** to avert critical stockouts without new procurement costs.
- **Crisis Scenario Sandbox**: Stress-tests hospital supplies against sudden epidemics (+300% respiratory demand), distributor defaults, and cold-chain losses without mutating production stock.
- **Backtested Invariants**: **100% recall** across 365-day backtest simulations covering 11 critical stockout events.

### 2. 🤖 AI Medical Report Simplifier & Patient Portal
- **Direct LLM Integration**: Connects directly to **Google Gemini 2.5 Flash** and **OpenRouter** with user-customizable API keys stored securely in browser storage.
- **Tesseract WASM OCR & Dictionary Matcher**: Automatically extracts values, units, and collection timestamps from uploaded lab reports and matches them against 100+ clinical biomarkers.
- **Empathetic, Humanized Plain-Language Summaries**: Explains complex lab parameters (e.g., HbA1c, Creatinine, Lipid Panels) in clear, compassionate, and non-alarmist language.
- **Context-Aware Medical AI Chat**: Patients can ask natural follow-up questions about exercise, nutrition, medications, and dosage timings with strict medical safety guardrails.
- **Longitudinal Trendlines**: Visualizes biomarker trajectory over time with normal reference bands and positive direction-of-travel feedback.
- **Medication Timers & 24x7 Helpline**: Clear morning/night dose schedules and 1-click doctor query messaging.

### 3. 🛡️ Regional Multi-Hospital Governance (Super Admin)
- **Multi-Facility Supervision**: Monitors network-wide bed capacity, occupancy, and shortage risks across regional hospital clusters (e.g., 5 Mangalore facilities, 3,500 active beds).
- **Zero-PHI Isolation Architecture**: Platform governors can manage hospital infrastructure and supply resilience while being **mathematically and cryptographically blocked** from viewing any patient health records (PHI), vitals, or lab reports.

### 4. 🩺 Clinical & Administrative Operations
- **Doctor CPOE Console**: Prescribe medications with **real-time stock depletion guards** and **allergy cross-checking** (e.g., automatically flags penicillin anaphylaxis for Augmentin and suggests in-stock Cefuroxime alternatives).
- **Nurse Bedside eMAR**: Chart medication administrations, log variances (hold/refusal), record vital signs, and track ward stock vs par levels.
- **Receptionist Front Desk**: Register new patients, generate MRNs, assign Emergency Severity Index (ESI) triage acuity, and manage OPD doctor queues.
- **Cashier Billing & POS**: Auto-populate billable items directly from charted clinical treatments, accept multi-mode payments (Cash, UPI, Card, Insurance), and reconcile daily ledgers.

---

## 🚀 Live Demo & Quick Start

### ⚡ Option 1: 1-Click Evaluation Mode (Zero Configuration)
The project includes a built-in in-memory backend pre-seeded with realistic clinical data, allowing judges and evaluators to test all 7 roles without signing up or configuring credentials:

```bash
# 1. Clone and install dependencies
git clone https://github.com/your-username/smartmedic.git
cd smartmedic
npm install

# 2. Start the unified development stack
npm run dev:stack
```

👉 Open **`http://localhost:5173`** in your browser. The login screen provides **1-Click Role Access** for every persona.

### 🗄️ Option 2: Full PostgreSQL + Supabase Backend
To connect with a real PostgreSQL database, Row Level Security (RLS), and cryptographic authentication:

```bash
# 1. Copy environment variables
cp .env.example .env

# 2. Add your Supabase project URL and service keys in .env
# (See supabase/migrations/0001_init.sql for the complete relational schema)

# 3. Seed the database
npm run seed

# 4. Start the stack
npm run dev:stack
```

---

## 👥 Pre-Seeded Evaluator Accounts

All demo accounts share the password: **`SmartMedic@2026`**

| Role | Email | Scope & Responsibilities |
|---|---|---|
| **Super Admin** | `superadmin@smartmedic.io` | Regional hospital network management, zero-PHI audit |
| **Hospital Admin** | `meera.krishnan@smartmedic.io` | Shortage control room, inter-ward transfers, crisis sandbox |
| **Doctor** | `dr.sharma@smartmedic.io` | OPD queue, CPOE prescribing, allergy guards, report review |
| **Nurse** | `fatima.sheikh@smartmedic.io` | ICU & Ward bedside eMAR, vitals capture, ward inventory |
| **Receptionist** | `kavya.nair@smartmedic.io` | Patient registration, appointment triage, queue management |
| **Cashier** | `arjun.deshpande@smartmedic.io` | POS checkout, itemized hospital billing, reconciliation |
| **Patient** | `priya.sharma@example.com` | AI report simplifier, longitudinal trends, dosage schedule |

---

## ⏱️ 5-Minute Evaluator Walkthrough

1. **Shortage Detection (Admin)**: Sign in as **Hospital Admin**. Inspect **Augmentin 625** sitting at *Critical Risk* (SPS 98, 4.2 days of cover). Click *Show Evidence* to inspect the 4-leg breakdown and consumption curves.
2. **Rebalance Stock (Admin)**: Navigate to *Inter-ward redistribution* and click **Approve** on the top proposal to rebalance stock from General Ward to ICU. Watch the risk score drop instantly.
3. **Safe Prescribing (Doctor)**: Switch to **Doctor**. Select patient **Aarav Menon** and try prescribing Augmentin. The system immediately halts the order with a **Penicillin Anaphylaxis Alert** and recommends in-stock Cefuroxime.
4. **Bedside eMAR (Nurse)**: Switch to **Nurse**. Open the *eMAR Round*, chart an overdue dose, capture pre-administration vitals, and log a variance.
5. **AI Report Simplifier (Patient)**: Sign in as **Priya Sharma** (Patient). Open her latest metabolic panel. See complex biomarkers explained in plain terms, inspect the interactive **AI Medical Chat Assistant**, and ask questions about diet and exercise.

---

## ☁️ Vercel Deployment & Serverless Architecture

SmartMedic is designed for unified zero-config deployment on **Vercel**, serving both the optimized static frontend and the authoritative TypeScript backend from a single repository:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Vercel Deployment                               │
├──────────────────────────────────────┬──────────────────────────────────────┤
│          Frontend (Static SPA)       │         Backend (Serverless API)     │
│   • Built with Vite into `dist/`     │   • Catch-all route: `api/[...path]` │
│   • Global Edge CDN delivery         │   • Node.js Serverless Execution     │
│   • SPA route rewrites via index.html│   • Token verification & RBAC check  │
│   • Security headers (CSP, nosniff)  │   • Postgres RLS or Seeded In-Memory │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 1. Unified `vercel.json` Routing
Vercel automatically detects the Vite build and routes all traffic seamlessly:
- **Client Routes**: All non-API routes (`/((?!api/).*)`) rewrite to `/index.html` for client-side React Router navigation.
- **Serverless API Routes**: Requests to `/api/*` are directly handled by the serverless function in `api/[...path].ts`.
- **Hardened Security Headers**: Injects `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`.

### 2. 1-Click Vercel Deployment

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. Import this repository into Vercel.
2. The `vercel.json` configuration automatically sets:
   - **Framework**: `vite`
   - **Build Command**: `npm run build` (`tsc --noEmit && vite build`)
   - **Output Directory**: `dist`
   - **Install Command**: `npm ci`
3. **Plug-and-Play Demo Mode**: If you deploy **without any environment variables**, SmartMedic automatically initializes in **High-Fidelity Demonstration Mode** (serving the pre-seeded in-memory database with full RBAC and 1-Click evaluator sign-ins).
4. **Production Postgres Mode**: Add your Supabase credentials in Vercel **Project Settings → Environment Variables**:
   - `SUPABASE_URL` & `SUPABASE_ANON_KEY` (Server runtime)
   - `SUPABASE_SERVICE_ROLE_KEY` (Server secret — never exposed to client)
   - `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY` (Compiled into client bundle)

---

## 🔒 Security, Privacy & Architecture Principles

- **Backend Authority**: Clinical dispensing, stock decrements, and billing calculations are performed server-side in `api/` serverless routes. The client never directly mutates database stock.
- **Zero-PHI Isolation**: Super admins and platform infrastructure staff have zero database permissions to query patient health records.
- **Scoped Patient Queries**: Patient accounts are strictly locked to their own ID at the API layer; requests attempting to query other patients are rejected with `403 Forbidden`.
- **Immutable Audit Trail**: Every sensitive action (prescribing, transfer approval, dosage administration) is written to an append-only audit ledger with cryptographic timestamps.

---

## 🛠️ Tech Stack & Tooling

- **Frontend**: React 18, TypeScript, Tailwind CSS, Heroicons / Lucide SVG icons.
- **Data & Charts**: Handcrafted SVG charting engine (Line charts, sparklines, gauges, donut meters).
- **AI & OCR**: Google Gemini API (`@google/genai`), OpenRouter SDK, Tesseract.js (WASM).
- **Backend**: TypeScript serverless API (`api/`), Node.js runtime, PostgreSQL on Supabase.
- **Quality & Verification**: Complete unit and regression test suite (`npm run verify`).

```bash
# Run all verification suites
npm run verify        # Runs API tests, store reducer tests, and shortage backtests
npm run build         # Strict TypeScript check + Vite production bundle
```

---

## 📄 Licensing & Prototype Notice

*Demonstration Instance: Developed for clinical operations research, disaster resilience demonstration, and hackathon evaluation. Uses synthetic healthcare records in accordance with HIPAA/GDPR simulated privacy standards.*

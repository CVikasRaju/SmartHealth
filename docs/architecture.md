# Architecture

SmartMedic is designed as a modular service-oriented monolith that isolates heavy computational workloads (OCR processing and shortage probability forecasting) from low-latency transactional clinical routes[cite: 2, 18].

## High-Level Topology

```text
                     [ React 18 Frontend Client ]
                                  │
                                  │ HTTPS / WebSocket
                                  ▼
                     [ Nginx Reverse Proxy / SSL ]
                                  │
                                  ▼
                   [ Express API Server / Router ]
                                  │
      ┌───────────────────────────┼───────────────────────────┐
      ▼                           ▼                           ▼
[Operations Module]   [Shortage Intelligence]    [Report Simplifier Module]
- Patients / Triage   - EWMA Consumption Model   - File Upload / Multer
- CPOE Prescriptions  - Lead-Time Anomaly        - OCR Parsing Pipeline
- Bedside eMAR Logs   - Inter-Ward Balancer      - Biomarker Normalization
- Cashier POS Invoices- Scenario Sandbox         - Longitudinal Trend Engine
      │                           │                           │
      └───────────────────────────┼───────────────────────────┘
                                  │
                     ┌────────────┴────────────┐
                     ▼                         ▼
            [ MongoDB Replica Set ]    [ Redis 7 + BullMQ ]
            - Core Schemas             - Queue: Shortage Jobs
            - Lab Report Documents     - Queue: Async OCR Jobs
            - Financial Transactions   - Pub/Sub: Live Alerts
```

## Subsystems

### 1. Operations Subsystem
- **Triage & Reception**: Outpatient check-in, priority categorization, room assignment[cite: 2, 17].
- **Doctor CPOE & Consultation**: Diagnostic coding (ICD-10) with inline inventory availability guards[cite: 2, 16].
- **Bedside Nursing (eMAR)**: Real-time logging of drug administrations, vital checks, and clinical notes[cite: 2, 16, 17].
- **Revenue Cycle Management (RCM)**: Itemized invoice generation, insurance claim parsing, and POS payment tracking[cite: 2, 15, 16].

### 2. Predictive Shortage Intelligence Subsystem
- Ingests routine consumption velocity ($D_t$), supplier replenishment delays ($LT_{dynamic}$), and regional distributor buffers[cite: 2, 6].
- Computes Shortage Probability Scores ($SPS$) across 7-day and 30-day horizons[cite: 6, 14].
- Suggests automated inter-ward linear redistributions, emergency supplier purchase orders, and therapeutic equivalent alternatives[cite: 2, 6, 14].

### 3. Medical Report Simplifier Subsystem
- **Multi-Format Ingestion**: Ingests clinical lab reports (PDF, PNG, JPG) via secure multipart streaming[cite: 11].
- **Text & Field Extraction (OCR)**: Extracts test titles (e.g., Fasting Blood Sugar, Creatinine), numerical values, reference units, and specimen collection dates[cite: 16].
- **Normalization & Reference Mapping**: Maps raw biomarker strings to clinical standard dictionaries without clinical speculation or diagnostic assertion[cite: 16].
- **Plain-Language Explanations**: Converts clinical terminology into readable summaries explaining the biological function of the biomarker[cite: 16].
- **Longitudinal Trend Engine**: Groups historical test values for the same patient over time to render historical comparison charts[cite: 16].
- **Export & Disclaimer**: Produces printable/exportable patient reports that include non-diagnostic medical disclaimers[cite: 16].

## Security & Compliance

- JWT authentication with 15-minute access tokens and encrypted HTTP-only refresh cookies[cite: 2].
- Granular Role-Based Access Control (RBAC) enforced across all endpoints[cite: 17, 18].
- HIPAA/GDPR Compliance: AES-256 database encryption at rest, TLS 1.3 in transit, and immutable audit logs on all mutation endpoints[cite: 2, 4, 18].
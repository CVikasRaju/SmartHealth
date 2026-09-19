# SmartMedic

An enterprise-grade hospital organization platform coupling intelligent medicine shortage detection, multi-role hospital operations, and an **AI-Powered Medical Report Simplifier** for clinical and patient transparency[cite: 2, 11].

## Overview

SmartMedic unifies acute clinical administration, regional pharmaceutical supply defense, and diagnostic patient accessibility into a single system[cite: 2, 11]:
- **Predictive Medicine Shortage Engine**: Ingests indirect clinical consumption signals, replenishment lead times, and regional constraints to forecast pharmaceutical disruptions 14 to 45 days in advance[cite: 2, 14].
- **Medical Report Simplifier**: Ingests complex lab reports (PDF/scans), extracts tests, values, and units via OCR, and generates structured, plain-language explanations with longitudinal biomarker tracking and medical disclaimers[cite: 16].
- **Centralized Hospital Operations**: End-to-end administration of patient triage, appointment schedules, physician prescriptions (CPOE), bedside nursing administration (eMAR), and cashier point-of-sale invoicing[cite: 2, 11, 16, 17].
- **Fine-Grained RBAC**: Isolated role portals for Admins, Doctors, Nurses, Receptionists, and Cashiers[cite: 11, 17].

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React.js (v18), TypeScript, Material-UI (MUI v5), Redux Toolkit[cite: 2, 11] |
| Backend | Node.js (LTS), Express.js (Controller-Service-Repository)[cite: 11, 12] |
| Database & Caching | MongoDB 6.0+ (Mongoose ODM), Redis 7.0[cite: 2, 11] |
| Background Jobs | BullMQ (6-hour shortage cron & async OCR parsing)[cite: 2, 14] |
| Report OCR & Parsing | Tesseract.js / AWS Textract, PDF-Parse[cite: 11] |
| Auth & Security | JWT, OAuth 2.0, Helmet, Strict RBAC Middleware[cite: 2, 11, 13] |
| DevOps & Monitoring | Docker, Docker Compose, Nginx, Prometheus, Grafana, ELK Stack[cite: 2, 11, 13] |

## Quick Start

```bash
git clone [https://github.com/your-org/smartmedic.git](https://github.com/your-org/smartmedic.git)
cd smartmedic

cd backend && npm install
cd ../frontend && npm install

cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

cd backend && npm run dev
# In a separate terminal:
cd frontend && npm start
```

## Project Structure

```text
smartmedic/
├── frontend/                     # React 18, MUI v5, Redux Toolkit
│   ├── src/
│   │   ├── components/report/    # OCR report uploader & longitudinal charts
│   │   ├── pages/                # Admin, Doctor, Nurse, Cashier, Receptionist views
│   │   └── store/                # RTK slices (auth, shortage, reports, clinical)
├── backend/                      # Express API Gateway
│   ├── src/
│   │   ├── controllers/          # HTTP request handlers
│   │   ├── services/             # Shortage math, OCR extraction, billing
│   │   ├── models/               # Mongoose schemas (Patients, Reports, Inventory)
│   │   └── jobs/                 # BullMQ asynchronous workers
├── docker/                       # Multi-stage Dockerfiles & compose manifests
└── docs/                         # Technical architecture and specs
```

See `docs/architecture.md` for the comprehensive system design[cite: 11].
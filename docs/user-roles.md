# User Roles and Permissions

SmartMedic enforces strict Role-Based Access Control (RBAC) across administrative, clinical, pharmaceutical, and diagnostic reporting functions[cite: 17, 18].

## Comprehensive Permission Matrix

| Feature / Action | Admin | Doctor | Nurse | Receptionist | Cashier | Patient (Portal) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Manage Users, Roles, & System Config[cite: 17] | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View Shortage Intel & Scenario Sandbox[cite: 2, 17] | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Patient Records: Read[cite: 17] | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (Self Only) |
| Patient Records: Create / Update[cite: 17] | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Prescribe Treatments & CPOE Orders[cite: 17] | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bedside Medication Admin & Vitals (eMAR)[cite: 2, 17] | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Schedule & Reschedule Appointments[cite: 17] | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ (Self Book) |
| Invoicing & POS Payment Collection[cite: 17] | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Inventory & Batch Stock Management[cite: 17] | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Upload Medical Reports (PDF/Scans) | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ (Self Upload) |
| View Plain-Language Report Simplifier | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ (Self Only) |
| View Longitudinal Biomarker Trends | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ (Self Only) |
| Export Report Summary with Disclaimer[cite: 16] | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ (Self Only) |

## Role Descriptions

### Admin
Full operational and system oversight[cite: 17]. Configures hospital departments, manages user accounts, reviews system-wide shortage risks, and accesses immutable audit logs[cite: 17, 18].

### Doctor
Primary clinical authority[cite: 17]. Reviews medical records, orders lab evaluations, inspects simplified report biomarker trends, and writes computerized prescriptions safeguarded by real-time inventory checks[cite: 2, 16, 17].

### Nurse
Direct ward and bedside healthcare provider[cite: 17]. Administers medications, records vitals pre- and post-administration, updates bedside eMAR sheets, and assists in uploading diagnostic lab results[cite: 2, 16, 17].

### Receptionist
Front-of-house coordinator[cite: 17]. Registers new patients, schedules outpatient clinic appointments, manages queue check-ins, and uploads initial outside medical lab reports[cite: 16, 17].

### Cashier
Financial administrator[cite: 17]. Generates itemized invoices from clinical encounters, procedures, and pharmacy dispensations, processes payments, and reconciles billing accounts[cite: 2, 16, 17].

### Patient (Outpatient Portal)
Authenticated patient viewer. Can securely upload lab reports, view simplified non-diagnostic summaries with historical trendlines, download exportable PDFs, and review appointment records[cite: 16].
# Medicine Shortage Detection

## 1. Dynamic Signal Ingestion

The Shortage Intelligence Engine runs every 6 hours as an asynchronous BullMQ worker[cite: 2, 14]. It evaluates routine clinical transactions rather than waiting for manual supply reports[cite: 2, 14].

| Input Signal | Clinical Origin | Description |
|---|---|---|
| Consumption Velocity ($D_t$) | Doctor Prescriptions & Nurse eMAR[cite: 2] | Moving average daily usage weighted for acute demand surges[cite: 2, 14]. |
| Replenishment Slippage | Supplier Invoices & PO Logs[cite: 2] | Deviation from contracted delivery lead time[cite: 6, 14]. |
| Local Shelf Buffer | Pharmacy Dispensations[cite: 2] | Net unreserved stock currently available on ward shelves[cite: 6, 14]. |
| Regional Pressure | External Distributor Alerts[cite: 2] | Neighboring hospital shortages and district supplier quotas[cite: 2, 14]. |

---

## 2. Mathematical Formulation

### 2.1. Dynamic Consumption Rate ($D_t$)
Rather than an unweighted mean, SmartMedic calculates the Exponentially Weighted Moving Average (EWMA) to catch acute infection waves:
$$D_t = \alpha \cdot C_t + (1 - \alpha) \cdot D_{t-1}$$[cite: 6]
Where $\alpha = 0.35$ and $C_t$ is the actual consumption count on day $t$[cite: 6].

### 2.2. Days of Inventory Remaining ($DIR$)
$$DIR = \frac{S_{physical} - S_{allocated}}{D_t}$$[cite: 6]

### 2.3. Dynamic Lead Time ($LT_{dynamic}$)
$$LT_{dynamic} = LT_{contracted} \times \left(1 + \frac{\sigma_{lead}}{\mu_{lead}}\right) \times R_{vendor}$$[cite: 6]
Where $R_{vendor}$ is the vendor reliability penalty index ($1.0$ to $1.8$)[cite: 6].

### 2.4. Shortage Risk Score ($SPS$)
$$SPS = \min\left(100, \; \max\left(0, \; \left[1 - \frac{DIR}{LT_{dynamic} + SS_{days}}\right] \times 100 + \Psi_{signals}\right)\right)$$[cite: 6]
Where $SS_{days}$ is mandatory safety stock and $\Psi_{signals}$ is the regional risk factor[cite: 6].

---

## 3. Intervention Playbook & Actions

| Score ($SPS$) | Risk Tier | Automated Workflow Triggered |
|---|---|---|
| **$\ge 85$** | **Critical** | Push alerts to Admins & Doctors; suggest therapeutic alternatives in CPOE; queue inter-ward transfer[cite: 2, 6, 14]. |
| **60 – 84** | **High** | Automatic PO draft sent to secondary vendor; restrict non-urgent outpatient dispensations[cite: 6, 14]. |
| **30 – 59** | **Moderate** | Flagged on Pharmacist dashboard; automated delivery status ping sent to supplier[cite: 6, 14]. |
| **$< 30$** | **Normal** | Standard scheduled replenishment cycle[cite: 6, 14]. |

---

## 4. Clinical CPOE Cross-Check Integration

When a physician creates a prescription, the CPOE service validates the item's live $DIR$:
- If $DIR < 3.0$ days, the screen displays a non-blocking warning recommending a substitute[cite: 2].
- If an item is stocked out, the physician is automatically presented with in-stock therapeutic equivalents with matching bio-availability[cite: 2].
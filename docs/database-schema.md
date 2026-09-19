# Database Schema

SmartMedic uses MongoDB with strict Mongoose schematization, optimized compound indexes, and multi-document ACID transaction guarantees[cite: 2, 15].

---

## 1. `medical_reports` (New Simplifier Collection)

```json
{
  "_id": "ObjectId",
  "patientId": "ObjectId → patients (indexed)",
  "uploadedBy": "ObjectId → users",
  "fileName": "string",
  "fileUrl": "string",
  "fileMimeType": "string",
  "fileSizeBytes": "number",
  "reportCategory": "string",
  "reportDate": "ISODate",
  "ocrExtractionStatus": "pending | processing | completed | failed",
  "rawOcrText": "string",
  "extractedFields": [
    {
      "testName": "string",
      "normalizedKey": "string (e.g. fbs, hba1c, creatinine)",
      "value": "number",
      "valueText": "string",
      "unit": "string",
      "referenceRange": {
        "min": "number",
        "max": "number",
        "text": "string"
      },
      "status": "normal | low | elevated | critical",
      "plainLanguageExplanation": "string"
    }
  ],
  "medicalDisclaimer": "string",
  "doctorNotes": "string",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

## 2. `users`

```json
{
  "_id": "ObjectId",
  "employeeId": "string (unique, indexed)",
  "fullName": "string",
  "email": "string (unique, indexed)",
  "passwordHash": "string",
  "role": "admin | doctor | nurse | receptionist | cashier",
  "department": "string",
  "contactNumber": "string",
  "isActive": "boolean",
  "lastLogin": "ISODate",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

## 3. `patients`

```json
{
  "_id": "ObjectId",
  "mrn": "string (unique, indexed)",
  "name": "string (indexed)",
  "dob": "ISODate",
  "gender": "male | female | other",
  "bloodGroup": "string",
  "contact": "string",
  "allergies": [
    {
      "allergen": "string",
      "severity": "mild | moderate | severe"
    }
  ],
  "emergencyContact": {
    "name": "string",
    "relation": "string",
    "contact": "string"
  },
  "currentAdmission": {
    "isAdmitted": "boolean",
    "ward": "string",
    "bedNumber": "string"
  },
  "registeredAt": "ISODate"
}
```

## 4. `inventory`

```json
{
  "_id": "ObjectId",
  "sku": "string (unique, indexed)",
  "genericName": "string (indexed)",
  "brandName": "string",
  "category": "antibiotic | analgesic | cardiovascular | emergency | consumable",
  "form": "tablet | injection | iv_fluid | syrup",
  "currentStock": "number",
  "allocatedStock": "number",
  "reorderThreshold": "number",
  "economicOrderQuantity": "number",
  "avgDailyConsumption": "number",
  "daysOfInventoryRemaining": "number",
  "shortageRiskScore": "number (0-100)",
  "supplier": {
    "name": "string",
    "leadTimeDays": "number",
    "reliabilityScore": "number"
  },
  "updatedAt": "ISODate"
}
```

## 5. `treatments` (Clinical Consultations & Prescriptions)

```json
{
  "_id": "ObjectId",
  "patientId": "ObjectId → patients (indexed)",
  "doctorId": "ObjectId → users (indexed)",
  "diagnosis": "string",
  "icd10Code": "string",
  "prescriptions": [
    {
      "medicineId": "ObjectId → inventory",
      "drugName": "string",
      "dosage": "string",
      "frequency": "string",
      "durationDays": "number",
      "dispenseStatus": "pending | dispensed | substituted"
    }
  ],
  "linkedReportIds": ["ObjectId → medical_reports"],
  "notes": "string",
  "createdAt": "ISODate"
}
```

## 6. `invoices`

```json
{
  "_id": "ObjectId",
  "invoiceNumber": "string (unique, indexed)",
  "patientId": "ObjectId → patients (indexed)",
  "cashierId": "ObjectId → users",
  "items": [
    {
      "itemType": "consultation | medication | procedure | diagnostic_report",
      "description": "string",
      "quantity": "number",
      "unitPrice": "number",
      "subtotal": "number"
    }
  ],
  "totalAmount": "number",
  "paymentStatus": "unpaid | partially_paid | paid | refunded",
  "transactions": [
    {
      "paymentMethod": "cash | credit_card | debit_card | upi | insurance_claim",
      "amountPaid": "number",
      "transactionReference": "string",
      "processedAt": "ISODate"
    }
  ],
  "createdAt": "ISODate"
}
```
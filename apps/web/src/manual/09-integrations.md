# Integrations & API

For IT teams connecting a system that sends meter readings — BMS, utility portal export, IoT platform, data logger. Clients are created under Setup → Integrations & API (super admin).

## The exchange

```flow
> 1. Get a token | POST /api/v1/oauth/token with grant_type=client_credentials, client_id and client_secret → access token, valid 1 hour
> 2. Send readings | POST /api/v1/meter-readings with "Authorization: Bearer <token>" and up to 100,000 readings
> 3. Read the answer | readings stored, corrected, unchanged, refused (with index and reason), and the monthly entries created or updated per meter
> 4. Repeat | as often as readings are produced — hourly, daily, weekly or monthly (at most 120 calls a minute)
```

## A reading

| Field | Required | Meaning |
|---|---|---|
| meterId | yes | the meter's id in the sending system, as set on the meter |
| timestamp | yes | time of the reading — for consumption per period, the **end** of the period. ISO 8601 with a zone (`2026-03-01T00:00:00+04:00` or `…Z`); without a zone it is read in the company time zone |
| value | yes | register reading, or consumption for the period, in the meter's unit before its multiplier |
| start | no | for consumption per period: the start of the period (otherwise: previous hour / day / week / month) |

Example:

    POST /api/v1/meter-readings
    Authorization: Bearer <access token>
    Content-Type: application/json

    { "readings": [
      { "meterId": "BMS-DC-MAIN", "timestamp": "2026-03-01T01:00:00+04:00", "value": 512.4 },
      { "meterId": "DEWA-2001458876", "timestamp": "2026-04-01T00:00:00+04:00", "value": 45500, "start": "2026-03-01T00:00:00+04:00" }
    ] }

`GET /api/v1/meters` lists the company's meters with their ids, units and last reading.

## Rules

- The same meter and timestamp sent again **replaces** the earlier value — send corrections the same way.
- Each reading is checked on its own; refused readings are listed, the others are stored.
- Approved monthly entries are never changed; the difference is reported in the answer.
- Keep the client secret in the sending system's secret store. If it may have leaked, revoke the client and create a new one.

## Purchase lines from an ERP

The client needs the **Purchase lines** permission (tick it when creating the client). Send the lines of a period under one reference, in as many calls as needed, then complete it:

    POST /api/v1/purchases
    { "reference": "SAP-2026-03", "currency": "AED", "facility": "BEEAH Headquarters",
      "lines": [ { "date": "2026-03-10", "description": "Copier paper A4", "amount": 4250,
                   "supplier": "Gulf Stationery LLC", "category": "Office supplies", "glAccount": "Office expenses",
                   "poNumber": "4500123", "quantity": 50, "unit": "box" } ] }

    POST /api/v1/purchases/SAP-2026-03/complete      (or "complete": true on the last call)
    GET  /api/v1/purchases/SAP-2026-03               status and counts

| Field | Required | Meaning |
|---|---|---|
| description | yes | what was bought |
| amount | yes, unless quantity + supplier factor | what was paid; negative for a credit note |
| date | yes | yyyy-mm-dd |
| currency | no | 3 letters; default the call's, else the company currency |
| facility | per line or per call | facility name |
| supplier, category, glAccount, poNumber | no | help mapping and checking |
| quantity, unit, supplierEf, supplierEfUnit | no | for a supplier's own factor (kg CO₂e per unit) |
| capital | no | true for capitalised purchases (Scope 3.2) |

At most 10,000 lines per call and 200,000 per reference. A completed reference is closed; corrections go under a new one. The batch is then reviewed and published under Capture → Purchases.

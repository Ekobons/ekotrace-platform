# Integrations & API

For IT teams connecting a system that sends meter readings — BMS, utility portal export, IoT platform, data logger. Clients are created under Setup → Integrations & batch runs → Integrations & API (super admin).

## The exchange

```flow
> 1. Get a token | POST /api/v1/oauth/token with grant_type=client_credentials, client_id and client_secret → access token, valid 1 hour
> 2. Send readings | POST /api/v1/meter-readings with "Authorization: Bearer <token>" and up to 100,000 readings
> 3. Read the answer | the batch id and what it holds: new readings, corrections, duplicates, conflicts with booked bills, refused (with index and reason)
> 4. Review in Ekotrace | the batch waits under Add data → the category → Meter readings; a manager previews it and publishes (or discards) it; then the monthly entries are created or updated
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
      { "meterId": "ELEC-2001458876", "timestamp": "2026-04-01T00:00:00+01:00", "value": 45500, "start": "2026-03-01T00:00:00+01:00" }
    ] }

`GET /api/v1/meters` lists the company's meters with their ids, units and last reading.

## Rules

- The same meter and timestamp sent again **replaces** the earlier value — send corrections the same way.
- Each reading is checked on its own; refused readings are listed (an impossible date such as 31 September is refused, not moved to October).
- By default readings wait for review in a batch; readings already received, or already waiting in an earlier batch, are skipped as duplicates. A super admin can switch review off: readings are then stored at once and the answer lists what was stored, corrected or unchanged, and the entries created or updated.
- Approved monthly entries are never changed; the difference is reported in the answer.
- Keep the client secret in the sending system's secret store. If it may have leaked, revoke the client and create a new one.

## Purchase lines from an ERP

The client needs the **Purchase lines** permission (tick it when creating the client). Send the lines of a period under one reference, in as many calls as needed, then complete it:

    POST /api/v1/purchases
    { "reference": "SAP-2026-03", "currency": "EUR", "facility": "Head office",
      "lines": [ { "date": "2026-03-10", "description": "Copier paper A4", "amount": 4250,
                   "supplier": "Office Supplies Ltd", "supplierRef": "V100231", "supplierCountry": "DE", "category": "Office supplies", "glAccount": "Office expenses",
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
| supplierRef, supplierCountry | no | the ERP vendor number and the supplier's country (2 letters or name): link lines to the right supplier and fill its profile |
| quantity, unit, supplierEf, supplierEfUnit | no | for a supplier's own factor (kg CO₂e per unit) |
| capital | no | true for capitalised purchases (Scope 3.2) |

At most 10,000 lines per call and 200,000 per reference. A completed reference is closed; corrections go under a new one. The batch is then reviewed and published under Add data → Purchases (Batches).

**Control totals (reconciliation).** Send the source's own count and totals with the batch, on any call or on `complete`:

    "control": { "lines": 1250, "amounts": { "AED": 4778973.97, "USD": 21673.23 } }

Batch runs then compares them with what arrived and flags any difference.

**Every call is logged.** Each call to the API by a client, successful or not, appears under Setup → Integrations & batch runs → **Batch runs → Transfers** with the records received, accepted and refused (and why). A failed call tells the super admins and admins at most once an hour per client. Set how often each system is expected to send; when it goes quiet for longer, they are told once.

## AI

Setup → Integrations, AI & batch runs → **AI** (super admin). The company connects the AI service it has approved and decides when it may run. Nothing is sent to any AI until it is switched on here.

| Service | What is needed |
|---|---|
| Claude (Anthropic) | an API key from console.anthropic.com; model, e.g. claude-haiku-4-5-20251001 (fast, low cost) or claude-sonnet-5-5 |
| ChatGPT (OpenAI) | an API key from platform.openai.com and the model name |
| Gemini (Google) | an API key from Google AI Studio and the model name |
| Azure OpenAI | the chat-completions address of your deployment and its key — data stays in your Azure region |
| Other (OpenAI-compatible) | the address of any service with an OpenAI-style chat-completions endpoint, e.g. a model hosted in-country |
| Platform AI service | shown only when the platform operator has approved one; no key needed |

- **The key** is stored encrypted and never shown again — only its last 4 characters. Leave the field empty to keep it; a new provider needs a new key. Use a key made for this purpose, with a spending limit in your AI account.
- **Addresses** must be https and may not point into a private network.
- **Test the connection** sends one small classification request and shows whether the answer came back right, and how long it took.
- **Use AI** is the master switch: off stops every AI call at once.
- **When AI runs** — purchases: large unidentified purchases only (recommended), every unidentified purchase, or never; and at most how many kinds of purchase per file. See the Purchases chapter for what is sent and what the AI may do.
- Every change and test is in the audit log, without the key. Needs the Professional or Enterprise plan.

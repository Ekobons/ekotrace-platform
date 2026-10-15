# Batch runs

Menu → Capture → **Batch runs** shows every batch of data that came in from a file or a connected system, whether it **reconciles** with what the source sent, and the **health** of each connection. Super admins, admins and verifiers see everything; managers see the batches of their facilities.

```flow
> 1 · Send | a system (SAP, Oracle, BMS, fuel cards) calls the API, or someone uploads a file
> 2 · Log | every call is a transfer: records received, accepted, refused and why — or why the call failed
> 3 · Process | lines are read, mapped and calculated; failed processing can be retried
> 4 · Reconcile | source totals → received → published / excluded / problems → entries
> 5 · Watch | each system's health; alerts when transfers fail or a system goes quiet
```

## Connected systems (health)

One card per API client, plus purchase files and utility bills.

| Health | Meaning |
|---|---|
| Healthy | sending, no failures in the last 24 hours |
| Failures in the last 24 h | it recovered, but some calls failed recently |
| Failing | its last call failed |
| Gone quiet | nothing received for longer than its **Expected** interval |
| Nothing sent yet / Key revoked | as it says |

**Expected** (super admin, admin): how often the system should send — every hour, 6 hours, daily, every 2 days, weekly or monthly. When nothing successful arrives for longer, the super admins and admins get one notice (inbox and e-mail) for that gap. A failed call also tells them, at most once an hour per system. API clients and their keys are created under Setup → Integrations & API.

## Purchase batches and reconciliation

Each batch shows its source (file, typed in, or a system), status, lines, outcome (published, excluded, problems, still in review), emissions and its reconciliation state:

| State | Meaning |
|---|---|
| Reconciled | published; the source totals agree and every check passes |
| Differences | at least one check fails — open it to see which |
| In review | not yet published; checks so far pass |
| No source totals | published and consistent, but there were no source totals to compare with |
| Not processed | processing failed — use **Retry** |

**Reconcile** opens the batch's reconciliation:

- **Source system totals**: the line count and total per currency the source reports (for example the footer of the SAP extract). Systems send them with the batch (`control`); for a file, the person who loaded it or an admin enters them.
- **The flow**: sent by the source → received → published, excluded in review, duplicates, problems, still in review → entries (by status), with lines, amounts per currency and tCO₂e at each step.
- **Checks**: lines received = lines sent; each currency's total received = source total; every line has an outcome; every published line is in an entry; the entries hold the emissions of the published lines; entries approved.
- Lines with problems, published lines no longer in any entry, and the history of transfers and processing steps.

**Retry** (super admin, admin, manager) runs failed processing again — for example after a server restart or once a missing exchange rate is added. It is logged in the audit trail.

## Meter-reading batches

When the company reviews readings before publishing them, each call that sends readings becomes a batch here: readings received, refused (unknown or inactive meter, bad value), and new, corrections, duplicates and conflicts. They are published or discarded under Add data → the category → Meter readings.

## Transfers

Every call a connected system made: when, what it sent, records received, accepted and refused, the result (OK, some refused, or failed with the HTTP status), and how long it took. Open one to see each refused record and its reason. For a failed call nothing was stored: fix the cause in the sending system and send it again. Transfers are kept for 400 days.

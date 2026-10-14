# Audit & assurance

**Audit & assurance** (menu → Disclose) prepares the year for external assurance under any of the usual standards — **ISO 14064-3**, **ISAE 3410**, **ISAE 3000 (Revised)**, **ISSA 5000** or **AA1000AS v3** — at **limited** or **reasonable** assurance. Pick the year at the top. The tiles show the approved entries and their tCO₂e, the share with evidence (meter, bill, purchases file, QR scans or files linked in the document vault), the months locked, and the open findings with their estimated impact against materiality.

```flow
> 1 · Engagement | standard, level, provider, subject matter, materiality, status
> 2 · Lock months | every entry approved → lock the month; nothing in it can change
> 3 · Sample | random or value-weighted, key items always in; the seed makes it reproducible
> 4 · Test | each entry agreed or an exception, with a note; an exception can raise a finding
> 5 · Findings | the company responds, the verifier closes
> 6 · Verifier pack and statement | one file for the verifier; the signed statement and conclusion are kept with the year
```

## Engagement

Assurance standard, level, provider and lead verifier, **subject matter** (what is assured, e.g. Scope 1, 2 and selected Scope 3 categories), **materiality** (% of the total, usually 5%), status (planning, fieldwork, reporting, statement issued), the **conclusion** as written in the statement, its date, and the signed **statement PDF**. The verifier, admins and the super admin can change it.

## Period locks

Each month shows **Locked**, **Ready to lock** (every entry approved) or how many entries are not approved yet. Admins lock a ready month. A locked month cannot be changed in any way — new entries, edits, deletions, approvals or send-backs, meter readings, imports, recalculation: the database refuses it, whichever screen or system tries. **Unlock** needs a reason (for example the correction agreed with the verifier); both are in the audit log.

## Sampling & testing

**Draw a sample** of the year’s approved entries:

| Choice | Meaning |
|---|---|
| Value-weighted | larger tCO₂e more likely to be picked (monetary-unit style) — the usual choice for assurance of a total |
| Random | every entry equally likely |
| Sample size | suggested 25 for limited, 60 for reasonable assurance |
| Key items | entries above this % of the total are always included (default: half of materiality, or 5%) |
| Seed | the same seed draws the same sample — recorded, so the verifier can reproduce it |

For each entry the sample shows facility and period, item, quantity, tCO₂e, factor source, evidence and who entered and approved it. The verifier marks it **Agreed**, or **Exception** with what does not agree — and can raise a finding at once with its severity and estimated impact.

## Findings

Severity (low, medium, high), kind (misstatement, evidence, control, method, other), the finding and its estimated impact in tCO₂e. The company **responds** (what was done); the verifier — or the super admin — **closes** it, or reopens it. Open findings and their total impact show against materiality on the tiles.

## Verifier pack

**Download verifier pack** gives one file with the engagement, the GHG statement from approved entries (Scope 1, Scope 2 location- and market-based, Scope 3, biogenic CO₂ separately), the emission factor sources, the period locks, every sample with its results, the findings with responses and the conclusion — plus the **change trail** of the year’s entries as CSV (who entered, changed, approved, sent back, locked and unlocked what, and when). The granular audit view and the entry-level dataset are under Reports.

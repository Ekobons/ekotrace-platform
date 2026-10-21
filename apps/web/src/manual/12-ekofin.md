# EKOFIN · financed emissions

EKOFIN measures the **financed emissions** of a bank, investor or other financial institution: the share of its borrowers' and investees' greenhouse gas emissions that it finances. It follows the **PCAF Global GHG Accounting and Reporting Standard, Part A** (Partnership for Carbon Accounting Financials), the method IFRS S2 refers to for financed emissions.

EKOFIN is a separate product on the same platform as EKOTRACE. A company can have EKOTRACE, EKOFIN or both; the Ekobon team switches them on in the platform console. With both, the switch at the top of the side menu moves between them. People, currencies, the Document vault and the audit log are shared.

```flow
> Portfolio | a loan book, fund or mandate → a reporting date → holdings (uploaded or added) → results straight away
> Improve | ask the largest estimated counterparties for their figures → record them → results move to better scores
> Close | lock the reporting date → export → report
```

## How a holding is calculated

Each holding gets an **attribution factor**: the share of the company the institution finances.

```layers
Listed equity, corporate bonds | outstanding ÷ EVIC (enterprise value including cash: market capitalisation + total debt)
Business loans, unlisted equity | outstanding ÷ (total equity + total debt); EVIC when the company is listed
```

The financed emissions are the attribution factor × the company's emissions. The attribution factor is capped at 100%. Scope 1 and 2 are added together, as PCAF reports them; Scope 3 is kept apart and shown only when the portfolio includes it.

## Data quality layers (PCAF score)

The company's emissions come from the best data available. Every holding shows its **score**, from 1 (best) to 5:

```layers
1 · Verified reported | the company's Scope 1 and 2, verified by a third party (assurance statement attached)
2 · Reported | the company's Scope 1 and 2, not verified (annual or sustainability report, CDP)
3 · Activity-based | calculated from the company's energy use or production
4 · Revenue estimate | the company's revenue × the sector's emissions per million of revenue
5 · Asset estimate | the outstanding amount × the sector's emissions per million of assets (no company data)
```

The best layer that can be calculated is used. A manager, admin or super admin can choose another layer for a holding; the reason is required and goes to the audit log, and the score shows with a star. Click a holding to see the formula, the inputs and the year of the data used.

Data used for a reporting date: the newest financial year and the newest emissions year **up to** the year of that date. Data more than two years older is flagged.

## Portfolios and reporting dates

**Portfolios & holdings** lists the portfolios. Each has:

- a type (loan book, fund, mandate) and a **reporting currency**;
- the **sector factor library** used for estimates (scores 4 and 5);
- whether the counterparties' Scope 3 is shown.

A **reporting date** holds the outstanding amounts on that day (for example 31 Dec 2025). A new date can start empty or copy the holdings of an earlier one.

Amounts in other currencies are converted to the reporting currency with the company's exchange rates on the reporting date (Setup → Currencies). A holding whose currency has no rate is left out and the page says which currency is missing.

### Uploading the loan book

**Upload holdings** reads an Excel (.xlsx) or CSV file. Columns are found by their headings; the template shows them all.

- Needed: counterparty name and outstanding amount.
- Used when present: LEI, ISIN, customer ID, country, listed, sector standard and code, asset class, currency, loan ID, origination date, the company's financials (financial year, EVIC, total equity, total debt, revenue, total assets) and reported emissions (year, Scope 1, 2, 3, verified, source).

A counterparty is matched to one already on record by **LEI**, then **ISIN**, then **customer ID**, then the same **name** (and country). Otherwise it is created. The file fills only blanks of an existing counterparty; it never overwrites what someone typed.

```flow
> Choose the file | preview: matched, new, rows with problems
! Any row with a problem | nothing is saved; fix the file and choose it again
> Replace or add | replace the date's holdings, or add to them
> Save | holdings, new counterparties, financials and emissions saved; results calculated
```

### Locking

When the figures are final, a super admin or admin **locks** the reporting date. The results are kept exactly as they were: later changes to counterparties, financials, emissions or factors do not move them, and holdings can no longer change. A super admin can unlock it with a reason (audit log); the figures are then recalculated from the current data.

## Counterparties

**Counterparties** is the register of companies lent to or invested in, one record each whatever the portfolio. A profile holds:

- identifiers (LEI, ISIN, customer ID), country, listed or not, and the **sector code** (NACE by default; GICS, ISIC, NAICS also accepted);
- **financials by year**: EVIC, total equity, total debt, revenue, total assets, in their own currency;
- **emissions on record** by year with their score. Score 1 needs the assurance statement or report from the Document vault;
- the sector factors that apply, and where the company is held.

## Portfolio dashboard

For the chosen portfolio and date:

- **Financed emissions** (Scope 1+2, tCO₂e) and Scope 3 when included.
- **Economic intensity**: financed emissions per million outstanding.
- **Weighted average carbon intensity (WACI)**: each company's Scope 1+2 per million of revenue, weighted by its share of the portfolio, over the holdings with revenue.
- **Data quality score**: the holdings' scores weighted by outstanding, and the share of the portfolio on reported data.
- Data quality across the portfolio, results by asset class and by sector, the largest financed emissions.
- **Ask for data first**: the estimated counterparties (scores 4 and 5) with the largest financed emissions — the ones whose own figures would lift the data quality most.

## Sector factor library

Estimates use a **sector factor library**: tCO₂e per million of revenue (score 4) or of total assets (score 5), by sector code, region and year. A shorter code covers every longer code starting with it (C24 covers C24.10). The company's country is used before GLOBAL, and the newest year up to the reporting year.

Libraries are shared by all companies and loaded by the Ekobon team (Excel or CSV in the template's columns). The licence of the source database must allow its use in this platform. The demo library is named "DEMO factors (illustrative, not for reporting)" and must never be used for real reporting.

## Who can do what

```layers
Super admin, admin | portfolios, lock; everything below
Manager | choose a layer for a holding (with a reason); everything below
Data preparer | reporting dates, holdings, uploads, counterparties, financials, emissions
Verifier | read everything, export
```

Every change is in the audit log. Company data is isolated by row-level security, as in EKOTRACE.

## Not yet in EKOFIN

Surveys to counterparties (with a free EKOTRACE workspace to calculate their footprint), the PCAF and IFRS S2 report templates, more asset classes (project finance, commercial real estate, mortgages, motor vehicle loans, sovereign debt, fund look-through) and targets come in the next phases.

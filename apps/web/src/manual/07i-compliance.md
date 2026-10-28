# Compliance desk

Menu → Disclose → **Compliance desk** shows which climate and sustainability regulations apply to the company and why, what each one requires and by when, and where each obligation stands. Where a module can tell (BRSR Core, UAE MRV, India CCTS), the status is read from it. Elsewhere, people set it.

The Compliance desk is a **package of its own**, switched on per company by the Ekobon team. With the GHG inventory it sits in the Disclose menu. Without it, it opens in a small menu of its own.

> The desk reads the rules from the company profile. It is **not legal advice**: confirm applicability and dates with counsel, above all where a regulation is still being changed.

```flow
> Profile | financial year end, size, listing, countries, EU turnover, CBAM tonnes, UAE and other facts
> Position | each regulation: applies, may apply (a fact is missing) or does not apply, with the reason
> Obligations | what falls due in the year, with the period it covers, the penalty and the module that does the work
> Status | done, in progress, not applicable — from the module or set by a person, with owner, note and evidence
! Overdue | past the due date and not done: shown in red, and carried into the next year's view
> Calendar | month by month; download as .ics for Outlook or Google Calendar, or the register in Excel
```

## Who does what

| Role | Can |
|---|---|
| Super admin, admin | the company profile, everything below |
| Manager | statuses, owners, notes, evidence, dates moved; the company's own obligations |
| Others | view, download the calendar and the Excel register |

## The company profile

**Company profile** holds the facts that decide what applies. An empty field uses what the other modules already know, shown after the field:

| Fact | Taken from the modules when empty |
|---|---|
| Countries of operation | the company's country and its facilities' countries (any EU member state adds *EU*) |
| Obligated under India CCTS | entities in India CCTS |
| CBAM goods imported, tonnes | CBAM imports of the last full year (the current year to date when there is none), without electricity and hydrogen, which are outside the 50-tonne threshold |
| Sells CBAM goods to EU buyers | CBAM communications finalised or sent to importers |
| UAE designated, Abu Dhabi facility | UAE MRV federal position; an Abu Dhabi facility in a covered sector (the 25,000 t threshold is not checked: answer *No* if it is below) |

The rest is typed: financial year end, employees and turnover, EU turnover and the largest EU subsidiary, listing (and the India rank or SGX index), US revenue and California business, the Australian group, UK quoted or large.

## The regulations

| Regulation | Applies when | Main deadlines |
|---|---|---|
| EU CSRD (after Omnibus I) | EU company: more than 1,000 employees and more than €450m turnover; non-EU group: more than €450m EU turnover and an EU subsidiary or branch above €200m | statement with the management report (about 4 months after year end); FY2027 for EU companies, FY2028 for non-EU groups |
| EU CBAM — importer | more than 50 t of CBAM goods imported a year | authorised declarant status (31 March 2026); certificates for 50% of embedded emissions at each quarter end from 2027; declaration and surrender on 30 September of the next year |
| EU CBAM — producer | sells CBAM goods to EU importers | embedded emissions to importers and verification (recommended timing) |
| SEBI BRSR and BRSR Core | listed in India, top 1,000 | with the annual report (31 August for a March year end); Core assurance from top 150 FY2023-24 to top 1,000 FY2026-27 |
| India CCTS | obligated entities | monitoring plan by 30 June; Form A by 31 July |
| UAE federal (Decree-Law 11 of 2024) | designated sources, or Scope 1 + 2 in the UAE of 0.5 MtCO₂e or more | IEQT report: adjustment period to 31 May 2027; NRCC at 0.5 MtCO₂e and above; records for 5 years |
| Abu Dhabi facility MRV (EAD) | Abu Dhabi facility of 25,000 t or more in a covered sector | registration and monitoring plan 31 March; verification notice 1 July; report 31 March of the next year |
| Singapore (SGX) | listed on SGX | Scope 1 and 2 from FY2025; IFRS S2 FY2025 (STI), FY2028 (S$1bn or more), FY2030 (others); assurance from FY2029 |
| Australia (AASB S2) | Group 1, 2 or 3 | with the annual report (3 months after year end for ASX-listed, 4 months for others); years starting from 1 January 2025 (Group 1), 1 July 2026 (Group 2), 1 July 2027 (Group 3) |
| California SB 253 | US entity with more than US$1bn revenue doing business in California | Scope 1 and 2 by 10 November 2026; later dates set by CARB |
| UK SECR | UK quoted company, or large unquoted company or LLP | with the accounts: 6 months (public) or 9 months (private) after year end |
| India EPR | places plastic packaging, electronics, batteries or tyres on the Indian market | annual returns and targets by 30 June after each financial year |
| EU PPWR | first makes packaging available in an EU member state | registration from 12 August 2026; labelling 12 August 2028; recycled content in plastic from 2030 |

The first year of a regime counts from the **first financial year starting on or after** its start date, so a June or March year end begins a year later than a December one (CSRD, SGX, AASB S2).

A regulation shows **may apply** when a fact it needs is missing from the profile. Its obligations are listed, marked *may apply*, until the profile settles it; they are never shown as overdue. Recommended or voluntary steps (CBAM verification and communications for producers, value-chain BRSR Core) are never overdue either. Dates the authority has not set yet show *not set* with a note, and appear under **No date set yet** on the calendar.

## Status

| Status | Meaning |
|---|---|
| Not started, In progress | open |
| Done | completed; needs the date it was completed |
| Not applicable | does not apply this time; needs a note saying why |
| Overdue | past the due date and not done or not applicable (worked out, not set) |

Statuses read from the modules carry **·auto**:

| Obligation | Read from |
|---|---|
| BRSR with the annual report | BRSR Core: the year marked *final* is done, otherwise in progress |
| BRSR Core assurance | BRSR Core: an assurance provider recorded is in progress |
| UAE IEQT report | UAE MRV federal tab: IEQT submitted or verified is done |
| EAD report, verification notice, monitoring plan | UAE MRV: done when every Abu Dhabi facility has it |
| India CCTS Form A | India CCTS: months entered is in progress |
| India EPR returns and targets, EU registration | EPR: returns filed, no shortfall, registration recorded for every stream |

A status set by a person takes over from the module. Saving an owner, a note or evidence without choosing a status (*As the module says*) keeps the module's status. **Clear** drops the status set by a person and goes back to the module's, keeping the owner, note and evidence. **Date moved to** records an extension; it needs a note, and the moved date is used for overdue and on the calendar. Link the evidence (a filing receipt, a letter) from the Document vault.

## The year

The year shows the obligations **due in that year**, and those due in the previous year that are still open, so a missed deadline does not drop out of view on 1 January. Obligations with no date show in the year of the period they cover.

## Own obligations

**+ Own obligation** adds anything the library does not hold: an environmental permit renewal, a local regulation, a lender's covenant, a CDP response, an SBTi commitment. It is due once, or every year on the same day (29 February falls on 28 February in other years). An annual one left open is carried into the next year like any other.

## Downloads

**Calendar (.ics)** gives the open dated obligations of the year as all-day events, to import into Outlook or Google Calendar. **Register (Excel)** has the regulations with their applicability and reason, the obligations of the year with status, owner and notes, and the method.

## Trying it

`npm run demo:compliance` creates *Gulf-India Metals Group PJSC (demo)*: a rolling mill in Abu Dhabi (an EAD facility), a wire plant in India (NSE, top 500), a trading office in Germany that imports CBAM goods and a UK service company, with a March year end. Its 2026 statuses are set, with one overdue item (the EAD verification notice), one date moved and two own obligations. Logins `esg@gimetals.demo` (super admin), `cosec@gimetals.demo` (admin), `compliance@gimetals.demo` (manager), with the password printed once. Figures and statuses are **invented**.

Every change is in the audit log.

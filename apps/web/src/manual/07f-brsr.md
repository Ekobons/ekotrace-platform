# BRSR Core

Menu → Disclose → **BRSR Core** prepares the *BRSR Core* of SEBI's Business Responsibility and Sustainability Report: nine attributes with their KPIs, the set listed companies must have **assured or assessed**, and the value-chain disclosures.

The format follows Annexure 17A of SEBI's master circular for listed entities as amended by the circular of 28 March 2025 (SEBI/HO/CFD/CFD-PoD-1/P/CIR/2025/42), with the *Industry Standards on Reporting of BRSR Core* (Industry Standards Forum, December 2024) for definitions and the PPP adjustment.

```flow
> Set up the year | revenue from operations, the PPP rate, output for intensity, the facilities inside the boundary, the assurance provider
> Collect | environmental figures (attributes 1–4) from approved entries; social and governance figures typed by their owners
> Prepare | override an entry figure only with a note; attach evidence; mark each row ready
> Review | a super admin or admin who did not change the row marks it reviewed
! Check | totals that do not add up and shares larger than their total; intensities stay empty until revenue and output are set
> Value chain | partners of 2% or more of purchases or sales, up to 75% coverage, with their figures
> Deliver | Excel for the annual report and the assurance provider; set the year Final to lock it
```

## Who does what

| Role | Can |
|---|---|
| Super admin, admin | year settings, mark rows reviewed, set the year Final, everything below |
| Manager, preparer | type and override values, attach notes and evidence, mark rows ready, add value-chain partners |
| Verifier | view, download the Excel |

Platform staff can look but not review: the review belongs to the company.

## The year

The reporting year is the Indian financial year, **April to March** (FY 2025-26 = 1 April 2025 to 31 March 2026). The page opens on the last completed year. **Year settings**:

| Setting | Use |
|---|---|
| Revenue from operations (₹) | from the audited statement of profit and loss; the base of every per-revenue intensity and of the wellbeing spend % |
| PPP rate | ₹ per US dollar at purchasing power parity, the IMF figure for India for the year. Default 22.4 — **check the IMF World Economic Outlook figure for your year** and enter it |
| Output and unit | for the per-unit-of-output intensities (tonnes, pieces, MWh…) |
| Facilities | which facilities are inside the BRSR boundary; none ticked = all |
| Provider and approach | the assurance or assessment provider, and reasonable assurance, assessment or none yet |
| Status | Draft → Ready → **Final**. Final freezes the figures from entries as they are at that moment and locks the year: values, reviews, value-chain partners and these settings. To change anything, set the status back to Draft or Ready first |

Revenue adjusted for PPP = revenue (₹) ÷ PPP rate, shown in USD million. The intensities are then per USD million (PPP) — comparable across countries, as SEBI asks.

## Where the figures come from

| Attribute | Source |
|---|---|
| 1 GHG | Scope 1 and Scope 2 (location-based) of the approved entries of the boundary facilities, by gas in the detail |
| 2 Water | water entries: withdrawal, discharge and consumption (withdrawal − discharge) in kL; discharge by level of treatment typed |
| 3 Energy | fuel and electricity entries converted to GJ; renewable = biomass, biogas and biofuels, plus electricity covered by renewable certificates or contracts |
| 4 Waste | waste entries in tonnes, by category A–H (Waste Management Rules, 2016) from the waste type, and by route from the entry's method: recycling, re-use, other recovery, incineration (with or without energy recovery), landfill, other disposal. Radioactive waste (F) is typed |
| 5–9 | typed: wellbeing spend, injuries and hours, wages, POSH complaints, MSME and local sourcing, wages by location, data breaches, payables, purchase and sales concentration, related-party shares |

An entry that spans the year boundary counts by the days inside the year. Only **approved** entries count. With no entries of a kind (no water entries, say), its rows show as missing, not zero. Water consumption is withdrawal − discharge as they stand, after any replaced figure, unless consumption itself is replaced. Each row shows its source: *From entries*, *Entered*, *Override* (an entry figure replaced, with the reason) or *Worked out*.

## Worked-out rows

| Row | Rule |
|---|---|
| Intensities | total ÷ revenue in USD Mn (PPP), and total ÷ output |
| % renewable energy | renewable GJ ÷ total GJ |
| Total waste | A + B + C + D + E + F + G + H |
| LTIFR | lost-time injuries × 1,000,000 ÷ person-hours worked, for employees and for workers |
| Wellbeing spend % | wellbeing spend ÷ revenue from operations |
| Wages to females % | gross wages to females ÷ total gross wages |
| POSH % | complaints ÷ average female employees and workers |
| MSME, within India % | input material from MSMEs / within India ÷ total purchases |
| Wages by location % | rural, semi-urban, urban, metropolitan (RBI classification) ÷ total wages |
| Breaches % | incidents involving customers' personal data ÷ all cyber incidents |
| Days payable | trade payables × 365 ÷ cost of goods and services procured |
| Concentration % | trading-house purchases ÷ purchases; top 10 ÷ trading-house purchases; dealer sales ÷ sales; related-party shares |

The inputs of these rows are listed with them, marked *input*; they are not BRSR Core rows themselves.

## The page

| Part | What it shows |
|---|---|
| Core rows filled | BRSR Core rows with a value this year, and how many inputs are reviewed or carry evidence |
| Scope 1 + 2, Energy | the year's headline figures and intensities |
| Assurance | the year's status and provider, revenue and PPP rate |
| Checks | discharge split not adding up to the total, discharge larger than withdrawal, more waste recovered and disposed of than generated, a share larger than its total, renewable energy above total energy, fuel entries without a calorific value (energy incomplete) |
| Attributes | the nine attributes on the left with rows filled; the table on the right with this year and last year |
| Detail | below the table: Scope 1 by gas, water by line, energy by source, waste by category and route |

In the table, type a value straight into an *Entered* row and **Save**. **Replace / note…** on a row opens it: replace an entry figure (a note is required), add a note, link a document from the vault, name the owner. Tick rows and use **Mark ready** or **Mark reviewed**. Changing a value sets its review back to *Open*. A reviewed figure from entries that changes afterwards (an entry approved or corrected later) shows **Changed** and needs reviewing again. You cannot review a row you changed yourself; such rows are skipped.

## Value chain

SEBI's value-chain disclosure covers the top **upstream** (suppliers) and **downstream** (customers, dealers, distributors) partners, each accounting for **2% or more** of purchases or sales by value, taken in order until **75%** is covered. For each partner give the business with the company (₹), the share attributable to the company (e.g. the company's share of the partner's revenue) and the partner's Scope 1, Scope 2, water consumption, energy and waste. The page shows coverage and the totals attributable to the company.

**Suggest from purchase files** proposes upstream partners from the company's published purchase files: suppliers above 2% of spend, until 75%.

The value-chain disclosures are voluntary for the top 250 listed companies from FY 2025-26, with assessment or assurance voluntary from FY 2026-27.

## Who must report

| | BRSR Core reasonable assurance or assessment |
|---|---|
| Top 150 listed companies | from FY 2023-24 |
| Top 250 | from FY 2024-25 |
| Top 500 | from FY 2025-26 |
| Top 1000 | from FY 2026-27 |

## The Excel

**BRSR Core (Excel)** downloads the sheets *BRSR Core* (every row with this and last year, source, review and evidence), *Inputs*, *Value chain*, *Detail* and *Method* (settings, PPP and the rules above) — the pack for the annual report and the assurance provider.

## Trying it

`npm run demo:brsr` creates *Sahyadri Auto Components Ltd (demo)*: three facilities (Chakan and Hosur plants, Mumbai office), two years of entries, FY 2024-25 final and FY 2025-26 in draft with reviews under way, and six value-chain partners. Logins `esg@sahyadri.demo` (super admin), `finance@sahyadri.demo` (admin), `hr@sahyadri.demo` (manager), with the password printed once. All figures are **invented**.

Every change is in the audit log.

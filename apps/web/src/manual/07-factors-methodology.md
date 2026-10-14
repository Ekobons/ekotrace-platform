# Factors & methodology

## Where factors come from

| Data | Source | Updated |
|---|---|---|
| Fuels, vehicles, refrigerants, UK electricity and heat, waste sent to others | UK DESNZ greenhouse gas conversion factors (2022 onwards) | each June, by Ekobon (preview before loading) |
| Waste treated at own sites | IPCC 2006 Guidelines Vol. 5 and 2019 Refinement | defaults in the tool; replaceable per site |
| Grid electricity — United States (national + 27 eGRID sub-regions, with T&D losses) | US EPA eGRID2023 | when EPA publishes a new eGRID |
| Grid electricity — 27 EU countries | European Environment Agency, CO₂-equivalent intensity of electricity generation (2022) | when EEA publishes a new year |
| Grid electricity — Australia (national, states and WA grids, with upstream Scope 3) | National Greenhouse Accounts Factors 2025 (DCCEEW) | each August |
| Grid electricity — India, Singapore, China (incl. residual mix), Japan | CEA CO₂ Baseline Database v20; EMA grid emission factor; MEE national average 2023; Japan national average (MOE / METI) | as published |
| Other grids (e.g. Gulf countries, Canadian provinces), residual mixes, T&D losses | entered by the platform admin with their source (utility, national inventory) | as published |
| Supplier factors, certificates | the company or the platform admin, with their source | per contract / period |
| GWP values | IPCC AR4, AR5, AR6 | fixed per set |

### Grid factors of other countries

These come with Ekotrace in one file (`data/grid/grid-factors.csv`) and load by themselves when the server starts. Each factor keeps its source, year and a note (for example the eGRID value in lb/MWh it was converted from). Open **Factor library → Grid regions** to see them.

- **Pick the right region for a facility.** In the United States choose the eGRID sub-region (e.g. *WECC California*), not the state; in Australia the state or WA grid. Without a region the country average is used.
- **Years.** eGRID 2023 and EEA 2022 are the latest published. An entry for a later year uses the latest factor and shows a warning; when a newer year is loaded, recalculate.
- **EEA values are generation intensities** (electricity produced in the country, imports not included). That is the common choice for EU location-based reporting; a national inventory value may replace it.
- **To check before a client report:** Australia's values were taken from secondary summaries of the NGA 2025 workbook, and India's from the CEA figure as reported; compare them with the official publication.
- **Market-based** uses the residual mix where one is loaded (China) and otherwise the grid average, which the report discloses.

## Which factor is used

```flow
> Country first | a factor for the facility's country beats a global one
> Year of the activity | activity in 2025 uses the 2025 factors; if next year's set is not loaded yet, the latest one is used with a warning — recalculate later
> Same kind of unit | litres with litre factors, kg with mass factors, kWh net with net factors (net and gross energy are never mixed)
> Per gas | CO₂, CH₄, N₂O masses × the company's GWP set, so AR4, AR5 or AR6 all work from the same factors
```

## Corrections and history

A factor is never overwritten. A correction is saved as a **new version**; the old one stays in the history with who changed it and when. Saved entries keep the factor they were calculated with until they are recalculated, which is logged with the old and new result.

## Energy content

Net and gross calorific values are different measures of energy and are never converted into each other by a fixed ratio. A company's own calorific value (from the supplier's certificate) can be used per entry.

## Waste methods

The IPCC parameters (degradable carbon, decay rates by climate, methane correction factors, oxidation, flare destruction, wastewater MCFs, N₂O factors) are shown on the waste screens with their table numbers. Site values can replace them — e.g. from a waste characterisation survey — and the source is recorded with the site. The company's approved methodology document takes precedence where it differs.

## Base year and restatements

The base year is the year targets are measured from (Methodology & boundaries → Base year). The GHG Protocol (chapter 5) and ISO 14064-1 (§6.4.1) require it to be recalculated when something changes, so that progress compares like with like. Otherwise a sale would look like a reduction, and an acquisition like an increase.

```flow
> 1 · Record | what happened, when, the facility concerned, the change to the base year by scope, evidence
> 2 · Approve | a second person (super admin or admin) approves or rejects it — never the person who recorded it
> 3 · Test | the change as a share of the base year, alone and together with earlier recorded changes, against the threshold
> 4 · Restate | at or above the threshold: the restated base year is used everywhere; below it: recorded, counts towards the next change
```

**What triggers a restatement.**

| Trigger | Example | Change to enter |
|---|---|---|
| Acquisition or merger | a fleet services company joins the group | **+** its base-year emissions, from its own records |
| Divestment or closure | a plant is sold | **−** the plant's base-year emissions (choose it, then "− remove them") |
| Activity brought in-house | waste transport done by own trucks instead of a contractor | **+** in Scope 1 (and **−** in Scope 3 if it was counted there) |
| Activity outsourced | the canteen handed to a caterer | **−** in Scope 1 or 2, **+** in Scope 3 if still counted |
| Calculation method improved | landfill gas measured instead of modelled | the difference the new method makes to the base year |
| Emission factors or GWP changed | a new grid factor source for the base year | the difference |
| Error found | a meter counted twice in the base year | the correction |
| Boundary or consolidation changed | operational control to equity share | the difference |

**Significance threshold.** This is 5% of the base year by default. The super admin can change it, from 0 to 50%. A change at or above it restates the base year when it is approved.

A smaller change is approved and **recorded**, and counts towards later ones. When the net effect of the recorded changes and a new one reaches the threshold, all of them are applied together (the cumulative test).

Some policies restate even for small changes: tick "Restate anyway".

**Where the restated base year is used.**

- Targets & actions: the target paths, the Net Zero trajectory and the like-for-like reduction.
- Home and the KPI dashboard: the target path by month.
- The base-year figure on dashboards.
- Reports: the "Base year and restatements" section shows the figures as measured, the restatements, the restated total and the full history, and the ISO 14064-1 report notes the recalculation.
- The verifier pack lists every approved or rejected change.

The figures as first measured are always kept, and every step is in the audit log. Comparisons with the previous year ("same months last year") use the figures as measured.

**Views.** A change for a facility counts in every view that includes that facility. A change for the whole company, such as an acquisition or a method change, counts in whole-company views only.

A facility that has been switched off is already left out of every view, including the base year. Recording its sale documents the change and counts towards the threshold, but is not subtracted a second time.

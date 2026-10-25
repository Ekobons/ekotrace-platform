# Factors & methodology

## Where factors come from

| Data | Source | Updated |
|---|---|---|
| Fuels, vehicles, refrigerants, UK electricity and heat, waste sent to others | UK DESNZ greenhouse gas conversion factors (2022 onwards) | each June, by Ekobon (preview before loading) |
| Waste treated at own sites | IPCC 2006 Guidelines Vol. 5 and 2019 Refinement | defaults in the tool; replaceable per site |
| Grid electricity — United States (national, 27 eGRID sub-regions and all 50 states + DC + Puerto Rico, with T&D losses) | US EPA eGRID2023 | when EPA publishes a new eGRID |
| Grid electricity — 27 EU countries | European Environment Agency, CO₂-equivalent intensity of electricity generation (2022) | when EEA publishes a new year |
| Grid electricity — Australia (national, states and WA grids, with upstream Scope 3) | National Greenhouse Accounts Factors 2025 (DCCEEW) | each August |
| Grid electricity — India, Singapore, China (incl. residual mix), Japan | CEA CO₂ Baseline Database v20; EMA grid emission factor; MEE national average 2023; Japan national average (MOE / METI) | as published |
| Grid electricity — New Zealand, South Africa, Türkiye, Malaysia (Peninsular, Sabah, Sarawak), Hong Kong (CLP, HK Electric), South Korea, Taiwan, Brazil, Philippines | the government, regulator or utility that publishes it (MfE, DFFE, ETKB, Energy Commission, the two utilities, the ministries) | as published |
| Grid electricity — UAE (national, Dubai, Abu Dhabi), Oman | MOCCAE (UAE NDC, 2019 base year); DEWA climate change report; EWEC decarbonisation report; Nama PWP 7-year statement | as published |
| Grid electricity — Saudi Arabia, Qatar, Bahrain, Kuwait, Egypt, Jordan | no official average found: Saudi Arabia from Climate Transparency (Enerdata data); the others from the UNFCCC/IFI combined-margin dataset — **provisional** | as published |
| Freight (Scope 3.4, 3.9) and leased vehicles (3.8, 3.13) | DESNZ *Freighting goods* and *Managed assets – vehicles*, with their well-to-tank | each June, with the DESNZ set |
| Typical energy use of buildings and warehouses (floor-area method, 3.4, 3.8, 3.9, 3.13) | BCA Building Energy Benchmarking Report 2023 (Singapore); ENERGY STAR Portfolio Manager Technical Reference 2024 (US EPA) for types BCA does not cover | `data/buildings/energy-intensity.csv`, by the platform admin |
| Grid electricity — Canada (national and provinces) | previous Ekotrace list, taken from Canada's National Inventory Report | when checked against the NIR |
| Grid electricity — about 50 other countries (Africa, Latin America, South and South-East Asia) | IGES list of grid emission factors (government and UN CDM values) — **last resort** | as published |
| Other grids, residual mixes, T&D losses | entered by the platform admin with their source (utility, national inventory) | as published |
| Supplier factors, certificates | the company or the platform admin, with their source | per contract / period |
| GWP values | IPCC AR4, AR5, AR6 | fixed per set |

### Grid factors of other countries

These come with Ekotrace in one file (`data/grid/grid-factors.csv`) and load by themselves when the server starts. Each factor keeps its source, year and a note (for example the eGRID value in lb/MWh it was converted from). Open **Factor library → Grid regions** to see them.

- **Pick the right region for a facility.** In the United States the eGRID sub-region (e.g. *WECC California*) is the better choice; the state is there when the sub-region is not known. In the UAE the emirate (Dubai, Abu Dhabi; the other emirates use the national value); in Australia the state or WA grid; in Canada the province; in Malaysia the grid (Peninsular, Sabah, Sarawak); in Hong Kong the utility. Without a region the country average is used.
- **How sure each value is.** The library shows each factor's source. In order of preference:
  1. **Official** — published by the government, regulator or utility (most countries above).
  2. **Official, read from a press report** — South Korea, Taiwan and Brazil; the note says so. Check against the ministry's notice before a client report.
  3. **Previous Ekotrace list** — Canada, Malaysia's national value and Indonesia's Java–Bali grid, carried over from the old tool with their original reference; not re-verified.
  4. **IGES / CDM grid factors** — for countries that publish no average grid factor. These are *carbon-credit baseline* factors (combined or operating margin, CO₂ only); they are usually higher than an average grid factor. Replace them when the country publishes one.
- **Left out on purpose.** India's state values (from a 2012 consultancy paper, with distribution losses inside) — the CEA national factor is used. IEA values — licensed data that cannot be republished.
- **Years.** eGRID 2023 and EEA 2022 are the latest published. An entry for a later year uses the latest factor and shows a warning; when a newer year is loaded, recalculate.
- **EEA values are generation intensities** (electricity produced in the country, imports not included). That is the common choice for EU location-based reporting; a national inventory value may replace it.
- **To check before a client report:** Australia's values were taken from secondary summaries of the NGA 2025 workbook, and India's from the CEA figure as reported; compare them with the official publication.
- **Market-based** uses the residual mix where one is loaded (China) and otherwise the grid average, which the report discloses.

## Which factor is used

```flow
> Country first | a factor for the facility's country beats a global one
> Year of the activity | activity in 2025 uses the 2025 factors (or one year per reporting year, see below); if that year's set is not loaded yet, the latest earlier one is used with a warning — recalculate later
> Same kind of unit | litres with litre factors, kg with mass factors, kWh net with net factors (net and gross energy are never mixed)
> Per gas | CO₂, CH₄, N₂O masses × the company's GWP set, so AR4, AR5 or AR6 all work from the same factors
```

## Factor year and reporting year

Factor sets such as DESNZ are published once a year **for a calendar year**: the "2025" set (published June 2025) is for activity from January to December 2025. Set the start of the company's reporting year, and which factor year it follows, under **Setup → Methodology & boundaries → Reporting year & factor year** (super admin):

| Factor year follows | April 2024 – March 2025 |
|---|---|
| Each month's calendar year (default) | Apr–Dec 2024 use the 2024 set, Jan–Mar 2025 the 2025 set |
| The reporting year — the year it starts in | the whole year uses the 2024 set |
| The reporting year — the year it ends in | the whole year uses the 2025 set |

All three are acceptable; state the choice in the report's methodology note and keep it from year to year. One set per reporting year is common; with an April start most of the year falls in the year it starts. Each entry's calculation says which year's factors it used. The setting changes the year of the **factors**; dashboards and reports still group entries by calendar months.

## When new factors come out — recalculation

Each entry stores the result **and the factor it was calculated with**. Loading a new factor never changes saved entries by itself; recalculation is a deliberate step, logged.

```flow
> 1 · Before the set exists | e.g. Jan–May 2025 entered in April: the 2024 set is used and the entry carries a warning "no factor for 2025; the 2024 one was used"
> 2 · New set loaded | the platform admin loads DESNZ 2025 in June (or a grid factor is added)
> 3 · Recalculate | Add data → Recalculate entries with warnings: those entries are calculated again and pick the 2025 set; the warning goes
> 4 · Logged | each change is in the audit log with the old and new totals; approved entries keep their status
```

- **Only entries that used a stand-in factor need recalculating** — they are the ones with the warning. Entries that already had their own year's factor do not change.
- **Locked months** (audit period lock) are never recalculated; unlock with a reason first if a correction is needed.
- **After changing the factor-year setting**, the Methodology page offers *Recalculate all entries*, because entries without a warning may now take another year's factors.
- **Past years are not moved onto newer factors.** 2024 activity keeps the 2024 set; a newer set does not replace it. A corrected factor for the same year (a new version) is applied by recalculating, and if the change is significant for the base year it is recorded under Base year and restatements.

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

## Weekly updates (platform admin)

Every Monday a research run checks the official sources and lists what changed under **Weekly updates** in the side menu (platform admin only; the count beside it is what still needs a decision). Nothing changes in the tool until the platform admin decides.

| What the run checks | What you do with it |
| --- | --- |
| Emission factor releases: DESNZ, US EPA (Hub, eGRID, spend factors), IPCC, national grid factors, PCAF and others | Open **Emission factors** (side menu) and load the file under Sources & import, or add the factor; then **Mark done** |
| CBAM: implementing acts, default values, deadlines | Open **CBAM**; then **Mark done** |
| Exchange rates: monthly averages once a month closes | **Apply**: saved as shared rates for every company (Currencies & price index shows them) |
| US CPI-U: the annual average when BLS publishes it | **Apply**: saved as that year's price index |
| Tech, regulation and market news | Read; **Mark done** or **Dismiss** |
| Two LinkedIn drafts for the Ekobon page | **Edit**, **Approve**, **Copy text**, post on LinkedIn yourself, then **Mark posted** |

**To review** shows everything waiting; **By week** shows each week with its summary. Each decision records who took it and is in the audit log. Applied rates and indices are corrected in Currencies & price index, not reopened here.

How the updates arrive: the run adds one file per week to `data/updates` in the code. After `git pull`, restarting the server loads it (a corrected file is loaded again; decisions already taken are kept).

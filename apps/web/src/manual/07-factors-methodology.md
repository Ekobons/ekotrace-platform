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

# Factors & methodology

## Where factors come from

| Data | Source | Updated |
|---|---|---|
| Fuels, vehicles, refrigerants, UK electricity and heat, waste sent to others | UK DESNZ greenhouse gas conversion factors (2022 onwards) | each June, by Ekobon (preview before loading) |
| Waste treated at own sites | IPCC 2006 Guidelines Vol. 5 and 2019 Refinement | defaults in the tool; replaceable per site |
| UAE and other grids, residual mixes, T&D losses | entered by the platform admin with their source (utility, national inventory) | as published |
| Supplier factors, certificates | the company or the platform admin, with their source | per contract / period |
| GWP values | IPCC AR4, AR5, AR6 | fixed per set |

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

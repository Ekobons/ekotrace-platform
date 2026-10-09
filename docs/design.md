# Design notes

## 1. Catalogue (editable)

`category → subcategory → item`, all rows in the database and editable by the platform admin:

- **category** – e.g. Stationary combustion, Fugitive emissions. `calc_method` says which formula the engine uses (`combustion`, `fugitive`). A new category of an existing kind needs no code.
- **subcategory** – e.g. the six fuel classes (Liquid, Solid, Gaseous, Biofuel, Biomass, Biogas) and the five fugitive groups. Holds the units offered in data entry and the default unit.
- **item** – a fuel, a refrigerant, a gas. Stable `code` (`desnz:diesel-100-mineral-diesel`), display name, aliases (old Ekotrace names, source spellings), default unit, gas or blend composition.

Removing something that is used (by a factor or an entry) switches it off instead of deleting it, so history keeps its meaning. Each company can also hide subcategories or items it does not use (`tenant_catalogue`).

## 2. Gases and GWP

- Every factor stores **kg of each gas per unit** (`factor_gas`), not only CO2e. CO2e is computed at calculation time with the company's chosen GWP set (AR4, AR5 or AR6, setting per company).
- DESNZ publishes "kg CO2e of CH4"; the importer divides by the GWP DESNZ used (AR4 in 2022, AR5 from 2023 — detected from the file) to get kg of CH4.
- Fossil-fuel methane is stored as `CH4_fossil` so AR6 applies the fossil value (29.8); AR4/AR5 use the single inventory value (25/28), as DESNZ and UNFCCC do.
- Where a source gives only a total (DESNZ bioenergy, well-to-tank), the published CO2e is used and the result says so.
- Results are stored per gas (`activity_result`), so reports can show CO2, CH4, N2O, HFCs, SF6… separately.
- Gas table: 68 gases. AR4/AR5/AR6 from the GHG Protocol GWP table (Aug 2024); AR4 and AR5 match DESNZ 2022/2026 exactly for all 57 gases DESNZ lists.

## 3. Bases of a result

| basis | meaning | counted in |
|---|---|---|
| direct | emissions of the category | its scope (Scope 1 here) |
| wtt | well-to-tank of fuels | Scope 3 category 3 |
| outside_scopes | biogenic CO2 of bioenergy | reported separately, never added |
| memo | non-Kyoto gases (HCFC-22, CFCs, halons) | reported separately, never added |

## 4. Factor selection

1. Region: a factor for the facility's country beats a GLOBAL one.
2. Year: activity in calendar year Y uses the factor valid in Y (DESNZ Y). If none is published yet, the latest earlier one is used with a warning.
3. Unit: a factor in the same dimension as the entered unit; net and gross calorific value are different dimensions (never converted into each other).

## 5. Decisions (9 Oct 2026)

- kWh offered as both net CV (default) and gross CV; therm and MMBtu are gross.
- Diesel and petrol default to "100% mineral" (UAE has no biofuel mandate); UK average-blend versions remain available.
- Calendar year Y → DESNZ Y.
- Anthracite, other bituminous, sub-bituminous coal and lignite: IPCC 2006 defaults (manufacturing CH4/N2O), labelled with their source — to be verified against the IPCC tables before client use.
- Fugitive emissions included: quantity (top-up), screening (charge × leak rate) and mass-balance methods; 25 common blends split per gas (compositions verified against DESNZ), the other 59 blends use the DESNZ total.

## 6. Client data isolation

PostgreSQL row-level security on facility, activity, activity_result and tenant_catalogue: every request runs with its company id set, and rows of other companies are invisible even if application code has a bug. Tested.

## 7. One codebase, many deployments

Brand pack (`brands/<name>/brand.json` + logo) and `.env` per deployment; everything else identical. Code updates never touch brand packs or data.

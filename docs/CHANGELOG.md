# Change log — Ekotrace platform (new codebase)

Newest first.

## 2026-10-09 — Stationary combustion and fugitive emissions: engine, factor library, API

**Calculation engine (`packages/calc`)**
- Units: one size per unit against its dimension's base (kg, L, kWh net, kWh gross…); any two units of a dimension convert. Net and gross energy kept apart.
- Factor selection by region, calendar year and unit dimension; fallback to latest year with a warning.
- Fuel combustion per gas (CO2, CH4 fossil/non-fossil, N2O) with the company's GWP set; well-to-tank (Scope 3.3); biogenic CO2 outside scopes.
- Fugitive: quantity, screening and mass-balance methods; blends split per gas; non-Kyoto gases as memo.
- Every result carries plain-language calculation steps and warnings.

**Database (PostgreSQL)**
- Editable catalogue: categories, subcategories, items (add, rename, move, switch off); per-company hide/show.
- Gases (68) and GWP values AR4/AR5/AR6.
- Factors stored per gas; versions kept (corrections supersede, never overwrite).
- Companies, facilities, entries, results per gas; row-level security between companies.

**Data loaded**
- DESNZ 2022–2026 flat files: 51 stationary fuels (6 classes), WTT and biogenic rows; 2,317 factors in total; 166 gas rows per year.
- 25 refrigerant blend compositions (each reproduces DESNZ AR4 and AR5 within 1 %); 59 other blends use the DESNZ total.
- IPCC 2006 defaults for anthracite, other bituminous, sub-bituminous coal, lignite.
- Old Ekotrace fuel names kept as aliases for later data migration.

**API (Fastify)**
- Catalogue read/edit, units (matrix) edit, gases/GWP, factors browse/add version/history, DESNZ upload with preview, import issues, companies, facilities, calculate (preview), save entries, entry detail with steps, per-gas report.
- Login not built yet: `DEV_AUTH=true` for laptop use only; with `false` everything is refused.

**Checks**
- 12 engine tests; 11 API tests on PostgreSQL, including: all 585 DESNZ fuel factors with a gas split (5 editions) reproduce the published totals; company A's entries invisible to company B.
- Dependencies: 0 known vulnerabilities (`npm audit`).

**Findings about the old Ekotrace factors** (from the comparison with DESNZ 2022–2026)
- All old values are the DESNZ 2024 set copied into four years; error usually < 1 % for oils and gases, 5–15 % for biomass and biogas.
- Old "Diesel" per kWh used gross CV while all other fuels used net CV (≈ 6 % difference).
- Several fuels held another fuel's values (biodiesel types ← tallow; liquefied ← compressed biomethane).
- Bituminous / lignite were copies of DESNZ coals; sub-bituminous had no traceable source.

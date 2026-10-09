# Change log — Ekotrace platform (new codebase)

Newest first.

## 2026-10-09 (2) — Screens

- **Add data**: stationary combustion and fugitive emissions. Facility, year and month (or whole year) on top; fuel classes / gas groups on the left; fuel or gas, quantity and unit (only units that class offers and the item has factors for). Fugitive: three methods (quantity refilled, screening, mass balance). Result recalculated while typing: Scope 1, well-to-tank, biogenic CO₂, memo; split per gas; calculation steps; warnings. Save, with recent entries below.
- **Entries & results**: totals for the year, table per greenhouse gas, all entries; click one to see exactly how it was calculated.
- **Factor library** (admin): Factors per item and year with gas split, history, add a corrected version; Categories & items — add, rename, units offered, default unit, move, switch off, remove, and show/hide per company; Units & conversions — edit the one number per unit, add units, conversion matrix; Gases & GWP (68 gases, AR4/AR5/AR6); Sources & import — upload next year's DESNZ file with a preview, review list.
- **Company & facilities**: create companies, choose GWP set and country, add facilities.
- Design tokens copied from the prototype (colours, Instrument Sans, cards, sidebar). Brand colour comes from the brand pack.
- API serves the screens itself: one command (`npm run app`), one address (http://localhost:4000). Without login it only accepts connections from the same computer.
- New API: units offered per item; current company settings. 24 tests pass (12 engine + 12 API).

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
- DESNZ 2022–2026 flat files: 52 stationary fuels across the five editions (51 in 2026), in 6 classes, with WTT and biogenic rows — 2,317 factors; 166 gas rows per edition.
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

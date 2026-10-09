# Change log — Ekotrace platform (new codebase)

Newest first.

## 2026-10-10 (3) — Waste: own sites (Scope 1) and waste sent to others (Scope 3.5)

The scope follows who runs the treatment site: one **Waste** tab with "Treated at our own site · Scope 1" and "Sent to another company · Scope 3.5". IPCC 2006 Guidelines Vol. 5 with the 2019 Refinement, every default shown next to its field and replaceable per site or entry; to be aligned with the client's approved methodology when it is received.

**Landfill (Scope 1)**
- **Site register** per facility (Add data → Waste → Manage landfill sites, or Organisation → facility → Landfill sites): climate, site type (MCF, 2019 Table 3.1 incl. semi-aerobic / active aeration), soil cover (oxidation 10% / 0, Table 3.2), optional methane share F, delay, composition of mixed waste (default Table 2.3 Western Asia & Middle East), DOC / DOCf / k per waste type.
- **Tonnage history** per year and waste type: paste from Excel (one column per type, or one row per year and type), or fill a range of years with an average (marked estimated). After a change, the site's entries can be recalculated in one click.
- **First order decay** (IPCC eq. 3.4–3.6): DOC Table 2.4, DOCf 2019 Table 3.0, k Table 3.3 by climate (UAE: tropical dry), delay 6 months; year-by-year table in the steps. A month's entry uses the share of days.
- Or **from gas collected** ÷ collection efficiency (AP-42: 60–85%, 75% average).
- **Gas recovered**: engines, boilers, open / enclosed flares, or sent to another company; kg CH₄ or m³ × CH₄ % (0.7168 kg/Nm³). Destruction: open flare 50%, enclosed 90% (CDM Tool 06), engines / boilers manufacturer's value, at most 99% (US EPA subpart HH); slip counted as emitted; CO₂ from burning it reported as biogenic. Emitted = (generated − recovered) × (1 − OX) + slip.

**Incineration / waste-to-energy**: waste types (municipal by composition, Table 2.4; industrial Table 2.5; sludges; clinical); fossil CO₂ = waste × dry matter × carbon × fossil share × oxidation × 44/12; biogenic CO₂ outside scopes; CH₄ by technology (Table 5.3) and N₂O by waste class (Table 5.6); or measured stack CO₂ with its biogenic share. Plant values for dry matter / carbon / fossil share; energy exported shown, never subtracted.
**Composting and anaerobic digestion**: Table 4.1 per tonne wet or dry; digesters also from measured biogas, leaks (5% default), burned / sent out, the rest counted as vented.
**Wastewater**: domestic or industrial; treatment system → MCF (2019 Tables 6.3 / 6.8); BOD or COD as kg or flow × mg/L; sludge removed; Bo 0.6 / 0.25; gas recovered; N₂O in the plant (0.016 kg N₂O-N/kg N, 2019) and in effluent (0.005); CH₄ from effluent discharged (MCF 0.11).

**Scope 3.5 — waste sent to others**: DESNZ waste disposal factors 2022–2026 (all materials × routes: landfill, combustion, open / closed-loop recycling, composting, anaerobic digestion, re-use), rows of material, route and tonnes, previewed and saved together. Note shown that DESNZ landfill factors are UK averages.

**Also**: new basis "Scope 3" (other categories; the category records which, here 3.5) shown on Entries & results; entries link to their landfill; importer version 5; migration 008.
**Demo**: Al Saja'a Landfill facility with a DEMO tonnage history (2000–2025, estimated, not real), landfill gas to engines and a flare, monthly waste-to-energy, composting, wastewater and office waste sent out.
**Tests**: 30 engine (incl. landfill FOD worked by hand, incineration of plastics and mixed waste, composting, digester leaks, wastewater) + 30 API.
**To check**: N₂O factor for effluent (0.005) is the 2006 value carried into the 2019 Refinement — to confirm against Table 6.8A.

## 2026-10-10 (2) — Scope 2: electricity, heat & steam, cooling; location- and market-based; Scope 3.3 T&D and upstream

**Electricity**
- **Location-based**: kWh × grid factor of the facility's **grid region** — country average (AE) or sub-region (emirate / state / grid sub-region: AE-DU, AE-SH, AE-AZ…, US eGRID, Indian states…). A sub-region without its own factor falls back to the country, shown in the steps. Grid region set per facility (profile) and changeable per entry.
- **Market-based**, GHG Protocol hierarchy: (1) certificates and contracts claimed — I-REC / REC / GO / REGO, PPAs, green tariffs, with source (solar, wind, hydro, biomass, biogas, geothermal, nuclear, other) and their factor (0 for zero-carbon sources); (2) the rest at the supplier's factor (list or typed in); (3) else the region's residual mix; (4) else the grid average, with a disclosure note.
- Both figures always shown and stored side by side (dual reporting); never added together.
- **Scope 3.3**: T&D losses and upstream (WTT of generation + WTT of T&D) per kWh. UK: DESNZ 2022–2026. Other regions: entered by the platform admin — T&D as kg/kWh or as a loss % of the grid factor.

**Heat & steam**: UK DESNZ district heat & steam (Scope 2), distribution losses and upstream (Scope 3.3); elsewhere the supplier's factor (used for both views).
**Cooling** (district cooling): TRh / kWh / MWh of cooling; supplier's factor per TRh (both views), or plant efficiency (kWh of electricity per TRh, or COP) × the grid factor of the region.

**Certificate register** (Setup → Energy certificates & suppliers): MWh held, standard, source, market, vintage, references, facility; claims per entry recorded and locked — the tool refuses claims beyond the MWh held (also under simultaneous saves); a claimed certificate cannot be deleted or have its source / factor changed; claims listed per certificate. Warnings when the market differs from the facility's country or the vintage does not cover the period.
**Supplier factors**: company's own and a shared list (platform), per energy, unit and period, with source and renewable %.
**Factor library → Grid electricity & prices**: regions per country with each year's grid / residual / T&D / upstream factors; add regions and factors.

**Also**: Entries & results show Scope 2 location / market and Scope 3.3 (upstream + T&D); EV charging now also reports market-based (= location; no contract applies); recalculation covers energy entries and keeps certificate claims; importer version 4 (UK electricity T&D / WTT, district heat); migration 007.
**Demo**: grid regions (Sharjah sites SEWA, data centre DEWA), demo supplier factors and a demo I-REC — clearly marked as not real; location-based waits for the UAE grid factors.
**Tests**: 24 engine + 28 API, incl. UK results against DESNZ 2026, Dubai sub-region and fallback, certificate over-claim, supplier vs residual, cooling both methods.

## 2026-10-10 — Vehicle count; paste rows from Excel

- **Number of vehicles**: one entry or a row can cover several identical vehicles — "car petrol, 2, 34 km" = 2 × 34 km = 68 km. Saved with the count (shown as the first calculation step, kept on recalculation).
- **Paste or type rows** (Add data → Vehicles): copy rows from Excel or any table and paste into the grid (Ctrl+V fills from the clicked cell; a pasted header row is matched by column names). Vehicles can be written in everyday words — "car petrol", "pickup diesel", "Land Cruiser diesel", "tipper 18t", "refrigerated truck 7t", "forklift LPG", "Tesla" — or as a fleet registration. Each row shows how it was read (type, what was assumed, total, method from the unit: km → distance, litres/kg → fuel, kWh → electricity, AED → spend), its result or its problem; the type can be changed per row. Only good rows are saved; rows with problems stay to be fixed.
- Excel upload uses the same reading (new column "Number of vehicles"; method optional, read from the unit).
- Refrigerated HGV types now have their own names ("Refrigerated Rigid (>17 tonnes) · Average laden"); importer version 3.
- Tests: 20 engine + 26 API (incl. matcher).

## 2026-10-09 (7) — Vehicles (mobile combustion), EV charging in Scope 2, fleet register, price list

**Vehicle types and factors** (DESNZ 2022–2026, per km and per mile, with gas split and well-to-tank)
- Passenger vehicles: cars by size (4) and by market segment (9) × powertrain (diesel, petrol, hybrid, CNG, LPG, plug-in hybrid, battery electric, unknown); motorbikes.
- Delivery vehicles: vans Class I–III and average × powertrain; HGVs rigid / articulated, refrigerated or not, 0 / 50 / 100 % / average laden (2026's renamed averages mapped to the same items).
- Off-road machinery (forklifts, loaders, excavators, sweepers, generators): fuel used or spend only.
- Electric and plug-in hybrid vehicles: DESNZ electricity use per km / mile; UK grid factor per year (Scope 2).

**Calculation**
- Distance × vehicle factor; fuel used × fuel factor (same factors as stationary combustion, 100 % mineral diesel / petrol by default, own calorific value possible); spend ÷ price = litres (or kWh), then as fuel (or electricity).
- Battery electric: Scope 1 = 0; kWh (charged, or km × kWh/km) × grid factor of the facility's country → **Scope 2**. Plug-in hybrid: petrol share in Scope 1 + electric share in Scope 2. Charged at the company's own site: shown, not added again (already on the site's meter).
- No grid factor for the country (or none valid for that year): saved with a warning; recalculate once the factor is added.

**Fleet register** (facility profile → Vehicle fleet): add, edit, retire with a date, reinstate, delete only without entries; Excel template with drop-down lists; upload with a preview of every row. Data entry offers the vehicles in service in the month.

**Add data → Vehicles**: one entry (fleet vehicle or type; distance / fuel / electricity / spend), fleet grid for the month (all vehicles, calculated as you type, saved together), Excel upload (template pre-filled with the fleet per month, preview, save valid rows).

**Price list** (Factor library → Grid electricity & prices for the shared list; Methodology for a company's own prices): fuel or electricity, country, currency, price per unit, months, source. Company prices win over the shared list. **Grid electricity factors** per country and year, with source.

**Recalculate** (Entries & results): entries with warnings, or one entry from its drawer; only changed entries are updated, each change audit-logged with before / after.

**Also**: Scope 2 column and card in Entries; batch save endpoint (each row on its own); `npm run demo -- --reset` recreates the demo company, now with 13 vehicles and 261 monthly vehicle entries; importer version so editions already loaded are re-read once, keeping unchanged factors as they are.

**Checks**: 20 engine + 23 API tests. Saved demo results hand-checked against the DESNZ 2026 file (trucks, vans, cars, plug-in hybrid by distance; trucks by litres): within 0.015 % (DESNZ rounding between gas split and total).

**Open**: the UAE grid factor must be entered with its source (none is preloaded); fuel prices likewise.

## 2026-10-09 (6) — Own calorific value; category tabs on Add data

**Own calorific value (fuels)**
- On Add data, "Use our own calorific value" (e.g. from the supplier's certificate or a lab analysis): value, energy unit (net or gross: MJ, GJ, kWh, MMBtu, therm, Btu) per unit of mass or volume.
- The quantity is converted to energy with that value, then the fuel's per-energy factors are applied (net or gross factors to match). If the source has no gross factor for that fuel, the message says so.
- The default offered is the value implied by DESNZ's own factors for that year (CO₂ per litre ÷ CO₂ per kWh). With the default, the result matches the per-litre calculation.
- Calculation steps, the emission factor table and the saved entry show the value used (`activity.inputs.cv`).
- New units: MJ (gross CV), Btu (gross CV) (migration 005). New API: `GET /api/items/:id/cv`.

**Add data** — tabs for each category (Stationary combustion, Fugitive emissions); fugitive emissions (refrigerants) could not be reached from the menu before. "Add data" stays highlighted on every tab.

Tests: 17 engine + 19 API.

## 2026-10-09 (5) — CO₂e emission factor shown with every result

- Below the totals, an **Emission factor** table: for Scope 1, well-to-tank, biogenic CO₂ and memo it shows the CO₂e factor per entered unit, the source (e.g. DESNZ 2026), how it was obtained (gas split × company GWP, or published total) and the check `quantity × factor = result`.
- When the entered unit differs from the factor's unit (e.g. GJ vs kWh), both are shown. When the company's GWP set differs from the source's, DESNZ's own published CO₂e factor is shown alongside.
- Refrigerants show the blend's CO₂e per kg (composition × GWP).
- Saved entries keep their factors (new column `activity.factors`, migration 004). Entries saved earlier show the factor derived as total ÷ quantity.
- Tests: 14 engine + 18 API.

## 2026-10-09 (4) — CO₂e first, split by gas below

- Add data (live result), the entry drawer and Entries & results show the CO₂e totals first. The split by gas sits below behind **Show split by gas**, closed by default; the choice is remembered on that browser.
- Calculation unchanged: still each gas × the company's GWP set, so per-gas reporting and the GWP setting keep working.

## 2026-10-09 (3) — Stage 1: login, roles, organisation, people, methodology, audit log, platform console

**Login and security**
- Real login: email + password (scrypt hash, OWASP parameters); session token in an http-only cookie, only its SHA-256 stored; 12-hour sessions; logout ends the session on the server.
- Same message for unknown email and wrong password; 5 wrong passwords lock the account for 15 minutes.
- New accounts get a temporary password shown once; it must be changed before anything else. Password rule: at least 12 characters.
- Changes must be sent as JSON (blocks cross-site form posts). Without HTTPS the server only accepts connections from the same computer (`HOST=127.0.0.1`).
- The "no login" development mode is removed.

**Roles (as in the prototype)** — platform admin (Ekobon), Super admin, Admin (one sub-group), Manager, Data preparer, Verifier (read-only). What each may see, enter and approve is enforced in the API, on top of the database's separation between companies.

**Organisation & groups** — main entity → sub-groups → facilities; facility profile (type, location, area, employees, manager, operational/financial control, ownership %); add, move, archive. Existing facilities moved under a main entity automatically.

**People & access** — add people with role and scope, edit, disable, reset password; Users / Roles & permissions / Access activity tabs. An Admin manages only Managers and Data preparers in their own sub-group; nobody can demote or disable themselves; the last Super admin cannot be removed.

**Methodology & boundaries** — consolidation approach as three cards with live Scope 1 totals (operational control, financial control, equity share), the facility boundary table, GWP set, base year.

**Security & audit log** — logins (and failed ones), people, organisation, methodology and data-entry changes, with time, person and address.

**Platform console** — companies with plan, access date, users, facilities, entries, last login; create a company with its first Super admin; suspend (logs everyone out) / reactivate; open a company for support. A suspended or expired company cannot log in.

**Tools** — `npm run admin:create` (first platform admin), `npm run demo` (BEEAH Group demo: 3 sub-groups, 6 facilities, one login per role, 105 fuel entries).

**Tests** — 30 pass (12 engine + 18 API), including login, lockout, forced password change, each role's limits, Admin confined to their sub-group, company separation, suspension, audit trail.

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

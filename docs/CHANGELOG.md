# Change log — Ekotrace platform (new codebase)

Newest first.

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

# Change log — Ekotrace platform (new codebase)

Newest first.

## 2026-10-10 (14) — Capital goods list corrected; published lines viewable; dashboards in the Ekotrace 2.0 design; bills and API readings per category with preview

**Capital goods list** (migration 014, `src/import/capitalList.ts`): of the 225 old "Capital Goods" products, 57 parts, materials and consumables now count as purchased goods (3.1) with the reason stored (vehicle and aircraft parts, primary metals, forgings, valves, bearings, fittings, cable, medicines and reagents, gloves and dressings, dentures, tool accessories, keyboards and mice). 168 stay capital (machinery, vehicles, IT, electrical equipment, buildings, construction). Applied on import too. Add data → Purchases → **Capital goods list** shows it (platform admin can switch a product: `GET /api/purchases/capital-list`, `PATCH /api/purchases/capital-list/:itemId`).

**Published purchase lines** (migration 015): `GET /api/purchases/published` (filters: batch, entry, month/year, facility, supplier, spend category, Scope 3 category, average factor, search; totals for the selection; sorted by emissions / spend / date; paged 100) and `GET /api/purchases/published/export` (Excel, streamed, or CSV; up to 250,000 lines). Screen: Add data → Purchases → **Published lines**, `/purchases/published`, "open lines" on a batch, "lines" on a purchase entry. 50,000 lines: first page ~1.9 s, CSV + Excel ~14 s.

**Dashboards** rebuilt to the Ekotrace 2.0 canvas boards: header, tabs Overview · Emissions · Energy · Water · Waste · Mobility & travel (My boards later); filters year, months (year to date / quarter / month), compare with previous year / base year / none, Location / Market, part of the group; Export (CSV of the view) and Share view. Overview: dark total box with change and scope split, per employee / data confidence / approved cards with monthly sparks, monthly HTML columns with values and the comparison year dashed (monthly or cumulative, any scope), Where (drill into entities and facilities, ↑ back up), What (biggest sources), Energy / Water / Waste / Mobility tiles, **What moved** (top 3 changes with the facility behind them, computed). Emissions, Energy, Waste, Mobility: 5 KPI cards, monthly columns, panels (stacked share bars and row bars). API `/api/dashboard`: rows carry subcategory, unit, quantity, kWh (fuels by mass or volume through the calorific value of their factors; vehicles by litres through the same fuel) and certificate kWh; `cmp=<year>` returns the comparison year's rows (`prevRows`). Water stays empty until the water module.

**Bills per category, checked → preview → publish** (migration 016): Add data → Electricity, heat & cooling / Stationary combustion / Waste → **Type in · Bills · Meter readings**. Bills carry their category (`x-category` on upload; the account's category once matched). New status *checked*; `POST /api/bills/:id/check`, `GET /api/bills/preview?category=` (months by days, quantity in the meter's unit, estimated tCO₂e, calculation warnings, issues), `POST /api/bills/publish {ids}`. Stopped: same bill number (later one), overlapping period with a published or earlier checked bill, readings from another source in the period, register meter. Same file still recognised on upload. Editing a checked bill sends it back to check. `/confirm` still books directly (with the same overlap checks).

**API meter readings wait for review** (tenant setting `review_readings`, default on): `/api/v1/meter-readings` answers with a batch id and new / corrections / duplicates (same value again, or already waiting in an earlier batch) / conflicts (inside a booked bill's period) / refused. `GET /api/reading-batches`, `GET /api/reading-batches/:id` (per meter: counts, period, quantity per month, sample corrections), `POST …/publish`, `POST …/discard`, `PATCH /api/tenant/review-readings`. Impossible dates (31 September) are now refused instead of rolling over.

**Menu:** Bills and Meters left the Capture menu (meters on the facility's Meters tab; `/bills`, `/meters` still open).

**Tests:** 46 API (new: bills by category preview/publish with duplicates and overlaps; readings review — staging, duplicates across batches, discard, publish; published lines paging, entry drill-down and export of 50,000 lines; capital list), 47 engine. Manual: Bills and meter readings, Dashboards, Purchases (capital list, viewing published lines), Entering data, Meters, Integrations, Glossary.

## 2026-10-10 (13) — Purchases decided once per kind of purchase; one Purchases tab; dashboards in the prototype design

**Purchases logic** (migration 013):
- Kinds of purchase: same description + account + category; vague descriptions (no clear match) split by supplier.
- Spend category, first answer wins: remembered choice → NAICS code in file → clear description (≥ 60 %) → supplier default → account default → category default → weaker match (≥ 30 %) → approved AI (only if switched on) → **average factor** (median EPA factor: services 0.111, goods 0.278 kg CO₂e / 2022 USD; marked as estimate).
- Capital goods: account type → capital column → **capital-goods list** (old "Capital Goods" products, and EPA codes whose listed products are all capital) → else 3.1. Account type *Not a purchase* (VAT, salaries…) excludes.
- Other categories decided by default: travel / freight / rent moved, fuel / energy / waste excluded; shown, changeable.
- **Review by impact:** kinds of purchase ranked by emissions; the largest up to 95 % of the batch (company setting 80–100 %) wait as "to confirm" (new line status `check`); the small rest is accepted as it is. Confirm per row, per page, or by any change; remember for this description / supplier / account.
- Accounts tab (GL type, default category, Scope 3 category) `GET /api/purchases/batches/:id/accounts`, `PUT /api/purchases/accounts`; supplier default category (`PATCH /api/suppliers/:id { defaultItemId }`, suggested at 80 % share).
- Classifier: "X for Y" → X ("Diesel for generators" is diesel); gasoil; generator synonyms.
- Speed: groups read once per query (no per-line row-security join), fresh planner statistics after large changes. 50,000 lines: ~22 s read+map+calculate, ~8 s publish. 10,000-line test file: ~11 s.

**One Purchases tab:** Add data → Purchases holds upload (default), typing by hand and the batch list; Capture → Purchases left the menu (`/purchases` still lists batches).

**Dashboards** redone in the prototype's compact design: one-line header, tabs (Overview, Scopes & categories, Facilities, Waste, Mobility & travel, Value chain; Energy, Water, Net zero later), stat strip, card grid; stacked monthly bars with last year's line, donuts, treemap, top 5, upstream · own · downstream, GHG category × month heat table, facility × month heatmap, intensities. API returns facility × month × category × item rows (tonnes). Supplier analytics use the same cards.

**Tests:** 44 API (new: decision logic — supplier/account defaults, account types, capital list, average factor, review by impact), 47 engine. Manual: Purchases rewritten (how the category is found, capital goods, review by impact), Suppliers, Dashboards.

## 2026-10-10 (12) — Upload purchases from Add data; lines without a facility

- Add data → Purchases now offers **Upload Excel / CSV** (default) or **Type by hand**; the upload is the same as Capture → Purchases, with the page's facility suggested for lines without one, and opens the batch when read.
- Column setup: with a facility column, choose where **lines with no facility written** go (or decide in the review). Choosing a facility for "no facility written" in the review is kept for the batch (re-reads and recalculation). Test added.
- Manual: Purchases → Facility of each line.

## 2026-10-10 (11) — Suppliers without duplicates, supplier analytics, Dashboards, 10k test files

**Suppliers registered from every purchase (upload, ERP API, by hand), one record however written** (migration 012, `supplierMatch.ts`):
- Order: remembered spelling → ERP vendor number → same normalised name / known spelling (legal forms incl. dotted F.Z.E. / L.L.C. / W.L.L. ignored) → near-identical name (linked automatically, listed for checking) → possible duplicate (new supplier, marked for a person) → new supplier. Country and vendor number from the file fill blank profile fields.
- Names compared word by word: generic words (also mistyped: "Indutsrial") dropped, "Al Noor" = "AlNoor", one typo allowed in words of 5+ letters, "Big Four" = "Bigfour". A word only one name has → different suppliers ("Pearl Steel" ≠ "Horizon Steel", "Desert Rose Steel" ≠ "Desert Rose IT Solutions"). Different numbers never auto-link; different vendor numbers go to a person. Most-used spelling names the supplier; names with a vendor number and many lines are linked first.
- Upload columns and API fields **supplierRef** (vendor number) and **supplierCountry** (code or name → ISO 2).
- Suppliers page: tabs **Suppliers** (filters: possible duplicates, incomplete profile, own factor, country; sort), **Check names** (possible duplicates: merge / different; linked automatically: right / split, confirm all), **Analytics**. Profile: name, vendor number, country, TRN, industry, size, contact, website, reports emissions, climate target, note; completeness; emissions by month; names seen and how each was linked.
- API: `GET /api/suppliers` (filters, sort, counts), `/review`, `/analytics?year=`, `/:id` (names, months, duplicate of), `PATCH /:id` (profile; vendor number unique), `POST /:id/merge`, `/:id/keep-separate`, `/matches/:id/confirm|split`.

**Supplier analytics:** suppliers, spend, emissions, share from suppliers' own factors, concentration (suppliers making 50 % / 80 %); by country (click → list), product group / spend category, Scope 3 category, industry sector, month; 25 largest suppliers; profile completeness and climate targets. Emissions or USD.

**Dashboards** (`GET /api/dashboard?year&node&scope2`, Dashboards in the menu): totals vs previous and base year, Scope 1 / 2 (location or market, never added) / 3, biogenic and memo apart; by month (stacked by scope; annual entries noted), category, facility (click to filter), Scope 3 categories, ten largest sources, data coverage per facility × month, purchases data quality. Consolidation approach applied (equity share × ownership %). Shared SVG charts (`components/Charts.tsx`).

**Spend matching:** ~60 procurement synonyms (brake pads, filters, hoses, breakers, HDPE liners, PPE items, pavers, MPLS, Wi-Fi, gasoil, generators…); fuel overlap no longer flags fuel filters, pumps, generators or lubricants (NAICS 324191); "flue gas" is not natural gas; UPS = power supply. On the 10k test file unmapped lines fell from 21 % to 8 %.

**Test files** (`npm run testfiles -w apps/api`, made up, marked DEMO): `purchases-10k-2026.xlsx` (10,000 lines Jan–Sep 2026, SAP-like layout, ~210 invented suppliers written ~450 ways, 10 created twice in the vendor master, vendor numbers on 70 % of lines, supplier countries, AED/USD/EUR/GBP/INR/SAR, credit notes, repeated lines, cost centres written differently or unknown, capital items, travel / freight / fuel) and 55 DEMO bills (SEWA ×4 accounts + HQ Aug–Sep, DEWA annex account, Empower district cooling) — all read correctly by the bill reader. Demo company gets meters for these accounts.
- 10,000 lines: read, suppliers linked, mapped and calculated in ~8 s → 208 new suppliers, 68 spellings linked automatically, 17 possible duplicates; 7,669 ready, 1,043 flagged for another category, 768 unmapped (suggestions shown), 458 problems (EUR / GBP / INR rates not yet entered for 2026; two unknown cost centres).
- Manual: new chapters Suppliers and Dashboards; Purchases, Integrations, Getting started and glossary updated. Tests: supplier matching, merge / split / keep apart, profile, analytics, dashboard.

## 2026-10-10 (10) — Real spend factors: EPA v1.3 and the previous Ekotrace products

- `data/epa/SupplyChainGHGEmissionFactors_v1.3.0_NAICS_CO2e_USD2022.csv` (1,016 NAICS commodities, with margins) loaded by the seed; demo placeholders no longer used.
- `data/ekotrace-old/products.csv`: the 1,645 products of the old platform (from `purchase_goods_categories_ef`, `purchase_category`, `purchase_subcategory`, `typesofpurchase`), each a spend category with its old category › subcategory and the EPA factor of its NAICS code (1,639 loaded; 8 old non-NAICS codes mapped to the closest EPA code; 6 public administration products have no EPA factor). Capital goods type → capital-goods hint.
- Not taken over, on purpose: the old per-currency factors (EPA per USD × one rate per country and fiscal year, no inflation adjustment) and per-kg factors (up to 16 different values for the same product across countries / years; implied prices implausible).
- Matcher: runner-up taken from another NAICS code (same code = same factor); words without a known category name translated in full by synonyms; retail / wholesale codes weighted down (factors already at purchaser price); filler words (contract, charges…) ignored; auto-mapping from confidence 0.30 (below 0.60 still "Check"). On the demo descriptions 36 of 43 map automatically.
- Old-list import route takes the raw exports (product, NAIC_code, typeofpurchase, category ids + names).

## 2026-10-10 (9) — Purchased goods & services (Scope 3.1), suppliers, currencies

**Ways in:** upload any CSV / Excel layout (up to 200,000 lines, 60 MB; header row and columns guessed, layout remembered per header signature); ERP API `POST /api/v1/purchases` (OAuth client with the new `purchases` permission, ≤10,000 lines per call, batches by reference, then complete); Add data → Purchases (rows typed by hand, check then save).

**Pipeline (background jobs, `job` table, worker in the API process, FOR UPDATE SKIP LOCKED):** read (streamed xlsx / CSV any delimiter, UTF-8 or Windows-1252; chunks of 2,000) → suppliers registered (normalised names, aliases) → duplicates of earlier uploads marked → lines grouped by normalised description (PO numbers, dates, pack sizes ignored) → mapping per group: remembered rules → NAICS code in the file → text matching (BM25 with procurement synonyms; description counts more than category / GL text; confidence) → optional approved AI service (OpenAI-compatible, off by default; only descriptions and candidate names sent; may only choose among candidates) → overlap flags (business travel, upstream transport, leased assets, fuel, energy, waste, capital-goods hint) → calculation per line (chunks of 5,000) → publish: entries per facility × month × Scope 3 category × spend category × method, linked to their lines; reopen.
- 50,000 lines: read, mapped and calculated in ~19 s, published in ~5 s (test).

**Calculation:** supplier factor per unit (kg, t, L, m³, kWh, piece) → supplier factor per currency → spend-based (EPA v1.3, kg CO₂e per 2022 USD, purchaser price). Money: amount ÷ currency per USD (company method: month average by default, annual average, or fixed budget rate; pegs AED/SAR/QAR/OMR/BHD) × CPI-U(2022) / CPI-U(purchase year). Fallbacks (missing month, missing CPI year) are warnings on the line. Every step shown per line.

**New:** categories capital_goods (3.2), upstream_transport (3.4), business_travel (3.6), upstream_leased (3.8) (spend-based for now); money units; `fx_rate`, `price_index` (CPI-U 2019–2024), suppliers and supplier factors, purchase batches / groups / lines / rules / layouts. Screens: Capture → Purchases (batches, upload with column choice, review by description with bulk actions, lines with steps, facilities not recognised, publish / reopen), Value chain → Suppliers (factors, merge spellings), Setup → Currencies & price index, Library → EPA import and import of the previous Ekotrace list. Integrations: client permissions (meter readings / purchase lines) and ERP API documentation.
- **Factors:** importer for the EPA CSV (`data/epa/`, or Library upload) and for the old Ekotrace tables (linked by NAICS; old names become search names). The demo uses `DEMO_placeholder_factors_USD2022.csv` (real NAICS codes, made-up values, marked DEMO; retired automatically when the EPA file is loaded).
- Vehicles: a currency typed as the unit still means spend (now that currencies are units).
- Manual: new chapter Purchases; data categories, entering data, security, integrations, glossary updated. Migration 011.

## 2026-10-10 (8) — Organisation: colour-coded hierarchy, org chart, clearer clicks

- Hierarchy list restyled as in the prototype: main entity teal, sub-groups olive, facilities blue (row tint, left bar, type badges, legend); icons; counts of sub-groups and facilities.
- **Org chart** view (List | Org chart, remembered per browser): cards with coloured headers, connectors, fold / unfold per branch, zoom.
- **Clicking:** a facility row (whole row, keyboard too) or card opens the facility, with "Open ›" on hover; a group row folds / unfolds, "Details" opens its profile.
- `/organisation?open=<id>&tab=meters|energy|fleet|waste` opens a facility on a tab; Capture → Meters links each meter's facility there.
- Manual (Getting started) updated.

## 2026-10-10 (7) — Facility page holds the facility's set-up

- Organisation → facility now has tabs **Profile · Meters · Energy · Vehicle fleet · Landfill sites** — everything that describes the facility in one place.
- **Meters tab**: the facility's meters (add with the facility already filled in; open a meter for its months, readings and settings). Same component as Capture → Meters, which stays as the company-wide view with a facility filter.
- **Energy tab**: grid region with its latest factors (or a prompt to set one), utility accounts that bills are matched to, and the certificates / contracts usable at the facility (its own and company-wide) with MWh left — with links to where each is managed.
- Manual updated: Getting started (facility tabs vs. Capture), Entering data, Meters, Bills.

## 2026-10-10 (6) — User manual in the app; session inactivity timeout

- **User manual** (Help → User manual, every role): getting started, each data category explained, entering data, meters, bills, factors & methodology, a dedicated **security** chapter, integrations & API, glossary. Flow charts, a scopes overview, protection layers and a month-split diagram. Searchable; "Print / save as PDF" prints all chapters.
- Written as Markdown in `apps/web/src/manual/` (shipped with each release, so it always matches the version in use); diagrams are written as text blocks (```flow, ```layers, ```diagram). **Every feature change updates the manual in the same release.**
- **Sessions end after 30 minutes without activity** (setting `IDLE_MINUTES`), besides the 12-hour maximum and logout — BEEAH security standard 4.9.

## 2026-10-10 (5) — Meters (readings by API), bills (PDF), API security

**Meters** (Capture → Meters; set up per facility, or from Add data → Month by month → "Set up a meter with these inputs", which keeps every detail of the entry: supplier factor, grid region, cooling plant, waste process…)
- Register (index, counts up) or consumption per period; hourly, daily, weekly, monthly or irregular; unit, multiplier (CT ratio / pulse value), register maximum (rollover), the meter's id in the sending system, utility account number (bills).
- Readings → one entry per calendar month in the company time zone (default Asia/Dubai): register differences and periods across a month end are split by time; coverage per month; a partly covered month (at least a quarter) scaled up and marked estimated; gaps, resets, rollovers, overlaps and unusual values flagged in the entry's warnings; meter steps at the top of the calculation.
- Entries are created / updated when a month has ended (automatic, or on demand); late readings and corrections update the month; **approved entries are never changed** — the difference is reported. Recalculation of meter entries goes through the meter.
- Readings can also be pasted (time, value[, start]; day-first dates accepted) and deleted; the screen shows months (coverage bar, measured, used, entry) and the latest readings.

**Machine API** (Setup → Integrations & API)
- API clients per sending system: client id + secret (shown once, only its hash kept), revoke at once, last use shown.
- OAuth 2.0 client credentials: `POST /api/v1/oauth/token` → 1-hour access token (JWT, HS256; `TOKEN_SECRET` setting on servers). `POST /api/v1/meter-readings` (up to 100,000 readings, each checked on its own; same meter + time = correction), `GET /api/v1/meters`. Rate limit 120 requests / minute per client. Every batch in the audit log.
- Security headers on every response (CSP, X-Frame-Options, nosniff, Referrer-Policy; HSTS with `HTTPS=true`) — BEEAH security standard 4.7 / 4.9.

**Bills** (Capture → Bills)
- Drop many PDFs at once (15 MB each; PDF checked; the same file twice recognised). Text read with PDF.js 6 (no code from the file runs); scans without text flagged for typing in.
- Reader for UAE / GCC bills (DEWA, SEWA, ADDC / AADC / TAQA, Etihad WE, Empower, Tabreed, Emicool, Emirates Gas) and generic layouts: supplier, account, bill no., billing period (or reading dates), bill date, consumption with unit (kWh, MWh, TRh/RTh, m³, kg, L — ignoring meter readings, rates, water), amount and currency; each value shows the line it came from; other figures offered with one click.
- Matched to the meter by account number (or chosen; or "new meter for this account"). A person checks against the PDF shown beside the fields and books it: one reading for the billing period → monthly entries split by days. Reject (with a reason) and reopen (removes the reading, recalculates the months).
- Email intake not built (see project notes): upload in one place instead.

**Demo**: hourly BMS electricity at the data centre (2026, with a 2-day outage in June), daily gas register at the WtE plant, weekly compost weighbridge, and 8 SEWA-style bills for HQ (15th–14th; 7 booked, August to check) — all marked DEMO; the manual entries they replace were removed.
**Tests**: 35 engine (incl. time zones, hourly / weekly / register / rollover / reset / partial months) + 38 API (incl. OAuth, ingest, corrections, approved lock, bills end to end with generated PDFs).

## 2026-10-10 (4) — Month by month entry; factor library filters

**Month by month** (Add data → period row → "Month by month"): set the inputs once, then type or paste the 12 readings; one entry per month is saved.
- Paste a row or a column from Excel into January (or any month) to fill from there; each month is calculated as you type; months that already have the same entry are flagged; a month with a problem stays on screen while the others are saved.
- Available for: stationary fuels (incl. own calorific value); fugitive "quantity refilled"; vehicles — one vehicle or type, and **fleet × 12 months** (vehicles down, months across, paste a block, months outside a vehicle's service closed); electricity, heat and cooling (same supplier / region / plant; certificates are claimed per month); waste — incineration (one waste type), composting, anaerobic digestion, wastewater (inflow per month), Scope 3.5 (one material and route).
- Not offered where it does not apply: landfill methane (yearly model), screening / mass balance for gases, measured stack CO₂ or biogas.
- Wastewater with flow × concentration: nitrogen and effluent BOD/COD now entered as mg/L (converted with the flow, shown in the steps), so they work month by month.

**Factor library → Factors**: category chips by scope with item counts; a subcategory filter; the list shows only the chosen category; search looks across all categories (results labelled category › subcategory). Waste items explain that their values are IPCC defaults shown on the entry screen.

**Tests**: 30 engine + 31 API.

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

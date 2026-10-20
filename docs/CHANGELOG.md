# Change log — Ekotrace platform (new codebase)

Newest first.

## 2026-10-20 · Smart import (AI) of any emissions spreadsheet; purchases browsed by the Ekotrace list

- **Capture → Smart import** (`/import`; migration 051: `import_job`, `import_sheet`, `import_row`, `import_rule`, `tenant.ai_import`; `lib/smartImport.ts`, `modules/smartImport.routes.ts`): upload .xlsx/.csv (20 MB, 5,000 rows per sheet; file kept in the vault as `data`). Per sheet a layout (`SheetMap`: header row, rows or months-across, column roles, months, constants) proposed by the company's AI from the first 40 rows (validated with zod; falls back) or worked out from the headings (month headings, keyword columns, numeric-column fallback, unit in heading, sheet name as activity), editable. Rows: totals/zeros skipped. Resolution: facility (rule → exact → unique contains → only facility), item (rule → word match against names/aliases/subcategories filtered by unit and factor units → AI among candidates), unit (item units, "kWh" → kWh_e on electricity), dry-run calculation with warnings, duplicates left out. Statuses ready / check / problem / excluded / created; confirm activities, choose facilities, remember answers, leave rows out. Create: `saveEntry` per row in a savepoint, linked to the file (evidence), submitted for approval.
- AI settings: "Use AI when someone imports a spreadsheet" (`ai_import`, default on); what is sent is listed. `aiChoose` takes a system prompt.
- **Purchases category picker**: "Browse the Ekotrace list" (category › subcategory › product with type and factor, `GET /api/purchases/tree`); search shows Ekotrace-list products first. **Factor library** (purchased goods): views *Ekotrace list* and *EPA commodities (NAICS)*.
- Tests: smart import end to end (months across, rows down, totals, notes sheet, text months, thousands separators, kWh, remembered answers, evidence link, submitted, duplicates on re-import, companies apart, AI layout and AI off). Manual: new Smart import chapter; Purchases chapter (browsing).

## 2026-10-20 · Purchases: published entries go to the approver and show in Add data; AI connection per company

- **Publish = submit for approval**: entries published from a purchase batch are created as submitted (submitted by the publisher); the batch review is the maker's check, the facility approver the checker. Before, they were drafts with no place to submit them for capital goods, upstream transport and leased assets.
- **Add data → Purchases** now holds every purchase-derived entry (3.1, 3.2, 3.4, 3.8 and those moved to 3.6), marked "From purchases → category" (`CAT_SQL` in review.routes; `groupOf` in AddData). Moved business-travel entries also show in the Business travel tab.
- **AI connection** (Setup → Integrations, AI & batch runs → AI, super admin; migration 050; `lib/ai.ts`, `modules/ai.routes.ts`): Claude (Anthropic Messages API), ChatGPT (OpenAI), Gemini (OpenAI-compatible endpoint), Azure OpenAI, other OpenAI-compatible, or the platform's service (AI_MAP_*). Key encrypted (AES-256-GCM), only the last 4 characters shown, never in the audit log; custom addresses https only and never into private networks (SSRF guard, `AI_ALLOW_PRIVATE_URLS` for tests / on-premise); test call; master switch; plan check.
- **When AI runs** for purchases: `large` (default — after the first calculation, material kinds still on the average factor, largest first: `aiLargeGroups`), `unidentified` (every unidentified kind during mapping), `off`; at most N kinds per file (default 300). `aiMap.ts` now takes the company's connection.
- Factor library: spend categories without their own list (3.2, 3.4, 3.8) say they use the purchased-goods factors, with a link.
- Removed client names from screens and templates (previous commit). Tests: publish status and the Purchases tab; AI settings (plan, key handling, encryption at rest, audit, address guard, test call, Anthropic and OpenAI formats, candidates only). Manual: Purchases and Integrations chapters.

## 2026-10-18 · Manual: purchases mapping flow

- Purchases chapter: new section "How purchases are mapped — the whole flow" (cleaning, grouping and the split of vague descriptions by supplier, the mapping order with what is confirmed automatically, how the BM25 description match and its confidence work, AI among candidates, average factor for goods or services and when a person must confirm it, worked example). Corrected: AI is used for every kind still unidentified after the text match, not only large ones; the category-text default (step 6) was missing.

## 2026-10-18 · Quantity check: seasonal band, and shown while typing

- **New check method** (`lib/rangeCheck.ts`), chosen under Methodology → Quantity check (`checkMethod` in the approval settings; default `smart`): two forecasts — seasonal (same month last year × recent trend, last 3 months vs the same 3 a year earlier, clamped ×0.5–×2) and level (6-month average) — are scored on the last 12 months; the one with the smaller robust spread (MAD of log errors) gives the expected value (bias-corrected by its median error) and the band, ±3 × that spread, at least ±10%, at most ×3; ± the limit around the seasonal forecast until it can be scored; 6-month average ± limit with less than a year. The 6-month average ± limit stays available.
- One history query for any number of entries (approved monthly entries of the same facility, item and unit); replaces the per-row `USUAL_SQL` subquery in Approvals, Home and the data-quality checks.
- **Add data month grid**: the Check column now calls `POST /api/activities/check` (same rule and limits as the approver, including a metric's own limit) instead of the browser's median ±60%; outside the range the note asks why. Hover shows how the range was worked out.
- Entries of a vehicle or a meter are compared with that vehicle's or meter's own months (before, one van was compared with the whole fleet's monthly total, which flagged every van of a two-van fleet as −50%).
- Tests: unit tests of the band (a normal summer peak passes where the 6-month average flags it; a 50% jump is flagged; steady noisy data uses the 6-month level; fallback without a year of history) and the live-check endpoint. Manual updated.

## 2026-10-17 · ESG & materiality: frameworks, double materiality assessment, industry questions; supplier portal ESG impact

- **Menu → Disclose → ESG & materiality** (`/esg`): Frameworks & set-up · Double materiality · ESG data · Content index · Excel export. Migration 049 (`esg_assessment` per year, `esg_topic`, `esg_answer`, all with row-level security; purge order updated).
- **Rules in one place** (`lib/esg.ts`): 9 frameworks with the materiality each needs (ESRS double; GRI impact; IFRS S1/S2 and SASB financial; VSME, ADX, DFM, Saudi Exchange, CDP none — recommended); the 10 ESRS topics; 16 industries with their usually-material topics; general and industry-specific questions with references to ESRS, GRI, IFRS S2, ADX, Saudi Exchange and SASB; scoring — impact severity = mean(scale, scope, irremediability) (positive: scale, scope), potential × likelihood ÷ 5 except potential negative human-rights impacts; financial = magnitude × likelihood ÷ 5.
- **Assessment**: thresholds per side (default 3), materiality follows the scores needed by the frameworks chosen, or a decision with a required reason; matrix; suppliers' 0–5 ratings aggregated per topic; send for approval once every topic is assessed and stakeholders are listed; a second super admin/admin approves or returns with a note; platform staff never approve; any change reopens an approved assessment.
- **ESG data**: questions of the material topics (or the industry's usual topics before any is material); numbers, percentages ≤ 100 and yes/no checked; GHG questions filled from the inventory. Export: materiality, IROs, ESG data with one reference column per framework, content index, method and stakeholders.
- **Supplier portal**: new optional step "ESG impact — double materiality" (industry, 0–5 impact and financial rating per topic with the main issue, ISO/policy/workforce/environment facts, report link); validated, not counted towards completeness; shown in the staff review drawer.
- DEMO (invented): a 2025 assessment for the demo waste company (GRI, IFRS S1/S2, ADX), every topic scored, 5 stakeholder groups, 13 data points; two demo suppliers answer the ESG section. Manual: ESG chapter. Test added.

## 2026-10-17 · CBAM (EU Carbon Border Adjustment Mechanism): producer and importer sides

- **Menu → Disclose → CBAM** (`/cbam`): Overview · Installations · Emissions reports · Imports & declaration · Default values & benchmarks. Migration 048 (`cbam_installation`, `cbam_process`, `cbam_report`, `cbam_report_line`, `cbam_precursor`, `cbam_good`, `cbam_import`, `cbam_reference` with shared rows readable by all; RLS; purge).
- **Rules in one place** (`lib/cbam.ts`): aggregated goods categories with routes and qualifying parameters (IR 2025/2547 Annex II); Annex I CN codes by prefix (`cnInfo`); SEE per process = (attributed direct + precursors) ÷ activity level, indirect = electricity × factor + precursors, indirect counted for cement and fertilisers only; share on default values; default-value mark-up 10/20/30 % (1 % fertilisers); CBAM factor 97.5 % 2026 → 0 % 2034; certificates = max(0, SEE − benchmark × CBAM factor − carbon price ÷ price) × mass.
- **Producer**: installations as registered in the CBAM Registry (O3CI), production processes, yearly report (activity, attributed emissions, electricity, default share, parameters, goods by CN code checked against the sector, precursors actual/default), period, electricity factor, verification, carbon price paid, EORI numbers shared with; verified reports locked (super admin / admin reopen). **Export** `.xlsx`: summary emissions report (Annex IV 1.2 data points), sheet for EU importers per CN code, O3CI entry sheet in portal order. The installation's facility Scope 1 is shown beside the attributed emissions.
- **Importer**: import lines (date → quarter, CN, origin, mass, procedure, supplier, installation, route), actual SEE (or from the company's own installation report) or default value; library lookup of default values (CN prefix + country) and benchmarks; certificate prices per quarter (2026 Q1–Q3 seeded); upload of the customs broker's Excel / CSV with preview, template; **declaration workbook** (summary, goods by CN × origin, installations & verification, certificates, lines).
- DEMO (invented): an aluminium recovery line with a 2026 draft report (remelt and extrusion, own billets as precursor), five 2026 import lines, illustrative default values and benchmarks marked as such. Manual: CBAM chapter. Test added.

## 2026-10-17 · Table alignment everywhere

- Number headings now sit over their numbers: `.t th` (left) was overriding `.num` on headings, so every number column had its heading on the left and its values on the right. Number headings and cells are right-aligned; a number column's heading follows its cells even without a class (CSS `:has`).
- Short tag columns (Scope, Status, Stage, Version, Data quality) are centred (`th.ctr` centres its column). Rows are centred vertically; headings no longer wrap.
- Entries & results: period shown as "Sep 2026" on one line; unit names (room-nights, m²-hours, t-km, US gallons…) instead of codes.

## 2026-10-16 · Countries picked by name; city suggestions

- **Country lists instead of typed codes** (`components/CountrySelect`, `lib/countries.ts`, 248 countries from the OurAirports list; common Gulf and partner countries first; the code is still what is stored): facility profile, new company (platform console), add supplier and supplier profile, supplier portal ("Your company"), fuel prices and the factor form (with "All countries (global)"). Earlier answers typed as a name (e.g. "India") are turned into the code when opened.
- **City / area** on the facility profile suggests cities of the chosen country as you type (`GET /api/geo/cities`, from the airport list); any text is still accepted.
- Countries shown by name where codes were shown: facility list, grid region ("United Arab Emirates — national average"), companies in the console, supplier lists and portal review, fuel prices.

## 2026-10-16 · Add data: the full calculation of each month row

- **ⓘ How?** under each row's emissions in the month rows (fuels, vehicles, energy, waste, water) opens a drawer with that row's calculation before it is saved: totals per part (Scope 1, well-to-tank…), the factors with source and check (quantity × factor = t), the **split per gas** (kg of gas × GWP) and the numbered **calculation steps**, open at once. As in the prototype's "Understand calculation steps". Previously only the single whole-year form showed it.

## 2026-10-16 · `npm run app` and `npm run demo` bring the database up to date first

- Both now run the migrations before starting, so pulling new code can no longer leave the screens running against an older database (new tables and columns missing, calculations and pages failing). Migrations already applied are skipped.

## 2026-10-16 · Server commands for platform admin logins

- `npm run admin:list` lists the platform admins on the server (email, name, MFA, last sign-in). `npm run admin:reset -- --email …` sets a new temporary password (shown once, must be changed at sign-in), unlocks the account, ends its sessions and records it in the audit log. MFA is left as it is. Server-only (`src/cli/admins.ts`); not reachable from the web.

## 2026-10-15 · Side menu: related pages under one entry, as tabs

- Menu entries with `tabs` (`NavItem.tabs`): one entry for several pages; on those pages a tab bar (`.sectabs`) above the page switches between them. Routes are unchanged, so old links and notification links open the right tab. Each tab keeps its own roles; the entry shows only if a tab is allowed, takes the tab's name when only one is, and its count adds up the counts of its tabs.
- Merged: Dashboards + KPI dashboard; Entries & results + Approvals (**Entries & approvals**); Data progress + Collection calendar; Inbox & to-dos + Message centre (**Inbox & messages**); Methodology & boundaries + Metric registry (**Methodology & metrics**); Energy certificates & suppliers + Currencies & price index (**Energy & currency data**); Integrations & API + Batch runs (**Integrations & batch runs**). Product LCA moved into Value chain; the AI models placeholder removed. Organisation & groups and People & access stay separate. Super admin: 30 entries → 22.
- Manual: Getting started (menu entries and their tabs) and menu paths throughout.

## 2026-10-15 · Product LCA: product carbon footprints (ISO 14067 / GHG Protocol Product Standard)

- **Menu → Product LCA → Product footprints** (`/lca`, its own menu section, replaces the stage-4 placeholder). Tabs: Products · LCA workspace · Life-cycle inventory · Scenarios · Published factors.
- **Model** (migration 047): `lca_product` (goal & scope: declared unit from the unit table, functional unit, boundary cradle-to-gate / cradle-to-grave / gate-to-gate, standard, allocation, cut-off, reference year; supplier or own product; spend category), `lca_input` (stage, amount per declared unit, factor from the library or own value, data quality verified / measured / supplier / estimated, source), `lca_scenario` (changes per input: library factor, amount, factor), `lca_publication` (each published version frozen), `lci_factor` (shared indicative library of 29 factors readable by every company + company factors, RLS), `supplier_ef.lca_product_id`.
- **Calculation** (`lib/lca.ts`): Σ amount × factor per declared unit, stages outside the boundary kept but not counted; emissions-weighted data quality (1 / 0.9 / 0.8 / 0.5); hotspots; ecodesign levers (lowest like-for-like library factor: same stage, unit and material family); scenarios.
- **BOM import** (`POST /api/lca/products/:id/import`): CSV / tab / semicolon lines `input, stage, amount, unit, kgCO2e_per_unit`; blank factor matched to the library by name (ties to the higher factor); preview, then add or replace.
- **Review**: draft → in review (super admin, admin, manager, preparer send) → verified (super admin, admin or verifier who did not last edit or send it; never platform staff; return needs a note) → published (super admin, admin), version + 1. Any later change returns the model to draft marked *republish*; the published factor stays in use until the next version. Notifications on send / verify / return. Published products cannot be deleted; their supplier is fixed.
- **Supplier products**: publishing writes / updates one `supplier_ef` per product (unit = declared unit, source "Product LCA: name vN (standard, boundary, year; verified by …)") and recalculates the supplier's unpublished purchase lines. Products tab shows the purchase lines and tCO₂e calculated with LCA factors.
- **Company factors**: add / edit / retire (super admin, admin, manager); editing updates the models using it (back to draft). Shared rows cannot be changed by a company.
- DEMO (invented): recycled aggregate (published), crumb rubber from ELT (in review), recycled HDPE pellet (draft, solar scenario), rebar from "Desert Rebar Mills (DEMO, not real)" (published; H2 rebar purchase lines use it). Manual: Product LCA chapter. Test added (80 API tests pass).

## 2026-10-15 · Supplier answers checked for consistency; document uploads

- **Consistency check** (`conflicts()` in the supplier portal): the share for the customer (own calculation) cannot exceed the supplier's Scope 1 + 2 (higher of location / market), sales to the customer cannot exceed revenue. Shown live on the portal (save disabled), refused on save of either section and on submit (`INCONSISTENT`), flagged in the staff review where accepting is blocked.
- **Uploads**: on the portal, attach the report / verification statement in the Emissions section and an EPD on each product (sets the product's document); on the supplier record, staff upload documents (report, verification, EPD, CDP response, contract, other — PDF, image, .xlsx, .docx ≤ 20 MB; `POST/DELETE /api/suppliers/:id/documents`, `supplier.documents`, migration 046), listed with the files the supplier sent. Test added (79 API tests pass).

## 2026-10-15 · Supplier engagement (after Greenly's supplier module): manual entry and list import, engagement funnel, climate score, analytics, trajectories, SBTi list

- **Add suppliers by hand** (drawer replaces the inline form): type current / prospect, internal code, country (code or name, `countryCode`), procurement department, industry, size, website, contact, reports emissions, CDP score, climate target and declared target; optional invitation to the portal in the same step. Duplicates refused by name, known spellings or code. `POST /api/suppliers` takes the new fields (`supplierBody`).
- **Import a supplier list** (`POST /api/suppliers/import?commit=0|1`, Excel / CSV): columns recognised by name; preview per row (new / completes / already there / error), then create (origin `list`) and fill only empty fields of existing suppliers. CSV template. **Download list** (`GET /api/suppliers/export`).
- **Supplier list like "My Suppliers"**: engagement tabs (Not engaged · Invited · Signed in · Survey started · Submitted · Finished, from the latest portal request), filters by name, internal code, procurement department, hide prospects, sort by CO₂; columns score grade, GHG report ✓/✗, SBTi ✓/✗, completion %, type, department. Panel: score card (breakdown, engagement, SBTi list match, improvement actions, invite / open request) and new fields (type, department, CDP score / year, declared target).
- **Climate score** (`lib/supplierScore.ts`, 0–100 → A+…E): measurement 25, target 30, disclosure (CDP) 15, data shared 20, product footprints 10, with the actions that earn the missing points. Shown to staff and to the supplier on the portal (with its score details); optionally the supplier also sees the customer's estimate of its emissions (`supplier_request.share_estimate`, off by default).
- **Engagement tab** (`GET /api/suppliers/engagement?year`): emissions-weighted SBTi objectives, CDP scores, grades, funnel; non-SBTi and C-or-lower suppliers by country and Scope 3 category; KPIs (validated / committed share vs the SBTi's 67% supplier-engagement benchmark, answered share, average score, CDP coverage). **Supplier trajectories** to 2050 from declared targets or the SBTi pathway, credibility high / average / weak, scenarios optimistic / prudent / no action, by supplier or credibility, filters.
- **SBTi list** (`sbti_company`, `POST /api/sbti/import`, platform admin): the SBTi target-dashboard export loaded once for the platform and matched to suppliers by normalised name; feeds score, SBTi ✓ and trajectories. Accepted portal answers now also store the supplier's declared target.
- Tabs: Suppliers · Engagement · Supplier portal · Spend analytics · Check names. Tabs scroll on phones.
- Migration 045 (`supplier.kind / department / cdp_score / cdp_year / target`, origin `list`, `supplier_request.share_estimate`, `sbti_company`, `sbti_import`). DEMO: departments on the largest suppliers; CDP scores, targets, three prospects and a five-company DEMO SBTi list only for invented suppliers (the DEMO list is loaded only if no real list exists). Manual: Suppliers chapter. Test added (78 API tests pass).

## 2026-10-15 · Supplier portal (suppliers sign in and report)

- **Public portal `/supplier`:** a supplier's contact signs in with work e-mail + access code (no account; code shown once, stored as a hash, 1–12 months, replaceable / revocable; 8-hour sessions, header `x-supplier-token`; sign-in rate-limited). Sections saved one by one: company profile; emissions inventory (Scope 1, 2 location / market, 3, categories, revenue and currency, boundary, standard, verification); share relating to the customer (by revenue, own calculation, or none); climate targets (SBTi validated / committed, own, none; %, years, net zero, link); product footprints (kg CO₂e per unit, standard, boundary, validity, verified, document); evidence files (PDF / JPEG / PNG ≤ 15 MB); review and declaration (name, title). Live intensity (kg CO₂e per currency unit) and tonnes for the customer. Locked after submitting until queried. Login page link "Suppliers: share your emissions data".
- **Staff: Suppliers → Supplier portal** (super admin, admin, manager): invite (supplier, year, contact, message, due date, validity, e-mail the invitation with the code), new code, remove access; requests with status, progress, emissions from purchases and the supplier's figure; largest suppliers not asked yet; coverage of purchase emissions. Review drawer: every answer and file; **Accept** updates the profile and turns the intensity and chosen product footprints into supplier factors (`supplier_ef.request_id`), recalculating the supplier's unpublished lines; **Query** with a note. Platform staff cannot accept. Inbox notice on submission; e-mails on invitation, query, acceptance.
- Migration 044 (`supplier_request`, `supplier_session`, RLS, purge). Audit trail of every supplier action. DEMO: four invented suppliers (accepted with a factor, submitted, in progress with a code printed by the demo, invited). Public pages no longer call the staff session check. Manual: Suppliers → Supplier portal. Test added (77 API tests pass).

## 2026-10-15 · Batch runs: transfer log, integration health, reconciliation, retry

- **Batch runs** (Menu → Capture, was a stage-4 placeholder): `/batches`, for super admin, admin, verifier (all) and manager (batches of their facilities).
  - **Transfer log:** every POST by a known client to `/api/v1/meter-readings`, `/api/v1/purchases` and `/complete` is logged (`integration_run`, new): records received, accepted, refused with reasons (sample of 200), HTTP status, error returned, batch reference and link, duration. Failed calls included (the client is identified before validation; content-type checks moved after it). Kept 400 days.
  - **Integration health** per API client: healthy / failures in the last 24 h / failing / gone quiet / never / revoked; transfers, failures, records accepted; last success and failure; expected interval (`api_key.expect_hours`). Alerts to super admins and admins: a failed call (at most once an hour per client) and a quiet client (once per gap, hourly check in the collection worker). Purchase-file and utility-bill channels shown beside.
  - **Reconciliation** per purchase batch: source control totals (`purchase_batch.control`: lines, amount per currency) sent by the system (`control` on `/api/v1/purchases` or `/complete`) or entered for a file; flow sent → received → published / excluded / duplicates / problems / in review → entries by status (lines, amounts per currency, tCO₂e); checks (lines, totals per currency, every line has an outcome, published lines in entries, entry emissions = line emissions, entries approved); state reconciled / differences / in review / no source totals / not processed; problem lines, published lines missing from entries, transfer and job history.
  - **Retry** of failed processing (re-queues the failed job; super admin, admin, manager; audited `batch.retry`).
  - Meter-reading review batches listed with received, refused, new / corrections / duplicates / conflicts.
- DEMO: source totals on both purchase files (the second 3 lines short of its footer), three DEMO connected systems with 30 days of transfers (Oracle failing, SAP gone quiet), one failed API batch to retry.
- Migration 043. Manual chapter "Batch runs"; Integrations chapter: control totals and the transfer log. Test added (76 API tests pass).

## 2026-10-15 · Carbon credits register (Net zero)

- **Carbon credits** (Menu → Net zero, was a stage-4 placeholder): `/credits`.
  - **Purchases (lots):** project, registry and project ID, methodology, type (avoidance / nature-based removal / technical removal), project type, country, vintage, tonnes, price and currency, supplier, contract date, status (contracted / delivered / cancelled), serials, ICVCM CCP, CORSIA, Article 6 corresponding adjustment, permanence, contract from the vault, notes. Super admin and admin.
  - **Retirements:** from delivered lots only, never more than available (waiting retirements hold their credits); reporting year, purpose (voluntary, neutralisation, BVCM, CORSIA, compliance), serials, beneficiary, registry link, statement. Neutralisation needs removals. A second super admin or admin approves; platform staff never do; rejection needs a reason; the author can withdraw. Only approved retirements count. Notifications, inbox to-do, audit (`credits.*`).
  - **Year view:** gross (whole company, approved) beside credits retired by type and purpose, net after credits, cost, held and contracted pipeline, residual at net zero (resid % of the restated base year) against removals held or contracted.
  - A lot in use keeps its type, vintage and status and cannot go below what is retired; it cannot be removed.
- **Dashboards → Net zero** and the Overview card now use the register: credits retired, net after credits, pipeline, emissions-vs-offsets bars split into net and offset, credit portfolio by type, residual from the restated base year.
- **Reports:** new section "Carbon credits (reported separately)" (Board summary, GHG Protocol, ESRS E1 templates). **Verifier pack:** the year's retirements; `credits.*` in the trail.
- DEMO data: four DEMO projects (not real), three approved retirements for the base year, one waiting.
- Migration 042 (`carbon_credit_lot`, `carbon_credit_retirement`, RLS, purge). Manual chapter "Carbon credits". Test added (75 API tests pass).

## 2026-10-15 · Self-approval setting (off by default); platform staff no longer approve company data

- **Self-approval** (Methodology → Approval levels → Self-approval, super admin): "Allow super admins, admins and managers to approve their own entries", optionally only below a size in tCO₂e. Off by default.
  - When on, own entries appear under "Waiting for you" as "Your entry". **Approve my own…** needs a note saying what the entry was checked against.
  - The entry is marked self-reviewed (with the note, new column `activity.self_review_note`). A new data-quality check, "Segregation of duties", lists these entries, and the verifier pack counts them.
  - "Approve all without warnings" never includes own entries. Data preparers never approve. Level 2 is always another person.
- **Platform staff (Ekobon)** can no longer approve or send back company entries, or decide registry changes and base-year restatements; they view and help. Their approval queues are empty.
- Manual (Approvals): who approves a manager's entry, self-approval, platform staff. Migration 041. Test added (74 API tests pass).

## 2026-10-14 · Carbontek name and a new sign-in page

- **Product name:** the platform now shows **Carbontek** (brand pack `brands/carbontek`, now the default; `BRAND=ekotrace` brings the Ekotrace name back). The name comes from the brand pack everywhere: menu, sign-in, contractor and scan pages, manual text, MFA app label and recovery-codes file, e-mails and notices, exports and downloaded file names, report declarations, the destruction certificate, demo texts. Internal identifiers (token audience, syslog app name, SCIM schema, package names) are unchanged.
- **Brand mark:** a new mark (an open carbon-cycle ring around a node) replaces the "e" tile.
- **Sign-in page redesigned:** split screen. The brand side shows the product, one line on what it does, and monthly bars stepping down from the base year to net zero along a dashed target path (illustrative; they grow in once, still with reduced motion). The form side has the email and password, company sign-in (SSO), and links for survey answers and waste contractors. It works on phones, with the brand side as a short band on top. The code, recovery and company sign-in steps keep the same flow.
- Colours stay the platform's green (Carbontek brand pack updated to match).

## 2026-10-14 · Base-year recalculation and restatement

- **Methodology & boundaries → Base year & restatements (RFP 3.2.9; GHG Protocol ch. 5; ISO 14064-1 §6.4.1):**
  - Record a change against the base year: trigger (acquisition, divestment or closure, in- or outsourcing, method, factors or GWP, error, boundary, other), date, facility or whole company, the change by scope (Scope 2 location and market), description, and evidence from the Document vault. "Use its base-year emissions" fills in a facility's figures.
  - A second person approves or rejects it (a super admin or admin, never the person who recorded it; a reason is needed to reject). The person who recorded it can withdraw it while it waits.
  - Significance threshold: 5% by default, set by the super admin. A change at or above it restates the base year. Below it, the change is recorded and counts towards later ones; when their net effect reaches the threshold, all are applied together (cumulative test). "Restate anyway" applies a change below the threshold.
  - The panel shows the base year as measured, the restatements applied, the restated base year and the recorded changes waiting.
- **Restated base year used** for the base-year figure and monthly base on dashboards, Home and the KPI dashboard; for Targets & actions (target paths, Net Zero trajectory, like-for-like reduction); in the report section "Base year and restatements" (as measured, restatements, restated, history, policy) and the ISO 14064-1 report; and in the verifier pack, whose change trail includes them. Comparisons with the previous year use figures as measured.
- **Views:** a change for a facility counts in views that include it; a whole-company change in whole-company views. A facility switched off is already left out, so its divestment record is not subtracted again.
- Notifications to the deciders and the person who recorded it; Inbox to-do "base-year changes to approve"; every step in the audit log.
- Demo: one DEMO restatement applied (landfill methane measured instead of modelled) and one acquisition waiting for approval.
- Database: migration 040 (base_restatement with row-level security; tenant.restate_threshold).

## 2026-10-14 · Metric registry, collection calendar, reminders and escalation, Inbox & to-dos

- **Metric registry (Setup) — the data dictionary, separate from the factors (RFP 3.2.1):**
  - One standard metric per category to start (EKO-001…), each with an approved definition, scope and category, items, reporting unit with conversion rules, owner, facilities it applies to (types or a list), required or not, source system, collection methods, frequency and due day, check limit and evidence rule.
  - Metrics are collected per facility, or once for the whole company (purchases, travel, commuting).
  - Every change is a new version with its reason, who changed and who approved it, and what changed. An admin's change waits for a super admin's approval (never their own). Metrics are retired, never deleted.
  - The registry drives the rest: the calendar, reminders, the check limit on Approvals and in data quality, and the evidence rule (required evidence blocks submission and approval; a new data-quality check lists entries without it).
- **Collection calendar (Capture) (3.4.1 b, e, i):**
  - Every obligation (facility × metric × month, quarter or year) with its due date, the people responsible, the data in (converted to the metric's unit), evidence missing, and its status: approved, in review, open, due soon, overdue, escalated, excused.
  - Views by month and as a list; filters by status, facility and "only mine"; share of periods complete on time.
  - Remind people now (once a day each); excuse a period with a reason (kept, shown to verifiers, can be undone).
  - The super admin sets the due day, "due soon" days, escalation days, and whether reminders go out automatically.
- **Reminders and escalation (3.4.1 c, 3.4.10):** hourly, once per kind and period: due soon and overdue to the people responsible, escalation to the facility manager and the admins above (else the super admins). Gathered into one message per person. People are also told at once when an entry is sent back to them, and when a registry change needs their decision or was decided.
- **Inbox & to-dos (Capture):** late and due-soon data, escalations, sent-back entries with the approver's note, approvals, registry changes and audit findings waiting, drafts; notifications (read / unread); a count on the menu.
- **E-mail:** notices also go by e-mail (SMTP_URL, MAIL_FROM; TLS required), queued in the same transaction and sent by the worker with retries. Each person can switch e-mails off. Without a mail server, messages are held and nothing leaves the platform.
- Demo: owners, rules and versions in the registry, one change waiting for approval, recent months left open, one month excused, reminders sent.
- Database: migration 039 (metric, metric_version, metric_change, collection_exception, reminder_log, notification, email_outbox; row-level security on all). Dependency: nodemailer 10.0.12 (pinned).

## 2026-10-14 · Security round 2: account sync (SCIM), security alerts, platform SSO, files encrypted at rest, stricter CSP, DAST

- **Account sync from the identity provider (SCIM 2.0) (4.2 joiners and leavers, PAM/PIM):**
  - `/scim/v2/Users` and `/Groups`, as Microsoft Entra ID provisioning, Okta and others send them: filters, PATCH with string booleans, members[value eq], group add / remove / replace. Authorised by a company token (SHA-256 kept).
  - Joiners get an account (no password; they sign in with SSO). Leavers are switched off at once and their sessions end. "Delete" keeps the person's history.
  - The super admin maps provider groups to roles: an Admin group to a sub-group, Manager / Preparer groups to facilities. A person gets the highest role of their groups.
  - In no mapped group a person has no access, or read-only if the company chooses. The last super admin is never removed. Plan limits are respected.
  - People & access shows "synced" and refuses manual role changes for these people.
- **Security alerts (Appendix A: actionable alerts):**
  - Rules on the sealed audit records:
    - failed sign-ins from one address (10 in 10 min);
    - an account locked;
    - MFA no longer required, switched off or reset;
    - a new super admin;
    - a full data export;
    - SSO or account-sync settings changed;
    - a new API client;
    - company sign-ins refused;
    - company data deleted;
    - the audit chain broken.
  - Each alert is raised at most once an hour per key. Alerts are written to the audit log, so the SIEM receives them as syslog error or warning.
  - Screens: an Alerts tab with "Mark reviewed" and a note, a red count on the menu, and the console list for the platform.
  - Failed sign-ins with unknown emails and attempts on locked accounts are now logged too.
- **Platform admins sign in with Ekobon's identity provider (4.2 admin console via SSO and MFA):**
  - Configured with the PLATFORM_SSO_… settings. MFA is required from the provider.
  - Password sign-in is refused, except for named break-glass accounts, which must use MFA.
  - Companies cannot claim the platform's domain.
- **Files encrypted at rest in the app (4.3):**
  - Every stored file (bills, invoices, permits, statements, purchase files, logos, message attachments) is encrypted with AES-256-GCM under the server key.
  - Existing files are encrypted at start-up: 24 locally.
  - Downloads, previews, exports and the purchases pipeline read them back unchanged.
- **Stricter Content-Security-Policy (4.9):**
  - No inline style blocks: `style-src 'self' blob:`, with only style attributes allowed.
  - The ISO report preview uses a stylesheet file. The print windows for reports and bin labels get their CSS as a browser-made file, and their inline Print button is gone (it was already blocked).
  - Checked in a browser on 15 pages and both print windows: no blocked content.
- **CI:**
  - A new DAST job starts the app with its database and scans it with the OWASP ZAP baseline. A FAIL fails the run; warnings are annotated and the report is kept.
  - GitHub Actions moved to the current major versions.
- **Cross-origin isolation headers:** COOP, CORP and COEP are set, so other sites can't open, embed or read Ekotrace pages and files. This clears the low findings of the first ZAP scan, which had no medium or high findings.
- **Fix: key file location.** Without DATA_KEY, the fallback key file is now kept in one place at the project root, whichever folder the server or demo starts from. Previously the server and the demo could each make their own key, and files encrypted by one couldn't be opened by the other. An older key file in apps/api is moved there or still used to open files. Servers that set DATA_KEY were never affected.
- **Fix: account sync replies after the commit.** A sync request now answers only once its change is saved, so a provider reading back at once sees the new role.
- **Dependencies:** pdfjs-dist 6.4.299, @fastify/static 10.1.6, marked 18.1.0, Instrument Sans font 5.3.0. TypeScript 7 is left for a deliberate upgrade.
- **Manual:** the Security chapter has new sections (account sync, security alerts) plus platform SSO, encryption, CSP and DAST; new glossary terms (SCIM, SAST / DAST).
- **Tests:** 71 API tests (3 new: SCIM as Entra sends it; alerts and file encryption; platform SSO with break-glass) and 52 engine tests pass.

## 2026-10-14 · Security: SSO, MFA, sealed audit log with SIEM feed, rate limits, data export and certificate of destruction

Closes the code gaps found against the BEEAH web application security standard.

- **Multi-factor authentication (4.2):**
  - Uses an authenticator app (RFC 6238 time-based codes): QR set-up on the account page and 10 recovery codes, each usable once.
  - The code step comes after the password, and a code can't be reused.
  - Wrong codes count towards the 15-minute lock.
  - The super admin can require MFA for everyone; people without it must set it up before anything else. The super admin can reset someone's MFA (lost phone).
  - On servers, platform admins must always use MFA.
- **Single sign-on (4.2):**
  - Per company over OpenID Connect (Microsoft Entra ID, Okta, Google…), using the authorization-code flow with PKCE, state and nonce.
  - Every ID token is checked: signature (RS256 / PS256 / ES256 against the provider's keys), issuer, audience, expiry and nonce.
  - The email domain decides the company, and each domain belongs to one company only.
  - "Must use MFA" refuses a sign-in without a second factor from the provider.
  - **Company sign-in only** refuses passwords, except for super admins with MFA (break-glass).
  - The provider must use https and not a private address (SSRF guard). Failed company sign-ins are logged with the reason.
- **Secrets:** MFA keys and SSO client secrets are encrypted with AES-256-GCM under a server key (DATA_KEY).
- **Audit log (4.3):**
  - Append-only: database triggers refuse UPDATE, DELETE and TRUNCATE for everyone.
  - Records are sealed every 10 s in a SHA-256 hash chain. "Check the whole chain" pinpoints a changed, removed or inserted record (tested by tampering with the guard switched off).
  - Kept 24 months by default (never less than 12), then purged automatically.
  - Records survive company deletion.
  - New events logged: sign-in method, MFA events, SSO settings, exports, file views.
- **SIEM:**
  - Push: RFC 5424 syslog over TLS, TCP or UDP (SIEM_SYSLOG), in order, with a cursor and error status.
  - Pull: `GET /api/v1/audit-events` for an API client with the new "Audit events" permission (OAuth client credentials).
- **Rate limiting (4.3 / 4.7):**
  - Every API request: 600/min per session, 300/min per address, 20/min on sign-in.
  - Over the limit returns 429 with Retry-After, plus RateLimit headers.
- **Fixes:**
  - The session cookie is always Secure on HTTPS deployments, also behind a proxy (TRUST_PROXY setting).
  - Stored files keep their stricter sandbox Content-Security-Policy.
  - Permissions-Policy header added.
- **Data return and destruction (5, 7):**
  - The super admin downloads everything as one ZIP: a CSV per table, every file, and a manifest with SHA-256 checksums. Secrets are left out.
  - The platform admin deletes a suspended company's data in one transaction (typed name, reason, export checksum). Nothing may remain, or the whole deletion is undone.
  - A certificate of destruction is produced: records per table, files, backup expiry and audit retention.
  - The demo reset uses the same routine.
- **Responsible disclosure:** `/.well-known/security.txt` (SECURITY_CONTACT).
- **Database role check:** with HTTPS on, the server refuses to start if its database user is a superuser or has BYPASSRLS, because that would skip company separation. It warns on laptops. CI now uses an ordinary role, and the GitHub checks (CI and CodeQL) pass.
- **CI/CD security (4.5 / 4.8):**
  - A GitHub Actions workflow runs the type check, build, all tests on PostgreSQL, `npm audit` (fails on high), and a CycloneDX SBOM kept with each run.
  - CodeQL code scanning (SAST) runs weekly and on every change.
  - Dependabot opens weekly dependency updates.
- **Screens:**
  - Sign-in: code step, recovery code, "Sign in with your company account".
  - Forced MFA set-up.
  - Account page: MFA card.
  - Setup → Security & audit log has tabs for Audit log, Sign-in & MFA (policy, who uses MFA, SSO set-up with test) and Data export & retention.
  - Platform console → Security & deletions: chain check, SIEM status, certificates.
- **Manual:** the Security chapter is rewritten (sign-in, audit log, export and deletion, settings for IT, mobile scope); new glossary terms.
- **Tests:** 68 API tests (3 new: MFA and policies, SSO against a mock identity provider, audit chain / SIEM / export / deletion) and 52 engine tests pass. `npm audit`: 0 vulnerabilities.

## 2026-10-14 · Document vault and Message centre

- **Document vault** (Capture → Document vault): every file of the company in one place.
  - **What is in it:** files uploaded here or attached to an entry. Files kept by other screens appear by themselves: bills, purchase files, contractor tickets and manifests, the assurance statement.
  - **Filed by:** type (15 types: invoice, utility bill, manifest, permit, certificate, contract, calibration, refrigerant log, travel report and others), facility or company-wide, period covered, valid until, data category, tags and note.
  - **Finding files:** filter by facility, type, year and month, and search names, titles, tags and notes. Tiles show files, expiring / expired, not linked to an entry, and the retention period.
  - **File types:** PDF, images, Excel, Word, PowerPoint, CSV, text and emails, up to 25 MB, checked by their content. The same file is never stored twice.
- **Evidence on entries:** the entry drawer in Entries & results and in Approvals has an **Evidence** panel.
  - It lists linked files, the meter's bills for the period, and QR collection scans.
  - **Attach a file** uploads and links in one step; **Unlink** keeps the file in the vault.
  - In the vault, a file's drawer links it to entries (several at once).
  - Linked files now count as evidence in Audit & assurance, the Home verifier view and the data-quality report.
- **Versions, archive, retention:**
  - A new version takes over the details and links, and the old one is kept.
  - Archiving needs a reason and can be undone. A file that supports an approved entry cannot be archived.
  - Delete for good is super admin only, for archived files past retention that support no entry.
  - Retention is 7 years by default (1–30), counted from the end of the period a file covers.
- **Locked months:** evidence can be added to an entry in a locked month but not removed. This is enforced by the database.
- **Access:** files follow facility access. Purchase files and assurance papers are for admins and verifiers only. Verifiers can read only. Every view, download and change is in the audit log. Downloads are served as attachments, so the browser never runs an uploaded file.
- **Message centre** (Help → Message centre):
  - **Conversations with the Ekotrace team:** topic, part of the app, subject, message and an optional screenshot or file. Status goes waiting → answered → closed, and a reply reopens a closed conversation.
  - **Who sees what:** people see their own conversations; the super admin sees the whole company's. Unread replies show as a count on the menu.
  - **Announcements** from the team (new factors, features, maintenance, regulation), each marked read per person.
- **Team side** (platform admin → Messages):
  - The inbox across all companies, needing a reply first: reply, reply and close, close, reopen.
  - An announcement composer for every company or chosen companies, with an end date, read counts and withdraw.
- **Demo:** 14 DEMO vault files (9 linked to diesel entries, one permit expiring, one calibration expired, one invoice not linked), 3 DEMO conversations and 2 DEMO announcements, shown to the demo company only.
- **Manual:** new chapters Document vault and Message centre; updated Assurance, Home and Glossary.
- **Tests:** 65 API tests (2 new) and 52 engine tests pass.

## 2026-10-14 · Grid electricity factors for other countries (US eGRID, EU EEA, Australia NGA, India, Singapore, China, Japan)

- **106 factors in 68 grid regions** now come with Ekotrace in `data/grid/grid-factors.csv`. They load by themselves when the server starts, and loading again changes nothing.
  - **United States:** EPA eGRID2023, for the national average and the 27 eGRID sub-regions, with T&D losses (Scope 3.3) from each region's loss %. Converted from lb CO₂e/MWh.
  - **European Union:** EEA, the CO₂e intensity of electricity generation in 2022, for 27 countries.
  - **Australia:** NGA Factors 2025, for the national figure, 6 states, NT and the two WA grids, with upstream Scope 3. To check against the DCCEEW workbook.
  - **India:** CEA CO₂ Baseline Database v20, 0.727 (FY 2023-24). To check against the CEA publication.
  - **Singapore:** EMA grid emission factor for 2023 and 2024.
  - **China:** MEE 2023 national average, plus the residual mix for market-based reporting.
  - **Japan:** the national average.
- Each factor keeps its source, publisher, link and a note. They show in **Factor library → Grid regions**.
- A facility picks its region (e.g. eGRID CAMX, Queensland) or falls back to its country.
- For a later year, the latest factor is used, with a warning.
- **Not included yet:** Canada, and the Gulf countries (no public official factor). The platform admin enters these.
- Manual: Factors & methodology (sources table, a new section on grid factors) and the glossary (grid region, eGRID, NGA).
- Test added; 63 API tests pass.

## 2026-10-14 · Audit & assurance; global report formats (ISO 14064-1 designed report, ESRS E1, IFRS S2, CDP, GRI 305, SECR, SB 253); company logo; global defaults

- **Audit & assurance** (menu → Disclose), for ISO 14064-3, ISAE 3410 / 3000, ISSA 5000 or AA1000AS, at limited or reasonable assurance:
  - **Engagement:** standard, level, provider, subject matter, materiality, status, conclusion and the signed statement PDF.
  - **Period locks:** a month with every entry approved can be locked.
    - The database then refuses any change in it — entries, edits, deletions, reviews, meters, imports, recalculation.
    - Unlocking needs a reason.
  - **Samples:**
    - Value-weighted or random, seeded so they can be reproduced.
    - Key items above a share of the total are always included.
    - Each entry is tested (agreed / exception with a note), and an exception can raise a finding.
  - **Findings:** severity, kind, impact in tCO₂e. The company responds; the verifier (or super admin) closes or reopens.
  - **Verifier pack:**
    - One HTML file: engagement, GHG statement with both Scope 2 methods and biogenic CO₂, factor sources, locks, samples and results, findings, conclusion.
    - Plus the change trail as CSV.
- **Reports — formats used worldwide**, grouped as Global standards, European Union, Country & regional, Internal and Your templates:
  - **ISO 14064-1:2018 GHG report** — a designed report with the company logo, key figures, key findings written from the data, charts and recommendations.
    - Charts: ISO categories 1–6, months, largest sources, facilities, direct emissions by gas, data quality and uncertainty.
    - Then boundaries, factors, exclusions and statement.
  - **ESRS E1 (CSRD):** E1-6 §48–53 (Scope 1, 2 location / market, Scope 3 by category, totals, intensity per net revenue, biogenic) and E1-5 energy.
  - **IFRS S2 (ISSB) §29(a)** — the basis of AASB S2, Singapore, SSBJ and UK SRS.
  - **CDP emissions module:** 7.6–7.8, by gas, country and division.
  - **GRI 305-1 to 305-4.**
  - **UK SECR.**
  - **California SB 253.**
  - Existing: GHG Protocol and Board summary. The UAE MOCCAE layout is kept as a regional option.
  - **Datapoints (CSV)** per format; the "MRV dataset" is now the entry-level dataset.
  - Report lines now carry the gas split, country, division and biogenic CO₂.
- **Organisation → Company details & logo:** legal name, registration no., LEI, region, sector and NACE / ISIC / NAICS code, regulator / registry ID, contact, website, net revenue and currency, financial year end; logo (PNG / JPEG) on every report cover.
- **Global defaults:**
  - A new company takes its currency and time zone from its country (about 70 countries). The country is now required — no UAE default.
  - Spend, prices and vehicle uploads default to the company currency.
  - Every time zone is available.
  - The commuting weekend follows the country.
  - Neutral examples for flights, groups, integrations, report equivalents and the manual (bills from any utility; biofuel blends).
- **Tests:** 62 API and 52 engine tests pass.
- **Manual:** new Audit & assurance chapter; report formats table; company details; glossary.

## 2026-10-14 · Waste contractor portal

- **Contractor portal at /contractor:** collection and treatment companies sign in with their work email and an access code.
  - No user account and no password.
  - The code is shown once, stored only as a hash, expires after 3–24 months, and can be replaced or removed. Sessions last 8 hours.
  - The contractor sees only the bins assigned to it; bins are linked by the contractor name.
- **Collections:** bin, date, weighbridge weight, manifest number, vehicle, ticket or manifest (PDF or photo up to 10 MB), note.
  - Hazardous waste needs the manifest; the same manifest twice is refused.
  - A contractor's collection is a collection scan of the bin, so its weighbridge weight replaces the site's scans in the month roll-up.
  - A collection without a ticket is marked.
- **Monthly statement:** tonnes per site, material and method, pre-filled from the collections, with the statement or certificate. It can be corrected until it is accepted.
- **Staff (QR & field app → Contractors):**
  - Give access, issue a new code, remove access.
  - Statements are reconciled against Ekotrace's own tonnes per site, material and method; gaps over ±10% are flagged.
  - Open the file, then Accept or Query (with a reason the contractor sees).
- **Controls:**
  - Nothing a contractor sends enters the inventory without the roll-up and approval by BEEAH (maker–checker).
  - Every action is in the audit log under the contractor's name.
  - Sign-in is rate-limited.
- **Login page:** new link "Waste contractor?". A bin label opened without signing in leads to the portal with that bin chosen.
- **DEMO:** contractor "DEMO Waste Collector LLC" (the access code is printed once by `npm run demo`) with a statement for this month; the food waste line is flagged.
- **Tests:** 61 API tests pass.
- **Manual:** QR & field app → Waste contractors; Glossary.

## 2026-10-14 · Waste by GRI 306 method, hazardous and manifest rules; QR & field app; coloured sub-tabs; collapsible menu

- **Waste sent out (Scope 3.5):**
  - **Disposal method** follows GRI 306. Diverted from disposal: preparation for re-use, recycling (closed- / open-loop), composting, anaerobic digestion. Disposal: incineration with energy recovery, incineration without energy recovery, landfill, other disposal (treatment).
  - Only methods with a factor for the material are offered. Re-use uses the recycling factor; both incineration methods use the combustion factor. Each step says so.
  - One factor set: DESNZ, end-of-life only, with no recycling credits.
- **Hazardous** is filled in from the material and can be changed: batteries, asbestos, fridges and freezers, mineral oil, and new hazardous streams.
  - New streams (DESNZ has no factor for them): clinical / healthcare, chemical and solvent, oily waste and sludge, paints and adhesives, contaminated packaging, other hazardous.
  - These use the nearest DESNZ factor and are saved as proxy data.
- **Manifest rules:**
  - Hazardous waste can't be submitted without its manifest number.
  - The same manifest with the same material and quantity entered twice is flagged.
  - The Waste dashboard shows incineration without energy recovery and other disposal.
- **QR & field app** (Capture menu):
  - **Bins:** material and usual method, hazardous, contractor, container size, density.
  - **Labels:** printable QR labels holding only a link with a code; opening one needs sign-in and access to the facility.
  - **Phone scan page:** Weigh (actual), Fill level (estimated from capacity × % × density), Collection (manifest — required for hazardous — and weighbridge weight). Location is stored only when ticked; scans are kept on the phone when offline.
  - **Checks:** more than the bin holds, the same bin scanned within 10 minutes, far from the bin's usual weight.
  - **Scans list:** remove a wrong scan while it's still open.
  - **Month roll-up:** weighbridge weights replace the field scans for that bin. Draft Scope 3.5 entries are grouped by material, method, hazardous and contractor; weighed and estimated stay apart; manifests are kept. Each scan is used once.
  - DEMO bins and scans at Al Zahia Community.
- **Design:**
  - Sub-tabs in every Add data category are outlined, with the chosen one filled (as in business travel).
  - The side menu has "Collapse all / Expand all" and « / » to narrow it to icons.
  - More space between menu items.
- **Tests:** 60 API and 52 engine tests pass.
- **Manual:**
  - Waste: disposal methods, hazardous, contractor and manifest.
  - New chapter: QR & field app.
  - Moving around: the menu.
  - Glossary.

## 2026-10-13 · Business travel: rows line up, meetings / events separate, factors load themselves

- **Factors load on start:** when the server starts it applies new migrations and loads any DESNZ / EPA / IPCC files the database is missing or has from an older importer, including when a category such as flights or rail has no factors at all. After `git pull` + `npm install`, `npm run app` is enough. Fixes "No DESNZ flight factor…" and the empty "Type of transport" list on databases seeded before business travel was added. `AUTO_SETUP=false` switches it off.
- **Alignment:** trip rows line up at the top, so a hint, a distance or an error under one box no longer moves the other boxes (flights, hotels, other transport).
- **Hotel stays** split into **Room stays** (country, hotel type, rooms, nights) and **Meetings / events** (country, hotel type, kind of room, m², hours). "Kind of room" fills in a typical size: boardroom ≈ 40 m², meeting room ≈ 60, training room ≈ 100, conference hall ≈ 250, ballroom ≈ 500.
- Meetings are saved as their own entries (m²-hours). Factor library: meeting space by hotel type (2- to 5-star), with "any hotel type" as the fallback. Until a factor is added the entry is kept at 0 with a note, ready to recalculate.

## 2026-10-13 · Business travel: flight types, connecting flights, hotel type and meeting space; factor library

- **Flights by type** — no distance to type. Types renamed **Domestic**, **Short-haul** (under 3,700 km), **Long-haul** (3,700 km or more) and **International** (average, when not sure), each with examples and the kg CO₂e per person one way; a typical one-way distance per type (450 / 1,500 / 6,500 / 3,000 km) is used and shown in the calculation steps.
- Flights from airports are typed by distance for every country pair (DXB–RUH is now short-haul, DXB–SIN long-haul) rather than "international" for anything not touching the UK. Saved entries are unchanged.
- **Connecting flights**: "+ via" adds up to two connecting airports; each leg gets its own distance and type and is saved as its own entry (note "DXB-DOH-LHR leg 1/2").
- Clearer switch between "From / to airports" and "Flight type" (filled, coloured active state).
- **Hotel stays**: hotel type (2- to 5-star, or not known) and **meeting space** (m² and hours); the hotel's own-factor box is removed.
- **Factor library**: flight items renamed to the new types with notes; new items for 2-, 3-, 4- and 5-star hotels (per room-night) and meeting / event space (per m²-hour, new unit), for CHSB / HCMI factors by country or for all countries. Until a factor is added, the stay uses the DESNZ country average and the meeting space is not counted (the entry says so). DESNZ 2026 air, hotel, land and sea factors are already loaded (DESNZ carried its 2025 air factors into 2026).
- **Other transport**: when no transport factors are loaded, the screen now says so and how to load them (migrate + seed) instead of an empty list.

## 2026-10-13 · Reports (as in the prototype); filters in Approvals

- New **Reports** page (menu → Disclose) for the selection and period viewed, location- or market-based Scope 2, **Download report** and **Print / PDF**.
- Tabs: **Summary** (total, scopes, per employee, equivalents, vs same months last year, by GHG Protocol category, top 10 sources, next steps); **GHG Protocol inventory** (1.1–3.15 measured / no data / excluded, exclusion reasons, exports: regulatory file, emission factors, entries); **Granular audit view** (every approved entry with factor, source, quality, capture, how calculated; search and filters); **Data quality** (actual/estimated/proxy, activity-based, supplier-specific, evidence, uncertainty, seven quality controls with justifications); **Templates & regulatory** (Board summary, GHG Protocol report, MOCCAE provisional layout, own templates with sections in order, MRV dataset CSV, reporting-entity details for the cover); **Versions** (save and compare with today).
- **Approvals**: filters by facility, category, month, check (with warnings / in range / no history), level, and search; "Approve all without warnings" acts on what is shown.

## 2026-10-13 · Approvals and Data progress (as in the prototype)

- **Approvals** page (menu → Capture, with the number waiting for you): entries waiting for you with facility and month, category and item, quantity, tCO₂e (How calculated), a check against the 6-month average for the same item (±35% by default), who entered it; Approve, or Send back with a note; **Approve all N without warnings**; entries waiting for someone else and who.
- **Approval levels** (Methodology, super admin): level 1 always; optional level 2 by an admin or the super admin — a different person — for entries of at least N tCO₂e or chosen categories; the check limit. Sending back clears both levels.
- **Data progress** page: each facility × month — Approved, In review, Partial, Missing, Future; hover for each category, click to open Add data for that facility and month (Add data now takes ?year= and ?month=).
- Home: the approval queue and "Needs your decision" link to Approvals and use the same check; entries covering several months count in each month they cover.

## 2026-10-13 · Targets & actions (as in the prototype)

- New **Targets & actions** page (menu → Net zero) with six tabs: Target register, SBTi setup, Scenario analysis, Action portfolio, ROI & cost, Tracking.
- Target register: target, reduction so far, committed abatement, approved investment; SBTi-compatible structure; scenarios compared; objectives (main SBTi targets + your own); largest actions; the targets with Scope 1+2 / Scope 3 paths and each facility against its path. Super admin edits the targets here.
- SBTi setup with a readiness check against the near-term criteria; **Import SBTi template** (1.5 °C, well-below 2 °C, Net-Zero Standard, supplier engagement).
- Scenarios: a Current plan plus any you create (optionally copying its actions); scenario lab with levers, saved lever settings.
- Action portfolio: a 21-action library sized from your own data (run-rate × typical reduction × metric value) plus custom actions; select into a scenario; details for KPI, period, owner, status, facility, planned and actual reduction, CapEx, OpEx, saving, life; exclude.
- ROI & cost: payback, ROI, TCO, NPV at 8%, cost per tonne, scenario comparison, marginal abatement cost curve.
- Tracking: Net Zero trajectory (year and residual % set by the super admin), projection waterfall, delivery tracking, estimated vs actual.
- Home "Reductions delivered" and the Net zero dashboard now show completed actions.
- Run-rate: entries covering several months are annualised; a yearly source not entered yet this year carries its base-year figure.
- Who: everyone views; managers and above change actions and scenarios; the super admin changes targets. All changes are in the audit log. Demo company: 2 scenarios and 7 DEMO actions.

## 2026-10-13 · Dashboards, Home and KPIs fill the screen; larger charts and text

- Charts are drawn at the size of their card instead of a fixed picture, so they grow with the screen while their labels stay readable; on Dashboards, Home and the KPI dashboard the main chart row stretches to fill the screen height (no empty band at the bottom).
- Larger text: headline numbers, card titles, legends, facility bars, axis labels; donuts about 15% larger, and their legend moves below the donut when the card is narrow so names are not cut.
- A chart with no data says so instead of showing an axis of zeros.

## 2026-10-13 · Side menu colours and full-width pages

- Side menu as in the prototype: each section has its own colour (Capture mint, Value chain amber, Net zero green, Disclose lilac, Setup grey, Help pink) — a coloured dot and title, a coloured line along its items, coloured icons and the current page highlighted in the section colour. Sections fold with ▾/▸ (remembered on this browser); the section of the open page always shows.
- Pages now use the full width of wide screens (no empty band on the right).

## 2026-10-13 · Home and KPI dashboard (as in the prototype)

- **Home by role** (replaces the old landing page): the month's data strip (due date, submissions in, overdue, escalated); super admin/admin — emissions, Scope 1+2 vs target path, data approved, monthly chart with last year and target path, Needs your decision, Facilities table, Biggest sources; manager — approval queue with Approve N clean; preparer — checklist and To fix; verifier — sample to test and assurance readiness; one-user companies — three steps, entries marked self-reviewed.
- **KPI dashboard**: 19 KPIs, monthly/quarterly/semi-annual/annual, aggregate or compare facilities, choose KPIs and set targets per selection (green/amber bars, dashed target line), Emissions vs target, Benchmarks.
- **Methodology**: reduction targets (target year, Scope 1+2 %, Scope 3 %) and collection rules (due day, due-soon days, escalation days).
- Dashboards count a month as in once it has approved data; a one-user company's super admin can approve their own entries (self-reviewed).
- Not yet: "Reductions delivered" waits for Targets & actions; reminders are not sent yet.

## 2026-10-13 (24) — Business travel (Scope 3.6): flights, hotel stays, other transport, spend

- Migration 024: `business_travel` gets calc method `trip` and sub-categories Flights, Hotel stays, Rail, Bus and coach, Taxi, Car hire and own car, Ferry; unit `room_night`; `tenant.flight_rf` (default with radiative forcing). Purchases still move spend lines into 3.6 (spend categories now include business travel by code).
- DESNZ importer v12: Business travel – air (haul × class × with/without RF, per passenger-km, gas split) and its well-to-tank; hotel stay per room-night by country (ISO code kept); business travel – sea; land travel as business-travel items (rail, bus, taxi, cars by size and fuel). 2022–2026.
- Airports: OurAirports (public domain) medium and large airports with IATA codes in `data/airports/` (+ countries); `lib/airports.ts`: search, great-circle distance, +8% uplift, haul (same country → domestic; to/from GB → short < 3,700 km / long; else international).
- Calculation (`trip` input): flights from / to airports or haul + one-way km (typical distance when empty, with a warning); class mapped to what DESNZ publishes for the haul; return × 2; trips; RF as the company chose (Methodology) unless given; hotel rooms × nights (latest earlier year's factor when the year has none; hotel's own factor); ground one-way km × return × trips. Well-to-tank counted in 3.6. Steps explain distance, haul and passenger-km; inputs kept on the entry; recalculation keeps the passenger-km.
- API: `GET /api/trips/airports`, `/api/trips/distance`, `/api/trips/options`; `PATCH /api/tenant {flightRf}`.
- Web: Add data → Business travel with Flights / Hotel stays / Other transport / By spend: one row per trip (month, from / to with airport search and the distance shown, or flight type and km; class; return · trips; traveller / ref.; emissions as you type), Save as draft / Submit for approval. By spend reuses the purchases grid with lines going to 3.6. Methodology: flights with or without radiative forcing.
- Add data polish: ways in as compact pills; row tables fit the card (inputs fill their column).
- Demo: DEMO flights (SHJ–RUH, DXB–LHR/FRA, DXB–BOM), hotel stays and taxis Jan–Sep 2026.
- Tests: API 55 (new: business travel), calc 52.

## 2026-10-13 (23) — Add data as in the prototype; Enter → Review → Approved

- **Approval workflow** (migration 023: `activity.submitted_at/by`, `reviewed_at/by`, `review_note`). `GET /api/data/status` (per category and month: drafts, waiting, approved, sent back; facility type and manager; who approves; categories the facility reports = data this year or last), `GET /api/review` (entries of a facility, category or group, months; stage open / approved; what the person may do with each), `POST /api/activities/review` (submit, withdraw, approve, return with a note — nobody approves an entry they entered or submitted; approvers = the facility's approve scope), `DELETE /api/activities/:id` (draft or sent back; not commuting-record or purchase entries). Audit log for each.
- **Add data** rebuilt on the prototype layout: band with facility (type · manager), approved / in review / missing chips, twelve month tiles with status (pick one or several; All open months; Whole year; Clear); data categories listed on the left of the entry card (status and scope; across the top on narrow screens), sub-groups as dropdowns (fuel class, vehicle group, energy bought); entry card with icon, facility · months and the **Enter → Review → Approved** stepper with counts; ways in as cards (Type it in, Upload bills, Meter readings, Whole fleet, Paste a table, Excel / CSV, Automatic feed).
- **Month rows** (MonthGrid rewritten): one row per month picked — month, type (per row, for fuels and refrigerants), quantity, note and data type, emissions as you type, check against the usual months and months already entered, + line; Save as draft / Submit for approval with the approver named. Single-entry forms (electricity for one month, vehicles, waste, whole year) also get Save as draft / Submit for approval. Review stage: submit drafts, withdraw, approve (one or all), send back with a note, delete; Approved stage: totals by scope.
- Look: bold labels, chips and headings; numbers in the UI font (mono only for codes); fonts served by Ekotrace (`@fontsource`, no Google Fonts call; CSP `font-src 'self'`, fonts never inlined).
- Demo: September 2026 waiting for approval, an August entry sent back with a DEMO note; BEEAH Headquarters managed by the demo manager.
- Tests: API 54 (new: review workflow), calc 52.

## 2026-10-13 (22) — Surveys (Capture → Surveys), connected to employee commuting

- **Surveys** (migration 022): `survey` (year, due date, working weeks, facilities, headcount per facility, home-working on/off, status draft → open → closed → published, what was published), `survey_participant` (name, email, facility, department, personal 8-character code unique across companies, sent), `survey_response` (one per person; answers; entered on behalf by). Row-level security on all three. `commute_record.survey_id`.
- API `/api/surveys`: list (answers / invited, estimate, headcount), create, detail (results, people — names, emails, codes and answers for admins only), edit, open / close / reopen, delete (not when published), add people (pasted CSV text or rows; facility matched by name; duplicates by email skipped), remove (not when answered), mark sent, invitations CSV (link, code, text), answer on behalf, publish (`dryRun` plan per facility: new / replaces typed-in / file / earlier publish; skipped without access, with approved entries, or headcount 0).
- Public `/api/public/survey/lookup` and `PUT /api/public/survey` (no session; code normalised; open surveys only; rate-limited per address; audit as "survey respondent"); page `/survey` with the code and a link from the sign-in page.
- Results: per facility mean kg per respondent × headcount; 95% range with finite-population correction; company average for facilities without answers; small-sample flag; by mode and by department. Publishing calls the same save as Add data (`saveCommute`), so a facility keeps one commuting record per year with monthly entries.
- **Home working** (optional): DESNZ "Homeworking" per FTE working hour (office equipment / heating / both, 2022–2026; importer v11 — the rows have no Level 3), items `commute:home:*`, unit `fte_h`; engine adds home days × 8 h.
- Web: Surveys list with cards and the new-survey form; survey tabs Overview, People, Questionnaire, Responses, Results & publish, Actions (as in the prototype). Add data → Employee commuting → From a survey lists the Ekotrace surveys of the facility and year and shows when a record was published from one.
- Demo: "Employee commuting 2026" for BEEAH Headquarters and Data Centre Dubai, 72 DEMO people, ~45 answers, open.
- Tests: API 53 (new: surveys end to end), calc 52.

## 2026-10-12 (21) — Water category; waste details for ESG reporting

- **Water** (migration 021): categories `water_supply` (Scope 3.1, "Water withdrawn") and `water_discharge` (Scope 3.5), calc method `water`; items by source (mains desalinated / other, tanker, TSE bought, own well, seawater, rain) and destination (public sewer, tanker for treatment, irrigation / soak-away, sea, surface water), plus "recycled or reused on site"; item attrs `flow`, `gri` (GRI 303 source type), `factor`. Units m³, L, kL, ML (new), imperial gallons, thousand imperial gallons (new `kgal_uk`).
- Factors: DESNZ "Water supply" and "Water treatment" per m³, 2022–2026 (importer v8); utility's own factor per m³ on the entry (`water.ownFactor`, with its source); desalinated mains water warned (UK factor). Own wells, sea, rain, irrigation, sea and surface discharge: no Scope 3.
- **Water bills:** reader hint `water` (m³, IG, 000 IG; kWh lines ignored); a combined DEWA / SEWA bill uploaded under Water and under Electricity is one document, two bills (no duplicate, same bill number allowed across kinds), each matched to its own meter of the same account. Bills, meter batches and recent entries filter `water` like `waste`.
- **Waste sent to others:** hazardous, contractor (suggestions from `GET /api/waste/contractors`) and manifest / ticket per row (`wasteInfo` in the entry's inputs; no effect on emissions).
- **Dashboards:** rows carry `m3`, `route`, `flow`, `gri`, `haz`, `contractor`. Water tab: withdrawn, discharged, consumption, recycled, emissions, per employee; monthly by source with discharge line; GRI 303 balance in megalitres; by facility. Waste tab: GRI 306 table (hazardous / non-hazardous by operation), diverted from landfill and recovered (GRI 306-4), by contractor.
- Demo: water in and out for six facilities (DEMO volumes), waste sent out with DEMO contractors, hazardous e-waste and batteries.
- Tests: 52 API (+1 water and waste details, water bill), bills reader (+1 water). Manual: Data categories (Water; waste reporting), Bills, Dashboards, Glossary.

## 2026-10-12 (20) — Employee commuting (Scope 3.7)

- **Once a year per facility** (migration 020: `commute_record` unique per facility and year, `commute_response` for the survey answers, `activity.commute_record_id`; category `employee_commuting`, calc method `travel`, unit `pkm`). Saving again replaces; any approved monthly entry locks the record (409 `LOCKED`).
- **Typed in:** per mode employees, one-way km, days at the workplace per week, people per car — or the year's total distance (kept as "actual"). **Survey:** .xlsx / .csv (Ekotrace survey file or a Forms export); columns guessed by name (changeable), everyday answers recognised (metro, Careem, drive, work from home…), miles converted, rows of other sites left out (site chosen when names differ), unrecognised answers listed; answers scaled to the headcount (employees ÷ answers; work-from-home answers count with no travel); warning below 30% response.
- **Engine** (`packages/calc/src/commute.ts`): 2 × one-way km × working days × days ÷ working days per week; cars ÷ people in the car (car-km), motorbikes per km, taxi / bus / shuttle / metro / train per passenger-km. Working days = weekdays (weekend Sat–Sun, Fri–Sat or Sun) − public holidays (12) − leave (22), or typed. The year is split into months by working days (no seasonal weights) → one entry per mode and month.
- **Factors:** DESNZ "Business travel- land" 2022–2026 (cars by size × fuel, motorbikes, taxis, buses, rail) with their well-to-tank, both counted in 3.7 (importer v7). Defaults: average car by fuel, average motorbike, regular taxi, average local bus, coach for staff shuttles, light rail and tram for metro, national rail.
- API: `/api/commuting/options`, `GET /api/commuting?year=`, `/record`, `POST /survey`, `/preview`, `PUT /api/commuting`, `DELETE /:id`, `/survey-template`. Screen: Add data → Employee commuting. Dashboards: commuting not counted in "% of required data in".
- Tests: 50 API (+1: typed, survey, monthly split, replace, lock, isolation), 52 engine (+4). Manual: Data categories → Employee commuting; Glossary.

## 2026-10-12 (19) — Spend factors: newer versions (v1.4) can be loaded

- Importer reads the published **.xlsx** (sheet "CO2e") as well as the CSV; version taken from the file name, including release candidates (`1.4.0-rc.1` ranks just below `1.4.0`); price year from the unit; publisher, GWP set and licence by version (v1.3 US EPA, AR5, public domain; v1.4 Cornerstone Sustainability Data Initiative, AR6, CC BY 4.0). The fingerprint is of the factors, so the same data as CSV or .xlsx is recognised.
- A newer version supersedes the factor in use **item by item** (history kept, `supersedes_id`); the products of the previous Ekotrace list are relinked to the new factor of their NAICS code; an older version than the one in use is refused (409 `OLDER_VERSION`). Seed loads files oldest first.
- Preview (`POST /api/admin/import/epa?preview=1`) also returns the version in use, commodities matched / added, and the median, 10th and 90th percentile change of the factors.
- **Not loaded:** the v1.4.0-rc.1 file received is the release candidate (12 Sep 2025, 2023 USD), superseded by the final v1.4.0 (14 Oct 2025, 2024 USD). Dry run on the test database: 1,016 commodities and 1,639 products moved, v1.3 kept as history; typical change for the same 2026 spend −2.2 % (10th–90th percentile −8.2 % to +9.8 %). The library still uses v1.3.
- Tests: 47 API + 2 new (versions in order; .xlsx read like the CSV, same fingerprint). Manual: Purchases → Factors.

## 2026-10-12 (18) — Dashboards as in the Ekotrace prototype

- **Dashboards rebuilt to the prototype's design:** top bar with **VIEWING** (company / sub-group / facility / dashboard group, facility count; opens the organisation tree and the dashboard groups) and **PERIOD** (year with the base year marked; year to date / quarters / one month; same months last year or no comparison; Scope 2 method). Header: what is viewed · period · consolidation · approved data or approved + waiting · % of required data in; **Include waiting**; nine tabs: Overview · Scopes & categories · Facilities · Energy · Water · Waste · Mobility & travel · Value chain · Net zero.
- Overview as in the prototype: stat strip (total with ▲/▼ vs last year on the complete months, Scope 1/2/3, per employee and per m²), scope-wise monthly bars with last year as a line and pale months still filling, scope split (donut, t, %, change, levers), treemap of every source with the full list, top 5 contributors, upstream · own operations · downstream, net zero vs offsets.
- API `GET /api/dashboard`: **approved entries only by default**, `pend=1` adds those waiting for approval; returns `filled` (facility-months with activity data, purchases excluded) and `waiting` (facility-months with entries waiting) for completeness, pale months and the heatmap outline.
- Tests: 47 API (dashboard check uses `pend=1`). Manual: Dashboards rewritten.

## 2026-10-12 (17) — Real exchange rates and the 2025 price index

- Migration 019: shared exchange rates (all companies) from the **Federal Reserve G.5** monthly averages of daily noon buying rates (via FRED), Jan 2019 – Sep 2026 (Sep 2026 preliminary), units per US dollar, for **EUR, GBP, INR, CNY, JPY, CHF, AUD, CAD, SGD** (EUR, GBP, AUD inverted from USD per unit), plus the annual average of each complete year 2019–2025. Source files in `data/fx/`.
- **US CPI-U 2025 = 321.943** (BLS annual average; October 2025 not collected during the 2025 lapse in appropriations, so 11 months — checked: the monthly values give 2023 and 2024 exactly as stored).
- Demo rates (EUR Jan–Jun 2025, GBP 2025 "DEMO rate") removed; the demo no longer creates them. A company's own rate still wins over the shared one for the same currency and period.
- Demo batches in review recalculated: no missing rates; 2026 lines use the 2025 index until the 2026 average is published (marked on each line); the published H1 2025 batch keeps its figures until reopened.
- Tests: 47 API (EUR line now uses the shared June 2024 rate, then the company's own rate wins), 48 engine. Manual: Purchases → Currencies and inflation.

## 2026-10-12 (16) — Spend conversion: exchange rate + price index, or exchange rate only

- Company setting (migration 018, `tenant.price_adjust`): **Exchange rate + price index** (default; currency → USD of the purchase year → USD of the factor's year with the US CPI-U) or **Exchange rate only** (currency → USD, used as it is; no price index, no "CPI year not loaded" warning). Setup → Currencies & price index (Super admin); `PATCH /api/currency/settings { priceAdjust: 'cpi' | 'none' }`, returned by `GET /api/currency`.
- Engine: `PurchaseContext.priceAdjust`; with 'none' the line's steps say "used as it is against the 2022 factor (no price-index adjustment: company setting)". Supplier factors per kg / litre / unit unaffected.
- Applies to new calculations; Recalculate open batches; published entries unchanged until reopened.
- Tests: 47 API (manual purchase with each option), 48 engine (new). Manual: Purchases → Currencies and inflation.

## 2026-10-11 (15) — Organisation tabs (Facilities, Sub-groups, Dashboard groups); plans with limits; console subscription

**Organisation & groups** now has the prototype's tabs: **Tree** (list / org chart, as before), **Facilities** (one table: type, sub-group, location, manager — red when missing —, meters, vehicles, landfill sites, share of the year's entries approved, tCO₂e; `GET /api/org/summary?year=`), **Sub-groups** (main entity and sub-groups with where each sits, admins, facilities, tCO₂e; Edit, + Facility here), **Dashboard groups**. Header buttons + Facility / + Sub-group.

**Dashboard groups** (migration 017, table `dashboard_group`): any mix of facilities viewed together; never change the structure; listed only to people who see every facility in them; created by anyone who enters data, deleted by the creator or a Super admin (`GET/POST /api/dashboard-groups`, `DELETE /api/dashboard-groups/:id`). Dashboards: groups in the "part of the group" list; `GET /api/dashboard?group=` (Where lists the group's facilities).

**Plans** (`src/lib/plans.ts`): Trial 3 facilities / 5 people; Starter 10 / 15 + data export; Professional 40 / 75 + Eko AI, export, dashboard groups; Enterprise unlimited, everything. Enforced on the server: adding or reactivating a facility or person above the limit, AI mapping (setting refused and ignored in mapping), published-lines export, dashboard groups (403 `PLAN_LIMIT` with the plan needed). Screens: plan name under the company in the menu, facility count of the limit, export buttons and the groups tab greyed with the plan needed. `/api/auth/me` returns `planLimits`.

**Platform console**: tabs Companies / Plans (plan cards with limits and number of companies); per company the plan's limits, facilities and people used against them (red when above), subscription price and cycle, PO, days left; **Edit** dialog: name, plan, access until, price, currency, annual / monthly, PO / contract reference, billing email, notes (migration 017 columns). Lowering a plan never deletes anything.

**Tests:** 47 API (new: trial limits on facilities and people, AI / export / groups refused, upgrade, subscription fields, groups create / duplicate / dashboard by group / delete / isolation), 47 engine. Manual: Getting started (organisation tabs, plans), Dashboards, Glossary.

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

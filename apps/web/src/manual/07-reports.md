# Reports

**Reports** (menu → Disclose) gives the inventory for the company, sub-group, facility or group and the period chosen with **VIEWING** and **PERIOD** at the top. Approved data only (tick *Include waiting* on the dashboards to see waiting entries too). **Location-based / Market-based** switches Scope 2. **Download report** saves the GHG Protocol inventory report as a web page; **Print / PDF** opens it for printing or saving as PDF.

| Tab | What it shows |
|---|---|
| Summary | Total and each scope, per employee; what it is equivalent to; the period against the same months last year; emissions by GHG Protocol category; top 10 sources; next steps |
| GHG Protocol inventory | Every category from 1.1 to 3.15 — measured, no data, or excluded. Every category without data needs a reason (the super admin types it in). **View entries** opens the entries behind a category. Exports: the regulatory file (inventory by category), the emission factors used, and all entries |
| Granular audit view | Every approved entry with its facility, month, category, activity, quantity, factor (kg CO₂e per unit and its source), tCO₂e, quality and how it was captured. Search and filter by facility, category and capture method; **ⓘ Method** shows how it was calculated |
| Data quality | Actual, estimated and proxy data; shares of activity-based data, supplier-specific factors and data backed by evidence; overall uncertainty; quality controls (missing months, outliers without a note, entries without a bill or meter, spend-based purchases, possible double counting, estimates without a note, entries waiting over 14 days). Admins can mark a control **justified** with a reason |
| Templates & regulatory | Report formats grouped as **Global standards**, **European Union**, **Country & regional**, **Internal** and **Your templates** (see below). Pick the sections and their order; preview; download or print; **Datapoints (CSV)** for the disclosure formats. **Entry-level dataset**: one row per approved entry for a regulator’s MRV platform, a verifier or a data room. The reporting entity and the logo come from Organisation → **Company details & logo** |
| Versions | Save the inventory as a version (e.g. before assurance) and compare it with today, category by category |

**Quality** of an entry (audit view): High (±5%) — measured, with a bill, meter or source file; Medium (±15%) — measured, no evidence; Medium (±20%) — survey scaled to headcount; Low (±40%) — spend-based. Overall uncertainty combines them weighted by tCO₂e.

Exports need a plan that includes exports (Starter and above).

## Report formats

| Format | Where it is used | What it contains |
|---|---|---|
| **ISO 14064-1:2018 GHG report** | worldwide; verified under ISO 14064-3 | a designed report with the company logo: key figures, **key findings** written from the data, emissions by ISO category 1–6 (chart and table), emissions month by month, largest sources, facilities, direct emissions by gas, biogenic CO₂, data quality and uncertainty, **recommendations**, boundaries, quantification and factors, exclusions, statement |
| **GHG Protocol inventory report** | worldwide (the basis of most of the others) | boundary, scopes, categories 1.1–3.15, activity data and factors, methodology, exclusions, base year, data quality, verification |
| **ESRS E1 climate disclosure** | EU — CSRD sustainability statement | E1-6: gross Scope 1 (§48), Scope 2 location- and market-based (§49), Scope 3 and its categories (§51), totals (§52), intensity per net revenue (§53), biogenic CO₂; E1-5 energy consumption and renewable electricity claimed |
| **IFRS S2 GHG metrics (ISSB)** | global baseline; adopted or adapted in Australia (AASB S2), Singapore, Japan (SSBJ), the UK and others | paragraph 29(a): Scope 1, Scope 2 location-based with market-based information, Scope 3 by category, measurement and consolidation approach |
| **CDP climate questionnaire — emissions** | worldwide (investor and supply-chain requests) | Scope 1, 2 (both methods), 3 by category, Scope 1 by gas, by country and by business division |
| **GRI 305 Emissions** | worldwide sustainability reports | 305-1 to 305-4: scopes, gases, biogenic CO₂, intensity, factor and GWP sources, consolidation |
| **UK SECR** | UK directors’ report | UK Scope 1 and 2, business travel in cars, global figures for context, intensity ratio |
| **California SB 253** | US (California) | Scope 1, 2 (both methods) and 3 under the GHG Protocol |
| **UAE MOCCAE (provisional)** | UAE regulator | GHG Protocol layout until the official template is published |
| **Board summary** | internal | headline figures, categories, facilities, targets and actions |

Every format is built from the same approved entries, for the selection and period viewed. Figures marked “to be completed” need data Ekotrace does not hold yet (for example the share of Scope 1 under an emissions trading scheme, or net revenue — entered under Company details). Check reference numbers (CDP items, ESRS paragraphs) against the current year’s guidance before filing.

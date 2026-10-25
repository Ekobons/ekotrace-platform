# CBAM

Menu → Disclose → **CBAM** prepares the data for the EU **Carbon Border Adjustment Mechanism** (Regulation (EU) 2023/956). From 1 January 2026 (the definitive period), goods covered by CBAM that enter the EU carry a carbon cost:

- **Producers** outside the EU work out the embedded emissions of their goods and share them through the CBAM Registry.
- **Importers** in the EU declare the goods once a year and surrender CBAM certificates.

The goods covered (Annex I) are cement and clinker, fertilisers and ammonia, nitric acid and urea, iron and steel, aluminium, hydrogen and electricity. Each is identified by its **CN code**. A company can be on both sides; the page has a tab for each.

```flow
> Producer | installation and processes → yearly report → verification → summary report and O3CI values → shared with EU buyers
> Importer | import lines by CN code and origin → actual or default emissions → free allocation adjustment → certificates → declaration
```

## CBAM Exporter package

Companies that only need CBAM — plants outside the EU selling cement, fertilisers, iron and steel, aluminium or hydrogen to EU buyers — can have the **CBAM Exporter** package on its own. The Ekobon team switches it on in the platform console (Products → CBAM Exporter). People of such a company log in to a simpler menu with CBAM only:

Menu | What it is
---|---
CBAM home | The year at a glance: a quarter tracker per installation (draft, final, sent, problems to fix; **+ Start** a quarter, copying the one before), the specific embedded emissions of each good by quarter with up/down arrows, and the share from default values
Communications to importers | The exporter portal below: fill in a quarter step by step, download the Commission's Excel
Installations | Plants as registered in the CBAM Registry, with their production processes
Reports | The year by quarter — SEE per good (total, or direct and indirect), installation emissions, the communications and where they were sent — and the **annual summary** in Excel
Annual emissions report | The installation's yearly report for the CBAM Registry, with verification
Default values & benchmarks | The Commission's values, to compare with your own
Setup | People & access, document vault, security & audit log

A company with the full product has the same pages under Disclose → CBAM; a company with both can switch between them at the top of the menu.

## The dedicated CBAM tool

The CBAM package also works as a tool in its own right, under its own name (for example *Carbontek CBAM*), with its own sign-in page at **/cbam**. It serves both sides and links them: an EU importer asks its suppliers for data, and the suppliers answer in the same tool.

### Signing in and signing up

- **/cbam** shows the CBAM sign-in page. People sign in with their usual account; after sign-in a CBAM-only company lands on **CBAM home**.
- **/cbam-signup** lets a new company open a 30-day trial on its own: company name, its role (importer, exporter or both), name and e-mail. A link by e-mail confirms the address and sets the password. The page only opens when the server runs with `CBAM_SIGNUP=on` and e-mail is set up.
- **/cbam-calculator** is a free calculator anyone can use without an account: CN code, country of origin, tonnes and year → the default embedded emissions, the mark-up, the free allocation adjustment and the estimated cost.

### Role and menu

Setup → **CBAM settings** sets the company's role — *importer*, *exporter* or *both* — and the declarant details (EORI, authorised declarant number, the carbon price assumption). The menu follows the role:

Group | Pages
---|---
Importing | CBAM home (importer dashboard), Imports & declaration, Suppliers & requests, Cost forecast
Exporting | Communications to importers, Answer a request, Installations, Precursor suppliers, Reports, Annual emissions report
Knowledge | CN codes & rules, Cost calculator, Default values & benchmarks
Setup | CBAM settings, people & access, document vault, audit log

### Importer dashboard

CBAM home for an importer shows the year at a glance:

- **Tonnes imported, embedded emissions, certificates and estimated cost**, with the part of the cost caused by default-value mark-ups.
- **Things to do**: supplier answers to review, requests past their due date, a high share of default values, values that look unusually low or high against the default (below 30% or above 200%).
- **De minimis threshold**: tonnes against the 50 t a year (electricity and hydrogen always count). Above 90% the tool warns; above 50 t every import of the year counts and you need authorised declarant status.
- **Certificates per quarter**: at the end of each quarter you must hold certificates for at least 50% of the embedded emissions of the year so far. Certificates for 2026 imports are sold from 1 February 2027; the declaration and surrender are due by 30 September of the following year.
- **Where it comes from**: cost, tCO₂e or tonnes by CN code, product, country or supplier.

### Suppliers and data requests

Suppliers & requests holds the producers you buy from. Import lines are linked to a supplier automatically by name.

1. **New request** — pick a supplier, the period and a due date, and add a note. The tool makes a one-time **access code** (shown once) and e-mails the supplier a link to **/cbam-supplier**.
2. The supplier signs in with the e-mail and code — no account needed — and either **uploads the EU communication template** or **fills a short form** (installation, country, and per good the direct and indirect SEE and the share from default values). Supplier and importer can write to each other on the request.
3. Suppliers with their own account in the tool answer under Exporting → **Answer a request**, straight from a communication they already filled in.
4. You **review** the answer: the tool compares each value with the default. **Accept** stores the values for that supplier and applies them to the matching import lines; **Return** sends it back with a comment.
5. Reminders go out by themselves once a request is overdue — at most once a week and three times in all. You can also send one by hand, issue a new code or withdraw the request.

An exporter can turn an accepted answer from its own precursor supplier into a purchased precursor in its communication (**Use in a communication**).

### Cost forecast

Cost forecast projects the certificate cost to 2034: the price path, volumes per CN code, the phase-out of free allocation (CBAM factor from 97.5% in 2026 to 0 from 2034), and *what if* scenarios such as moving a share of suppliers from default to actual values. Save several forecasts and export them to Excel.

### Declaration data

Imports & declaration → **Declaration data (JSON)** exports the year's goods by CN code and origin, with the installation, emissions, the source of each value and the declarant's EORI, ready to bring into the CBAM Registry. The Registry's own XML format will be added once the Commission's schema is available.

### Printable summary

In a communication, **PDF summary** opens a one-page summary of the goods and their SEE to print or save as PDF — useful for a customer who does not want the Excel. The review step also shows, for each good, the default value and how much an importer saves per tonne by using your actual values.

### Official default values (platform staff)

The Commission's own files come with the tool and load by themselves when the server starts: the **default values** (Implementing Regulation (EU) 2025/2621 as corrected by (EU) 2026/1740, file of 6 August 2026) and the **CBAM benchmarks** (Implementing Regulation (EU) 2025/2620). Each file loads once.

When the Commission publishes a new file, the platform team uploads it under Default values & benchmarks → **Load official values**. The tool recognises the Commission's workbooks — one sheet per country, "Other countries and territories", Annex IV, the benchmarks sheet — shows what it found, and loads them whole, replacing the earlier official values. Any other spreadsheet (Excel or CSV) is loaded by mapping its columns. Every company and the free calculator use these values.

## Exporter portal — communication to your importers

Your EU importers need the embedded emissions of the goods you sell them, in the European Commission's **CBAM Communication template for installations** (version 2.1). The **Exporter portal** tab fills that template with you, one communication per installation and reporting period (usually a quarter), and downloads the official Excel ready to send.

```flow
> Exporter | period and installation → goods and processes → fuels and emissions → energy and data quality → production processes → purchased precursors → products and carbon price → review and download
```

Each step matches a sheet of the template:

Step | Template sheet | What you enter
---|---|---
1 · Installation & period | A_InstData (1–3) | Reporting period (pick the quarter), installation name, address, UN/LOCODE, coordinates, contact; the verifier if there was one
2 · Goods & processes | A_InstData (4–5) | Aggregated goods categories and routes; production processes (name, category, what they include); precursors you buy in, with the country of production
3 · Fuels & emissions | B_EmInst | Source streams (combustion, process emissions, mass balance) with activity data, NCV, emission factor, oxidation/conversion factor and biomass share; PFC emissions (aluminium smelters); measured sources (CEMS)
4 · Energy & data quality | C_Emissions&Energy | Fuel balance, totals by gas (calculated, or entered by hand), **total indirect emissions** (always entered), data quality and quality assurance
5 · Production processes | D_Processes | Production per route, where it went (market, other processes, non-CBAM), directly attributable emissions, measurable heat, waste gases, electricity consumed and exported
6 · Purchased precursors | E_PurchPrec | Amounts bought, where they were used, and their SEE (direct), electricity per tonne and its factor — measured or default
7 · Products & carbon price | Summary_Products, F_Tools | CN codes and product names, qualifying parameters, carbon price due and rebates (with the template's carbon price calculator)
8 · Review & download | Summary_Processes, Summary_Communication | Results, checks, status, the Excel file

Good to know:

- **Calculated as you type.** Every change is saved and recalculated with the template's own formulas: emissions of each source stream, attributed emissions of each process, and the specific embedded emissions (SEE) of each good through the whole supply chain — precursors made in the installation and precursors bought in. Results show beside each product and in the left rail.
- **Checks.** The template's completeness and control rules are applied (production = market + used + non-CBAM; purchased = consumed + other uses; units consistent; justification when default values are used). A communication can be marked **final** only when nothing is left to fix; then **sent**, with a note of the importers it went to.
- **The download is the official file.** All 19 sheets, formulas, drop-downs, protection and guidance are kept; only the input cells are filled. Excel recalculates when the file opens, so Summary_Communication shows the results your importers copy into their CBAM report.
- **Fuel defaults.** Fuels can be added with IPCC 2006 default NCV and emission factors (diesel, LPG, natural gas, heavy fuel oil and others), and amounts entered in litres are converted with the fuel's density. Replace defaults with your own analyses where you have them.
- **Next quarter.** **Copy to the next period** keeps the installation, goods, processes, precursors, fuels and products and moves the dates on; update the amounts.
- **Import a filled template.** An Excel template you filled before (version 2.x) can be imported as a new communication, or loaded into an open one.

## Producer side

### 1 · Installations

Under **Installations**, add the plant as it is registered in the **CBAM Registry (O3CI portal)**:

- Installation name, the identifier the Registry gave it, UN/LOCODE, address, and the coordinates of the main emission source.
- The **operator**: legal name, registration number and address.
- A contact person.
- Optionally, the facility in this tool, so the attributed emissions can be compared with the facility's Scope 1.

Then add its **production processes**. Each process has an aggregated goods category and, where there are several, a route. For example:

- **Crude steel:** basic oxygen steelmaking or electric arc furnace.
- **Unwrought aluminium:** primary smelting or secondary melting (recycling).
- **Ammonia:** Haber-Bosch with steam reforming, or with gasification.

### 2 · The yearly report

**Start {year} report** opens one report per installation and year. It has one card per process:

| Field | What to enter |
|---|---|
| Activity level | tonnes produced by the process in the year (MWh for electricity) |
| Attributed direct emissions | tCO₂e of the process, from the monitoring plan |
| Electricity consumed | MWh; turned into indirect emissions with the report's electricity factor |
| Share on default values | the part of the direct emissions determined with default values instead of monitoring |
| Qualifying parameters | depend on the good: clinker ratio in cement, scrap per tonne, nitrogen content, alloy content… |
| Goods produced | the CN codes (8 digits) the process makes, with quantities. Only CBAM goods of the same sector are accepted |
| Precursors | CBAM goods used as inputs (clinker, DRI, pig iron, unwrought aluminium, ammonia…), with their tonnes and their own embedded emissions, actual or default |

The card shows the **specific embedded emissions (SEE)** in tCO₂e per tonne:

- **Direct SEE** = (attributed direct emissions + Σ precursor tonnes × precursor direct SEE) ÷ activity level.
- **Indirect SEE** = (electricity × factor + Σ precursor tonnes × precursor indirect SEE) ÷ activity level.
- **SEE for CBAM:**
  - cement and fertilisers: direct + indirect;
  - iron and steel, aluminium and hydrogen: **direct only**. These are the Annex II goods. Their indirect emissions are still reported, but they don't count.
- **Share on default values:** how much of the counted emissions rests on default values.

**Period, electricity & verification** holds the rest of the report:

- the reporting period, the electricity emission factor and its source, and the monitoring plan;
- the **accredited verifier**, site visit, verification date and opinion (reasonable assurance; a site visit is required for 2026);
- any **carbon price effectively paid** in the country of production (Article 9), with evidence;
- notes on heat flows, waste gases or CO₂ capture;
- the importers the data is shared with (EORI numbers).

Marking the report **verified** needs:
- the verifier, the verification date and the opinion;
- the activity level and goods of every process;
- the electricity factor wherever electricity counts.

Once verified, the figures are locked. A super admin or admin can reopen the report.

### 3 · Share

**Summary report & O3CI sheet** downloads an Excel workbook with three sheets:

1. **Summary emissions report:** the data points of Annex IV point 1.2 of Implementing Regulation (EU) 2025/2547, in English. That covers the operator, installation, processes and routes, SEE per good, direct and indirect emissions, precursors, parameters, carbon price and verification.
2. **For EU importers:** one row per CN code with the direct, indirect and CBAM SEE, the share on default values, the route and the verifier. Send it to buyers who have no access to your Registry data.
3. **O3CI entry:** every value in the order the CBAM Registry operator portal asks for it: operator, installation, production process, emissions per good, verification. The portal is filled in on screen; copy the values across, then disclose them to your buyers' EORI numbers.

## Importer side

### Import lines

Under **Imports & declaration**, record each import of a CBAM good:
- import date (the quarter follows from it);
- CN code and country of origin;
- net mass in tonnes;
- customs procedure and declaration number;
- the supplier and installation.

**Upload customs file** reads an Excel or CSV export from the customs broker. Columns are recognised by name, there is a **Template**, and **Check** shows what will be imported before anything is saved. Lines that are not CBAM goods, or are dated outside the year, are left out.

For each line choose the emissions:
- **Actual:** the installation's verified SEE (direct, and indirect for cement and fertilisers), with the verification report. If the goods come from one of **your own installations**, pick its report and the values are filled in from it.
- **Default:** the default value for the CN code and country of origin, increased by the year's mark-up: 10 % for 2026, 20 % for 2027, 30 % from 2028, and 1 % for fertilisers.

### Certificates

For each line:

```flow
> SEE used | actual SEE, or default value × (1 + mark-up)
> Free allocation adjustment | SEFA = CBAM benchmark × CBAM factor (97.5 % in 2026, 95 % in 2027, 90 % in 2028 … 0 % in 2034)
> Carbon price | EUR paid per tonne of good ÷ the quarter's certificate price
> Certificates | max(0, SEE − SEFA − carbon price) × net mass
> Cost | certificates × the certificate price of the quarter of import
```

For 2026 imports, the certificate price is the quarterly average of EU ETS auction prices published by the Commission. Certificates are sold from 1 February 2027, and the **2026 declaration is due by 30 September 2027**.

**Declaration workbook** downloads the figures for the CBAM Registry declarant portal:
- totals for the year;
- goods by CN code and origin;
- installations with their verification reports;
- the certificate calculation per line;
- all import lines.

### Default values & benchmarks

The library holds the Commission's values, loaded with the tool:
- **default values** per CN (or TARIC) code and country of origin — direct, indirect and total, and the production route behind them (Implementing Regulation (EU) 2025/2621, corrected by (EU) 2026/1740);
- the **highest default value** of each good (Annex IV), used when the country of origin is not known;
- **CBAM benchmarks** per CN code and production route: column B goes with default values, column A with actual emissions (Implementing Regulation (EU) 2025/2620);
- the **certificate prices** per quarter.

Type a code and a country to see the value that applies, why (the country's own value, or "Other countries and territories" when the country has none or shows "–"), the value with each year's mark-up, the benchmarks by route, and the same code in every country, lowest first.

How a line is priced:

What | Rule
---|---
Default value | The line's own value; else your company's value; else the country of origin's value; else "Other countries and territories". Stored before the mark-up; the total is priced (direct + indirect for cement and fertilisers, direct for the others)
Mark-up | 10% in 2026, 20% in 2027, 30% from 2028; 1% for fertilisers
TARIC codes | Clinker and calcined clay have values per 10-digit TARIC code. Enter the TARIC code on the line; with the 8-digit code the higher value is used and the line says so
Benchmark | Column B on the production route behind the default value (e.g. (C) BF/BOF). For actual emissions, column B on the installation's route given on the line (BF/BOF, DRI, scrap/EAF, primary or secondary aluminium); without a route, the lowest benchmark with a note. Type the benchmark on the line when the supplier gives it

Super admins and admins add their company's own values with the source; these come before the Commission's.

## Good to know

- The importer-side **de minimis** threshold is 50 tonnes of CBAM goods a year (electricity and hydrogen excluded). Below it, no declaration is needed.
- Reports must be in English. Producers registered in the Registry disclose only the summary; buyers of unregistered producers ask for the full emissions and verification reports.
- Every change, verification, export and declaration download is recorded in the audit log.

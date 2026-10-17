# CBAM

Menu → Disclose → **CBAM** prepares the data for the EU **Carbon Border Adjustment Mechanism** (Regulation (EU) 2023/956). From 1 January 2026 (the definitive period), goods covered by CBAM that enter the EU carry a carbon cost:

- **Producers** outside the EU work out the embedded emissions of their goods and share them through the CBAM Registry.
- **Importers** in the EU declare the goods once a year and surrender CBAM certificates.

The goods covered (Annex I) are cement and clinker, fertilisers and ammonia, nitric acid and urea, iron and steel, aluminium, hydrogen and electricity. Each is identified by its **CN code**. A company can be on both sides; the page has a tab for each.

```flow
> Producer | installation and processes → yearly report → verification → summary report and O3CI values → shared with EU buyers
> Importer | import lines by CN code and origin → actual or default emissions → free allocation adjustment → certificates → declaration
```

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

The library holds:
- **default values**, per CN code and country of origin, from Implementing Regulation (EU) 2025/2621;
- **CBAM benchmarks**, per CN code (and route), from Implementing Regulation (EU) 2025/2620;
- the **certificate prices** per quarter.

A value typed on a line is used first. Otherwise the most specific library value is taken: the longest CN code, and the same country before "all countries". Super admins and admins add their company's values with the source.

Values marked **illustrative** come with the demo only: they are not the official figures. Replace them with the values of the regulations before any declaration.

## Good to know

- The importer-side **de minimis** threshold is 50 tonnes of CBAM goods a year (electricity and hydrogen excluded). Below it, no declaration is needed.
- Reports must be in English. Producers registered in the Registry disclose only the summary; buyers of unregistered producers ask for the full emissions and verification reports.
- Every change, verification, export and declaration download is recorded in the audit log.

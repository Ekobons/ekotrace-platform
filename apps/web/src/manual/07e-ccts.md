# India CCTS

Menu → Disclose → **India CCTS** tracks India's Carbon Credit Trading Scheme (compliance mechanism) for each **obligated entity** of the company: its GHG emission intensity (GEI) against the target notified by the Ministry of Environment, Forest and Climate Change, and the Carbon Credit Certificates (CCCs) it earns or must surrender.

The method follows the Bureau of Energy Efficiency's *Detailed Procedure for Compliance Mechanism under CCTS* (v1.0, July 2024). Targets come from the gazette schedules of the *Greenhouse Gases Emission Intensity Target Rules, 2025* (first schedule October 2025: aluminium, cement, chlor-alkali, pulp & paper; second schedule January 2026: secondary aluminium, refineries, petrochemicals, textiles; iron & steel in draft).

```flow
> Set up | add the obligated entity from its gazette row: registration no., sector, 2023-24 baseline output and GEI, targets
> Collect | output every month; fuel and grid electricity from approved entries, process emissions and the rest typed
> Track | GEI year to date against the target, the CCC position projected to 31 March, the GEI the rest of the year needs
! Check | months with output but no emissions (or the reverse) are flagged and left out of the GEI
> Report | Form A draft (Excel) with the monthly data and method, for the ACVA's verification and BEE by 31 July
> Settle | record CCCs issued, bought, sold and surrendered on the ICM registry
```

## Who does what

| Role | Can |
|---|---|
| Super admin, admin | add and change obligated entities and their targets, record CCC transactions, everything below |
| Manager | enter monthly data and reduction measures |
| Verifier and others | view, download Form A |

## The calculation

| Step | Rule |
|---|---|
| Total emissions | direct energy (fuel combustion) + direct process (CO₂, PFCs) + purchased electricity and heat − exported power − CO₂ transferred out for permanent storage or use |
| Gases and GWP | CO₂ and PFCs, GWP of IPCC AR5 (as BEE prescribes) |
| Purchased electricity | (grid MWh − documented renewable MWh) × the grid factor of the entity: the CEA average of the baseline year, held constant (default 0.727 tCO₂/MWh, FY 2023-24) |
| Renewable electricity | zero only with documents and no double counting: RECs used for renewable purchase obligations or sold on do not count |
| Exported power | deducted at its heat-rate factor where the month gives one, otherwise at the grid factor |
| Excluded | biomass and biogenic CO₂, approved alternate fuels used in co-processing, colony and construction energy, transport outside the plant, office refrigerants |
| GEI | total emissions ÷ equivalent product output, over the months that have both |
| CCCs | (target GEI − achieved GEI) × output. Positive: eligible for issuance. Negative: to surrender. 1 CCC = 1 tCO₂e |
| Shortfall not covered | environmental compensation of **twice** the average CCC price of the trading cycle, levied by CPCB |

### Where the figures come from

On the entity choose **Fuel and grid electricity**:

- **From approved entries** (default). The tracker adds up the approved **stationary combustion** entries (Scope 1, fossil CO₂e) and the **grid electricity** entries of the facilities you tick as inside the entity's boundary. An entry that covers several months is split by days. Entries waiting for approval do not count. The month's grid shows these figures in grey. Typing a value in a month replaces them for that month only.
- **Typed per month**. Nothing comes from entries; type every figure.

Process emissions (e.g. clinker calcination, anode consumption), PFCs, purchased heat, exported power and CO₂ transferred out are always typed on the month.

The company's GWP set should be **AR5** so that fuel figures from entries match BEE's rules (Setup → Methodology & boundaries).

## The page

| Part | What it shows |
|---|---|
| Entity cards | each obligated entity with its GEI and projected CCC position — click one to open it |
| Achieved GEI | year to date (or the full year), with the target and the 2023-24 baseline; green at or below target, red above |
| CCC position | CCCs eligible or to surrender. During the year it is **projected to 31 March**: the months still to come follow the average monthly output and emissions of the months in |
| Cost or value | the CCC price set on the entity × the CCCs to buy after those held, and the environmental compensation if they are not surrendered; or the value of the surplus |
| Next date | the next date of the compliance calendar |
| Chart | GEI of each month, the year to date, the target (dashed) and the baseline; hover a month for its figures |
| What the rest of the year needs | the GEI the remaining months must average to end the year on target |

## Monthly data

One row per month, April to March. Type or paste (from Excel: copy a column, click the first cell, paste — the column fills downwards) and **Save**. Empty a whole row to remove the month. A month without both output and emissions is shown pale, flagged, and left out of the GEI.

## CCC account

Record what happens on the ICM registry (run by Grid-India) and the power exchanges: **Issued by BEE**, **Bought**, **Sold**, **Surrendered**, each for a compliance year, with price and reference. The tool refuses selling or surrendering more than is held, and removing a purchase that would leave fewer CCCs than were sold or surrendered. Unused CCCs can be banked for later years.

## Reduction measures and Form A

Under **Reduction measures** list what was done in the year: the measure, the year implemented, tCO₂e a year before and after, and the investment. The cost per tonne saved is worked out.

**Form A (Excel)** downloads a draft of the Performance Assessment Document for the compliance year: entity details, output, total emissions, achieved and target GEI, CCCs eligible or to surrender, the measures, a sheet with every month and a sheet with the method. It is a draft: copy the values into the form issued by BEE.

## Compliance calendar

| Date | What |
|---|---|
| 1 April | compliance year starts |
| within 3 months | monitoring plan for the year |
| 31 March | compliance year ends |
| 31 July | verified emissions report, Form A and Form B (certificate of verification by the ACVA) to BEE |

BEE then recommends issuance to the National Steering Committee; CCCs are issued on the registry. Entities with a shortfall surrender CCCs after the trading sessions (Form D).

## Setting up an entity

**+ Obligated entity** (super admin, admin): copy the entity's row from the gazette schedule — name, registration number, sector and sub-sector, state, the baseline equivalent output and the baseline GEI of 2023-24. Tick the facilities inside its gate-to-gate boundary. Then, under **Entity & targets**, enter the target GEI for each compliance year (the tool warns if a target is above the baseline). Refineries use crude throughput × NRGF as their output unit.

Every change is in the audit log.

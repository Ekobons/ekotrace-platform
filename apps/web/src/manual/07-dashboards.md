# Dashboards

Dashboards (top of the menu) shows the inventory for the whole company, a sub-group, one facility or a dashboard group, for any months of a year.

## Choosing what you see

Two buttons at the top choose the view:

- **VIEWING** shows what you are looking at (Company, Sub-group, Facility or Dashboard group) and how many facilities it covers. Click it to open the organisation tree and click a name to view it; dashboard groups (Organisation → Dashboard groups) are listed on the right. You only see the facilities your access allows, and a group is listed only when you can see every facility in it.
- **PERIOD** shows the year and months, and what they are compared with. Click it to choose: **1 · Year** (the base year is marked); **2 · Which months** — the year to date (or the full year for a past year), a quarter, or one month; **3 · Compare with** — the same months last year, or no comparison. **Scope 2** location- or market-based is also chosen here. **Done** closes it.

The line under **Dashboards** repeats the choice: what you view · year · months · consolidation approach · approved data (or approved + waiting) · **% of required data in**.

**Include waiting** (top right): by default only **approved** entries count. Tick it to add the entries still waiting for approval (rejected entries never count).

## Tabs

| Tab | Shows |
|---|---|
| Overview | total emissions with the change against last year, Scope 1, 2 and 3, per employee and per m²; **scope-wise emissions by month** (stacked bars, last year as a line); **scope split** (donut, tonnes, share and change per scope, the main levers for the largest scope); **where emissions come from** (every source as a box, sized by tCO₂e and coloured by scope, all sources listed beside it); **top 5 contributors**; **upstream · own operations · downstream**; **net zero · emissions vs offsets** |
| Scopes & categories | each scope by GHG Protocol category (donuts), and a category × month table with codes (1.1, 2.1, 3.1 …), totals and shares |
| Facilities | emissions by facility and scope (click one to view only it), share of total, intensity per employee and per m² (annualised), and a facility × month heatmap |
| Energy | total energy (MWh), electricity, renewable share (certificates claimed), energy emissions, per m²; energy by month and source, energy mix, by facility, renewable electricity |
| Water | water withdrawn (m³ and megalitres), discharged, consumption (withdrawn − discharged), recycled or reused, water emissions (Scope 3.1 supply, 3.5 treatment), per employee; withdrawn by month and source with the discharge as a line, by source, the GRI 303 balance (withdrawal and discharge by source type), emissions by source, by facility, per employee |
| Waste | waste generated (sent to others, t), diverted from landfill (re-use, recycling, composting, waste-to-energy), recovered (GRI 306-4: without waste-to-energy), hazardous, waste emissions (Scope 3.5), treatment at own sites (Scope 1); by month and route, by route, the GRI 306 table (hazardous and non-hazardous by operation), by contractor, diversion by month, by facility |
| Mobility & travel | company fleet, business travel and employee commuting: emissions, fleet fuel (L), distance driven (km); by month, split, and every activity with its quantity and kg CO₂e per unit |
| Value chain | Scope 3 by category, purchases by category (boxes), top suppliers, share of purchase emissions on supplier-specific factors |
| Net zero | gross emissions, credits retired (from Carbon credits, whole company), net after credits (shown beside gross, never instead), credits in the pipeline; emissions vs offsets by year; the credit portfolio by type; good practice |

## From a figure to its entries

Click a figure to open **Entries & results** filtered to the entries behind it, for the same year, period, facilities and status (approved only; with *Include waiting*, every status except sent back). The months follow the dashboard's rule: an entry covering less than 40 days counts in the month it starts, a longer one (a quarter, the year) only in the full-year view. Facilities the consolidation leaves out are left out too:

| Click | Opens |
|---|---|
| a month in *Scope-wise emissions by month* | the entries covering that month |
| a scope in *Scope split* | the entries with emissions in that scope (Scope 3 includes the upstream part of fuels and energy) |
| a source in *Where emissions come from* or *Top 5* | the entries of that item in that scope (purchases: the spend categories behind the group) |
| a category, or a category × month cell, under *Scopes & categories* | the entries of the categories behind that GHG Protocol code |
| a facility × month cell in the facilities heatmap | that facility's entries in that month |

A bar at the top of Entries & results says which figure it came from, with **Back to the dashboard** and **Show all entries**. The filters are kept in the page address, so the filtered list can be bookmarked or shared.

The entries show their own full values. Under **equity share** the dashboard counts each facility at its ownership percentage, so its figure is lower where a facility is not wholly owned (the bar says so). A Scope 2 list shows both the location- and market-based values.

## Complete months and the comparison

- A facility that reports monthly (activity data in at least half of the months so far; purchases come in files and are not counted here) is expected every month. A month is **complete** when all of them have data in it; **% of required data in** is the share of those facility-months that have data.
- In the monthly bars, months that are not complete yet are drawn **pale** ("month still filling").
- The change against last year uses only the complete months, against the same months of last year — the stat says how many ("vs 2025 (9 full months)").
- In the facilities heatmap a **dashed outline** marks a month with entries still waiting for approval, or with no data yet.

## How totals are counted

- **Consolidation:** operational or financial control (a facility counts in full or not at all) or equity share (× the ownership percentage), as set in Methodology & boundaries.
- Approved entries only, unless **Include waiting** is ticked. Purchases count once published and approved.
- Entries for a whole year (e.g. landfill methane) count in the year-to-date / full-year view and its totals, not in the months, quarters or single months.
- Well-to-tank and grid losses are their own Scope 3 source (3.3, fuel- and energy-related).
- **Energy** is the quantity entered when it is energy (kWh, MWh, TRh of cooling); fuels by litre, kg or m³ are converted with the calorific value behind their factors. Vehicles entered by distance count in emissions but not in energy (the tab says how many).

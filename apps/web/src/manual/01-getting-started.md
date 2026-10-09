# Getting started

Ekotrace calculates a company's greenhouse gas emissions from the activity data its facilities enter: fuel burned, vehicles driven, refrigerant topped up, waste treated, electricity and cooling bought. Every number can be traced back to what was entered, the emission factor used and its source.

## How the inventory is built

```diagram scopes
```

The three scopes follow the GHG Protocol:

- **Scope 1** — emissions from sources the company owns or controls: its boilers and generators, its vehicles, refrigerant leaks from its equipment, the landfills and plants it operates.
- **Scope 2** — emissions from the electricity, heat, steam and cooling the company buys. Reported twice: **location-based** (average of the grid) and **market-based** (what the company actually buys: certificates, contracts, the supplier's own factor).
- **Scope 3** — other emissions in the value chain. So far: upstream emissions of fuels and energy, and transmission losses (3.3), and waste sent to other companies for treatment (3.5).

Biogenic CO₂ (from burning biomass, biogas, or the organic part of waste) is reported separately, **outside the scopes**, as the GHG Protocol requires.

## A month in Ekotrace

```flow
Readings arrive | meters send readings through the API, bills are uploaded as PDF
> Data entered | facility teams add fuel, vehicles, refrigerants, waste — one month, the whole year, or month by month
> Calculated at once | every entry shows its result, the factor used and the calculation steps while it is typed
* Checked | the person entering sees warnings (missing factor, gaps in readings, estimates) before saving
> Saved with its evidence | quantity, factor, source, steps and who saved it are stored with the entry
> Results | Entries & results shows the totals by scope and by gas; each entry opens to show how it was calculated
```

## Roles

| Role | Sees | Enters data | Manages |
|---|---|---|---|
| **Super admin** | the whole company | everywhere | people, structure, methodology, API clients |
| **Admin** | one sub-group and everything below it | in that sub-group | people and facilities of the sub-group |
| **Manager** | the facilities they manage or are assigned | there | fleet, meters, landfill sites, bills of those facilities |
| **Data preparer** | the facilities assigned to them | there | — |
| **Verifier** | the whole company, read-only | — | — (for auditors) |
| **Platform admin** | Ekobon staff: the shared factor library and company accounts | — | — |

Every request is checked on the server against these rules — hiding a button is never the only protection.

## The organisation

Organisation & groups holds the structure: **main entity → sub-groups → facilities**. Data is always entered for a facility.

The hierarchy can be seen as a **List** or an **Org chart** (switch at the top right; the choice is remembered). Colours show the level: **teal** main entity, **olive** sub-group, **blue** facility.

- **Click a facility** (anywhere on its row, or its card in the chart) to open it.
- **Click a sub-group or the main entity** to fold or unfold it; **Details** opens its profile.
- Search finds entities, facilities and locations; the type filter narrows to one kind of facility. In the chart, − / + zooms.
- A facility's name on other pages (for example a meter in Capture → Meters) links straight to it.

Everything that **describes** a facility — set up once, changed rarely — is on the facility itself, in tabs (Organisation → click the facility):

| Tab | What it holds |
|---|---|
| Profile | type, location, manager, floor area, employees, ownership and control, **grid region** (the emirate or grid it buys electricity from) |
| Meters | the facility's meters: what each measures, how often readings come, the utility account number; open one to see its months and readings |
| Energy | the energy set-up at a glance: grid region and its factors, utility accounts that bills are matched to, certificates and contracts usable here |
| Vehicle fleet | the vehicles based here, with in-service and retired dates |
| Landfill sites | landfills the company operates here, with their history of waste placed |

What **arrives** month after month stays under Capture, where it can be followed across all facilities at once: **Meters** (all meters and how their readings are coming in) and **Bills** (the one place to upload PDF bills). Certificates and supplier factors are kept for the whole company under Setup → Energy certificates & suppliers; the Energy tab shows the ones that apply to the facility.

**Methodology & boundaries** sets how the company reports: the consolidation approach (operational control, financial control or equity share — totals shown live for all three), the GWP set (AR4, AR5 or AR6) and the base year. A joint venture is handled by its ownership % and control flags.

## Moving around

- **Add data** — one tab per category; facility and period on top; the result is calculated as you type.
- **Entries & results** — everything saved for the year, totals per scope, per gas, and the detail of each entry.
- **Meters** and **Bills** — data that arrives from other systems or as PDF bills.
- **User manual** — this guide. It is updated with every release.

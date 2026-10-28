# Getting started

Ekotrace calculates a company's greenhouse gas emissions from the activity data its facilities enter: fuel burned, vehicles driven, refrigerant topped up, waste treated, electricity and cooling bought. Every number can be traced back to what was entered, the emission factor used and its source.

## How the inventory is built

```diagram scopes
```

The three scopes follow the GHG Protocol:

- **Scope 1** — emissions from sources the company owns or controls: its boilers and generators, its vehicles, refrigerant leaks from its equipment, the landfills and plants it operates.
- **Scope 2** — emissions from the electricity, heat, steam and cooling the company buys. Reported twice: **location-based** (average of the grid) and **market-based** (what the company actually buys: certificates, contracts, the supplier's own factor).
- **Scope 3** — other emissions in the value chain. So far: purchased goods and services (3.1), capital goods (3.2), upstream emissions of fuels and energy and transmission losses (3.3), upstream transport & distribution (3.4), waste sent to other companies for treatment (3.5), business travel (3.6), employee commuting (3.7), upstream leased assets (3.8), downstream transport & distribution (3.9), processing of sold products (3.10), use of sold products (3.11), end-of-life treatment of sold products (3.12) and downstream leased assets (3.13).

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

The page has four tabs:

| Tab | Shows |
|---|---|
| Tree | the hierarchy as a **List** or an **Org chart** (the choice is remembered); colours show the level: **teal** main entity, **olive** sub-group, **blue** facility |
| Facilities | one table of every facility: type, sub-group, location, manager (red when missing), meters, vehicles, landfill sites, the share of the year's entries approved and the tCO₂e — click a row to open the facility |
| Sub-groups | the main entity and each sub-group: where it sits, its admins, its facilities and tCO₂e; **Edit** and **+ Facility here** |
| Dashboard groups | any mix of facilities to view together (for example “European sites” or the SBTi boundary); **Open dashboard** shows it in Dashboards, where it is also in the “part of the group” list. Groups never change the structure. A person sees a group only if they can see every facility in it; the creator or a Super admin deletes it. Professional and Enterprise plans. |
| Company details & logo | the reporting entity printed on every report — legal name, registration no., LEI, region, sector and its code (NACE / ISIC / NAICS), regulator or registry ID, contact, website, net revenue (for intensity per revenue) and financial year end — and the **company logo** (PNG or JPEG) for the report cover |

**+ Facility** and **+ Sub-group** at the top add under the main entity (Super admin); inside the tree, the buttons under each sub-group add there. The number of facilities is limited by the company's plan.

In the Tree tab:

- **Click a facility** (anywhere on its row, or its card in the chart) to open it.
- **Click a sub-group or the main entity** to fold or unfold it; **Details** opens its profile.
- Search finds entities, facilities and locations; the type filter narrows to one kind of facility. In the chart, − / + zooms.
- A facility's name on other pages (for example a meter in a bill or a dashboard row) links straight to it.

Everything that **describes** a facility — set up once, changed rarely — is on the facility itself, in tabs (Organisation → click the facility):

| Tab | What it holds |
|---|---|
| Profile | type, location, manager, floor area, employees, ownership and control, **grid region** (the country, state, province or grid sub-region it buys electricity from) |
| Categories | which Scope 1, 2 and 3 categories apply to the facility — see *Categories that apply* below |
| Meters | the facility's meters: what each measures, how often readings come, the utility account number; open one to see its months and readings |
| Energy | the energy set-up at a glance: grid region and its factors, utility accounts that bills are matched to, certificates and contracts usable here |
| Vehicle fleet | the vehicles based here, with in-service and retired dates |
| Landfill sites | landfills the company operates here, with their history of waste placed |

### Categories that apply

Each facility starts with **every category ticked**. On its **Categories** tab, untick those that do not apply, for example an office with no company vehicles, no refrigerant equipment and no products sold, and give a reason for each.

| | Ticked (applies) | Unticked (not applicable) |
|---|---|---|
| Add data | listed on the left | hidden; the list says how many are hidden, with a link to change it |
| Missing months | shown when the facility reports the category | never shown; no reminders or escalations |
| Collection calendar, Data progress, data-quality checks | counted | left out |
| Entries made before | count | still count; a note in Add data says the category is marked not applicable |
| Report | — | the reason supports the boundary note |

Super admins, admins and the facility's manager change it; every change is in the audit log with who and when.

What **arrives** month after month is under Add data, in the tab it belongs to: **Bills** (PDF bills, checked, previewed, then published) and **Meter readings** (batches sent by connected meters, previewed before they count). Certificates and supplier factors are kept for the whole company under Setup → Energy & currency data → Energy certificates & suppliers; the Energy tab shows the ones that apply to the facility.

**Methodology & boundaries** sets how the company reports: the consolidation approach (operational control, financial control or equity share — totals shown live for all three), the GWP set (AR4, AR5 or AR6) and the base year. A joint venture is handled by its ownership % and control flags.

## Plans

The company's plan (shown under its name in the menu) is set by the Ekobon team:

| Plan | Facilities | People | Eko AI | Data export | Dashboard groups |
|---|---|---|---|---|---|
| Trial (30-day evaluation) | 3 | 5 | — | — | — |
| Starter | 10 | 15 | — | ✓ | — |
| Professional | 40 | 75 | ✓ | ✓ | ✓ |
| Enterprise | unlimited | unlimited | ✓ | ✓ | ✓ |

A facility or a person above the limit cannot be added (or brought back); what the plan does not include is greyed out with the plan it needs. Changing plan never deletes anything. To upgrade, contact the Ekobon team.

## Packages

Besides the plan, the Ekobon team switches on the **packages** the company has, one by one, in any mix:

| Package | What it is |
|---|---|
| The GHG inventory (this tool) | Scopes 1, 2 and 3, dashboards, targets, reports, assurance |
| Financed emissions | portfolios and holdings of banks and investors (PCAF) |
| CBAM Exporter | CBAM only, with a simpler menu; the CBAM pages are also part of the GHG inventory |
| India CCTS | GEI tracker for obligated entities under India's Carbon Credit Trading Scheme |
| BRSR Core | SEBI's BRSR Core for listed companies, with the value chain |

India CCTS and BRSR Core are **packages of their own**: they are not included in the GHG inventory. With the GHG inventory they read its approved entries and appear under Disclose. Without it, they open in a small menu of their own (the page, Organisation, People & access, Document vault, Audit log, Help) and every figure is typed. A page of a package the company does not have says so.

## Moving around

The menu on the left is grouped into coloured sections — Capture, Value chain, Net zero, Disclose, Setup and Help. Click a section title to fold or open it (the section of the page you are on always stays open).

Some menu entries hold related pages, shown as **tabs at the top of the page** (the menu entry's count adds up the counts of its tabs):

| Menu entry | Tabs |
|---|---|
| Dashboards | Dashboards · KPI dashboard |
| Entries & approvals | Entries & results · Approvals |
| Data progress | Data progress · Collection calendar |
| Inbox & messages | Inbox & to-dos · Message centre |
| Methodology & metrics | Methodology & boundaries · Metric registry |
| Energy & currency data | Energy certificates & suppliers · Currencies & price index |
| Integrations & batch runs | Integrations & API · Batch runs |

You see only the tabs your role allows; when only one is allowed, the menu entry takes its name. Links to a page (in e-mails and notifications) open the right tab.

**▾▾ Collapse all / ▸▸ Expand all** (above the menu) folds or opens every section at once. **«** next to the logo narrows the menu to icons only (hover an icon for its name); **»** widens it again. Both are remembered on this browser.

- **Home** — what needs your attention, for your role. **Dashboards** — charts of the inventory, and the **KPI dashboard** tab with the indicators you track against targets.
- **Add data** — categories on the left; facility and months on top; the result is calculated as you type.
- **Entries & approvals** — everything saved for the year, totals per scope, per gas, and the detail of each entry; the Approvals tab lists what waits for you.
- **Meters** and **Bills** — data that arrives from other systems or as PDF bills.
- **QR & field app** — bins with QR labels; scans at the bin roll up into the month's waste entries.
- **User manual** — this guide. It is updated with every release.

# Glossary

| Term | Meaning |
|---|---|
| Activity data | what was used or done: litres, km, kWh, tonnes |
| Emission factor | kg of greenhouse gas per unit of activity, from a named source and year |
| CO₂e | carbon dioxide equivalent: all gases expressed as CO₂ using their GWP |
| GWP | global warming potential of a gas relative to CO₂ over 100 years (IPCC AR4, AR5 or AR6) |
| Scope 1 / 2 / 3 | direct emissions / bought energy / other value-chain emissions (GHG Protocol) |
| Location-based / market-based | Scope 2 using the grid average / using what the company actually buys |
| Residual mix | grid mix after certificates sold to others are removed |
| I-REC, REC, GO | energy attribute certificates: proof of 1 MWh from a named source |
| Well-to-tank (WTT) | upstream emissions of producing and delivering a fuel or energy (Scope 3.3) |
| T&D losses | electricity or heat lost in the grid on the way (Scope 3.3) |
| Grid region | the grid a facility draws from: a country average, a state or province, or a grid sub-region (e.g. eGRID CAMX in California); its factor gives location-based Scope 2 |
| eGRID | US EPA database of emission rates for the US grid and its 27 sub-regions |
| NGA Factors | Australian Government National Greenhouse Accounts Factors, published each year |
| Biogenic CO₂ | CO₂ from burning biomass or organic waste; reported outside the scopes |
| Calorific value (net / gross) | energy content of a fuel, without / with the heat of the water vapour |
| Coverage | share of a month covered by meter readings or bills |
| Register / index reading | a meter value that counts up; consumption is the difference |
| FOD | first order decay: the IPCC model of landfill methane over the years after waste is placed |
| MCF | methane correction factor: how anaerobic a landfill or wastewater system is |
| DOC / DOCf | degradable organic carbon in waste / the share of it that decomposes |
| Consolidation approach | which facilities count, and how much: operational control, financial control, equity share |
| OAuth 2.0 client credentials | standard way for one system to obtain a short-lived token to call another |
| Row-level security | database rule that keeps each company's rows invisible to the others |
| Spend-based method | Scope 3 estimate from money spent × kg CO₂e per unit of money for that kind of product (environmentally-extended input-output data) |
| NAICS | North American Industry Classification System: the 6-digit codes of the EPA spend categories (e.g. 322121 paper mills) |
| Purchaser price / margins | price paid including transport, wholesale and retail margins; the EPA factors "with margins" are per dollar of purchaser price |
| CPI | consumer price index; brings money of one year to the prices of another |
| Supplier-specific factor | a supplier's own emission factor for what it sells (EPD, product footprint, its inventory divided by its revenue) |
| EPD | Environmental Product Declaration: a verified product footprint (ISO 14025) |
| Vendor number | the number the ERP gives a supplier; the surest way to link purchase lines to a supplier |
| Possible duplicate | a new supplier name that may be an existing supplier; a person merges it or keeps it apart |
| Supplier concentration | how many suppliers make up 50 % or 80 % of purchased emissions |
| Ready to publish | A bill a person has checked, waiting in the preview with its months, estimated emissions and anything that stops it |
| Reading batch | Meter readings sent through the API in one request, waiting for review: new, corrections, duplicates (skipped), conflicts (skipped) |
| Published lines | The purchase lines behind published purchase entries, kept line by line and downloadable |
| What moved | On each dashboard tab: the three sources that changed most against the comparison year, calculated from the entries |
| Dashboard group | Any mix of facilities viewed together in Dashboards; never changes the organisation; shown only to people who can see all its facilities |
| Plan | Trial, Starter, Professional or Enterprise: how many facilities and people, and whether Eko AI, data export and dashboard groups are on |
| Passenger-km | One person travelling one km; buses, rail and taxis are counted this way. Cars are counted per car-km (shared cars divided by the people in them) |
| Commuting survey | One answer per employee about how they travel to work; scaled up to all employees of the facility (employees ÷ answers) |
| Response rate | Survey answers ÷ employees of the facility; below 30% a warning is shown |
| Ekotrace survey | A survey run in Ekotrace (Capture → Surveys): people answer with a personal code, without an account; results are published into Employee commuting |
| Personal code | 8 letters and digits (no 0/O or 1/I) given to each person asked; it finds their survey and lets them change their answer until it closes |
| 95% range | How far a survey estimate could move with a different sample: ± 1.96 × standard deviation ÷ √answers × finite-population correction × headcount |
| Small sample | Fewer than 30 answers or fewer than 10% of the facility's headcount |
| FTE working hour | One full-time employee working one hour; DESNZ home-working factors are per FTE working hour |
| Working days | Weekdays of the year minus public holidays and annual leave; used for commuting distances and to split the year into months |
| Water withdrawal | All water a facility takes in: from a utility, tanker, TSE, own wells, the sea or rain (GRI 303-3) |
| Water discharge | Water a facility lets out: to a sewer, tanker for treatment, land, sea or surface water (GRI 303-4) |
| Water consumption | Withdrawal minus discharge: water evaporated, in products or kept in the ground (GRI 303-5) |
| TSE | Treated sewage effluent: treated wastewater reused, mostly for irrigation and district cooling |
| Diverted from disposal | GRI 306-4: waste prepared for re-use, recycled or otherwise recovered (composting, digestion); incineration with energy recovery is disposal in GRI, but counts as diverted from landfill |
| Hazardous waste | Waste marked hazardous on its entry (e.g. electronic waste, batteries, clinical, oily waste), reported separately in GRI 306 |
| Draft | An entry saved but not submitted; counts only in views that include pending data |
| Submitted / In review | Waiting for approval by someone who may approve the facility (not the person who entered it) |
| Sent back | Returned by an approver with a note; fix and submit again |
| Approved | Checked by an approver; counts in the dashboards and reports |
| Radiative forcing (RF) | The extra warming of aircraft emissions released at altitude (contrails, NOx); DESNZ flight factors with RF are about 1.7× those without |
| Great-circle distance | The shortest distance between two airports over the Earth's surface; DESNZ adds 8% for real routes |
| Flight type (haul) | Domestic (one country), Short-haul (under 3,700 km), Long-haul (3,700 km or more), International (the average, when the distance is not known) — the DESNZ flight factor groups |
| Manifest (waste transfer note) | the signed document that travels with a load of waste: what, how much, from where, to where; required for hazardous waste; the evidence for the tonnes |
| Contractor (waste) | the licensed company that collects and treats the waste; its statement is used to check the month's tonnes |
| GRI 306 disposal method | re-use, recycling, composting, anaerobic digestion (diverted from disposal); incineration with or without energy recovery, landfill, other disposal (disposal) |
| QR label (bin) | a label with a link to the bin's scan page; holds no data; opening it needs a signed-in person with access to the facility |
| Weighbridge weight | the weight on the collection ticket; replaces the month's field scans for that bin |
| Contractor portal | the page (/contractor) where a waste contractor, with its email and an access code, records collections and sends its monthly statement for the bins assigned to it |
| Room-night | One hotel room for one night; 2 rooms for 3 nights = 6 room-nights |
| Target path | The straight-line route from base-year emissions to the reduction target in the target year; each month is compared with the same base-year month cut by the share due by then |
| Due day | Day of the next month by which a month's data should be submitted (Methodology → Collection rules) |
| Overdue / escalated | A submission past its due day; escalated once it is more than the escalation days late |
| Submission | One facility × one category it reports × one month |
| Self-reviewed | An entry approved by the person who entered it — only allowed when the company has a single user |
| KPI target | A level set for a KPI and a selection (company, sub-group, facility or group); bars turn green when met |
| Run-rate | This year's approved emissions for the months so far, annualised |
| Abatement | The reduction an action brings, in tCO₂e a year once fully delivered |
| Scenario | A set of selected reduction actions; compared on gap to the target, capex and NPV |
| NPV (8%) | Net present value: lifetime net savings discounted at 8% a year, minus the investment |
| Marginal abatement cost | Net cost per tonne reduced; negative means the action saves money |
| Residual emissions | What is left at net zero (at most ~10% of the base year), neutralised by permanent removals |
| Level 1 / level 2 approval | Level 1: the facility manager, sub-group admin or super admin. Level 2 (optional): a second approval by an admin or the super admin for large entries or chosen categories |
| 6-month check | An entry's quantity compared with the average for the same item at the same facility over the 6 months before |
| GHG Protocol category | 1.1–1.4 Scope 1, 2.1–2.2 Scope 2, 3.1–3.15 Scope 3 (the 15 Scope 3 categories) |
| Exclusion justification | Why a category has no data (e.g. no products sold); every excluded category needs one in the inventory |
| MRV dataset | One row per approved entry (facility, scope, category, activity, unit, factor, source, data type, evidence) for a regulator's MRV platform or a verifier |
| Report version | The inventory frozen at a point in time, to compare with today |
| Limited / reasonable assurance | limited: "nothing has come to our attention…", fewer tests; reasonable: "presents fairly, in all material respects", more evidence and larger samples |
| Materiality | the size of misstatement that would change a reader’s view, usually 5% of the total |
| Key item | an entry large enough (above the key-item threshold) to be tested every time |
| Period lock | a month closed for assurance: nothing in it can be added, changed or removed |
| ISO 14064-1 categories | 1 direct; 2 imported energy; 3 transportation; 4 products used by the organization; 5 use of the organization’s products; 6 other indirect |
| ESRS E1 | the climate standard of the EU Corporate Sustainability Reporting Directive (CSRD) |
| IFRS S2 | the ISSB climate-related disclosure standard |

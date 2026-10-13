# Data categories

What each category covers, which scope it counts in, what to enter and how it is calculated. All factors carry their source and year; calculation steps are kept with every entry.

## Stationary combustion — Scope 1

**What:** fuel burned in fixed equipment — boilers, furnaces, generators, kitchens, incinerator start-up burners.
**Enter:** the fuel and the quantity, in any unit the fuel is sold in (litres, kL, gallons, kg, tonnes, m³, kWh net or gross, GJ…).
**How:** quantity × DESNZ factor of the year, **per gas** (CO₂, CH₄, N₂O) × the company's GWP set. Upstream emissions of the fuel (well-to-tank) go to Scope 3.3.

- Six fuel classes: liquid, solid, gaseous, biofuel, biomass, biogas. For **bioenergy**, CH₄ and N₂O count in Scope 1 and the CO₂ is reported as biogenic, outside the scopes.
- **Own calorific value:** when the supplier's certificate or a lab gives the fuel's energy content, tick "Use our own calorific value": the quantity is converted to energy with that value and the energy factors are used. The DESNZ value is offered as the default.
- Diesel and petrol default to "100% mineral" (no biofuel blend in the UAE).

## Vehicles — Scope 1 (electric driving: Scope 2)

**What:** company-owned or leased cars, vans, trucks, motorbikes and off-road machinery (forklifts, loaders, sweepers).
**Enter:** for a fleet vehicle or a vehicle type — **distance** (km, miles), **fuel used** (litres, kg), **electricity charged** (kWh) or **spend** (converted to litres with the price list).
**How:** DESNZ factors per km for each vehicle class and powertrain, or the fuel's factor for fuel used.

```flow
? Is it electric? | Battery electric: no tailpipe — kWh (charged, or km × kWh per km) × grid factor → Scope 2 | Petrol / diesel / hybrid: distance or fuel × factor → Scope 1
? Charged at our own site? | Yes: already on the site's electricity meter — shown, not counted twice | No: counted here in Scope 2
> Plug-in hybrids | split between the fuel part (Scope 1) and the electric part (Scope 2)
```

- **Fleet register** per facility (Organisation → facility → Vehicle fleet): add, retire with a date, reinstate. Data entry offers the vehicles in service in the month.
- Rows can be typed or pasted in everyday words ("car petrol 2 34 km", "tipper 18t", "forklift LPG"): each row shows how it was read before anything is saved.
- Spend-based (money) factors are deliberately not used for Scope 1: spend is converted to litres with a price, then the fuel factor applies.

## Fugitive emissions — Scope 1

**What:** refrigerant and other gas leaks — air conditioning, chillers, cold rooms, SF₆ switchgear, CO₂ fire extinguishers.
**Enter:** the gas or blend and one of three methods:

| Method | Use when | Calculation |
|---|---|---|
| Quantity refilled | service records show what was topped up | refilled = leaked |
| Screening | only the equipment charge is known | charge × annual leak rate (+ installation and disposal losses) |
| Mass balance | gas purchase and stock records exist | stock change + purchases − returns + equipment changes |

Blends (R-410A, R-407C…) are calculated per gas from their composition. Gases outside the Kyoto basket (e.g. HCFC-22) are reported as a **memo**, not added to Scope 1.

## Waste — Scope 1 or Scope 3.5

The scope follows **who runs the treatment site**: one Waste tab with a switch.

```flow
? Who treats the waste? | Our own site → Scope 1: landfill, incineration / waste-to-energy, composting, digestion, wastewater | Another company → Scope 3.5: tonnes × DESNZ waste factor by material and route
```

**Own sites** — IPCC 2006 Guidelines Vol. 5 with the 2019 Refinement; every default is shown with its table and can be replaced per site:

- **Landfill:** methane builds up for decades after waste is placed, so each landfill keeps a **tonnage history** (per year and waste type) in its site register, with its climate, site type (MCF), soil cover and waste composition. Methane for the year = IPCC first order decay over all earlier years — or, where only gas is metered, gas collected ÷ collection efficiency. Gas burned in engines or flares is subtracted; the share that escapes the flame (open flare 50%, enclosed flare 90%, engines up to 99%) counts as emitted.
- **Incineration / waste-to-energy:** fossil CO₂ from the waste's carbon (plastics, textiles, rubber); the food, paper and wood part is biogenic and reported outside the scopes. CH₄ and N₂O by technology. Measured stack CO₂ with its biogenic share can be used instead. Electricity exported is shown but **never subtracted**.
- **Composting and anaerobic digestion:** CH₄ and N₂O per tonne; for digesters, measured biogas with leaks and flaring.
- **Wastewater:** CH₄ from the organic load (BOD or COD) and the treatment system; N₂O from nitrogen in the plant and the effluent.

**Sent to others (Scope 3.5):** rows of material, route (landfill, combustion, recycling, composting, digestion) and tonnes × the DESNZ factor. These are UK averages — landfills without gas capture are likely higher.

**Waste reporting (GRI 306).** Each row of waste sent to others also records whether it is **hazardous**, the **contractor** (collector or treatment company; earlier names are suggested) and the **manifest or ticket** number. These do not change the emissions; they feed the Waste dashboard: waste generated, hazardous and non-hazardous, diverted from disposal (re-use, recycling, composting / digestion) or directed to disposal (incineration with energy recovery, landfill), by contractor and by facility.

- *Diverted from landfill* (the usual UAE measure) counts waste-to-energy as diverted; GRI 306 counts incineration with energy recovery as disposal. The dashboard shows both.
- Waste the company treats **for others** at its own sites (landfill, waste-to-energy plant) is operations, not waste it generated: its emissions are Scope 1, and its tonnes are not in "waste generated".

## Water — Scope 3.1 and 3.5, and water accounting

**What:** all water a facility takes in (by source), recycles on site, and lets out (by destination), in m³ — or litres, kL, megalitres, imperial gallons or thousand imperial gallons as on the bill.
**Enter:** Add data → **Water**, with the same three ways as electricity: **Type in** (a month, the whole year or month by month), **Bills** (water bills; a combined electricity & water bill from DEWA or SEWA can be dropped under both — under Water its water consumption is read, under Electricity its kWh — and the two are separate bills, each matched to its own meter of the same account), **Meter readings** (water meters through the API).

| | Sources / destinations | Scope 3 |
|---|---|---|
| **Water in** | mains water (desalinated or other), tanker water, treated wastewater (TSE) bought | 3.1 — DESNZ water supply factor per m³, or the utility's own factor |
| | groundwater (own well), seawater (own intake or desalination), rainwater or surface water | none — the pumping and desalination energy is already in the facility's electricity and fuel |
| **Recycled on site** | greywater, own TSE for irrigation, reused process water | none; reported as recycled water |
| **Water out** | public sewer / municipal treatment, removed by tanker for treatment | 3.5 — DESNZ water treatment factor per m³, or the utility's own |
| | irrigation or soak-away, to sea, to surface water | none |

- **Desalinated water** takes much more energy than the UK water behind the DESNZ factor. Enter the utility's factor per m³ (and where it comes from) on the row when you have it; until then the entry carries a warning.
- **Consumption** = water in − water out (evaporation, water in products, irrigation that stays in the ground). Water that goes to the company's own treatment plant is not "out": record where the plant discharges it.
- The Water dashboard follows GRI 303: withdrawal and discharge by source type (third-party water, groundwater, seawater, surface water) in megalitres, consumption, recycled water, by facility and per employee. Water-stress areas are not assessed.

## Electricity, heat & cooling — Scope 2 (and 3.3)

**What:** electricity, district heat or steam, and district cooling bought.
**Enter:** the quantity (kWh, MWh, TRh…). Readings can also come from a **meter** or from **bills**.

```flow
> Location-based | quantity × grid factor of the facility's grid region (emirate, state, or the country average)
> Market-based, in order | 1. certificates and contracts claimed (I-REC, REC, PPA, green tariff) → 2. the supplier's factor → 3. the region's residual mix → 4. the grid average, with a note
> Scope 3.3 | transmission & distribution losses and upstream emissions of generation, from the same entry
```

- Both Scope 2 figures are always reported side by side and never added together.
- **Certificates** (Setup → Energy certificates & suppliers): each MWh can be claimed once — the tool refuses a claim beyond what is held, also when two people save at the same moment.
- **Cooling:** the supplier's factor per TRh, or the plant's efficiency (kWh per TRh, or COP) × the grid factor.

## Purchased goods & services — Scope 3.1 (and 3.2, 3.4, 3.6, 3.8)

**What:** everything the company buys that is not fuel or energy it uses itself: materials, equipment, IT, services, travel and freight paid for, rent.
**Enter:** purchase lines — uploaded from the ERP or finance system or typed by hand (both under Add data → Purchases), or sent by the ERP through the API. Each line: date, description, amount and currency; supplier, category and GL account help the mapping.

```flow
> Spend category | each description is mapped to a spend category (US EPA NAICS commodity)
> Best factor | the supplier's own factor (per kg, t, L, piece or per currency) when there is one, else the spend-based factor
> Money brought to the factor | amount → US dollars at the month's exchange rate → 2022 prices with the US consumer price index
> Result | money (or quantity) × factor = kg CO₂e, line by line; entries per facility, month and category
```

- **Other categories:** air tickets, hotels and taxis belong to business travel (3.6); freight and couriers to upstream transport (3.4); rent to upstream leased assets (3.8); capitalised assets to capital goods (3.2). Fuel, electricity and waste are usually already counted from activity data — those lines are **excluded** to avoid counting twice. The tool flags them; a person decides.
- Spend-based factors are averages: supplier-specific factors are better and are shown separately in the data-quality split.

## Business travel — Scope 3.6

**What:** travel for work in vehicles the company does not own or control: flights, hotel stays, trains, buses, taxis, hire cars and ferries. Company vehicles are under Vehicles; the journey to and from work is Employee commuting.
**Enter:** Add data → Business travel, one row per trip, for the months picked. Four ways in:

| Way | What you give | How it is counted |
|---|---|---|
| **Flights** | from / to airports (code or city, e.g. DXB, Riyadh) — or the flight type and the one-way km; class; return; trips (journeys × people) | distance × trips × the DESNZ air factor for the haul and class, per passenger-km |
| **Hotel stays** | country, rooms, nights (or the hotel's own factor per room-night) | room-nights × the DESNZ hotel-stay factor of the country |
| **Other transport** | train, metro, bus, coach, taxi, hire car (by size and fuel) or ferry; one-way km; return; trips | DESNZ business travel – land and sea, per passenger-km (hire cars per km) |
| **By spend** | the amount, when only the cost is known (e.g. a card statement) | EPA spend factor for air, hotel or ground travel; expense or travel-agency exports go through Purchases |

```flow
> Distance | great-circle distance between the airports + 8% for routing, stacking and delays (DESNZ)
> Haul | both airports in one country → domestic; to or from the UK → short-haul (under 3,700 km) or long-haul; otherwise international (DESNZ "to/from non-UK")
> Class | economy, premium economy, business, first, or not known (average); DESNZ has only the average for domestic flights and economy / business for short-haul — the nearest is used and the steps say so
> Passenger-km | one-way km × 2 when return × trips
> Factor | DESNZ business travel – air, with radiative forcing (the company can choose without, under Methodology); its well-to-tank is counted in 3.6
```

**Flight type and distance:** when the airports are not known, choose domestic, international or (to/from the UK) short- or long-haul and type the one-way km; left empty, a typical distance is used (domestic 450 km, international 3,000 km, short-haul 1,500 km, long-haul 6,500 km) and the entry says so.

**Radiative forcing** adds the warming effect of aircraft emissions at altitude (contrails, NOx) — DESNZ recommends including it; GHG Protocol leaves it optional. The company's choice is under Methodology and shows on every flight entry.

**Hotels:** DESNZ publishes a factor per room per night for about 50 countries; when a country has no value in the year, the latest earlier year is used. For other countries choose a nearby one or enter the hotel's own factor.

## Employee commuting — Scope 3.7

**What:** travel between home and the workplace by employees, in vehicles the company does not own or control (own cars, car-pools, taxis, public transport, a contracted staff shuttle). A shuttle the company owns or leases and runs itself is fleet (Scope 1) instead.
**Enter:** **once a year per facility**, under Add data → Employee commuting. Saving again for the same facility and year replaces the earlier figures; nothing is added twice.

**Two ways in**

| | What you give | Good for |
|---|---|---|
| **Type in** | per way of travelling: employees, average one-way distance, days at the workplace per week (and people per car for cars); or the year's total distance when it is known (e.g. the shuttle contractor's passenger-km) | small sites, or when HR already knows the split |
| **From a survey** | an **Ekotrace survey** (Capture → Surveys, below) published into the record; or one answer per employee uploaded as Excel or CSV — the Ekotrace survey file (Download the survey file) or an export of Microsoft Forms / Google Forms | larger sites; the better method |

Under *From a survey*, Add data lists the Ekotrace surveys that cover the facility and year (status, answers, **Open**, **Results & publish**) and a **+ New survey** link. A record published from a survey shows *From survey "…"*; to change it, reopen the survey and publish again — saving other figures in Add data replaces it.

**The survey.** Questions: main way to work; one-way distance (km); days at the workplace per week; people in the car (including the driver); car fuel; optionally a second way and its distance (e.g. bus then metro) and the site. Columns are recognised by their names (you can change the choice under *Columns*), and so are everyday answers ("Dubai Metro", "Careem", "drive my car", "work from home"). Answers that cannot be read are listed and left out. When one file covers several sites, only the rows of the facility are used (choose the site value if the name differs).

**Scaling up.** The answers stand for all employees of the facility: each answer counts for *employees ÷ answers* people (110 answers for 171 employees → 1.55 each). People who work from home all week count as answers with no travel, so they are not scaled up as commuters. Below 30% of employees answering, a warning is shown.

```flow
> Per person and year | 2 × one-way km × working days × (days at the workplace ÷ working days per week, 5 or 6)
> Cars | ÷ people in the car (car-km); motorbikes per km
> Taxi, bus, shuttle, metro, train | passenger-km
> Factors | DESNZ land travel of the year (cars by fuel, average size), with well-to-tank, all in 3.7
> Months | the year split by the working days of each month → one entry per mode and month
```

### Ekotrace surveys (Capture → Surveys)

Ask employees directly, without a separate form tool. Admins and super admins create and run surveys; managers can publish; verifiers can view results. People answering do not need an account.

```flow
> 1 · New survey | name, reporting year, answers due by, working weeks per year (46 by default), facilities covered (with their staff counts), optionally home-working days
> 2 · Add people | paste "name, email, facility, department" or upload a CSV; each person gets a personal 8-character code
> 3 · Open & send | Email (opens your mail app with the invitation), Copy text, or Download invitations (CSV for a mail merge); "Send to unanswered" for reminders
> 4 · Collect answers | people go to the sign-in page → "Answering a survey? Enter your code" (or the link with the code) and answer in about 2 minutes; the same code changes the answer until the survey closes; admins can enter a paper answer on someone's behalf
> 5 · Results & publish | average per respondent × headcount, per facility, with a 95% range → one commuting record per facility and year in Scope 3 · Employee commuting
```

**The questions:** where you usually work (site); days a week you travel to work; days a week you work from home (if asked); main way you travel and one-way km; an optional second way (e.g. bus then metro) and its km; car fuel and people in the car (for cars and car pools).

**Scaling up.** Per facility: average kg CO₂e per respondent × headcount. The headcount comes from the facility's details and can be changed for the survey on the Results tab. A facility with no answers uses the company average (flagged). *Small sample* = fewer than 30 answers or fewer than 10% of the headcount. The 95% range is 1.96 × standard deviation ÷ √answers, with the finite-population correction √((N − n) ÷ (N − 1)), × headcount — how far the estimate could move with a different sample.

**Working days for a survey** = working weeks × 5 (46 weeks → 230 days; holidays and leave are in the weeks left out). Home working, when asked: home days × 8 hours × DESNZ "Homeworking" per FTE working hour (office equipment; heating is not used for the UAE climate) — indicative.

**Publishing** writes the same record as Add data: one entry per mode and month (the year split by working days), waiting for the usual approver. The publish plan shows per facility whether it is new or replaces typed-in figures, an uploaded file or an earlier publish. A facility with approved entries for the year, or outside your access, is skipped. Publishing again (after *Reopen*) replaces the records. Published surveys cannot be deleted.

**Privacy.** People answering see only their own first name, the company and the sites. Inside Ekotrace, names, emails, codes and individual answers are shown to admins only; others see counts and averages. Results are reported as averages. Code lookups are limited per network address.

**Actions tab:** ways to reduce commuting emissions with an indicative size from your results (staff shuttle, car-pooling, hybrid working, EV charging) and guides.

**Working days.** Weekdays of the year (by the facility's weekend: Saturday–Sunday, Friday–Saturday or Sunday only) − public holidays (12 by default) − annual leave (22 by default), or typed over. Holidays and leave come off the **year's total**; the year is then spread over the months by each month's working days.

**Why no seasonal weights?** For the year — the figure that is reported — they change nothing: the holidays and leave are already taken off the total. They would only move tonnes between months, and doing that well needs a company holiday calendar and leave records per month; for most companies a guess would make the months look precise without being so. The months are therefore split by working days, the same for every mode. If a site has a known shutdown (e.g. two weeks in August), lower its working days for the year.

- **Locked once approved:** the monthly entries are made from the record and change only with it. When any of them is approved, the record can no longer be changed or removed.
- **Electric cars:** the DESNZ factor assumes charging on the UK grid; with few electric cars the difference is small.
- Working from home (home-office energy) is optional in the GHG Protocol and is not counted.
- On dashboards, commuting shows under Mobility & travel and Scope 3.7; it does not count towards "% of required data in".

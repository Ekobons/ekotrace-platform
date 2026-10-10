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
**Enter:** purchase lines — uploaded from the ERP or finance system (Capture → Purchases), sent by the ERP through the API, or typed under Add data → Purchases. Each line: date, description, amount and currency; supplier, category and GL account help the mapping.

```flow
> Spend category | each description is mapped to a spend category (US EPA NAICS commodity)
> Best factor | the supplier's own factor (per kg, t, L, piece or per currency) when there is one, else the spend-based factor
> Money brought to the factor | amount → US dollars at the month's exchange rate → 2022 prices with the US consumer price index
> Result | money (or quantity) × factor = kg CO₂e, line by line; entries per facility, month and category
```

- **Other categories:** air tickets, hotels and taxis belong to business travel (3.6); freight and couriers to upstream transport (3.4); rent to upstream leased assets (3.8); capitalised assets to capital goods (3.2). Fuel, electricity and waste are usually already counted from activity data — those lines are **excluded** to avoid counting twice. The tool flags them; a person decides.
- Spend-based factors are averages: supplier-specific factors are better and are shown separately in the data-quality split.

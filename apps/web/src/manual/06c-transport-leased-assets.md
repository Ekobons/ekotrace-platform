# Transport, storage and leased assets

Four Scope 3 categories cover goods moved and stored by others, and buildings or vehicles that change hands through a lease. Each has its own tab in **Add data**.

| Category | What it covers | Typical data |
|---|---|---|
| **Upstream transport & distribution (3.4)** | freight and storage of goods **coming to you, paid by you**: suppliers' deliveries you pay for, inbound shipping, couriers, third-party warehouses you rent space in. Also outbound freight **you pay for** | tonne-km or truck-km from the carrier, the warehouse area you use, the carrier's emission statement |
| **Downstream transport & distribution (3.9)** | freight and storage of **products you sold, not paid by you**: the customer's or distributor's delivery, retailers' warehouses | estimated tonne-km to customers, distribution warehouse area |
| **Upstream leased assets (3.8)** | buildings and vehicles **you lease (rent)** whose emissions are **not already in your Scope 1 and 2** — e.g. an office where the landlord pays the energy | the landlord's energy bills or report, the floor area, leased vehicles' km or fuel |
| **Downstream leased assets (3.13)** | buildings and vehicles **you own and lease out**, used by the tenant | the tenant's energy use or report, the floor area, vehicles' km or fuel |

```flow
? Who pays for the transport? | You pay (on your invoice): 3.4 Upstream transport & distribution — inbound or outbound | Someone else pays (customer, distributor): 3.9 Downstream transport & distribution
? A leased building or vehicle — is its energy already in your Scope 1 and 2? | Yes (you run it and pay the energy, operational control): it is in Scope 1 and 2 — nothing in 3.8 | No (the landlord pays it, or you chose financial control): 3.8 Upstream leased assets
? A building or vehicle you own — who uses it? | You: your own Scope 1 and 2 | A tenant: 3.13 Downstream leased assets (unless already in your Scope 1 and 2)
```

## Ways of entering

Pick **What you know** first; the list of types and units follows.

| What you know | Unit | How it is calculated | Best for |
|---|---|---|---|
| **Road freight (trucks, vans)** | tonne-km, or km / miles for a whole vehicle hired | DESNZ *Freighting goods* factor for the vehicle and load, plus its upstream fuel (well-to-tank) | shared loads and couriers (tonne-km); dedicated trucks (km) |
| **Sea, air and rail freight** | tonne-km | DESNZ factor for the ship type and size, freight flight (with radiative forcing) or freight train, plus upstream fuel | shipping, air cargo |
| **Warehousing — by floor area** | m² × months (or days, years) | area × time × the typical energy use of that kind of warehouse (kWh per m² per year) × the facility's grid factor | when only the area is known |
| **Warehousing — energy used** | kWh, litres, m³… | the platform's grid or fuel factor | when the operator gives the energy for your space |
| **Leased buildings — energy used** | kWh, m³ of gas, litres of diesel, kg of LPG | the platform's grid factor (with grid losses and upstream) or DESNZ fuel factor (with upstream) | the best method: the building's meters or bills |
| **Leased buildings — by floor area** | m² × months | area × time × typical energy use of the building type × grid factor | when the energy is not known |
| **Emissions reported by the carrier / landlord / tenant** | kg or t CO₂e | the reported figure as it is | when they give their Scope 1 and 2 for your goods or space — attach the statement |
| **Leased vehicles — by distance** | km, miles | DESNZ *Managed assets – vehicles* factor for the class and fuel, plus upstream fuel | leased cars, vans, trucks |
| **Leased vehicles — by fuel** | litres, kg | DESNZ fuel factor, plus upstream | when the fuel bought is known |

Everything is counted in the category's Scope 3 — the energy of an asset someone else runs is never your Scope 1 or 2. Grid losses and upstream fuel are included, as in business travel and commuting. Each entry shows its steps: the area or tonne-km, the factor and its source.

**Tonne-km** = tonnes carried × km. 20 t of cement moved 150 km = 3,000 tonne-km. A courier parcel of 12 kg sent 1,000 km = 12 tonne-km.

## Typical energy use of buildings (floor-area method)

| Building type | kWh per m² per year | Source |
|---|---|---|
| Office | 160 | BCA Singapore 2023, offices ≥15,000 m², median (electricity) |
| Retail store | 331 | BCA Singapore 2023, retail 5,000–15,000 m², median |
| Shopping mall | 367 | BCA Singapore 2023, retail ≥15,000 m², median |
| Hotel | 232 | BCA Singapore 2023, hotels, median |
| Hospital | 357 | BCA Singapore 2023, hospitals, average |
| Clinic / medical office | 164 | BCA Singapore 2023, polyclinics / private clinics, average |
| School | 98 | BCA Singapore 2023, private colleges / schools, average |
| University / college | 187 | BCA Singapore 2023, universities, average |
| Apartments / residential | 188 | ENERGY STAR (US EPA) 2024, multifamily, median site energy |
| Supermarket / grocery | 618 | ENERGY STAR 2024, median site energy |
| Restaurant | 1,027 | ENERGY STAR 2024, median site energy |
| Bank branch | 279 | ENERGY STAR 2024, median site energy |
| Warehouse (ambient / dry) | 72 | ENERGY STAR 2024, non-refrigerated warehouse, median site energy |
| Warehouse (refrigerated / cold store) | 265 | ENERGY STAR 2024, refrigerated warehouse, median site energy |
| Self-storage | 64 | ENERGY STAR 2024, median site energy |

- **Why Singapore first:** the BCA benchmarks are official, from a hot climate, and count electricity only — the closest match for buildings in the Gulf, India and South-East Asia, which are cooled rather than heated.
- **ENERGY STAR** fills the types BCA does not cover. Its figures are US *site energy* (all fuels); they are counted as electricity — slightly conservative for all-electric buildings. Say so in the report's methodology note.
- Dubai's own benchmarks (EmiratesGBC, 2019) are higher for malls (465) and hotels (252) — another reason to prefer the real energy of the building whenever the landlord can give it.
- Data centres and factories have no floor-area benchmark: use their energy or the landlord's reported emissions.
- The values live in one file (`data/buildings/energy-intensity.csv`); the platform admin can update them, and each entry keeps the value it was calculated with.

## Scenarios

| Situation | What to do |
|---|---|
| A **logistics company** delivers raw materials, the supplier pays | it is in the supplier's price — counted in purchased goods (3.1), not in 3.4 |
| **You pay** the freight for raw materials (FOB / EXW terms) | 3.4: tonne-km from the shipping documents (weight × distance by mode) |
| **You deliver** to customers in your **own trucks** | Scope 1 (Vehicles), not 3.4 or 3.9 |
| **You pay** a courier to deliver to customers | 3.4 (paid by you, even though it is outbound) |
| The **customer arranges** collection from your warehouse | 3.9: estimate tonne-km to their sites |
| Freight already came in as **spend** from a purchase file (moved to 3.4) | keep one or the other for the same shipments — if you enter tonne-km for them, **exclude** those spend lines in the purchase review |
| You rent **space in a 3PL warehouse** | 3.4 — warehousing by floor area (m² × months), or the operator's energy for your space |
| A **leased office** where you pay the DEWA bill yourself | already in your Scope 2 (Electricity) — nothing in 3.8 |
| A **leased office** in a tower where the landlord pays the energy | 3.8 — ask for your share of the energy (kWh); otherwise floor area × months |
| You **lease out** floors of your building and the tenants pay their own electricity | 3.13 — their kWh, or floor area × months |
| **Leased cars** whose fuel you pay | already in your Scope 1 (Vehicles) under operational control — not 3.8 |
| A carrier sends a **CO₂ statement** for your shipments | *Emissions reported by the carrier*, in kg or t CO₂e — attach it as evidence |

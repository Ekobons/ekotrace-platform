# Sold products: processing, use and end of life

Three Scope 3 categories cover what happens to your products **after the sale**. Each has its own tab in **Add data**. Everything is counted in the category's Scope 3. It is never your Scope 1 or 2, because the processor, the user or the waste company does it.

| Category | What it covers | Typical data |
|---|---|---|
| **Processing of sold products (3.10)** | **intermediate** products you sell that others process further before they reach the end user, e.g. resin moulded into parts, steel coil pressed into panels, grain milled into flour | the processor's energy for your products, or their energy per tonne × the tonnes you sold them; their reported emissions |
| **Use of sold products (3.11)** | energy, fuel and gases released while customers **use** the products sold in the year, over their **whole expected life** | units sold, years of life, kWh or litres per year, refrigerant charge and leak rate; fuel sold to customers; a product footprint (LCA, EPD) |
| **End-of-life treatment of sold products (3.12)** | disposal of the products sold in the year — **and their packaging** — when customers throw them away | product weight × units sold, by material and by route (landfill, incineration, recycling, composting) |

```flow
? Do you sell products that others process further? | Yes (an intermediate product): 3.10 Processing of sold products | No (a final product): nothing in 3.10
? Do your products use energy, burn fuel or contain a gas? | Yes (appliances, vehicles, engines, AC units, fuels sold): 3.11 Use of sold products — direct use phase | No (furniture, clothing, packaging): usually nothing in 3.11
? Is anything thrown away at the end of its life? | Products and their packaging: 3.12 End-of-life treatment, by material and route | Services only: nothing in 3.12
```

Use-phase and end-of-life figures cover the units **sold in the reporting year**, for their whole life. They are not the units in use this year. Enter them once a year: pick **Whole year** in Add data.

## Ways of entering

| Category | What you know | Unit | How it is calculated |
|---|---|---|---|
| 3.10 | **Energy used by the processor** — electricity, natural gas, diesel, fuel oil, LPG | kWh, m³, litres, kg | the platform's grid factor (with grid losses and upstream) or the DESNZ fuel factor (with upstream) |
| 3.10 | **Emissions reported by the processor** | kg or t CO₂e | the reported figure, as it is — attach their statement |
| 3.11 | **Products that use electricity** | kWh over the products' life | the grid factor of the facility's grid region, with losses and upstream |
| 3.11 | **Products that burn fuel** — diesel, petrol, natural gas, LPG, kerosene | litres, m³, kg over their life | DESNZ fuel factor, with upstream |
| 3.11 | **Fuels sold to customers** — also jet fuel, marine gas oil, fuel oil, coal | litres, kg, tonnes | DESNZ fuel factor, with upstream — the customer burns the fuel you sold |
| 3.11 | **Refrigerants and gases released by products** — R-410A, R-32, R-134a, R-404A, R-407C, R-1234yf, R-290, R-600a, CO₂ | kg released over the life | mass × the gas's GWP (the company's GWP set); gases outside the Kyoto basket (R-290, R-600a) are shown as a memo item |
| 3.11 | **Use-phase emissions from a product study** | kg or t CO₂e | per unit (LCA / EPD) × units sold — attach the study |
| 3.12 | **A material and a route** — construction, electrical items (incl. batteries, fridges), metal, paper, plastic, refuse, other | tonnes, kg | the DESNZ waste factor of that material and route — the same factors as *Waste sent to others* |
| 3.12 | **Emissions from a product study** | kg or t CO₂e | per unit × units sold |

**Lifetime helper** (3.11, electricity, fuel and gases): type the units sold, the years of life and the use per unit per year (or the charge, leak rate and share recovered at disposal for gases). The total is worked out; **Use as the quantity** puts it in the entry (with months picked, **Copy** it and paste it into a month).

- Lifetime use = units sold × years of life × use per unit per year.
- Gas released = units × charge × (annual leak rate × years + share **not** recovered at disposal).

**Where the products are used:** the electricity of products is calculated with the grid factor of the facility the entry is made for. When most products are used in another country, make the entry for a facility in that country, or say so in the methodology note.

## Examples

| Situation | What to enter |
|---|---|
| 5,000 t of PET resin sold to bottle makers; a bottle maker uses about 450 kWh per tonne to blow it | 3.10 · Energy used by the processor · Electricity · 2,250,000 kWh (5,000 × 450) |
| 2,000 split AC units sold; 1,100 kWh a year each; 12 years of life | 3.11 · Products that use electricity · 26,400,000 kWh |
| The same AC units: 1.2 kg of R-32 each, 4 % leak a year, 70 % recovered at disposal | 3.11 · Refrigerants · R-32 · 2,000 × 1.2 × (0.04 × 12 + 0.30) = 1,872 kg |
| 300 diesel generators sold; 2,500 L of diesel a year each; 10 years | 3.11 · Products that burn fuel · Diesel · 7,500,000 L |
| A fuel station network sold 40 million litres of petrol | 3.11 · Fuels sold to customers · Petrol · 40,000,000 L |
| 1.2 million bottles of 25 g PET sold; 60 % landfilled, 40 % recycled | 3.12 · Plastic · PET · Landfill 18 t and Open-loop recycling 12 t |
| The products' packaging: 80 t of cardboard | 3.12 · Paper · Board · by the route of the market (e.g. landfill / closed-loop recycling) |

## What is not counted here

- Your own processing, your own fuel and electricity: Scope 1 and 2.
- Transport of products after the sale: **Downstream transport & distribution (3.9)**.
- Waste from your own operations: **Waste sent to others (3.5)**.
- Indirect use-phase emissions (washing clothes, cooking food) are optional under the GHG Protocol; when you include them, enter them as *Products that use electricity / burn fuel* and say so in the methodology note.

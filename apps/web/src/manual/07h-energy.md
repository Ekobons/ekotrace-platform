# Energy management

Menu → Net zero → **Energy management** follows the energy of each site month by month, sets a baseline that allows for the weather and production, measures the energy avoided against it, values it in money and tonnes, and keeps the register of energy-saving measures and the energy review that ISO 50001 asks for.

Energy management is a **package of its own**, switched on per company by the Ekobon team. With the GHG inventory, a site linked to an inventory facility takes its energy from the approved entries. Without it, energy is typed month by month.

```flow
> Site | add the site: type, floor area, baseline year, the variables that drive its energy, tariffs, target
> Months | energy by carrier (from entries or typed) and the variables: production, degree days, occupancy
> Baseline | the model is fitted on the baseline year and checked against ASHRAE Guideline 14
> Savings | each month: expected − actual = avoided energy, valued at the tariff and in tCO₂e; CUSUM
! Flags | months off the model by more than 2 standard errors and 5%: look for faults
> Measures | register of measures with expected and verified savings, IPMVP option, payback and NPV
> Review | significant energy uses with their variables, EnPI and controls; the M&V report in Excel
```

## Who does what

| Role | Can |
|---|---|
| Super admin, admin | add and change sites (baseline, model, tariffs, target), everything below |
| Manager | months, measures, significant energy uses |
| Preparer | months (energy and variables) |
| Verifier and others | view, download the Excel files |

## Energy by carrier

| Carrier | From the inventory |
|---|---|
| Electricity | grid electricity entries, kWh as bought |
| Fuels (on site) | stationary combustion entries through their net calorific values; gross-basis units (MMBtu, therm, GCV) × 0.9 for gases, × 0.95 for liquids and solids |
| Heat & steam, district cooling | heat and cooling entries as bought (TRh = 3.517 kWh of cooling) |
| Vehicle fuels | mobile combustion entries by fuel (distance-based entries have no energy content and are listed as left out) |

Entries covering several months are split by days. Only approved entries count. A figure typed in a month replaces the inventory's figure for that carrier and month (a meter replaced, a bill corrected).

## The baseline and savings

The method is **IPMVP Option C** (whole facility). On the site, choose:

| Setting | Use |
|---|---|
| Baseline year | the year the model is fitted on; it must be before the year viewed |
| Energy modelled | total energy, or one carrier (electricity for a cold store, gas for a bakery) |
| Variables (up to two) | production, cooling degree days, heating degree days, occupancy — those that drive the energy |
| EnPI driver | kWh per m², per unit produced, per degree day or per occupant |

The model is fitted by ordinary least squares on the baseline year's months: kWh = b₀ + b₁·x₁ (+ b₂·x₂). Its quality is checked as **ASHRAE Guideline 14** asks for monthly data:

| Statistic | Limit |
|---|---|
| CV(RMSE) | ≤ 15% |
| NMBE | within ±5% |
| t-statistic of each variable | \|t\| ≥ 2 (otherwise leave the variable out) |
| R² | shown; a low R² means the variables explain little |

A model that misses the limits gives **indicative** savings. At least 9 baseline months with energy and every variable are needed.

Each month of the year viewed, the model gives the **expected** energy with that month's variables; **avoided energy = expected − actual**. The CUSUM is the running sum of the avoided energy: a rising line means savings are holding. Avoided energy is valued at the site's tariff and at the carrier's emission intensity (from the inventory's emissions over its energy, or — for a site not linked or a carrier typed — the factor typed on the site); a total-energy model uses the energy-weighted average of the carriers.

A month is **flagged** when it is off the model, after the saving of the two months before it and of the two months after it, by more than 2 standard errors and by more than 5% of the expected month — a one-off such as a fault, a change in operation or a data error, not the step of a measure that starts mid-year. Without a model, a month 25% off the same month of the year before is flagged.

Degree days come from a weather service for the site's location; base 18 °C is common in the Gulf.

## Energy performance indicators

The EnPI is the energy modelled divided by the chosen driver, over the months that have both energy and the driver, compared with the same months of the baseline year (ISO 50006). Per m², the floor area counts for the months covered, so a full year gives kWh/m² a year. Set a target (% reduction by a year): the site shows whether it is on track, with the reduction expected to grow evenly from the baseline year to the target year.

## The page

| Part | What it shows |
|---|---|
| Portfolio | energy and cost of every site, change on last year (sites with both years, same months), avoided energy, money and tCO₂e, energy by month and carrier, kWh/m² a year (full years with a floor area), each site's EnPI change, model quality, target and flags |
| Site | the year's energy, EnPI and target, avoided energy, model quality; the chart of actual (bars), expected (line) and CUSUM (dashed); months to type or paste; the model's equation and statistics; measures; energy review |
| Measures | all measures with expected and verified savings a year, cost saving, capex, payback, NPV and tCO₂e a year |

## Measures

Each measure has a category (lighting, HVAC, motors and VSDs, compressed air, heat recovery, insulation, controls, process, solar, fuel switching, behaviour), the carrier it saves, its status (idea, approved, implemented, verified, dropped), the expected saving a year and, once measured, the verified saving with the **IPMVP option** used:

| Option | Measurement |
|---|---|
| A | retrofit isolation: the key parameter measured, others estimated |
| B | retrofit isolation: all parameters measured |
| C | whole facility: the site baseline above |
| D | calibrated simulation |

An implemented or verified measure needs its date; a verified one its verified saving and option. The economics use the verified saving when there is one, otherwise the expected: cost saving a year = kWh × the site's tariff for the carrier − extra running cost; simple payback = capex ÷ cost saving; NPV at 8% over the life; tCO₂e a year at the carrier's intensity.

## Energy review

Record the site's **significant energy uses** (ISO 50001 clause 6.3): the uses with most of the energy or the most potential to save, their share, the relevant variables, the EnPI that tracks each, the operational controls that keep it efficient, and the owner.

## Excel

**M&V report (Excel)** on a site: summary, months (energy by carrier, variables, expected, avoided, CUSUM, EnPI, flags, notes), the baseline model with its statistics, the measures with their economics, the energy review and the method. **Portfolio (Excel)**: every site's year in one table.

## Trying it

`npm run demo:energy` creates *Oasis Hospitality & Cold Chain LLC (demo)*: a cold store and an office tower driven by cooling degree days, a hotel driven by degree days and occupancy, and a bakery driven by production, with 2024 as the baseline, measures going live during 2025 and a defrost fault in August 2025 at the cold store. Logins `energy@oasis.demo` (super admin), `finance@oasis.demo` (admin), `fm@oasis.demo` (manager), with the password printed once. All figures are **invented**, degree days included.

Every change is in the audit log.

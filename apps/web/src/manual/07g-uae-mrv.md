# UAE MRV

Menu → Disclose → **UAE MRV** prepares the two emissions reports UAE companies face:

- **Abu Dhabi facility MRV** — the Environment Agency – Abu Dhabi (EAD) programme under EAD Resolution No. 3 of 2026: a Scope 1 report for each facility, every calendar year, by 31 March.
- **Federal reporting** — Federal Decree-Law No. 11 of 2024 on the Reduction of Climate Change Effects and Cabinet Resolution No. 67 of 2024 on the National Register for Carbon Credits: Scope 1 and 2 on the national MRV system (the Integrated Emissions Quantification Tool, IEQT), and registration with the National Register for Carbon Credits (NRCC) from 0.5 MtCO₂e a year.

UAE MRV is a **package of its own**, switched on per company by the Ekobon team. With the GHG inventory, source streams are filled from approved entries and the federal Scope 1 and 2 come from the entries of the UAE facilities. Without it, every figure is typed.

```flow
> Facilities | add each reporting facility: emirate, sector, EAD ID and permit, monitoring plan, verifier
> Source streams | fill from entries or type them: fuel combustion, process, mass balance, measured, other gases
> Tiers | give each stream's activity-data uncertainty; the tool classes streams and checks the tier each needs
! Check | open checks: missing factors, tiers too low, fallback without a reason, verifier rotation, monitoring plan due
> Report | production, QA, data gaps, mitigation; the EAD report in Excel laid out as the template's sheets
> Submit | record the submission and lock the year; record the verification (from reporting year 2026)
> Federal | designation, NRCC, IEQT status; the federal data pack in Excel
```

## Who reports what

| | Abu Dhabi facility MRV (EAD) | Federal |
|---|---|---|
| Who | facilities in Abu Dhabi in power and water, oil and gas, industry, or road and rail transport (not aviation or marine), with 25,000 tCO₂e or more of CO₂ and methane in the year | sources designated by the Ministry of Climate Change and Environment or the emirate authority; companies with 0.5 MtCO₂e or more of Scope 1 + 2 |
| Unit | the facility: fixed units on adjacent sites under common operational control | the company (its UAE activities) |
| What | Scope 1 by source stream and gas | Scope 1 and 2 (GHG Protocol) |
| When | 31 March for the calendar year before (grace to 14 April) | annual; the adjustment period was extended by one year from 31 May 2026 (Cabinet Resolution No. 147 of 2026) |
| Verification | ISO 14065-accredited verifier from reporting year 2026 | annual, by a verifier authorised by the Ministry, at 0.5 MtCO₂e or more |
| Records | corrections within 30 days; records kept 5 years | records kept at least 5 years |
| Penalties | under the Decree-Law | AED 50,000 to 2,000,000 under the Decree-Law, doubled for a repeat within two years; NRCC: up to AED 500,000 / 1,000,000 / 2,000,000 |

Below 25,000 t, an Abu Dhabi facility in a covered sector gives one year of data with a short explanation to confirm its status. Other facilities may report voluntarily.

The Ministry's technical guidance on federal scopes, methods and deadlines is still pending: check before submitting.

## Who does what

| Role | Can |
|---|---|
| Super admin, admin | add and change reporting facilities, the federal position, the report status (submitted, verified), everything below |
| Manager | source streams, production, QA, data gaps, submission and verification details, mitigation measures |
| Preparer | source streams, production, QA, data gaps (not the submission or verification details) |
| Verifier and others | view, download the Excel files |

## Source streams

A source stream is a fuel or material whose use releases greenhouse gases, or an emission source that is measured.

| Type | Calculation |
|---|---|
| Fuel combustion | CO₂ = activity data (TJ) × emission factor (tCO₂/TJ) × oxidation factor; CH₄ and N₂O = TJ × their factors (kg/TJ) |
| Process | CO₂ = tonnes of material × emission factor (tCO₂/t) × conversion factor |
| Mass balance | CO₂ = tonnes × carbon content (t C/t) × 44/12; carbon leaving in products or waste is deducted |
| Measured (CEMS) | CO₂ and CH₄ as measured |
| Other gas released | tonnes of the gas (fugitive or vented methane, N₂O, HFCs, SF₆…) × its GWP |

Activity data can be in tonnes, TJ (net calorific value), thousand Nm³ (with the net calorific value per thousand Nm³) or kL (with a density). Where a factor is left empty, the 2006 IPCC Guidelines default for the chosen fuel applies (Vol. 2, Table 1.2 net calorific values, Table 1.4 CO₂, Tables 2.2–2.3 stationary and 3.2.1–3.2.2 road transport CH₄ and N₂O). A supplier certificate or a laboratory analysis is better: enter it and say so under *Factor source*.

The **biomass fraction** of a stream's CO₂ is reported apart and not counted. Grid electricity (Scope 2) is not part of the EAD report.

### Filling from entries

Link the reporting facility to an inventory facility, then **Fill from entries**. The approved stationary and mobile combustion entries of the calendar year become fuel combustion streams in TJ on net calorific value (entries crossing the year's ends count by their days inside it), and the refrigerants and other gases released become *other gas* streams. The tool matches each fuel to its IPCC defaults. Energy billed on a gross basis (MMBtu, therm, GCV units) is brought to net (× 0.9 for gases, × 0.95 for liquids and solids, as IPCC suggests; a supplier's ratio is better). Entries in units with no energy content (e.g. km) are left out with a note on the stream.

**Refresh from entries** updates the quantities and keeps what people set: fuel, factors, uncertainty, instrument, notes. A stream switched to its own units (tonnes with a measured NCV, say) or to another method keeps its figures; only the comparison with the inventory moves. Streams with no entries any more are removed; a stream you removed is not brought back; streams typed by hand stay. Each stream shows the tCO₂e the inventory worked out with its own factors, for comparison.

Tick **Not in the inventory entries** on a process or mass-balance stream to add it to the federal Scope 1 (at the company's share of the facility). Leave it off when its fuels or materials are already entered, or they would count twice. Facility reports not linked to an inventory facility are added to the federal Scope 1 in full.

## Classes and tiers

The tool classes each stream from the year's totals, as EAD's guidance does: streams are taken smallest first; together they are **de minimis** while below the higher of 1 kt and 2% of the total (2% capped at 20 kt), then **minor** while below the higher of 5 kt and 10% (capped at 100 kt); the rest are **major**. The operator can set the class; the tool then shows both.

| Tier | Activity-data uncertainty |
|---|---|
| Tier 1 | ±7.5% |
| Tier 2 | ±5% |
| Tier 3 | ±2.5% |
| Tier 4 | ±1.5% |

Major streams need at least Tier 2, minor at least Tier 1; de minimis streams may be estimated. Streams are ranked by their size, so a carbon-out stream of a mass balance counts by its absolute value. Where no tier is technically feasible or the cost is unreasonable, tick **fallback approach**, say why and give its uncertainty; the whole facility's uncertainty must then not exceed ±7.5%, and every stream above de minimis needs its uncertainty to show it. The tool works out that uncertainty from the streams' uncertainties: the square root of the sum of (stream emissions × uncertainty)², divided by the total.

## The facility page

| Part | What it shows |
|---|---|
| Scope 1 | the year's total and its split by gas, with the company's GWP set |
| CO₂ and methane | the threshold basis against 25,000 t, and the facility's EAD position |
| Uncertainty | the whole facility's |
| Checks | streams with something missing, plus facility checks: verifier more than 6 years running, verification needed but no verifier, monitoring plan due after a significant change |
| Source streams | each stream with activity, TJ, tCO₂e, share, class, tier achieved and needed, and status; click one to open it |
| Production & QA | products and quantities for EAD's benchmarking (intensity = Scope 1 ÷ quantity); management and quality assurance |
| Verification & data gaps | report status, submission date and reference, verification dates, opinion and statement; data gaps with the approach used and the emissions affected |
| Mitigation | measures implemented, planned or studied, by means (efficiency, clean energy, CCUS, fuel switching, methane…). Offsets and removals are information only, never netted |
| Monitoring plan & dates | facility identifiers, monitoring plan, the year's dates |

**Submitted to EAD** (super admin, admin) needs the submission date and locks the year: streams, production, QA and data gaps can no longer change, and the figures are frozen as submitted (a later change of GWP set, default factor or facility details does not change them); the verification details still can. **Verified** needs the date of the statement. Setting the year back to Ready unlocks it.

## The EAD report

**EAD report (Excel)** downloads the year laid out as the sheets of EAD's template: C1 Identifiers, C2 Facility description (totals, production, gases), D1 Source streams, D2 Calculation, E Measured, F Fallback, G Methane, H1 Verification & data gaps, I Management & QA, J Mitigation, and a Method sheet with the open checks. It is a draft: copy the values into the template on the EAD portal.

## Federal

The **Federal (MOCCAE)** tab shows the company's Scope 1 and 2 in the UAE for the calendar year, against the 0.5 MtCO₂e NRCC threshold, with the duties that follow. With the GHG inventory, the figures come from the approved entries of the facilities whose country is the UAE, by emirate (the facility's grid region) and by gas, under the company's consolidation approach, plus the facility-report additions above. Without it, type Scope 1 and 2 (empty Scope 1 = the sum of the facility reports).

Record whether the company has been designated, the NRCC registration, the status of the IEQT submission (organisation registered, draft, submitted, verified) and the verifier. Company-wide reduction measures are listed here.

**Federal pack (Excel)** downloads the organisation, Scope 1 and 2 by facility, by emirate and by gas, the activity data, the EAD facilities, the reduction measures and the method, ready to enter on the national MRV system.

## Calendar

| Date | What |
|---|---|
| 31 March | registration with EAD for the year (facilities without an environmental permit); monitoring plan for the year with the verifier's review |
| 90 days after registration | first monitoring plan |
| 30 days after a significant change | revised monitoring plan |
| 1 July | planned verification notified to EAD (from reporting year 2026); verification starts by mid-year with a site visit |
| 31 March of the next year | annual report with the verification statement (grace to 14 April) |

## Trying it

`npm run demo:uaemrv` creates *Al Dhafra Steel & Logistics LLC (demo)*: an ICAD steel plant above the threshold (2025 report submitted, 2026 in draft, with an electric arc furnace carbon balance), an Al Ain fleet depot below it, and a Jebel Ali warehouse for the federal figures. Logins `hse@aldhafra.demo` (super admin), `finance@aldhafra.demo` (admin), `env@aldhafra.demo` (manager), with the password printed once. All figures are **invented**.

Every change is in the audit log.

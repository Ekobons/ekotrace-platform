# Entering data

## Choose the period

On every Add data tab, pick the facility and the year, then:

- **a month** (Jan … Dec) — one entry for that month;
- **Whole year** — one entry for the year (e.g. a yearly service record);
- **Month by month** — the same entry for all twelve months, only the reading changes.

## Month by month

Set the inputs once (fuel, unit, supplier, vehicle, waste process…), then type the twelve readings — or copy a row or a column of twelve numbers from Excel and paste it into January.

```flow
> Inputs set once | fuel, unit, supplier, method — whatever the form asks
> Twelve readings | typed, or pasted from Excel into January (a row or a column)
> Each month calculated | as you type; the month's tCO₂e shows under its value
! Already entered? | months that already have the same entry are marked “entered” and flagged
> Save | one entry per month; a month with a problem stays on screen, the others are saved
```

Available for fuels, refrigerants refilled, vehicles (one vehicle, or the **fleet × 12 months** grid), electricity / heat / cooling, waste-to-energy, composting, digestion, wastewater and waste sent to others. Where one reading per month does not fit (landfill methane, screening and mass balance, measured stack CO₂ or biogas, certificate claims) the screen says so.

From the month-by-month view, **“Set up a meter with these inputs”** turns the same set-up into a meter, so the readings can arrive automatically instead.

## Other ways in

| Way | Where | For |
|---|---|---|
| One entry | every tab | a single bill, invoice or record |
| Paste or type rows | Vehicles | many vehicles and months at once, in everyday words |
| Excel upload | Vehicles (template per fleet and month) | fleet data kept in spreadsheets |
| Purchases | Add data → Purchases (upload or by hand), or the ERP API | purchase lines from the ERP or finance system, any layout |
| Meters | Capture → Meters, or the facility's Meters tab | readings sent by another system (hourly to monthly) |
| Bills | Capture → Bills | PDF utility bills |

## What is saved with an entry

Every entry keeps: what was entered, the result per gas and per scope, **the emission factor used** (with its source, year and version), the calculation steps in plain language, the warnings shown, the data type and who saved it when.

- **Data type:** *actual* (measured, invoiced), *estimated* (e.g. a month scaled up from part of its readings), or *proxy* (borrowed from a similar facility or period).
- **Check the factor:** each result shows the CO₂e factor so anyone can redo the sum: quantity × factor = result.

## Entries & results

The year's totals per scope, the split by gas, and every entry. Click an entry to see exactly how it was calculated.

**Recalculate entries with warnings** re-runs entries saved before a factor existed (e.g. the UAE grid factor, or next year's DESNZ set) — each change is in the audit log with the old and new totals. Entries that come from a meter are recalculated from the meter's readings.

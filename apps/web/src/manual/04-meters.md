# Meters

A meter brings readings from another system — a building management system (BMS), a utility portal, an IoT platform, a weighbridge, a data logger — or from bills. Ekotrace turns the readings into **one entry per calendar month**.

## From readings to monthly entries

```flow
> Readings arrive | through the API (hourly, daily, weekly, monthly or irregular), pasted on the meter's page, or from a booked bill
! Each reading checked | known meter of this company, valid time, not in the future, no negative consumption — refused readings are listed with the reason
> Stored | the same meter and time sent again replaces the earlier value (a correction)
> Split into months | in the company time zone (Asia/Dubai by default); periods across a month end are split by time
> Coverage worked out | share of each month that readings cover; gaps, resets and unusual values flagged
? Has the month ended? | Yes: the month's entry is created or updated | No: shown as “month not ended”, nothing booked yet
! Approved entries | never changed by new readings — the difference is reported instead
```

## Two kinds of readings

| Readings are | Example | How consumption is found |
|---|---|---|
| **Register / index** (counts up) | electricity meter showing 458,120 kWh | difference between two readings, spread evenly over the time between them |
| **Consumption per period** | BMS hourly kWh, weekly weighbridge tonnes, a bill | each value is the consumption since the previous one (or since its start time) |

How often readings come does not matter — hourly, daily, weekly, monthly or irregular all work the same way.

## How a period across a month end is split

```diagram month-split
```

A reading (or a bill) covering 15 February to 14 March is split by time: 14 of its 28 days fall in February, 14 in March. Each month's **coverage** is the share of the month that readings cover. Here February is 50% covered and March 45%.

- With **“Scale a partly covered month up”** (the default), a month with at least a quarter covered is scaled up to the whole month and marked **estimated**; below a quarter, only the measured part is counted and flagged.
- When the next reading or bill arrives, the month is filled in and recalculated — the entry becomes *actual* again.

## Warnings you may see

| Warning | Meaning | What to do |
|---|---|---|
| readings cover 93.5% of the month | some hours or days are missing | check the sending system; late readings update the month |
| register went down … not counted | reset or meter replaced | check; add the old meter's last reading if known |
| register rolled over | the register passed its maximum and restarted | nothing (set the register maximum on the meter) |
| no readings … spread evenly over the gap | a long gap between two register readings | fine for a register; check if unexpected |
| unusually high value | more than 10× the usual rate | check the reading at source |
| overlapping readings | two periods cover the same time | the overlap is counted once; fix at source |

## Setting up a meter

The easiest way: on the Add data tab, choose **Month by month**, fill in the inputs exactly as for a manual entry (fuel, supplier factor, grid region, waste process…), then **“Set up a meter with these inputs”**. Or **Add meter** for a fuel, electricity, heat or cooling — on the facility (Organisation → the facility → **Meters** tab, where the facility is already filled in) or under Capture → Meters.

A facility's meters are listed on its Meters tab; Capture → Meters lists every meter in the company, with a facility filter, to follow how readings are arriving.

| Setting | Meaning |
|---|---|
| Id in the sending system | how readings are matched to this meter (e.g. BMS-DC-MAIN) |
| Utility account no. | how bills are matched to this meter |
| Readings are | register (counts up) or consumption per period |
| How often | hourly, daily, weekly, monthly, irregular |
| Unit, multiplier | the meter's unit; the multiplier (CT ratio, pulse value) is applied to every reading |
| Register maximum | for rollovers |
| Automatic entries | create / update a month's entry as soon as the month has ended |

On the meter's page: **Months** (readings, coverage bar, measured, used for the entry, entry status, notes), **Readings** (latest readings, paste more, delete a wrong one) and **Settings**. “Create / update entries now” runs the monthly step on demand.

For IT teams connecting a system, see **Integrations & API**.

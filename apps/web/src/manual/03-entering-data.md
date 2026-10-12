# Entering data

## The Add data screen

```flow
> Facility and year | at the top: the facility (with its type and manager) and how its categories stand for the months picked — approved, in review, missing
> Months | the twelve months with their status for the category open (Approved, In review, Draft, Sent back, Missing, Open, Future). Pick one or several; they are entered side by side
> Category | the list on the left of the entry, each with its status for the months picked and its scope; sub-groups (vehicle group, fuel class, energy bought) are dropdowns in the form
> Enter → Review → Approved | the three steps of the category, with how many entries wait and how many are approved
```

**Status of a month** (for the category open): *Approved* — every entry approved; *In review* — something waits for approval; *Draft* — saved, not submitted; *Sent back* — an approver returned an entry with a note; *Missing* — a past month with nothing, for a category the facility reports (it had data this year or last year); *Open* — the current month; *Future* — not yet (cannot be picked). A category the facility has never reported shows *Optional · nothing yet*.

**Picking months:** click months to add or remove them; **All open months** picks every month still to do; **Whole year** makes one entry for the year (refrigerant screening and mass balance, landfill methane, a yearly service record); **Clear** empties the choice. Purchases take one month at a time; employee commuting is entered once a year.

## Step 1 · Enter

The **ways in** are shown as cards: *Type it in*, *Upload bills* and *Meter readings* (electricity, fuels, waste, water), *Whole fleet*, *Paste a table* and *Excel / CSV* (vehicles), and *Automatic feed* (connected systems, under Integrations).

**Type it in:** set what applies to every row once (fuel class and unit, supplier, vehicle, waste process…), then one row per month picked:

```flow
> Month · Type | the month; the type (e.g. the fuel) can differ per row
> Quantity | typed, or a column pasted from Excel into the first row (fills the rows below)
> Note / reference · data type | invoice or meter number; actual, estimated or proxy
> Emissions | calculated as you type
> Check | against the usual months of the same entry (✓ in line, ! far above or below); a month that already has the same entry is flagged
> + line | a second row for the same month (e.g. two fuels)
```

Then **Save as draft** (to finish later) or **Submit for approval** — the line above the buttons says who approves. A row with a problem stays on screen; the others are saved. Electricity for **one** month opens the full form, so certificates and contracts can be claimed; picking several months gives the rows.

From the rows, **“Set up a meter with these inputs”** turns the same set-up into a meter, so readings can arrive automatically instead.

## Step 2 · Review

Everything not yet approved for the category and months picked, with who entered it and its status.

| Who | Can |
|---|---|
| Anyone who can enter the facility's data | **Submit** drafts (one by one or *Submit n drafts*), **Withdraw** their own submission, **Delete** a draft or a sent-back entry |
| Managers of the facility, admins of its sub-group, super admins | **Approve** (one by one or *Approve all*) and **Send back** with a note — never an entry they entered or submitted themselves |

A sent-back entry shows the approver's note in red; fix it (delete and enter again) and submit. Entries made by the commuting record or from purchases are changed there, not deleted here. Every step is in the audit log.

## Step 3 · Approved

What counts in the dashboards and reports for these months, by scope. An approver can still send an approved entry back with a note (it then stops counting until approved again).

## Other ways in

| Way | Where | For |
|---|---|---|
| One entry | every tab | a single bill, invoice or record |
| Paste or type rows | Vehicles | many vehicles and months at once, in everyday words |
| Excel upload | Vehicles (template per fleet and month) | fleet data kept in spreadsheets |
| Purchases | Add data → Purchases (upload or by hand), or the ERP API | purchase lines from the ERP or finance system, any layout |
| Bills | Add data → Electricity, Stationary combustion or Waste → **Bills** | PDF bills and invoices: checked, previewed, then published |
| Surveys | Capture → **Surveys** | employee commuting asked of employees with personal codes, scaled up and published into Add data → Employee commuting |
| Meter readings | Add data → the same tabs → **Meter readings**; meters themselves on the facility's Meters tab | batches sent by another system (hourly to monthly), previewed before they count |

## What is saved with an entry

Every entry keeps: what was entered, the result per gas and per scope, **the emission factor used** (with its source, year and version), the calculation steps in plain language, the warnings shown, the data type and who saved it when.

- **Data type:** *actual* (measured, invoiced), *estimated* (e.g. a month scaled up from part of its readings), or *proxy* (borrowed from a similar facility or period).
- **Check the factor:** each result shows the CO₂e factor so anyone can redo the sum: quantity × factor = result.

## Entries & results

The year's totals per scope, the split by gas, and every entry. Click an entry to see exactly how it was calculated.

**Recalculate entries with warnings** re-runs entries saved before a factor existed (e.g. the UAE grid factor, or next year's DESNZ set) — each change is in the audit log with the old and new totals. Entries that come from a meter are recalculated from the meter's readings.

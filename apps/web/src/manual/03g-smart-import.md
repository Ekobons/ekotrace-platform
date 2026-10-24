# Smart import

Capture → **Smart import** takes a spreadsheet of emissions data in the company's own layout and turns it into entries, after a person has reviewed every row. It suits onboarding (a year or two of history) and teams that keep their own Excel trackers.

```flow
> 1 · Upload | an Excel (.xlsx) or CSV file, up to 20 MB, any number of sheets (first 5,000 rows each) — kept in the Document vault
> 2 · Layout | for each sheet: headings row, one entry per row or one column per month, which column is the facility, date, activity, quantity, unit
> 3 · Rows | totals, blanks and zeros skipped; each value becomes a proposed entry
> 4 · Matching | facility by name, activity to the catalogue, unit, month; checked and calculated; already-entered rows left out
* 5 · Review | confirm activities, choose facilities not recognised, leave rows out, correct a layout
? 6 · Create | the ready rows become entries, sent for approval, each linked to the file as evidence
```

## What it reads

```video data-entry-smart-import
Smart import | 0:55
```

Fuels (stationary and vehicles), electricity, heat and cooling, refrigerants, water and waste sent out. Business travel, employee commuting and purchases have their own screens (Add data → Business travel and Employee commuting; Purchases for finance exports).

Layouts it handles:
- **One entry per row**: a facility, a date or month (or month and year columns), an activity, a quantity and a unit column.
- **One column per month**: Jan, Feb, … across (any spelling: "Jan-26", "January 2026", "2026-01", dates).
- A facility, year, unit or activity written **once** for the whole sheet (in a title, a heading such as "Consumption (kWh)", or the sheet name).
- Title rows above the headings, notes sheets, subtotal and total rows, blank and zero cells.

## The layout of each sheet

- With **AI on for imports** (Setup → Integrations, AI & batch runs → AI): the company's AI reads the first 40 rows of each sheet and proposes the layout. It is checked before use; if the AI does not answer, the layout is worked out from the headings.
- Without AI: worked out from the headings (Site, Facility, Fuel, Quantity, Unit, Month, Jan…), and from which column holds numbers.
- **Check or change the layout** shows the first rows with the columns as read, and lets you set every column, the month columns, and the values for the whole sheet. **Apply this layout** proposes the rows of that sheet again.

## Matching

| What | How | When it is not sure |
|---|---|---|
| Facility | the name in the file against the facilities you may enter data for; a remembered answer first | "Not recognised": choose it once in **Facilities found** |
| Activity | the words of the description against the catalogue (item names, aliases, subcategories), only items whose units and factors fit the unit given; a remembered answer first; then, with AI on, the AI picks among the candidates | marked **To check**: confirm, or choose another item in **Activities found** |
| Unit | the unit written (litres, Ltr, kWh, MT, m³…) against the item's units — "kWh" on electricity is kWh (electricity) | a problem: set the unit column or the unit for the sheet |
| Month | date, month name, month and year, or the month column; a year alone gives the whole year | a problem: set the date column or the year |

**Remember my choices** keeps the facility and activity answers for the next files of the company.

Each row is calculated as it would be in Add data (factor, conversions, gases); warnings such as a missing grid factor are shown on the row. A row with the same facility, activity, period and quantity as an entry already in the platform is **left out** as already entered (bring it back if it is not a duplicate).

## Creating the entries

**Create and submit N entries** creates the **Ready** rows only (rows **To check** first need their activity confirmed). Each entry:
- is created by you and **submitted for approval** — you reviewed the rows (maker), the facility's approver checks them (checker);
- is linked to the uploaded file in the Document vault, which counts as its evidence;
- carries the note "Smart import: file name".

Rows that cannot be created (a locked month, for example) stay with the reason. An import is **done** when nothing is left to resolve; **Drop this import** removes the import but never entries already created.

## AI and your data

Nothing is sent to any AI unless the super admin has connected one and allowed it for imports. When allowed, the AI receives the first 40 rows of each sheet (to read the layout), the facility names, and the distinct activity descriptions with candidate catalogue names. It never creates entries, never invents an item or a number, and every row is reviewed by a person before it becomes an entry.

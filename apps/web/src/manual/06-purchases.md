# Purchases (Scope 3.1)

Purchased goods & services usually come from the ERP or finance system — often tens of thousands of lines a year. Ekotrace reads them in any layout, groups them, maps each group to a spend category, flags what belongs elsewhere and publishes entries. Capture → Purchases lists every batch; Value chain → Suppliers holds the suppliers and their own factors; Setup → Currencies & price index holds exchange rates.

## Three ways in

| Way | When | Where |
|---|---|---|
| Upload | an export from the ERP or finance system, any layout, up to 200,000 lines (60 MB) | Capture → Purchases |
| ERP API | the ERP sends the lines itself, in calls of up to 10,000 | Setup → Integrations & API |
| By hand | a few purchases | Add data → Purchases |

All three go through the same steps; an upload or API batch is reviewed before publishing, purchases typed by hand are published when every row is complete.

## From a file to entries

```flow
* Upload the file | Excel (.xlsx) or CSV — any column names, title rows above the header are fine
* Say which column is which | best guess shown; the layout is remembered for the next file with the same columns
! Same file twice | recognised; it can be uploaded again only on purpose, and its lines are then marked as duplicates
> Read in the background | 50,000 lines take well under a minute; you can leave the page
> Grouped | lines with the same description (PO numbers, dates and pack sizes ignored) form one group — you map groups, not lines
> Mapped | 1. your remembered choices → 2. a NAICS code in the file → 3. text matching against the spend categories → 4. an approved AI service (only if switched on)
! Overlap checked | travel, freight, rent, fuel, electricity, waste and capital goods flagged for a decision
> Calculated | each line with the best factor; problems listed (facility not recognised, no exchange rate…)
* Review | fix problems, choose categories for unclear groups, decide on flagged groups
? Publish | ready lines become entries | the rest wait in the batch
```

## Reviewing a batch

- **By description:** one row per group with its lines, spend and result. The spend category shows how it was found (remembered, code in file, text match, AI, by hand) and how sure the match is; groups below 60 % are under **Check**.
- Change a category and every line of the group follows. With **Remember my choices**, the next uploads get the same category and decision automatically.
- Select several groups to set a category or a decision for all of them at once.
- **Facilities not recognised:** choose the facility each value in the file stands for.
- **Lines:** every line, filterable (problems, duplicates, warnings); open one to see its calculation step by step.
- **Publish** creates one entry per facility, month, Scope 3 category, spend category and method, each with its lines behind it. **Reopen** takes the entries back (approved ones stay) so the batch can be changed and published again.

## Other categories

| Flag | Choices |
|---|---|
| Business travel (3.6): flights, hotels, taxis | move, keep, exclude |
| Upstream transport (3.4): freight, couriers, warehousing | move, keep, exclude |
| Upstream leased assets (3.8): rent | move, keep, exclude |
| Fuel, electricity & water, waste | keep, or exclude when already counted from activity data |
| Capital goods (3.2): machinery, vehicles, construction, computers | a hint: mark as capital goods when the company capitalised the purchase |

Moved lines are spend-based in their category until activity data (distances, nights, tonne-km) replaces them. Nothing flagged is published until someone decides — except the capital-goods hint, which never blocks.

## Factors

```flow
> 1. Supplier factor per unit | the line has a quantity in the factor's unit (kg, t, L, m³, kWh, piece)
> 2. Supplier factor per money | kg CO₂e per AED, USD… spent with that supplier
> 3. Spend-based | US EPA Supply Chain GHG Emission Factors v1.3: kg CO₂e per 2022 US dollar, purchaser price (with margins)
```

Spend categories: the 1,016 EPA commodities (NAICS codes) and the 1,639 products of the previous Ekotrace list (e.g. “Cereal - Barley grain”, “LPG”, “Office Products”) with their old category › subcategory — each product uses the EPA factor of its NAICS code. Products listed as capital goods in the old list show the capital-goods hint. Government administration (NAICS 92) has no EPA factor.

A factor written in the file (vendor-specific EF and its unit) counts as a supplier factor for that line. Suppliers' factors are kept under Value chain → Suppliers, for everything bought from them or for one spend category; adding one recalculates their open lines.

## Currencies and inflation

Spend-based factors are per US dollar of 2022. Each line is converted in two steps, both shown in the line's calculation:


1. **Exchange rate:** amount ÷ units of the currency per US dollar. By default the **average rate of the purchase month**; the company can choose the annual average or a fixed budget rate (Setup → Currencies & price index). Currencies pegged to the dollar (AED, SAR, QAR, OMR, BHD) use the peg. A missing month falls back to the annual average, and the line says so.
2. **Inflation:** × US CPI of 2022 ÷ US CPI of the purchase year. A 2024 dollar is worth about 7 % fewer 2022 dollars, so without this step emissions would rise with prices. A year not yet loaded uses the latest year, and the line says so.

## Safety checks

```flow
! Files | Excel or CSV only, 60 MB at most; old .xls refused; read without running anything from the file
! Duplicates | the same file is refused unless uploaded on purpose; lines already uploaded are marked and left out unless counted on purpose
! Each line checked | missing description, amount, date, currency or facility → listed with the reason; the rest continue
! Facilities | lines go only to facilities the person may enter data for; others are left out of publishing and listed
! Published lines locked | a group with published lines cannot change until the batch is reopened; approved entries stay
! AI | off unless the company approves the service and where it runs; only descriptions and category names are sent — never amounts, suppliers or files
```

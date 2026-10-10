# Purchases (Scope 3.1)

Purchased goods & services usually come from the ERP or finance system — often tens of thousands of lines a year. Ekotrace reads them in any layout, groups them, maps each group to a spend category, flags what belongs elsewhere and publishes entries. Add data → Purchases holds the upload, typing by hand and every batch; Value chain → Suppliers holds the suppliers and their own factors; Setup → Currencies & price index holds exchange rates.

## Three ways in

| Way | When | Where |
|---|---|---|
| Upload | an export from the ERP or finance system, any layout, up to 200,000 lines (60 MB) | Add data → Purchases → Upload Excel / CSV |
| ERP API | the ERP sends the lines itself, in calls of up to 10,000 | Setup → Integrations & API |
| By hand | a few purchases | Add data → Purchases → Type by hand |

All three go through the same steps; an upload or API batch is reviewed before publishing, purchases typed by hand are published when every row is complete.

## From a file to entries

```flow
* Upload the file | Add data → Purchases → Upload Excel / CSV — any column names, title rows above the header are fine
* Say which column is which | best guess shown (including vendor number, supplier country and account); the layout is remembered for the next file with the same columns
! Same file twice | recognised; it can be uploaded again only on purpose, and its lines are then marked as duplicates
> Read in the background | 50,000 lines take well under a minute; you can leave the page
> Suppliers linked | each supplier name is linked to the supplier list, new suppliers added (see Suppliers)
> Grouped | lines with the same description, account and category form one kind of purchase (PO numbers, dates and pack sizes ignored); a vague description (“Monthly charges”) is split by supplier
> Category found | for each kind of purchase, once — see the order below
> Calculated by month | each line keeps its month; entries are per facility, month and category
* Review by impact | confirm the largest kinds of purchase; the small rest is accepted as it is
? Publish | ready lines become entries | the rest wait in the batch
```

## How the spend category is found

The first answer wins, for each kind of purchase:

| # | Source | Example |
|---|---|---|
| 1 | A choice remembered for this description | “Copier paper A4” → Stationery, decided last month |
| 2 | A NAICS code written in the file | 322230 |
| 3 | A clear description | “Ready mix concrete C40” → Ready-mix concrete |
| 4 | The supplier's default category | “Monthly charges” from a guarding company → Security services |
| 5 | The account's default category | account “Audit fees” → Accounting services |
| 6 | A weaker description match | shown with how sure it is |
| 7 | An average factor (estimate) | median EPA factor of services (0.11 kg CO₂e per 2022 USD) or of goods (0.28) |

No AI is used unless the company switches on an approved AI service; even then only for large unclear purchases, choosing among the candidates found. Services have similar factors, so a wrong guess for a small purchase barely changes the total.

## Capital goods and what is not a purchase

Checked in this order:

1. **The account:** under the Accounts tab of a batch, each account (GL) gets a type, remembered for every upload — *Purchase* (default), *Capital* (Scope 3.2) or *Not a purchase* (VAT, salaries, depreciation, intercompany: left out).
2. **A capital column in the file** (e.g. asset or capex flag) for single lines.
3. **The capital-goods list** (Add data → Purchases → **Capital goods list**): 168 products of the previous Ekotrace list — machinery, vehicles, IT and electrical equipment, buildings and construction — and EPA categories whose products on that list are all capital goods. The old list marked 225 products as capital goods; 57 of them are **parts, materials or consumables** (vehicle and aircraft parts, steel and other metals, valves and bearings, cable, medicines, gloves and dressings, tool accessories, keyboards and mice) and count as purchased goods (3.1), with the reason shown. Only the platform administrator changes the shared list.
4. Otherwise standard goods and services (3.1).

A person can always change it for a kind of purchase; the choice is remembered.

## Viewing published lines

A published batch becomes monthly entries (facility × month × spend category), but **every line stays stored** with its spend category, factor, exchange rate and result. Add data → Purchases → **Published lines** (or “open lines” on a batch, or “lines” next to a purchase entry) lists them across all batches:

- filter by month or year, facility, Scope 3 category, spend category, average-factor lines, or search description, supplier, PO and account;
- totals for the whole selection (lines, entries, tCO₂e, spend, suppliers);
- sorted by largest emissions, largest spend or latest; 100 lines a page — the server pages, so 50,000 lines open in about two seconds;
- **Download Excel** or **CSV**: every line of the selection with its factor, exchange rate, price-index ratio, file and row (50,000 lines in a few seconds).

## Other categories

Purchases that belong elsewhere are decided by default and shown:

| Found | Default | Can be changed to |
|---|---|---|
| Business travel (3.6): flights, hotels, taxis | moved to 3.6 | keep in 3.1, exclude |
| Upstream transport (3.4): freight, couriers | moved to 3.4 | keep, exclude |
| Upstream leased assets (3.8): rent | moved to 3.8 | keep, exclude |
| Fuel, electricity & water, waste | excluded (already counted from activity data) | keep |

An account can also move its lines (e.g. account “Travel” → business travel). Moved lines are spend-based in their category until activity data (distances, nights, tonne-km) replaces them.

## Review by impact

- Kinds of purchase are sorted by emissions. The largest, up to **95 %** of the batch's emissions (company setting: 80–100 %), wait under **To confirm** until a person confirms them — *Confirm* on a row, *Confirm these* for a page, or any change.
- The small rest is **accepted as it is** and publishes without a check.
- The review bar shows confirmed, to confirm and accepted shares. Changing a category or decision confirms it; with **Remember my choices** the next uploads follow — for *this description*, *everything from this supplier* (the supplier's default) or *everything in this account*.
- **Facilities not recognised:** choose the facility each value in the file stands for. **Lines:** every line, filterable; open one to see its calculation.
- **Publish** creates one entry per facility, month, Scope 3 category, spend category and method, each with its lines behind it. **Reopen** takes the entries back (approved ones stay).

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

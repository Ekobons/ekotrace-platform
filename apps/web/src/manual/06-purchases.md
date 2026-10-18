# Purchases (Scope 3.1)

Purchased goods & services usually come from the ERP or finance system — often tens of thousands of lines a year. Ekotrace reads them in any layout, groups them, maps each group to a spend category, flags what belongs elsewhere and publishes entries. Add data → Purchases holds the upload, typing by hand and every batch; Value chain → Suppliers holds the suppliers and their own factors; Setup → Energy & currency data → Currencies & price index holds exchange rates.

## Three ways in

| Way | When | Where |
|---|---|---|
| Upload | an export from the ERP or finance system, any layout, up to 200,000 lines (60 MB) | Add data → Purchases → Upload Excel / CSV |
| ERP API | the ERP sends the lines itself, in calls of up to 10,000 | Setup → Integrations & batch runs → Integrations & API |
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

## How purchases are mapped — the whole flow

A year of purchases can be 50,000 lines but only a few thousand *kinds* of purchase. Ekotrace decides once per kind, spends a person's time only where the emissions are, and never leaves a line without a factor.

```flow
> 1 · Clean | each description is normalised: lower case, accents, PO / invoice numbers, dates and bare numbers removed
> 2 · Club together | lines with the same cleaned description, category text and account form one kind of purchase; a vague one is split by supplier
> 3 · Map each kind | first answer wins: remembered → NAICS code → clear description → supplier / account / category default → weaker description → AI (if on) → average factor
> 4 · Other categories | travel, freight, rent moved; fuel, energy, waste excluded; capital goods and non-purchases set aside
> 5 · Calculate | every line with the best factor: supplier per unit → supplier per money → spend-based
* 6 · Review by impact | the kinds making up 95 % of the emissions are confirmed by a person; the small tail is accepted as it is
? 7 · Publish | entries per facility × month × category × spend category, each with its lines behind it
```

### 1 · Cleaning the description

“Ready mix concrete C40 – 25 m3 – PO 4500123 – 31/03/2026” becomes **ready mix concrete c40 m3**. Two invoices for the same thing therefore look the same, whatever their PO number, date or quantity. The cleaned text is also what a remembered choice is stored against.

### 2 · Clubbing similar lines together

- **One kind of purchase** = same cleaned description + same category text from the file (if there is such a column) + same account (GL). “Copier paper A4 – PO 4500123” and “Copier paper A4 – PO 4500988” are one kind; the decision is taken once and applies to every line in it.
- **Vague descriptions are split by supplier.** A description is vague when nothing remembered applies, it carries no NAICS code and the text match is not clear (confidence below 0.6) — e.g. “Monthly charges”, “Services rendered”, “Annual contract”. Such lines are split into one kind per supplier, so “Monthly charges” from a security company and from a cleaning company can go to different categories (through each supplier's default).
- Each kind shows its lines, total spend, suppliers, account and — after calculation — its tCO₂e.

### 3 · Mapping each kind to a spend category

The first answer wins:

| # | Source | Example | Confirmed automatically? |
|---|---|---|---|
| 1 | **Remembered choice** for this description | “Copier paper A4” → Stationery, decided last month | Yes |
| 2 | **NAICS code** (6 digits) in the description or category column | 322230 | Yes |
| 3 | **Clear description match** (confidence ≥ 0.6) | “Ready mix concrete C40” → Ready-mix concrete | No |
| 4 | **Supplier's default** category | “Monthly charges” from a guarding company → Security services | Yes |
| 5 | **Account's default** category | account “Audit fees” → Accounting services | Yes |
| 6 | **Category-text default** (a value of the file's category column) | “IT consumables” → Computer supplies | Yes |
| 7 | **Weaker description match** (confidence 0.3–0.6) | shown with how sure it is | No |
| 8 | **AI** — only if switched on (below) | picks among the candidates of the text match | No |
| 9 | **Average factor** (estimate) | nothing above identified it | No |

Defaults 4–6 and remembered choices are created by people (*Remember my choices* in the review, or set on a supplier or account), so they count as confirmed. Description matches, AI picks and average factors are proposals: in the large kinds they wait for a person.

**How the description match works.** No data leaves the platform for this step.

- The catalogue: 2,655 spend categories — the 1,016 US EPA commodities (NAICS) and the 1,639 products of the previous Ekotrace list — each a small “document” of its name, aliases and group.
- Procurement words are first translated into the words category names use: 264 of them, e.g. *laptop* → computer manufacturing, *airfare* → passenger air transportation, *DEWA* → electric power and water. Words that say nothing about what was bought are ignored (pack sizes, *LLC*, *invoice*, *monthly*, currencies…).
- The description is scored against every category with **BM25**, the ranking used by search engines: rare words that match (e.g. *concrete*) count more than common ones (e.g. *steel*). The file's category text or account title helps rank, at half weight.
- **Confidence (0–1)** = how much of the description the best category explains × how clearly it beats the runner-up (a different factor). Unknown words such as brand names and model numbers lower it a little. Categories with the same NAICS code share a factor, so they do not compete.
- The 5 best candidates are kept on the kind of purchase, so a person (or the AI) can pick among them.

**AI — optional, for what is still unidentified.** When the company has it switched on, every kind still without a category after steps 1–7 and with at least one candidate is sent to the AI in batches of 40. The AI may only choose **one of the candidates** found by the text match, or none — it cannot invent a category, and its answer is a proposal like any other. Sent: the cleaned description, the category text or account title, and the candidate names — never amounts, suppliers, people or the file. Needs: an AI service approved for the deployment, the Professional or Enterprise plan, and the super admin switching it on. If the AI service does not answer, the batch carries on without it and says so.

**Average factor — when nothing identifies the purchase.** The kind gets the median EPA factor of **services** (0.11 kg CO₂e per 2022 USD) or of **goods** (0.28), chosen from its best candidate (an agriculture, mining, construction or manufacturing code → goods) or from units in the description (kg, t, L, m³, pcs, box… → goods). It is marked *average factor (estimate)*. Whether it needs a person depends on its size, not on the method:

- in the **large kinds** (the top 95 % of emissions) it waits under *To confirm* — someone picks the right category from the candidates or the full list;
- in the **small tail** it is accepted as it is. Factors of services are close to each other, so a rough estimate on a small purchase barely moves the total.

### 4–7 · The rest of the flow

Capital goods and non-purchases, other categories, factors, currencies and review by impact are explained in the sections below.

### Example

| Line in the file | Cleaned | Kind of purchase | Mapped by | Result |
|---|---|---|---|---|
| “Copier paper A4 – PO 4500123” (AED 1,200) | copier paper a4 | Copier paper A4 (42 lines) | remembered choice | Stationery — confirmed |
| “Ready mix concrete C40 – 25 m3” (AED 180,000) | ready mix concrete c40 m3 | Ready mix concrete C40 (12 lines) | clear description | Ready-mix concrete — in the top 95 %: a person confirms |
| “Monthly charges” from *Al Amn Guarding* | monthly charges | Monthly charges · Al Amn Guarding | supplier default | Security services — confirmed |
| “Monthly charges” from *Sparkle Cleaning* | monthly charges | Monthly charges · Sparkle Cleaning | weaker description | Janitorial services — small: accepted |
| “ZX-200 kit” (AED 900) | zx kit | ZX-200 kit | nothing found → average factor (goods) | estimate, small: accepted |
| “Flight DXB–LHR” | flight dxb lhr | Flight DXB–LHR | description | Air transport — moved to Business travel (3.6) |

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
> 2. Supplier factor per money | kg CO₂e per USD, EUR… spent with that supplier
> 3. Spend-based | US EPA Supply Chain GHG Emission Factors v1.3: kg CO₂e per 2022 US dollar, purchaser price (with margins)
```

Spend categories: the 1,016 EPA commodities (NAICS codes) and the 1,639 products of the previous Ekotrace list (e.g. “Cereal - Barley grain”, “LPG”, “Office Products”) with their old category › subcategory — each product uses the EPA factor of its NAICS code. Products listed as capital goods in the old list show the capital-goods hint. Government administration (NAICS 92) has no EPA factor.

**Newer versions of the spend factors.** The platform admin loads them under Factor library → Sources & import, as the published .xlsx (sheet "CO2e") or as a CSV. The preview shows the version, its price year (e.g. 2024 USD), how many commodities match and the typical change against the factors in use. On loading, each commodity's factor is replaced by the new one, the old one is kept in its history, and the products of the previous Ekotrace list move to the new factor of their NAICS code. An older version than the one in use is refused. v1.3 is US EPA's (AR5); v1.4 is published by the same authors through the Cornerstone Sustainability Data Initiative (AR6). Open batches pick up the new factors when recalculated; published entries keep theirs until reopened.

A factor written in the file (vendor-specific EF and its unit) counts as a supplier factor for that line. Suppliers' factors are kept under Value chain → Suppliers, for everything bought from them or for one spend category; adding one recalculates their open lines.

## Currencies and inflation

Spend-based factors are per US dollar of 2022. Each line is converted in one or two steps, all shown in the line's calculation:

1. **Exchange rate:** amount ÷ units of the currency per US dollar. By default the **average rate of the purchase month**; the company can choose the annual average or a fixed budget rate (Setup → Energy & currency data → Currencies & price index). Currencies pegged to the dollar (AED, SAR, QAR, OMR, BHD) use the peg. A missing month falls back to the annual average, and the line says so.
   **Rates loaded for everyone:** the Federal Reserve's monthly averages (G.5 release, units per US dollar) for EUR, GBP, INR, CNY, JPY, CHF, AUD, CAD and SGD from January 2019, with the annual average of each complete year. A company can add its own rates (e.g. its bank's or a budget rate); its own rate wins for the same currency and period. Other currencies: add them on the same page.
2. **Inflation:** × US CPI of 2022 ÷ US CPI of the purchase year (US BLS CPI-U annual averages 2019–2025; 2025 = 321.943, the average of 11 months because October 2025 was not collected). A 2024 dollar is worth about 7 % fewer 2022 dollars, so without this step emissions would rise with prices. A year not yet loaded uses the latest year, and the line says so.

**Two options** (Setup → Energy & currency data → Currencies & price index → *Converting spend to the factor's dollars*, Super admin):

| Option | Steps | When |
|---|---|---|
| Exchange rate + price index (default, recommended) | currency → US dollars of the purchase year → 2022 dollars with the CPI | follows GHG Protocol and EPA guidance; inflation does not raise emissions |
| Exchange rate only | currency → US dollars, used as they are | simpler, no price index needed; emissions rise with prices (about 7 % more for 2024 spend on 2022 factors) |

A change applies to new calculations: use **Recalculate** on open batches; published entries keep their figures until the batch is reopened. Supplier factors per kg, litre or unit are not affected.

## Safety checks

```flow
! Files | Excel or CSV only, 60 MB at most; old .xls refused; read without running anything from the file
! Duplicates | the same file is refused unless uploaded on purpose; lines already uploaded are marked and left out unless counted on purpose
! Each line checked | missing description, amount, date, currency or facility → listed with the reason; the rest continue
! Facilities | lines go only to facilities the person may enter data for; others are left out of publishing and listed
! Published lines locked | a group with published lines cannot change until the batch is reopened; approved entries stay
! AI | off unless the company approves the service and where it runs; only descriptions and category names are sent — never amounts, suppliers or files
```

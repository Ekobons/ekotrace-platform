# Suppliers

Value chain → Suppliers lists everyone the company buys from. Suppliers are registered automatically from every purchase upload, ERP API call and purchase typed by hand — one record per supplier however its name is written — and their profiles are completed here. The page has three tabs: **Suppliers**, **Check names** and **Analytics**.

## One supplier, however it is written

The same company often appears as “Acme Office Supplies Ltd”, “ACME OFFICE SUPPLIES LIMITED”, “Acme Office Suplies Ltd” or under a second vendor number. Each name in a purchase file is linked in this order:

```flow
> 1. Seen before | a spelling already linked (or decided by a person) keeps its supplier
> 2. Vendor number | the same ERP vendor number as a known supplier
> 3. Same name | legal forms (LLC, L.L.C., FZE, Est., Co., W.L.L.…), capitals, punctuation and spacing ignored; also every spelling merged before
> 4. Near-identical | the same words apart from a typo, a joined word (“AlNoor” / “Al Noor”) or generic words (“Trading”, “Services”, “International”): linked automatically and listed under Check names
! 5. Possibly the same | one name contains the other, a short name, or a different vendor number: a new supplier marked “possible duplicate” for a person to decide
* 6. New supplier | added to the list with the vendor number and country from the file
```

Names are compared word by word: a word that only one name has means two suppliers, however alike the names look — “Pearl Steel” and “Horizon Steel”, or “Desert Rose Steel” and “Desert Rose IT Solutions”, are never linked. Names with different numbers (“Unit 2” / “Unit 3”) are never linked automatically. The spelling used most in the file names a new supplier; names with a vendor number and many lines are linked first, so a typo is attached to the proper name rather than the other way round.

## Check names

| List | What to do |
|---|---|
| Possible duplicates | **Same: merge** moves the lines, spellings, factors and profile details into the existing supplier and recalculates the open lines. **Different** keeps them apart for good. |
| Linked automatically | The lines already count under the supplier. **Right** confirms the link; **Wrong: split** makes the spelling a supplier of its own and moves its lines. **Confirm all** accepts the whole list. |

Any two suppliers can also be merged from a supplier's profile (“Same supplier under another record?”). Merged and split names are remembered for later uploads.

## The profile

Open a supplier to see and complete:

- **Profile:** name, vendor number, country, tax registration number (TRN), industry, size, sustainability contact and e-mail, website, whether it reports its emissions, its climate target (SBTi validated or committed, own target, none) and a note. The bar shows how complete the profile is (country, vendor number, industry, contact, reports emissions, climate target).
- **Emissions by month** and **what is bought** (spend categories, spend and tCO₂e).
- **Names seen in purchases:** every spelling linked to the supplier, how it was linked and its lines.
- **Default spend category:** used for this supplier's purchases that their description does not identify (“Monthly charges”, “Service fee”). Suggested when one category makes up 80 % or more of what is bought from the supplier; also set from a batch with *Remember my choices for everything from this supplier*.
- **Own emission factors:** an EPD, product footprint or the supplier's inventory, per unit (kg, t, L, m³, kWh, piece) or per money spent; it replaces the spend-based estimate for that supplier's lines.

A vendor number can belong to one supplier only: if it is already used, merge the two records instead. Country and vendor number are filled from the files when the profile has none; a person's entry is never overwritten.

Filters on the list: possible duplicates, incomplete profiles, with or without an own factor, and a country (from Analytics). Sort by emissions, spend, lines or name.

## Analytics

For a year, from calculated purchase lines (ready or published), shown as emissions or as spend in US dollars:

| View | Shows |
|---|---|
| Totals | suppliers with purchases, spend, emissions, share from suppliers' own factors, concentration (how many suppliers make 50 % and 80 % of emissions) |
| By supplier country | emissions or spend per country; click a country to list its suppliers. “Country not known” shrinks as profiles are completed or files carry a supplier-country column |
| By product | product groups, or the individual spend categories (EPA / NAICS) |
| By Scope 3 category | 3.1, 3.2 capital goods, and lines moved to transport, travel or leased assets |
| By industry sector | the economic sector of each spend category |
| By month | spend-based versus suppliers' own factors |
| Largest suppliers | the 25 largest, with country, main purchase, share, factor type and profile completeness — the suppliers to engage first |
| Profiles and climate targets | how much is known about suppliers, and the share of purchased emissions by the supplier's climate target |

Lines that cannot be calculated yet (no exchange rate, facility not recognised, no spend category) are not in Analytics until fixed.

## Supplier portal

Suppliers → **Supplier portal** asks suppliers for their own data, so their purchases are counted with their real figures instead of spend-based averages. The supplier's contact signs in at **/supplier** with their work e-mail and an access code — no user account, no password.

```flow
> 1 · Invite | choose the supplier, the year, the contact's e-mail; an access code is made
> 2 · Answer | the supplier fills in the sections, saving as they go, and attaches evidence
> 3 · Submit | they confirm the answers with their name and title; you are told in your inbox
> 4 · Review | accept (profile updated, chosen figures become supplier factors) or query with a note
> 5 · Use | purchases from the supplier are recalculated with its own factor
```

**Inviting** (super admin, admin, manager): **+ Invite a supplier**, or **Invite** next to one of the largest suppliers not asked yet (ranked by emissions from that year's purchases). Give the contact's work e-mail and name, a message, a date to answer by, and how long the code is valid (1–12 months). The access code is shown **once**; with "E-mail the invitation" ticked, the invitation with the link and code is sent (once a mail server is set up). The code is stored only as a hash. **New code** replaces it (the old one stops working); **Remove access** ends it. A supplier is asked once per year.

**What the supplier answers:**

| Section | Content |
|---|---|
| Your company | legal name, country, registration number, website, industry, size, contact |
| Emissions | whether they measure them; Scope 1, Scope 2 (location- and market-based), Scope 3 and its categories, in tCO₂e; revenue and currency; boundary, standard, verification and verifier |
| Your share for us | the part of their Scope 1 + 2 relating to your purchases: by revenue (their sales to you ÷ their revenue), their own calculation, or "cannot say" |
| Climate targets | SBTi validated or committed, own target or none; reduction %, base and target year, scopes, net-zero year, link |
| Product footprints | per product: kg CO₂e per unit (kg, t, L, m³, kWh, piece or a currency), standard (EPD, ISO 14067…), boundary, validity, verified, document |
| Evidence | reports, verification statements, EPDs — PDF, JPEG or PNG up to 15 MB |
| Review & submit | a summary, the sections still missing, and a declaration with name and title |

The page shows the figures that follow as they type: their **intensity** (Scope 1 + 2 in kg CO₂e per unit of revenue) and the **tonnes relating to you**. Once submitted the answers are locked until you query them.

**Reviewing**: open the request (**Review**) to see every answer and file. Then:

- **Accept** — optionally update the supplier's profile (country, registration, industry, size, contact, reports emissions, climate target); use the **intensity** as a supplier factor (in the answer's currency, for purchases in the reporting year and the next), for everything bought from the supplier or for one spend category; use any **product footprint** as a factor, again for everything or a chosen category. Purchase lines of the supplier not yet published are recalculated at once; published ones change when their batch is reopened. The supplier is thanked by e-mail.
- **Query** — with a note the supplier sees on the portal and by e-mail; they correct and submit again.

Platform staff cannot accept. Every step — invitation, sign-in, each saved section, files, submission, decision — is in the audit log, the supplier's actions under their name. The factors created point back to the request.

**Coverage**: the tab shows how much of the year's purchase emissions comes from suppliers whose data you accepted.

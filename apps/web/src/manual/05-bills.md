# Bills and meter readings

Bills are uploaded **inside the tab they belong to**: Add data → Electricity, heat & cooling → **Bills** for electricity, cooling and heat; Stationary combustion → **Bills** for fuel and gas invoices; Waste → **Bills** for waste collection invoices and hauler tickets. Each bill is read, matched to its account (a meter with the account number), **checked by a person**, shown in a **preview**, and only counts once it is **published**.

The same tabs have **Meter readings**: readings that connected meters send through the API wait there in batches with the same kind of preview.

## The life of a bill

```flow
> Upload | drop many PDFs at once in the category's Bills tab (up to 15 MB each)
! The same file | a file uploaded before is recognised and not stored again (the upload list says so)
> Text read | supplier, account no., bill no., billing period, bill date, quantity and unit, amount — each with the line of the bill it came from
? Text in the PDF? | Yes: fields filled in from the bill | No (a scan): flagged — type the figures from the preview
> Matched to an account | by the account number; or chosen; or “New meter for this account”
* A person checks | every field against the PDF shown beside it, then “Checked — add to preview”
> Ready to publish | the preview: quantity, months it is split over (by days), estimated emissions, and anything that stops it
? Stopped? | Published: one reading for the billing period, monthly entries follow | Fix the bill or reject it (duplicate, not ours…)
```

## The preview before publishing

“Ready to publish” lists the checked bills of the category, each with:

- the account (meter) and facility, the billing period and its days;
- the quantity in the meter's unit and **how it splits over calendar months**;
- the **estimated emissions** (tCO₂e) the bill will add, and any calculation warning (for example a missing grid factor);
- what **stops** it (red, cannot be published) or deserves a look (amber).

Stopped (red):

- **the same bill number** from the same supplier as an earlier bill (the later one is stopped);
- **an overlapping period** on the same account: a bill already published, or an earlier checked bill;
- **meter readings from another source** (API, upload) already covering part of the period — the bill would count it twice;
- the account takes register readings (bills need a meter that records consumption per period).

Amber: approved months that will not change (the difference is reported).

Tick the bills to publish (the clean ones are ticked) and press **Publish**. A change to a checked bill sends it back to “To check”.

## Meter readings received through the API

Building systems, utility portals and data loggers send readings with an API client (Integrations & API). By default each request becomes a **batch waiting for review** under Add data → the category → **Meter readings**:

| In the preview | Means | On publishing |
|---|---|---|
| New | no reading yet at that time | stored |
| Corrections | a different value at the same time as an existing reading (old → new shown) | replaces it |
| Duplicates | the same value again, or already waiting in an earlier batch | skipped |
| Conflicts | inside a period a published bill already covers | skipped |
| Refused | not understood (bad date, unknown meter, future time) | reported to the sender |

Per meter the preview shows the period covered and the quantity per month. **Publish** stores the readings and creates or updates the monthly entries; **Discard** drops the batch. A super admin can switch review off (readings are then stored at once, as before).

## What the reader looks for

- **Supplier:** recognised for DEWA, SEWA, TAQA (ADDC / AADC), Etihad WE, Empower, Tabreed, Emicool and Emirates Gas; other bills work with the generic rules.
- **Consumption:** the figure next to words like *consumption*, *units consumed*, *total kWh* — not meter readings, rates (AED/kWh) or water (IG). If the total is not printed, previous and current readings are used. Other figures found on the bill are offered as one-click alternatives.
- **Billing period:** "Period 15/02/2026 – 14/03/2026", "From … To …", or the previous and current reading dates. Numeric dates are read day first (UAE).
- **Not found?** The field stays empty and is listed in yellow: fill it in from the preview.

## Publishing

Publishing turns the bill into one reading of its meter covering the billing period. Because bills rarely follow calendar months, the consumption is split by days — see the diagram in **Meters**. A month only partly covered until the next bill arrives is shown as *estimated* and becomes *actual* when the next bill is booked.

**Safeguards:**

- nothing counts until a person has checked the figures and the bill is published;
- the same file twice is not stored again; the same bill number or an overlapping period is stopped in the preview;
- a bill cannot be published on top of readings from another source for the same period;
- months whose entry is already **approved** are not changed — the difference is reported;
- **Reopen** removes the bill's reading, recalculates the months and puts the bill back to check;
- every upload, check, publication, rejection and reopening is in the audit log, and so is every API batch published or discarded.

## Why not by email?

Reading bills from a mailbox is not offered for now. It would need access to a company mailbox, it opens a route for phishing and malicious attachments, and it needs a separate security review. Dropping the PDFs in one place covers the need. If wanted later: a dedicated inbox that accepts only known utility senders, with files held for review.

## AI reading

Bills are read with fixed rules, inside Ekotrace — no bill leaves the platform. AI reading (for unusual layouts and scans) would only run through an AI service approved by the client, in an approved location, and stays switched off until then.

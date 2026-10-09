# Bills

Electricity, cooling, heat and gas bills can be uploaded as PDF in one place (Capture → Bills). Each bill is read, matched to its meter, **checked by a person**, and only then booked.

## The life of a bill

```flow
> Upload | drop many PDFs at once (up to 15 MB each)
! File checks | must be a real PDF; the same file uploaded twice is recognised and not stored again
> Text read | supplier, account no., bill no., billing period, bill date, consumption and unit, amount — each with the line of the bill it came from
? Text in the PDF? | Yes: fields filled in from the bill | No (a scan): flagged — type the figures from the preview
> Matched to a meter | by the account number; or chosen; or “New meter for this account”
* A person checks | every field against the PDF shown beside it, corrects what is needed
? Correct? | Book it: one reading for the billing period | Reject it, with a reason (duplicate, not ours, water only…)
> Months follow | the consumption is split over the months the bill covers, by days; the meter's monthly entries are created or updated
```

## What the reader looks for

- **Supplier:** recognised for DEWA, SEWA, TAQA (ADDC / AADC), Etihad WE, Empower, Tabreed, Emicool and Emirates Gas; other bills work with the generic rules.
- **Consumption:** the figure next to words like *consumption*, *units consumed*, *total kWh* — not meter readings, rates (AED/kWh) or water (IG). If the total is not printed, previous and current readings are used. Other figures found on the bill are offered as one-click alternatives.
- **Billing period:** "Period 15/02/2026 – 14/03/2026", "From … To …", or the previous and current reading dates. Numeric dates are read day first (UAE).
- **Not found?** The field stays empty and is listed in yellow: fill it in from the preview.

## Booking

Booking turns the bill into one reading of its meter covering the billing period. Because bills rarely follow calendar months, the consumption is split by days — see the diagram in **Meters**. A month only partly covered until the next bill arrives is shown as *estimated* and becomes *actual* when the next bill is booked.

**Safeguards:**

- nothing is booked until a person confirms the figures;
- one bill per meter per period: a second bill overlapping a booked one is refused;
- a bill cannot be booked on top of a reading from another source for the same time;
- months whose entry is already **approved** are not changed — the difference is reported;
- **Reopen** removes the bill's reading, recalculates the months and puts the bill back to check;
- every upload, booking, rejection and reopening is in the audit log.

## Why not by email?

Reading bills from a mailbox is not offered for now. It would need access to a company mailbox, it opens a route for phishing and malicious attachments, and it needs a separate security review. Dropping the PDFs in one place covers the need. If wanted later: a dedicated inbox that accepts only known utility senders, with files held for review.

## AI reading

Bills are read with fixed rules, inside Ekotrace — no bill leaves the platform. AI reading (for unusual layouts and scans) would only run through an AI service approved by the client, in an approved location, and stays switched off until then.

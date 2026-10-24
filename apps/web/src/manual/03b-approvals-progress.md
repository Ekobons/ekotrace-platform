# Approvals and data progress

## Approvals

**Approvals** (menu → Capture → Entries & approvals) lists the entries submitted for the facilities you look after.

- **Waiting for you** — entries you can approve. For each: facility and month, category and item (with the note), quantity, tCO₂e (**How calculated** shows the factors and steps), the **check**, and who entered it and when.
- **Check** — the quantity against the approved history of the same item at the same facility (see *Quantity check* below). Outside the usual range it is flagged, e.g. “+42% vs expected 1,240 (usual range 1,010–1,520…) — add a note”; hover the check to see how the range was worked out. No history = nothing to compare yet. The person entering the data sees the same check while typing.
- **Approve** — the entry counts in the dashboards and reports. **Send back** — write what needs fixing; the person who entered it sees it on Home and in Add data.
- **Approve all N without warnings** — approves every entry in its usual range in one go; flagged ones stay for a closer look.
- **Waiting for someone else** — entries in your facilities waiting for another approver, and who (your own entries, which you never approve yourself).
- **Several approvers.** An entry waits for *everyone* who may approve its facility: each of its managers (the facility's manager and anyone assigned as manager), the admin of its sub-group and the super admin. It appears in each of their lists, and the **first** to approve or send it back decides — it then leaves everyone's list. One approval is enough at level 1; it is not approved once per manager. *Waiting for* names all the managers.
- **Sent by** — who submitted it and when, who entered it if someone else, and whether it came from a purchase file or a meter.

The number next to **Entries & approvals** in the menu (and on its Approvals tab) is what waits for you.

### Approval levels

Set by the super admin under **Methodology & boundaries → Approval levels**:

- **Level 1** — another manager of the facility, else the sub-group admin, else the super admin. Nobody approves their own entry (unless self-approval is switched on, below).
- **Level 2** (optional) — for entries of at least a number of tCO₂e, or always for chosen categories, a second approval by a sub-group admin or the super admin, a different person from level 1. After level 1 the entry shows **Level 2 · Level 1 approved by …**.
- **Quantity check** — how the usual range is worked out, and the ± % limit:
  - **Seasonal band** (default): two forecasts are tried on each of the last 12 months — (a) the same month last year × the recent trend (the last 3 months against the same 3 months a year earlier, kept between ×0.5 and ×2) and (b) the average of the 6 months before. The one that has been closer gives the expected value, and the band is 3 × its usual error (a robust spread, so one odd month does not widen it), at least ±10% and at most ×3. Seasonal entries (cooling, irrigation) end up judged against last year's season, steady ones against their recent level; regular data gets a tight band, erratic data a wider one. Until the forecasts can be scored the band is ± the limit around (a); with less than a year of history the 6-month average ± the limit is used.
  - **6-month average ± limit**: the average of the 6 months before, ± the limit (±35% by default). Simple, but flags normal seasonal swings such as summer cooling.
  - A metric in the Metric registry can have its own limit.

Sending an entry back clears both levels; when it is resubmitted it starts again at level 1.

Platform staff (Ekobon) never approve or send back a company's data, and never decide its registry changes or base-year restatements. They can view and help.

### Self-approval (off by default)

For companies where an independent check is impractical, for example one person runs the data for a site, the super admin can switch on **Allow super admins, admins and managers to approve their own entries**, optionally only below a size in tCO₂e.

When it is on:

- Your own entries appear under "Waiting for you" marked **Your entry**.
- **Approve my own…** asks what you checked the entry against (the bill, the meter export, the delivery notes). The note is required.
- The entry is marked **self-reviewed**. It is listed in the data-quality report under "Segregation of duties", with your note, and counted in the verifier pack.
- **Approve all without warnings** never includes your own entries.
- Data preparers never approve. Level 2, when it applies, is always someone else.

Verifiers and most frameworks expect an independent check; the BEEAH RFP asks for one. Leave it off where that applies. A company whose only user is its super admin approves its own entries anyway, marked self-reviewed.

## Data progress

**Data progress** shows each facility (for the company, sub-group, facility or group viewed) by month of the year:

| Status | Meaning |
|---|---|
| Approved | every category the facility reports is approved for that month |
| In review | everything is in; some of it waits for approval |
| Partial | some categories are missing, drafts or sent back |
| Missing | nothing in for the month |
| Future | the month is not over yet |
| Not reported | the facility has no categories with data this year or last |

Hover a month to see each category; click it to open **Add data** for that facility and month. **Approved** at the end of each row counts the approved months so far. An entry covering several months (e.g. a landfill model for January–September) counts in each month it covers.

# Approvals and data progress

## Approvals

**Approvals** (menu → Capture) lists the entries submitted for the facilities you look after.

- **Waiting for you** — entries you can approve. For each: facility and month, category and item (with the note), quantity, tCO₂e (**How calculated** shows the factors and steps), the **check**, and who entered it and when.
- **Check** — the quantity against the average for the same item at the same facility over the 6 months before. Outside the limit (±35% by default) it is flagged, e.g. “+42% vs 6-month average — add a note”. No history = nothing to compare yet.
- **Approve** — the entry counts in the dashboards and reports. **Send back** — write what needs fixing; the person who entered it sees it on Home and in Add data.
- **Approve all N without warnings** — approves every entry in its usual range in one go; flagged ones stay for a closer look.
- **Waiting for someone else** — entries in your facilities waiting for another approver, and who (your own entries, which you never approve yourself).

The number next to **Approvals** in the menu is what waits for you.

### Approval levels

Set by the super admin under **Methodology & boundaries → Approval levels**:

- **Level 1** — the facility manager, a sub-group admin or the super admin. Nobody approves their own entry.
- **Level 2** (optional) — for entries of at least a number of tCO₂e, or always for chosen categories, a second approval by a sub-group admin or the super admin, a different person from level 1. After level 1 the entry shows **Level 2 · Level 1 approved by …**.
- **Quantity check** — the ± % limit for the check.

Sending an entry back clears both levels; when it is resubmitted it starts again at level 1.

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

# Approvals and data progress

## The life of an entry

Every figure in Ekotrace is an **entry**: one facility, one period (usually a month), one thing (diesel, grid electricity, a spend category…), with its quantity, its factors and its result. It moves through four statuses (plus an optional second approval); only **Approved** counts in dashboards and reports.

```diagram entry-life
```

| Status | What it means | Who can change it | Counts in dashboards and reports |
|---|---|---|---|
| **Draft** | saved, not yet sent for approval | whoever can enter data for the facility: edit, delete, submit | no |
| **Waiting approval** | submitted; in the approvers' lists | the approvers: approve or send back. The person who submitted it (or another data entrant of the facility): withdraw it to draft | only with *Include waiting* ticked on the dashboard (a preview) |
| **Level 2** (optional) | level 1 approved; a large entry or a chosen category waits for a second approver | an admin or the super admin, not the level-1 person | as *waiting* |
| **Approved** | checked and accepted | nobody edits it. An approver can **send it back** for a correction | **yes** |
| **Sent back** | returned with the approver's note | the people who enter data: fix and submit again, or delete | no |

### Where entries come from, and how they start

| Source | Starts as |
|---|---|
| Add data — typed in, pasted rows, Excel templates | Draft, or Waiting approval with **Submit for approval** |
| Meters and bills (readings split by month) | Draft — submit from Add data; later readings update the month until it is approved |
| Smart import, purchase files (on **Publish**), waste contractor collections | Waiting approval — the person who reviewed the file is the maker, the facility's approver the checker |
| Employee commuting (typed in or from a survey) | Draft |

### The normal path

```flow
* Enter | Add data → the category → months; or a meter, bill, purchase file, smart import
> Saved as draft | editable; Home lists My drafts
* Submit for approval | Add data → step 2 Review → Submit (or Submit all drafts); the line above the button says who approves
> Waiting approval | in the Approvals list of every approver of the facility, with the quantity check
? Approver decides | Approve: the entry is approved (or goes on to level 2) | Send back: with a note; the person who entered it sees it on Home, in Add data and in the Inbox
> Approved | Add data → step 3 Approved, Entries & results (status Approved), Data progress, dashboards, reports
```

### Who approves — several approvers

An entry waits for **everyone** who may approve its facility, and the **first** one to act decides; it then leaves every list. One approval is enough.

| Role | Approves entries of |
|---|---|
| Manager | the facilities they manage or are assigned to — a facility can have several managers |
| Admin | every facility in their sub-group |
| Super admin | every facility |
| Data preparer, verifier, platform staff | none |

Nobody approves their **own** entry (entered or submitted by them) unless self-approval is on — see the scenarios below. *Waiting for* on the Approvals page names all the facility's managers.

### Level 2 (optional)

Switched on under **Methodology & boundaries → Approval levels**: for entries of at least a set tCO₂e, or always for chosen categories.

```flow
> Waiting approval | level 1: a manager, admin or super admin of the facility
* Level 1 approves | the entry shows “Level 2 · Level 1 approved by …”
> Waiting at level 2 | an admin or the super admin, never the level-1 person
* Level 2 approves | approved
! Sent back at either level | both levels are cleared; on resubmission it starts again at level 1
```

### Where to see entries

| Place | Shows |
|---|---|
| **Add data** → category → step 2 *Review* | drafts, waiting and sent back for the facility, category and months chosen — submit, withdraw, approve |
| **Add data** → step 3 *Approved* | every approved entry of that facility, category and months, whoever entered it and from whatever source |
| **Entries & approvals → Approvals** | what waits for you, and what waits for someone else (with *Sent by*) |
| **Entries & approvals → Entries & results** | every entry of a year — filters just above the list (month, facility, category, item, status) and a **Total** row that adds up the entries shown: quantity (per unit when units differ) and each emissions column; click an entry to see how it was calculated |
| **Home** | my drafts, sent back to me, waiting for my approval, data due |
| **Data progress** | each facility × month: approved, in review, partial, missing |
| **Dashboards, reports, verifier pack** | approved entries only (dashboards can preview waiting ones) |

Purchase files: one entry per facility, month, Scope 3 category and spend category, shown under Add data → **Purchases** (those moved to business travel also under Business travel); the lines behind them under Purchases → **Published lines**.

### Add data or Approvals — who sees what, and the months

The same entries can be looked at in two places; they answer different questions.

| | **Add data** (category → step 2 *Review*, step 3 *Approved*) | **Approvals** (Entries & approvals) |
|---|---|---|
| Question it answers | “What is the state of *this* facility's data for *these* months?” | “What is waiting for *me* to approve, anywhere?” |
| Scope | one facility, one category, the months picked at the top | every facility you approve, every category, every month |
| Statuses | *Review*: draft, waiting, sent back. *Approved*: approved | waiting only (approved ones leave the list) |
| Whose entries | everyone's — whoever entered them and from whatever source (typed, meter, bill, purchase file, import) | everyone's, split into *Waiting for you* and *Waiting for someone else* |
| What you can do | submit, withdraw, approve, send back (also an approved entry) | approve, approve all without warnings, send back |

**Who sees which facilities**

| Role | Add data (facilities offered) | Approvals: *Waiting for you* | Approvals: *Waiting for someone else* |
|---|---|---|---|
| Super admin | all | everything waiting, except own entries (unless self-approval) | own entries, level 2 the super admin cannot take |
| Admin | the facilities of their sub-group | entries of those facilities | own entries in them |
| Manager | facilities they manage or are assigned to | entries of those facilities | own entries, and level 2 entries |
| Data preparer | facilities assigned to them (enter, not approve) | — | what they and others submitted for their facilities, and who it waits for |
| Verifier | read-only, all facilities (no Add data actions) | — | — (sees approved data in dashboards, reports and the verifier pack) |

**Why pick months in Add data**

- The month buttons at the top decide **what you enter** (one row per month picked) **and what steps 2 and 3 list**: every entry of that facility and category that falls in, or overlaps, the months from the **first to the last month picked**. Pick March only → March. Pick January and June → January to June. Pick nothing, or *Whole year* → the whole year.
- Each month button shows that month's status (approved, in review, missing…), so picking the *open* ones (**All open months**) is the quick way to finish a facility.
- A whole-year or quarterly entry (a landfill model, a commuting survey, an annual refrigerant check) shows in every month it covers.
- Step 3 *Approved* adds up Scope 1, 2 and 3 for those months: the facility's approved total for the period, the same figure the dashboards show.
- The **year** selector changes the year; future months cannot be picked (the current month can).

**Years and months in Approvals** are filters, not a period: *All years* and *All months* by default, a year to see only that year's entries, or one month to work through them in order. Approvals is a to-do list across the whole company; Add data is the picture of one facility.

### Scenarios

| Situation | What happens |
|---|---|
| **Self-approval off** (default) and you submit your own entry | it waits for another approver of the facility; you see it under *Waiting for someone else* |
| **Self-approval on**, you are a super admin, admin or manager | your entry also appears under *Waiting for you*, marked **Your entry**; **Approve my own…** (on the Approvals page or in Add data → Review) asks what you checked it against; it is marked **self-reviewed** and listed in the data-quality report and the verifier pack. Others can still approve it instead |
| Self-approval on **with a size limit** | below the limit as above; above it someone else approves |
| Self-approval on, you are a **data preparer** | no change — preparers never approve |
| **Self-approval switched off again** | entries already self-approved stay approved and marked; your entries still waiting go back to needing someone else |
| The **super admin is the company's only user** | approves their own entries without the setting (marked self-reviewed); level 2 does not apply |
| A facility has **two managers** | both see it; the first to act decides |
| You entered it and are the **only manager** | it waits for the sub-group admin or the super admin |
| **Withdraw** | a waiting entry goes back to draft (for example to fix a typo before anyone looks) |
| An **approved entry is wrong** | an approver sends it back with a note → it can be edited and resubmitted; the change is in the audit log |
| **New factors loaded / recalculation** | the figures of saved entries (any status) are recalculated; the status stays; each change is logged with old and new totals |
| A **meter reading** arrives for an approved month | the approved entry is not changed; the difference is listed for the approver to decide (send back to update) |
| A **purchase file is reopened** | its entries not yet approved are taken back; approved ones stay |
| The **month is locked** for audit | nothing in it can be entered, edited, approved, sent back or recalculated until unlocked with a reason |


## Approvals

```video data-entry-submit-approve
Submit, approve or send back | 1:07
```

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

Verifiers, most frameworks and many tenders expect an independent check. Leave it off where that applies. A company whose only user is its super admin approves its own entries anyway, marked self-reviewed.

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

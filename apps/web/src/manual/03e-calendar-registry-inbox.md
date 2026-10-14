# Metric registry, collection calendar and inbox

Three screens run the data-collection cycle.

- The **metric registry** says what is collected (Menu → Setup).
- The **collection calendar** shows what each facility owes and by when (Menu → Capture).
- **Inbox & to-dos** tells each person what is waiting for them (Menu → Capture).

Reminders and escalations go out by themselves.

```flow
> 1 · Define | the metric registry: what, unit, owner, facilities, frequency, due day, evidence, check limit
> 2 · Owe | the calendar works out each facility's obligations: facility × metric × month, quarter or year
> 3 · Remind | before the due date, the day after it, and to managers when it is badly late
> 4 · Enter | the people responsible enter the data and submit it; the approver approves it
> 5 · Close | the period turns green; a period not owed is excused with a reason
```

## Metric registry (data dictionary)

The registry is separate from the emission factors. A factor says how to calculate. A metric says what is collected, by whom, how often and with what proof.

A company starts with one standard metric per category, numbered EKO-001, EKO-002 and so on. You can split a category into several metrics, for example "Grid electricity" and "District cooling". To do that, give each metric its own items. A metric without items covers the rest of the category.

| Field | What it does |
|---|---|
| ID and definition | A unique ID that never changes, and the approved wording of what is counted |
| Category and items | The scope and GHG Protocol category the data belongs to |
| Reporting unit | The unit totals are shown in. Entries in other units of the same kind are converted (the drawer lists the conversion rules, for example 1 MWh = 1,000 kWh). |
| Owner | The person responsible for the metric everywhere. Without one: the facility's data preparers, else its manager. |
| Collected | **Per facility**, or **once for the whole company** (finance system, travel agency, survey) |
| Applies to | Facility types (for example Plant), or a list of facilities, or all of them |
| Required | Ticked: every facility it applies to owes it every period. Not ticked: only facilities that report it (data this year or last). |
| Source system, methods | Where the data comes from (SAP MM, fuel cards, DEWA bills…) and how it is captured (form, upload, bill or meter, API, QR, survey) |
| Frequency and due | Monthly, quarterly or yearly. Due on a day of the month after the period, or later. Without a day, the company's due day applies. |
| Check limit | How far from the 6-month average an entry may be before it is flagged on Approvals and in the data-quality checks (company default ±35%) |
| Evidence | **Required**: an entry cannot be submitted or approved until it has evidence, which can be a bill, a meter, a purchase file, bin scans or a document linked in the Document vault. **Optional**: flagged only. |

### Changes and versions

- **A super admin's change** is saved at once as a new version.
- **An admin's change** is a proposal. It goes to the super admins, who see the old and new values side by side and approve or reject it, with a note when rejecting. Nobody approves their own proposal. Until it is approved, the current version stays in use.
- **Every version** keeps the reason, who changed it, who approved it, and what changed (before → after). Open a metric to see its history.
- **Metrics are never deleted.** A metric no longer needed is retired: it keeps its history and leaves the calendar.

Everyone in the company can read the registry, verifiers included.

## Collection calendar

For the year chosen, the calendar lists what each facility owes for each metric: one cell per month, quarter or year. **By month** shows the year at a glance. **List** shows due dates, the people responsible, the data already in and the reminders sent.

| Status | Meaning |
|---|---|
| Approved | Every month of the period has data, all approved. "Late" if it was complete only after the due date. |
| In review | Every month has data and some of it is waiting for approval |
| Open | Nothing yet, and the due date is still ahead |
| Due soon | Due within the "due soon" days (company setting, default 3) |
| Overdue | Past the due date. "Partial" when some data is in (drafts, sent back, or months missing). |
| Escalated | More than the escalation days late (default 7) |
| Excused | Not owed for this period, with a reason |

The tiles at the top are filters: due soon, overdue, escalated, in progress, approved (with the share that came in on time), and excused. **Only mine** keeps what you are responsible for, or what is escalated to you.

Click a period to see:

- the data in, converted to the metric's unit;
- whether evidence is missing;
- who is responsible and who hears about escalations;
- the reminders already sent.

From there you can **enter the data**, **remind** the people responsible now (at most once a day), or **excuse** the period with a reason, for example "plant shut for maintenance". Excusing is open to managers of the facility, admins and super admins. The reason, your name and the date are kept and shown to verifiers, and you can undo an excuse later.

**Company-wide metrics**, such as purchases, travel and commuting, appear once as "(company-wide)". Super admins and verifiers see them, as do their owners.

### Rules

These rules are set by the super admin under **Change rules**:

- the due day (day 10 of the next month unless a metric sets its own);
- the "due soon" days;
- the escalation days;
- whether reminders go out automatically.

**Send due reminders now** runs today's reminders at once instead of waiting for the hourly run.

## Reminders and escalation

Every hour Ekotrace checks the calendar and sends:

- **Due soon:** to the people responsible, the set number of days before the due date.
- **Overdue:** to the people responsible, the day after the due date.
- **Escalation:** when a period is more than the set number of days late. It goes to the people above those responsible: the facility manager and the admins of the sub-group above it, or, failing that, the super admins.

Each kind of reminder goes once per period. The items are gathered into one message per person, so nobody is flooded. Periods more than 180 days late are no longer chased; they stay red on the calendar.

When an approver sends an entry back, the person who entered or submitted it is told at once, with the approver's note.

## Inbox & to-dos

| To do | Where it leads |
|---|---|
| Late: data you are responsible for | the calendar |
| Escalated to you: badly late at your facilities | the calendar |
| Due soon, and coming up in the next 31 days | the calendar |
| Sent back to you, with the approver's note | Add data, at that facility and month |
| Entries waiting for your approval | Approvals |
| Registry changes to approve (super admin) | Metric registry › Changes |
| Open audit findings to answer (admins) | Audit & assurance |
| Your drafts not submitted yet | Entries & results |

**Notifications** lists the reminders, escalations, sent-back entries and registry decisions sent to you, unread first. Click one to open the page it is about.

The number on **Inbox & to-dos** in the menu counts unread notifications and late or sent-back work. Approvals has its own number.

**E-mail.** Notifications are also sent by e-mail unless you untick "Also send them to me by e-mail". An e-mail carries the title, the list of facilities, metrics and periods, and a link. It never carries figures or files. If the platform has no mail server set up yet, e-mails are held and nothing leaves Ekotrace; the notices still appear here.

*For the IT team:* set SMTP_URL (smtps://, or smtp:// with STARTTLS; TLS 1.2 or later is required) and MAIL_FROM. Set PUBLIC_URL so the links in e-mails work. Undelivered messages are retried five times, and sent messages are kept 90 days.

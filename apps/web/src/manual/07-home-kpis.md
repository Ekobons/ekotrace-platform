# Home and KPI dashboard

## Home

**Home** is the first page after signing in. It uses the same **VIEWING** and **PERIOD** buttons as Dashboards, and shows what matters for your role.

**The month's data (top strip)** — data for a month is due on the **due day** of the next month (Methodology → Collection rules; 10 by default). The strip shows the month being collected, its due date, how many of the expected submissions are in (a submission = one facility × one category it reports), and how many are **overdue** (past the due date) or **escalated** (more than the escalation days past it).

| Role | Home shows |
|---|---|
| Super admin, admin | Emissions (with the change against last year), **Scope 1+2 vs target path**, **Data approved** (share of the required facility-category-months approved), Reductions delivered; the **monthly emissions** chart; **Needs your decision**; the **Facilities** table; the **Biggest sources** |
| Manager | Entries **waiting for your approval** (with a warning when a month is far from the usual), overdue items at your sites, the monthly chart and your facilities. **Approve N clean** approves every waiting entry without a warning in one go |
| Data preparer | When this month's data is due, how much of it is done, what was **sent back** to you, your on-time record, **your checklist** for the month and **To fix** (sent-back entries and drafts not submitted) |
| Verifier | Approved entries, how many come with evidence (a bill or meter readings), complete months; a **sample to test** (the largest approved entries), **assurance readiness** checks and where to look |
| Only user (super admin of a one-user company) | Three steps: enter, check, report. Entries you enter and approve yourself are marked **self-reviewed** |

**Monthly emissions chart** — bars by scope, a grey line for the same month last year and a dashed amber line for the **target path**. A pale bar is a month whose data is still coming in (shows "x% in"). The chip above says how many complete months are at or below the path.

**Facilities table** — each facility's tCO₂e, the change against last year (complete months only), a square per month (green approved, amber partly in or waiting, pale nothing yet) and this month's data: done / expected, **Overdue**, and **+N late months** when earlier months are still missing after their due date. Click a row to view that facility.

## KPI dashboard

**KPI dashboard** (under Home) tracks the indicators you choose, for the selection at the top (company, sub-group, facility or dashboard group).

- **Monthly / Quarterly / Semi-annual / Annual** groups the bars.
- **Aggregate** shows one chart per KPI for the selection; **Compare facilities** shows one bar per facility for the period.
- **My KPIs** — a card per KPI. Change a card's KPI from its title. Bars are **green** when on target and **amber** when not; the dashed line is the target; a pale bar is a period still filling (under 90% of the data in).
- **Emissions vs target** — Scope 1+2 and Scope 3 by month against the target path, with a table of each period: actual, path, difference and whether it is on target (or "Data incomplete").
- **Benchmarks** — intensities (per employee, per m², energy use intensity, water per employee) compared with typical bands for each facility type.

**Choose KPIs & set targets** opens a list of 19 KPIs (emissions, intensity, energy, water, waste, fleet & travel, value chain). Tick the ones to show (up to 12). Super admins and admins can also set a **target for this selection**: for totals, a value per month (scaled to quarters, half-years and years); for percentages and intensities, the level to stay below (or above, for renewable share and waste diversion). Managers can choose KPIs but not set targets.

## Targets and collection rules

Set in **Methodology**:

- **Reduction targets** — the target year and the cut from the base year for Scope 1+2 and for Scope 3 (default −42% and −25% by 2030). The target path is a straight line from the base year to the target year, applied to each base-year month.
- **Collection rules** — the due day (data for a month is due on this day of the next month), the days before it that count as **due soon**, and the days after it when an overdue submission is **escalated**.

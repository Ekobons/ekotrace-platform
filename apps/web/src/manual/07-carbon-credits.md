# Carbon credits

Menu → Net zero → **Carbon credits** keeps the company's register of carbon credits: what was bought, what is held, and what was retired against which year.

Credits are reported **beside** the GHG inventory, never inside it. Gross emissions always stay as measured. "Net after credits" is shown next to them for information. Credits do not count towards reduction targets (SBTi): only real reductions do.

```flow
> 1 · Buy | record the purchase (a lot): project, registry, type, vintage, tonnes, price
> 2 · Deliver | when the credits reach the company's registry account, mark the lot delivered
> 3 · Retire | cancel the credits on the registry, then record the retirement with serials and statement
> 4 · Approve | a second super admin or admin approves it; only then does it count
> 5 · Report | dashboards, reports and the verifier pack show gross, credits retired and net after credits
```

## The page

| Part | What it shows |
|---|---|
| Gross emissions | the year's Scope 1, 2 and 3 from approved entries, whole company |
| Credits retired | approved retirements used for the year, with the share that are removals; retirements still waiting are shown apart |
| Net after credits | gross minus credits retired — shown beside gross, never instead |
| Held and in the pipeline | delivered credits not yet retired, plus credits contracted but not yet delivered |
| Residual at net zero | the residual allowed at the Net Zero year (the % of the base year set under Targets & actions) and how much of one year of it the removals held or contracted would cover |
| Portfolio | one line per purchase, with how much of it is retired, waiting and still available |
| Retirements | every retirement with its year, purpose, serials, registry link and approval |

Choose the **reporting year** at the top. A retirement counts in the year it is recorded **for**, not the day it was cancelled.

## Recording a purchase

Super admins and admins record purchases: **+ Record a purchase**.

| Field | Notes |
|---|---|
| Project, registry, project ID | for example Verra (VCS), Gold Standard, Puro.earth, Isometric |
| Type | **Avoidance / reduction** (e.g. landfill gas, cookstoves), **Removal — nature-based** (forests, mangroves, soils) or **Removal — technical** (biochar, DAC, BECCS, enhanced weathering) |
| Vintage | the year the reduction or removal happened |
| Quantity | tonnes of CO₂e — one credit is one tonne |
| Price and currency | per tonne; used for the cost of credits retired |
| Status | **Contracted** (bought, not yet in the company's registry account), **Delivered**, or **Cancelled** (never delivered) |
| Labels | ICVCM Core Carbon Principles (CCP), CORSIA eligible, Article 6 corresponding adjustment |
| Permanence | how long the carbon stays stored, e.g. "1,000+ years" or "40 years with a buffer pool" |
| Contract | a file from the Document vault |

Once credits from a lot are retired, its type, vintage and status are fixed, and its quantity cannot go below what is retired or waiting. A lot with no retirements can be removed; otherwise mark it cancelled.

## Recording a retirement

First retire (cancel) the credits on the registry. Then click **Retire** on the delivered lot and enter:

- the tonnes and the registry date,
- the **reporting year** it is used for,
- the **purpose**: voluntary claim, neutralising residual emissions (net zero), beyond value chain mitigation (BVCM), CORSIA or a compliance scheme,
- the serial numbers, the name on the statement, a link to the public registry record and the retirement statement from the Document vault.

Rules:

- Only **delivered** credits can be retired, and never more than are available. Credits in a retirement waiting for approval are held.
- **Neutralising residual emissions** needs removals. Avoidance credits cannot be used for it (SBTi Corporate Net-Zero Standard).
- A **second person** approves each retirement: a super admin or admin who did not record it. Platform staff never approve. A rejection needs a reason. The person who recorded it can withdraw it while it waits.
- Retirements waiting for approval appear in **Inbox & to-dos** for the people who can approve them.

## Where credits appear

- **Dashboards → Net zero**: credits retired, net after credits, credits in the pipeline, the emissions-vs-offsets bars and the credit portfolio by type. The Overview's Net zero card shows the share offset. Credits are company-wide: they are not split by facility or sub-group.
- **Reports**: the section **Carbon credits (reported separately)** — in the Board summary, GHG Protocol and ESRS E1 templates, and available to add to any template — lists gross, credits retired by type, net after credits and every retirement with its registry, vintage, labels and serials.
- **Audit & assurance → Verifier pack**: the year's approved and rejected retirements, and every step in the change trail.

## Good practice

- Report gross emissions first and credits separately.
- Reduce first. Before net zero, credits can support climate action beyond the value chain (BVCM); at net zero, the residual is neutralised with permanent removals.
- Prefer high-quality credits (CCP label, independent ratings); keep the due diligence in the notes and the contract in the vault.
- Make claims carefully: "carbon neutral" claims are regulated in some markets (ISO 14068-1, VCMI Claims Code, consumer-protection rules).

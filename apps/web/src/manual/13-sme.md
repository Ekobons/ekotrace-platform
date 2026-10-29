# EKOTRACE SME (Indian MSMEs)

**EKOTRACE SME** is a separate, simple tool for small and medium enterprises in India. It has its **own sign-in page at `/sme`**, its own menu and only the screens an MSME needs: what rules apply, Scope 1, 2 and 3 from bills, ESG readiness, the ICAI SRMM level, money-saving checks, a compliance calendar, exports (CBAM, EUDR) and sharing with buyers, banks and a CA.

It is a **package of its own** (`sme`), switched on per company in the platform console, or opened by the company itself at `/sme-signup` when self-service sign-up is on. Buyers, clusters, banks and CA firms use the **SME network** package (`smenet`).

> Figures are estimates for planning and for answering buyers. They are not a statutory return, an audit or legal advice. Factors, rules, schemes and the SRMM question banks are kept up to date by the EKOTRACE team in the SME console.

```flow
> Profile | six answers: sector, turnover, people, exports, customers, products
> What applies | the rules that apply, may apply or are coming, each with a next step
> Emissions | yearly totals from bills; Scope 1, 2 and optional Scope 3
> ESG and SRMM | readiness score and the ICAI SRMM self-assessment (v3.1 manufacturing, v3.2 services)
> Save money | power bill, solar, schemes, scrap, pooled carbon credits
! Share | buyers, banks and the cluster see figures only with your consent; a CA validates the SRMM level
```

## The financial year

Everything is kept per Indian financial year (April–March, e.g. *FY 2025-26*). The year is shown at the top of each page; change it on **Profile**. Last year's figures are used for trends.

## Who does what

| Role | Can |
|---|---|
| Super admin (owner) | everything, company details, consent to share, ask a CA to validate |
| Admin | everything except consent and CA requests |
| Manager, preparer | enter and change data |
| Verifier | view |

Every change saves itself a moment after you type. If two people change the same page at once, the second sees a note and the latest figures.

## The screens

| Section | Screen | What it does |
|---|---|---|
| Home | Overview | headline figures, readiness ring, due next, money found, what needs attention |
| Carbon & ESG | Profile, What applies, Emissions, ESG, SRMM, Product footprint, Certifications | the core data and scores |
| Save money | Bill analyser, Solar, Schemes, Scrap market, Carbon credits | savings in ₹ per year |
| Compliance | Calendar, EPR, DPDP, People & safety, CSR | due dates and checklists; the workers' grievance QR poster |
| Exports | CBAM, EUDR | what your EU / UK buyer will pay and the data they need |
| Assist | Bill scan, Questionnaire, WhatsApp | read a bill PDF; answer a buyer's questionnaire from your data |
| Share | Share & validate, Green loan | consent per partner, CA validation, bank pack |

## SRMM level

The ICAI Sustainability Reporting Maturity Model scores 300 marks in three sections (A general, B environment & social, C governance). Levels: **1 Formative** above 30%, **2 Developing** above 50%, **3 Emerging** above 65%, **4 Established** above 80% — and each section must reach at least 30% of its marks. Where your data already supports a score the tool suggests it; you decide. The level becomes official only after a chartered accountant validates it (**Share & validate → Ask a CA**).

## Workers' grievance QR

**People & safety** shows a QR poster for the shop floor. A worker scans it and writes in Hindi or English, without signing in and without giving a name. The message reaches the company's grievance list; no phone number or IP address is kept.

## Sharing and the SME network

A buyer, cluster, bank or CA firm is linked to your company by the EKOTRACE team or by inviting you. **Nothing is shared until the owner turns sharing on** for that partner (Share & validate). Buyers see your summary figures; banks see figures for green-loan and financed-emissions reporting; a cluster sees only totals of five or more members, never one company. You can turn sharing off at any time.

## The SME benchmark

With your consent (**Share & validate**), your figures join the anonymous SME emissions database, shown only for groups of five or more companies of the same industry.

## Platform console → SME console

The EKOTRACE team manages SME companies, partners and links, the CA validation queue, scrap and carbon-credit moderation, the benchmark and every SME setting (emission factors, requirement rules, calendar templates, SRMM question banks, ESG weights, CBAM settings, tariffs and solar, schemes, plans, messages). Settings are versioned: a change is saved as a draft and goes live only when activated.

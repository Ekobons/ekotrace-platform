# EPR (extended producer responsibility)

Menu → Disclose → **EPR** shows what the company owes for the packaging, electronics, batteries and tyres it places on the market, the certificates that meet it, what is carried forward and what a gap would cost. For a recycler, it shows the certificates generated, sold and in stock.

EPR is a **package of its own**, switched on per company by the Ekobon team. With the GHG inventory it sits in the Disclose menu; without it, it opens in a small menu of its own. Every figure is typed: quantities placed on the market come from sales and procurement records, certificates from the authority's portal.

> Targets are the regimes' as published, checked October 2026. Each stream can take the target the portal shows instead. It is a working tool, **not legal advice**.

```flow
> Stream | one registration line: regime, category, role (producer, importer, brand owner, recycler), registration no.
> Years | quantity placed on the market each year (recyclers: processed), recycled content, pre-consumer waste
> Obligation | base quantity × target %, or the obligation typed from the portal
> Certificates | bought for a compliance year (producers), or generated and sold (recyclers)
! Shortfall | carried into the next years as the regime allows; exposure = shortfall × compensation rate
> Return | annual return filed: the year's figures lock
```

## Who does what

| Role | Can |
|---|---|
| Super admin, admin | add and change streams (regime, targets, rates), everything below |
| Manager | certificates, annual returns |
| Preparer | quantities by year |
| Others | view, download the Excel position |

## The regimes

| Regime | Categories | Obligation | Other targets |
|---|---|---|---|
| India — plastic packaging (PWM Rules, Schedule II) | I rigid, II flexible, III multi-layered, IV compostable | 100% (from FY 2023-24) of the average quantity placed in the two previous years, plus pre-consumer waste, less quantity supplied to registered PIBOs | recycling share: Categories I and IV 50 / 60 / 70 / 80% (FY 2024-25 to 2027-28), II and III 30 / 40 / 50 / 60%; recycled content (G.S.R. 237(E), 31 March 2026): I 30 / 40 / 50 / 60%, II 10 / 10 / 20 / 20%, III 5 / 5 / 10 / 10% from FY 2025-26 |
| India — e-waste (E-Waste Rules 2022) | Schedule I groups | EEE placed on the market one average life earlier × 60% (FY 2023-24, 2024-25), 70% (FY 2025-26, 2026-27), 80% (from FY 2027-28) | — |
| India — batteries (BWM Rules 2022) | portable, automotive, industrial, EV | the target the CPCB portal shows (type it as a % or in tonnes) | domestic recycled content: portable and EV 5% FY 2027-28 to 20% from FY 2030-31; automotive and industrial 35% to 40% |
| India — tyres (HOWM Rules, Schedule IX) | new tyres, imported waste tyres | 35% FY 2022-23, 70% FY 2023-24, 100% from FY 2024-25 of the weight placed two years earlier (imported waste tyres: the year before) | certificates valid two years after the year generated |
| EU — packaging (PPWR, Regulation (EU) 2025/40) | by material, four plastic types | a fee per tonne to the producer responsibility organisation (no tonnage target) | registration in each member state from 12 August 2026; recycled content in plastic from 2030: contact-sensitive PET 30%, other contact-sensitive 10%, beverage bottles 30%, other 35% (2040: 50 / 25 / 65 / 65%) |
| Other scheme | packaging, EEE, batteries, tyres, oil, textiles, other | typed | typed — e.g. the UAE framework (MOCCAE, pilot with Tadweer) |

India periods run April–March and are shown as *FY 2025-26*; the year picker shows the year the financial year ends in. EU and other schemes run by calendar year.

## The year

For each year the stream shows the **base** (and which years it comes from), the **target**, the **obligation**, the shortfall **carried in** from earlier years, the certificates that **met** it and the **shortfall**:

- Certificates clear the oldest carried shortfall first, then the year's own obligation.
- In India a shortfall may be carried for up to three years. After that it is forfeited to environmental compensation and no longer carried.
- **Exposure** is the shortfall × the environmental compensation rate typed on the stream. **To buy** is the shortfall × the assumed certificate price.
- For plastic packaging, at least the **recycling share** of the obligation must be met with recycling certificates. The rest may be end-of-life disposal (co-processing, waste-to-energy, road building) where the guidelines allow it.
- Batteries and tyres: certificates bought may cover the liability, any carried liability and 10% more. More is flagged. A tyre certificate used after its two years have run out is flagged.

**Recycled content** compares the recycled plastic (or material) in what was placed on the market with the required share. For food-contact plastic packaging, the FY 2025-26 shortfall may be carried for up to three years from FY 2026-27, clearing at least one-third a year. The stream shows what is still carried and how far it is behind that schedule. Importers' own recycled content does not count, but certificates from surplus PIBOs do (kind *Recycled content*).

## Certificates

| Who | Records |
|---|---|
| Producer, importer, brand owner | certificates bought: kind (recycling, end-of-life, recycled content, refurbishing, reuse), the compliance year it counts for, the year generated (for validity), tonnes, price, certificate no., recycler and registration |
| Recycler / processor | certificates generated (year generated), and sold (year sold, buyer, price). No more can be sold than are in stock, and a generated certificate cannot be removed while sales draw on it |

A certificate number is recorded once per stream. For tyres, choose the end product (each has a weightage).

## Annual return

Click a year's **Return** to record its status, the date filed and the acknowledgement, with the evidence from the Document vault. A filed return locks that year's quantities. Set it back to *in progress* to change them. A stream with a filed return cannot be deleted: set it inactive instead.

## Compliance desk

With the Compliance desk, two regulations read from EPR:

- **India EPR:** annual returns (done when every India producer stream has filed) and targets met (done when no stream is short).
- **EU PPWR:** registration in each member state (done when every EU stream has a registration) and reporting.

## Excel

**Position (Excel)** gives the year's position per stream, the quantities by year, every certificate and the method.

## Trying it

`npm run demo:epr` creates *Sahyog Consumer Goods Ltd (demo)*, an Indian food and kitchen-appliance company. It has:

- plastic packaging Categories I (food contact, with a recycled-content gap), II (return in progress) and III (a shortfall carried);
- mixer grinders under e-waste;
- snacks sold in Germany and the Netherlands (the Netherlands not yet registered);
- a flexible-film recycling plant selling certificates;
- the UAE pilot, typed.

Logins `epr@sahyog.demo` (super admin), `finance@sahyog.demo` (admin), `compliance@sahyog.demo` (manager), `packaging@sahyog.demo` (preparer), with the password printed once. All figures are **invented**.

Every change is in the audit log.

# QR & field app

Waste weighed or checked at the bin, by the people who handle it, rolled up into the month's waste entries (Scope 3.5, waste sent out). Menu → Capture → **QR & field app**.

```flow
> 1 · Set up the bin | facility, name, location, material and usual disposal method, hazardous, contractor, container size and density — print its QR label
> 2 · Scan | the phone camera opens the scan page; sign in once on the phone; the bin, facility and material are filled in
> 3 · Record | Weigh (kg, actual) · Fill level (% × capacity × density, estimated) · Collection (manifest number, weighbridge weight)
> 4 · Checks | more than the bin holds · the same bin scanned again within 10 minutes · far from the bin's usual weight
> 5 · Month roll-up | per bin the weighbridge weights of the month's collections when there are any, else the scans; grouped by material, method, hazardous and contractor
> 6 · Drafts → approval | draft waste entries (weighed and estimated kept apart, with the manifests); check against the contractor's statement; submit as usual
```

## Bins & labels

**Add a bin** (managers, admins, super admin): name and location, the **material** and its **usual disposal method** (the same list as Waste → sent out), **hazardous** (filled in from the material), the **contractor**, the **container** (120 L to a 30 m³ compactor) and the **density** in kg per litre — used only to estimate the weight from the fill level. Typical densities are suggested: food and organic about 0.5, glass 0.3, mixed waste 0.15, metal cans 0.1, paper and card 0.06, plastics 0.04, construction 1.2.

**Print labels** (one bin or all of the facility): each label has the QR code, the bin's name, facility, material and method, a HAZARDOUS mark when it applies, and a short code. The QR holds only a link with the code (`/scan/<code>`) — no data. Opening it needs a signed-in person with access to the facility, so a label photographed by someone else opens nothing. A removed bin's label stops working.

## Scanning (on the phone)

Point the phone camera at the label and open the link. The first time, sign in; the phone stays signed in. Then choose:

| | What you enter | Counted as |
|---|---|---|
| **Weigh** | the weight in kg (bin scale or hand scale) | actual |
| **Fill level** | how full the bin is (slider or 25 / 50 / 75 / 100 %) | estimated: capacity × % × density |
| **Collection** | the manifest / transfer note number (required for hazardous waste) and the weighbridge weight when the ticket has it | actual; replaces the month's field scans for that bin |

Add a note if needed, and tick **Add my location** to store where the scan was made (asked each time; never stored otherwise). With no connection the scan is kept on the phone and sent when it is back online.

## Scans

The month's scans for a facility: when, bin, type, kg (estimated marked), manifest, the checks raised, who, and status — **Open**, **In an entry** (rolled up) or **Removed**. Remove a wrong scan while it is open; once in an entry, change the entry instead.

## Month roll-up

**By bin:** weighed and estimated kg, number of scans and manifests, and the basis — **weighbridge** when the month has collections with a weight for that bin (they replace the field scans), else **field scans**.

**Entries to be made:** one per material, disposal method, hazardous and contractor — weighed and estimated kept as separate entries, so the data quality is right. **Create draft entries** saves them under Waste → sent out (Scope 3.5) with the contractor and the manifests, and marks the scans as used (a scan is used once). Check the totals against the contractor's monthly statement, then submit for approval from Entries & results. Hazardous waste without a manifest is saved but cannot be submitted until the manifest number is added.

## Waste contractors (contractor portal)

Collection and treatment companies record their own collections and send a monthly statement — without a user account. QR & field app → **Contractors**.

**Give access** (managers, admins, super admin): the contractor's name **as written on its bins** (its bins are linked by that name), the work email, a contact, and how long the code is valid (3–24 months). An **access code** is shown once: give it privately (by phone, not in the same email as the link). Ekotrace keeps only a scrambled form of it. **New code** replaces it (the old one stops working at once); **Remove access** ends it and signs the contractor out.

**The contractor** opens **/contractor** (also linked on the sign-in page as "Waste contractor?"; a bin's QR label opened without signing in leads there with that bin chosen), signs in with the email and code (8 hours), and sees **only the bins assigned to it**:

| Tab | What the contractor does |
|---|---|
| **Collections** | per collection: bin, date, **weighbridge weight**, **manifest** number (required for hazardous waste; the same manifest twice is refused), vehicle, the **ticket or manifest** as a PDF or photo (up to 10 MB), note. Withdraw one while it is not yet in the site's figures |
| **Monthly statement** | tonnes per site, material and method of its bins — filled in from its collections, to be corrected to its records — with the statement or treatment certificate and a note. It can be corrected until accepted |
| **Your bins** | the bins assigned, with their label codes |

A collection recorded by the contractor is a **collection scan** of the bin: its weighbridge weight replaces the site's own scans of that bin in the month roll-up, and a collection without a ticket is marked "No ticket attached".

**Monthly statements** (QR & field app → Contractors): for the month, each contractor's tonnes against Ekotrace's own (weighbridge weights of collections, else the scans), per site, material and method; gaps over **±10%** are flagged. Open the statement file, then **Accept**, or **Query** with what does not match — the contractor sees the query and sends the statement again. An accepted statement is locked.

Nothing a contractor sends goes into the emissions by itself: collections reach the inventory only through the month roll-up (draft entries) and approval by a BEEAH person — the maker–checker split. Every sign-in, upload, collection and statement is in the audit log under the contractor's name.

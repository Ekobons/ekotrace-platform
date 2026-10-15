# Product LCA

Menu → Product LCA → **Product footprints** works out the carbon footprint of a product, per tonne (or kg, piece, litre, m³, kWh), following **ISO 14067** and the **GHG Protocol Product Standard**. It is used for two things:

- **Your own products**, such as recycled aggregate, crumb rubber or recycled pellet: a footprint to give to customers, to put in a tender, or to compare production options.
- **Your suppliers' products**, such as rebar or cement bought by the tonne: once published, the footprint becomes that supplier's factor, so purchases of the product are calculated with it instead of a spend-based factor.

```flow
> 1 · Goal & scope | product, declared unit, boundary, supplier (if it is theirs)
> 2 · Inventory | materials, packaging, energy, transport, use and end of life, per declared unit
> 3 · Review | the author sends it for review; a second person verifies or returns it
> 4 · Publish | a super admin or admin publishes it as version 1, 2, 3…
> 5 · Use | a supplier's product becomes their factor; purchases are recalculated
```

## The tabs

| Tab | What it is for |
|---|---|
| Products | every product modelled, with its footprint, a bar of the life-cycle stages, data quality and status; the footprints compared; which supplier products are used for purchases |
| LCA workspace | one product, in seven steps from goal & scope to review, with the result, the hotspots and ecodesign levers beside it |
| Life-cycle inventory | all the inputs of the product grouped by stage, and the factor library |
| Scenarios | what-if versions of the product (another material, energy source, amount or factor) compared with the current model |
| Published factors | the published footprints, their version, who verified and published them, and how many purchase lines use them |

Choose the product at the top right of the workspace, inventory and scenarios tabs.

## 1 · Goal & scope

**+ New product**, or **Edit goal & scope** in the workspace.

| Field | Notes |
|---|---|
| Product name, description | e.g. "Recycled aggregate 0–40 mm" |
| Supplier | leave empty for your own product. Choose the supplier when it is their product: once published, its footprint is used for purchases from them |
| Spend category | for a supplier's product, optional: limit the factor to purchases in this category. Empty: everything bought from the supplier with a quantity in the declared unit |
| Declared unit | what the footprint is per: t, kg, pcs, L, m3 or kWh. All amounts in the inventory are per one declared unit |
| Functional unit | in words, e.g. "1 tonne of recycled aggregate at the plant gate" |
| System boundary | **Cradle-to-gate** (raw materials, packaging, manufacturing, transport: the usual choice and the one used for purchases), **Cradle-to-grave** (adds use and end of life), **Gate-to-gate** (only your own process and packaging) |
| Standard, allocation, cut-off, reference year | recorded with the footprint and printed on every published version |

**Copy as a new product** starts a new model with the same inventory, for a variant.

## 2 · The inventory

Steps 2 to 6 of the workspace hold the inputs, one stage at a time: bill of materials, packaging, manufacturing energy, transport legs, use and end of life. Each input is:

| | |
|---|---|
| Amount and unit | per declared unit, e.g. 1,050 kg of feedstock, 4.2 kWh, 26 t-km |
| Factor | a **library factor**, or **your own value** in kg CO₂e per unit (from the supplier, an EPD, a measurement) |
| Data quality | **Verified** (third-party checked), **Measured** (meters, weighbridge), **Supplier-specific**, or **Estimated** |
| Source | where the figure comes from: meter, invoice, EPD number… |

The result is amount × factor, added up. Inputs in stages outside the boundary are kept in the model, shown greyed out, and not counted.

**Waste used as a raw material** (C&D waste, end-of-life tyres, plastic bales) enters **burden-free** under the cut-off approach: its factor is 0, and the work of collecting and processing it is counted in transport and manufacturing.

### Importing a bill of materials

**Import bill of materials** takes a CSV or text file, or lines pasted from Excel, one input per line:

```
input,stage,amount,unit,kgCO2e_per_unit
Steel scrap,raw,1080,kg,
Rolling mill electricity,manufacturing,120,kWh,0.4041
Woven PP bulk bag,packaging,1,unit,
```

Stages can be written as Raw materials, Packaging, Manufacturing, Transport, Use or End of life. When the factor is blank the input is **matched to the library by name**. When a name could match several factors (e.g. "Steel"), the higher one is taken, as a conservative choice. **Check** shows what will be imported and why a line cannot be; **Import** adds the good lines, or replaces the whole inventory if you tick the box.

## The result

Beside every step of the workspace:

- **Footprint**: kg CO₂e per declared unit, split by stage, with the **data-quality score**. The score is the emissions-weighted average of Verified 100 %, Measured 90 %, Supplier-specific 80 % and Estimated 50 %.
- **Hotspots**: the six largest inputs and their share of the footprint.
- **Ecodesign levers**: for each input, the lowest library factor for the same material, stage and unit (primary to recycled steel, grid to solar electricity, virgin to recycled HDPE), and what it would save. **Try as scenario** opens a scenario with that change.

## Scenarios

**+ New scenario** lists every input. For each one you can choose another library factor, a new amount or a new factor. The total updates as you type. Scenarios are compared with the current model, in a table and in bars by stage. They never change the model itself.

## 3 · Review and verify

Step 7 of the workspace shows the checks before review:

- the share of the footprint from **indicative** library factors (see below);
- the share from estimated data;
- the data-quality score;
- who edited, sent, verified and published the model, and when.

| Who | Can |
|---|---|
| Super admin, admin, manager, preparer | build and change models; send a draft for review |
| Super admin, admin, verifier | verify, or return with a note saying what to change. **Not** the person who last edited the model or sent it |
| Super admin, admin | publish a verified model |
| Platform staff | cannot verify a company's footprint |

Anyone who can verify is notified when a model is sent. The author is notified when it is verified or returned.

## 4 · Publish

**Publish** saves the model as the next version: the footprint, the split by stage and every input as they were. The versions are listed under step 7.

For a **supplier's product**, publishing writes the footprint as that supplier's factor, per declared unit, with the source "Product LCA: name vN (standard, boundary, year; verified by …)". Purchases from that supplier that are not yet published are recalculated straight away. Lines with a quantity in a mass unit (t, kg) use it when the declared unit is t. Version 2 replaces version 1's factor in the same place. Published purchase batches keep their results until they are reopened.

**After publishing**, any change to the scope, an input or a company factor it uses returns the model to **draft**, marked **republish**. The published factor stays in use until the next version is verified and published. A published product cannot be removed, and the supplier of a published product cannot be changed: copy it as a new product instead.

## The factor library

Life-cycle inventory → **Factor library** lists the factors in kg CO₂e per unit, by stage.

- The **shared rows are indicative** (marked in amber). They are a starting point for screening and demonstration, not licensed data. Replace them before a footprint is disclosed, used in a claim or used for purchases: with licensed **ecoinvent** or **EF 3.1** data, EPDs (ISO 14025 / EN 15804), or your own measurements.
- **+ Company factor** (super admin, admin, manager) adds your company's own factor with its source. Other companies never see it. When you change one, the models that use it take the new value and return to draft. A factor that is in use is retired instead of deleted.
- The UAE grid factor in the library is indicative too. Use the grid factor your company reports with (Methodology & boundaries) for a footprint you publish.

## Good practice

- Keep the boundary **cradle-to-gate** for anything used as a supplier factor: that matches Scope 3 Category 1 (purchased goods).
- Model per **1 tonne** (or one piece) and enter every input for that one unit, including process losses (e.g. 1,080 kg of scrap per tonne of rebar).
- Aim for a data-quality score above 80 % and less than half the footprint from indicative factors before publishing.
- Write the data sources in each input and the assumptions in the notes: the verifier and your customers will ask.

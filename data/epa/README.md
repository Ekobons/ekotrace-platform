# Spend-based factors (purchased goods & services)

`SupplyChainGHGEmissionFactors_v1.3.0_NAICS_CO2e_USD2022.csv` — US EPA, "Supply Chain Greenhouse Gas Emission
Factors for US Industries and Commodities" v1.3, by 2017 NAICS-6 (1,016 commodities): kg CO2e per 2022 USD,
purchaser price. US Government work (public domain). Loaded by `npm run db:seed` (the factors *with margins*).

`DEMO_placeholder_factors_USD2022.csv` holds **made-up values** (real NAICS codes and titles). It is only used by
the demo when no EPA file is loaded, as source "DEMO-SPEND", and is retired automatically when the EPA file is loaded.

The products of the previous Ekotrace list (`../ekotrace-old/products.csv`) are loaded on top, each with the EPA
factor of its NAICS code.

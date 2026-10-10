# Spend-based factors (purchased goods & services)

Put the US EPA file here and run `npm run db:seed`:

    SupplyChainGHGEmissionFactors_v1.3.0_NAICS_CO2e_USD2022.csv

from "Supply Chain Greenhouse Gas Emission Factors v1.3 by NAICS-6" (US EPA, public domain).
Or upload it under Library → Factors → Import (platform admin).

`DEMO_placeholder_factors_USD2022.csv` holds **made-up values** for the demo company only
(real NAICS codes and titles, numbers NOT from EPA). It is loaded as source "DEMO-SPEND" only
while no EPA file is loaded, and its factors are retired automatically when the EPA file is imported.

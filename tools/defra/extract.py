"""
Extract stationary-combustion factors from DEFRA/DESNZ flat files.

Output: one row per (year, fuel, unit) with
  kgco2e   Scope 1 total (kg CO2e per unit)
  co2, ch4, n2o   gas split (kg CO2e per unit)
  wtt      well-to-tank, Scope 3 category 3 (kg CO2e per unit)
  biogenic biogenic CO2 "outside of scopes" (kg CO2 per unit), bioenergy only

Sources inside each file:
  Scope 1 / Fuels      (Gaseous, Liquid, Solid)
  Scope 1 / Bioenergy  (Biofuel, Biomass, Biogas)
  Scope 3 / WTT- fuels, WTT- bioenergy
  Outside of Scopes / Outside of scopes  (Biofuel, Biomass, Biogas)
"""
import sys, json, re, glob
import pandas as pd
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from load import load

UNIT = {'tonnes': 't', 'litres': 'L', 'cubic metres': 'm3', 'kg': 'kg', 'GJ': 'GJ',
        'kWh (Net CV)': 'kWh_net', 'kWh (Gross CV)': 'kWh_gross', 'kWh': 'kWh'}
CLASS = {'Gaseous fuels': 'Gaseous fuels', 'Liquid fuels': 'Liquid fuels', 'Solid fuels': 'Solid fuels',
         'Biofuel': 'Biofuel', 'Biomass': 'Biomass', 'Biogas': 'Biogas',
         'WTT- biofuel': 'Biofuel', 'WTT- biomass': 'Biomass', 'WTT- biogas': 'Biogas'}


def gas(label: str):
    label = label.lower()
    for g in ('co2', 'ch4', 'n2o'):
        if f'of {g}' in label:
            return g
    return 'kgco2e' if label.startswith('kg co2e') else None


def extract(path: str):
    d = load(path)
    year = int(re.search(r'(20\d\d)', path.split('/')[-1]).group(1))
    rows = {}

    def put(cls, fuel, unit, key, val):
        if pd.isna(val):
            return
        r = rows.setdefault((cls, fuel, unit), {'year': year, 'class': cls, 'fuel': fuel, 'unit': unit})
        r[key] = float(val)

    for _, x in d.iterrows():
        l1, l2, fuel, uom = x['Level 1'], x['Level 2'], x['Level 3'], x['UOM']
        unit = UNIT.get(uom)
        if unit is None or not fuel:
            continue
        if x['Scope'] == 'Scope 1' and l1 in ('Fuels', 'Bioenergy'):
            g = gas(x['GHG/Unit'])
            if g:
                put(CLASS[l2], fuel, unit, g, x['value'])
        elif x['Scope'] == 'Scope 3' and l1 in ('WTT- fuels', 'WTT- bioenergy'):
            put(CLASS[l2], fuel, unit, 'wtt', x['value'])
        elif x['Scope'] == 'Outside of Scopes' and l2 in ('Biofuel', 'Biomass', 'Biogas'):
            put(l2, fuel, unit, 'biogenic', x['value'])
    # Rows that only carry a WTT/biogenic value for a unit with no Scope 1 factor are kept:
    # they are flagged later, not dropped silently.
    return list(rows.values())


if __name__ == '__main__':
    out = []
    for f in sorted(glob.glob(sys.argv[1] + '/*.xlsx')):
        out += extract(f)
    df = pd.DataFrame(out)
    df.to_csv(sys.argv[2], index=False)
    print(df.groupby(['year', 'class']).fuel.nunique().unstack().to_string())
    print(len(df), 'rows')

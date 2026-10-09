"""Read a DEFRA/DESNZ flat file into a tidy DataFrame (one row per factor)."""
import pandas as pd, re, sys
def load(path):
    raw = pd.read_excel(path, sheet_name='Factors by Category', header=None)
    hdr = raw.index[raw.apply(lambda r: 'Scope' in list(r.astype(str)) and 'UOM' in list(r.astype(str)), axis=1)][0]
    df = raw.iloc[hdr+1:].copy(); df.columns = [str(c).strip() for c in raw.iloc[hdr]]
    val = [c for c in df.columns if c.startswith('GHG Conversion Factor')][0]
    df = df.rename(columns={val: 'value'})
    keep = ['Scope','Level 1','Level 2','Level 3','Level 4','Column Text','UOM','GHG/Unit','value']
    df = df[[c for c in keep if c in df.columns]].dropna(subset=['Scope'])
    for c in keep[:-1]:
        df[c] = df[c].astype(str).str.strip().replace({'nan': ''})
    df['value'] = pd.to_numeric(df['value'], errors='coerce')
    return df

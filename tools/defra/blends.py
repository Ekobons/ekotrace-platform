"""Blend compositions (ASHRAE 34, % by mass). Verified against DESNZ AR4 (2022)
and AR5 (2026) blend totals; only blends that reproduce DESNZ within 1 % are kept."""
import sys, csv, json
sys.path.insert(0,'scripts')
from load import load
B = {
 'R401A': {'HCFC-22':53,'HFC-152a':13,'HCFC-124':34},
 'R402A': {'HFC-125':60,'R290':2,'HCFC-22':38},
 'R404A': {'HFC-125':44,'HFC-143a':52,'HFC-134a':4},
 'R407A': {'HFC-32':20,'HFC-125':40,'HFC-134a':40},
 'R407B': {'HFC-32':10,'HFC-125':70,'HFC-134a':20},
 'R407C': {'HFC-32':23,'HFC-125':25,'HFC-134a':52},
 'R407F': {'HFC-32':30,'HFC-125':30,'HFC-134a':40},
 'R408A': {'HFC-125':7,'HFC-143a':46,'HCFC-22':47},
 'R409A': {'HCFC-22':60,'HCFC-124':25,'HCFC-142b':15},
 'R410A': {'HFC-32':50,'HFC-125':50},
 'R410B': {'HFC-32':45,'HFC-125':55},
 'R417A': {'HFC-125':46.6,'HFC-134a':50,'R600':3.4},
 'R422A': {'HFC-125':85.1,'HFC-134a':11.5,'R600a':3.4},
 'R422D': {'HFC-125':65.1,'HFC-134a':31.5,'R600a':3.4},
 'R427A': {'HFC-32':15,'HFC-125':25,'HFC-143a':10,'HFC-134a':50},
 'R434A': {'HFC-125':63.2,'HFC-143a':18,'HFC-134a':16,'R600a':2.8},
 'R437A': {'HFC-125':19.5,'HFC-134a':78.5,'R600':1.4,'R601':0.6},
 'R438A': {'HFC-32':8.5,'HFC-125':45,'HFC-134a':44.2,'R600':1.7,'R601a':0.6},
 'R442A': {'HFC-32':31,'HFC-125':31,'HFC-134a':30,'HFC-152a':3,'HFC-227ea':5},
 'R500':  {'CFC-12':73.8,'HFC-152a':26.2},
 'R502':  {'HCFC-22':48.8,'CFC-115':51.2},
 'R503':  {'HFC-23':40.1,'CFC-13':59.9},
 'R507A': {'HFC-125':50,'HFC-143a':50},
 'R508A': {'HFC-23':39,'PFC-116':61},
 'R508B': {'HFC-23':46,'PFC-116':54},
}
gases = {r['code']: r for r in csv.DictReader(open(sys.argv[1]))}
ok, bad = {}, []
for y, f, col in [(2022,'raw/ghg-conversion-factors-2022-flat-format.xlsx','AR4'),(2026,'raw/ghg-conversion-factors-2026-flat-format-revised.xlsx','AR5')]:
    d = load(f); r = d[d['Level 1'].str.contains('Refrigerant', case=False) & (d['Level 2']=='Blends')]
    kyo = dict(zip(r[r['Column Text'].str.contains('only Kyoto')]['Level 3'], r[r['Column Text'].str.contains('only Kyoto')]['value']))
    tot = dict(zip(r[r['Column Text'].str.startswith('Total')]['Level 3'], r[r['Column Text'].str.startswith('Total')]['value']))
    for name, comp in B.items():
        assert abs(sum(comp.values()) - 100) < 1e-6, name
        k = sum(p/100*float(gases[g][col]) for g, p in comp.items() if gases[g]['kyoto']=='1')
        t = sum(p/100*float(gases[g][col]) for g, p in comp.items())
        dk, dt = kyo.get(name), tot.get(name)
        good = (dt == dt and abs(t-dt) <= max(1, 0.01*dt)) and ((dk != dk and k < 1) or (dk == dk and abs(k-dk) <= max(1, 0.01*dk)))
        if not good: bad.append((name, y, round(k,1), dk, round(t,1), dt))
        ok.setdefault(name, True); ok[name] &= good
keep = {n: c for n, c in B.items() if ok[n]}
print('dropped:', bad)
json.dump({n: {g: p/100 for g, p in c.items()} for n, c in keep.items()}, open(sys.argv[2], 'w'), indent=1)
print(len(keep), 'blends verified')

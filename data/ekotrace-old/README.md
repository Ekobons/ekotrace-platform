# Purchased-goods list of the previous Ekotrace

`products.csv`: the 1,645 products of the previous platform (product, NAICS code, type of purchase,
category, subcategory, "other category" flag), taken from its tables `purchase_goods_categories_ef`,
`purchase_category`, `purchase_subcategory` and `typesofpurchase` (export of October 2026).

Loaded by `npm run db:seed` after the EPA file: each product becomes a spend category with the EPA v1.3
factor of its NAICS code. Not taken over: the per-currency factors (EPA per-USD factor at one rate per
country and year, no inflation adjustment — Ekotrace now converts each purchase) and the per-kg factors
(inconsistent across countries and years).

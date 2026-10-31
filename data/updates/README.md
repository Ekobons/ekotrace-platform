# Weekly updates

One file per week, named `<YYYY-MM-DD>.json` (the Monday of the week), written by the weekly research run. The server loads new or changed files at every start and shows them to the platform admin under **Weekly updates**. Nothing is applied until the platform admin decides.

```json
{
  "week": "2026-10-26",
  "summary": "One or two sentences on the week.",
  "items": [
    {
      "key": "fx-2026-09",
      "stream": "fx",
      "title": "September 2026 monthly average exchange rates",
      "detail": "What changed, in plain words.",
      "impact": "What it changes in the tool.",
      "published": "2026-10-05",
      "sources": [{ "title": "Federal Reserve G.5 (FRED)", "url": "https://fred.stlouisfed.org/" }],
      "whereTo": "",
      "apply": { "kind": "fx", "rows": [{ "currency": "EUR", "month": "2026-09", "perUsd": 0.8541, "source": "Federal Reserve G.5, monthly average of daily noon buying rates (FRED EXUSEU)" }] }
    },
    {
      "key": "cpi-2026-09",
      "stream": "cpi",
      "title": "CPI-U September 2026 released",
      "detail": "Monthly index 3xx.xxx. The annual average used by the tool is published in January.",
      "whereTo": ""
    },
    {
      "key": "desnz-2026-errata-1",
      "stream": "factors",
      "title": "DESNZ 2026 conversion factors: errata",
      "detail": "…",
      "whereTo": "Emission factors → Sources & import"
    }
  ],
  "linkedin": [
    { "key": "li-2026-10-26-1", "title": "Short title", "body": "Post text, 120–200 words." }
  ]
}
```

Rules
- `key`: lower-case letters, digits, `.`, `_`, `-` (2–80 characters), unique across all weeks. Reusing a key updates that item's wording but keeps the decision already taken.
- `stream`: `factors`, `cbam`, `cpi`, `fx`, `tech`, `market`, `regulation` or `standards` (GHG Protocol, ISO 14064/14067, SBTi, PCAF — methodology changes; `impact` says which part of EKOTRACE's calculation or reporting it touches, e.g. Scope 2 market-based, category 3, biogenic CO₂, removals).
- `apply` only for data the tool takes directly:
  - `{"kind":"fx","rows":[{currency, month "YYYY-MM", perUsd (units of the currency per 1 USD), source}]}` — monthly averages, written as shared rates. Same source as the rates already loaded: Federal Reserve G.5 via FRED. USD-pegged currencies (AED, SAR, QAR, OMR, BHD) are not needed.
  - `{"kind":"cpi","rows":[{region "US", year, value, source}]}` — the CPI-U **annual average** only (the tool converts by year).
  - Anything else (factor files, CBAM default values, news) has no `apply`; `whereTo` names the screen.
- Dates `YYYY-MM-DD`; sources must be pages actually opened.

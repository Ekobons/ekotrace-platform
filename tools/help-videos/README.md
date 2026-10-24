# Help videos

Short screen recordings for the user manual. No sound: captions on screen, a visible cursor, a title card at the start and the end. A script drives the real app with Playwright, the recording is cut and converted to MP4, and a poster frame (JPG) is taken. The files go to `apps/web/public/help/<name>.mp4|.webm|.jpg` (H.264 MP4, and VP9 WebM for browsers without H.264), are shipped with the app, and are shown in the manual with a block:

````
```video data-entry-bills
Upload utility bills | 1 min
```
````

## The videos

| Script | Video | Shows |
|---|---|---|
| `01-months.mjs` | `data-entry-months` | several months side by side, How?, submit |
| `02-paste.mjs` | `data-entry-paste` | a column pasted from Excel into the month rows |
| `03-bills.mjs` | `data-entry-bills` | PDF bills: upload, check, preview, publish |
| `04-meters.mjs` | `data-entry-meters` | API batches; readings pasted into a meter, months and entries |
| `05-fleet.mjs` | `data-entry-fleet` | the fleet × months grid, a block pasted from Excel |
| `06-vehicle-paste.mjs` | `data-entry-vehicle-paste` | vehicle rows in everyday words |
| `07-purchases.mjs` | `data-entry-purchases` | a purchase file: columns, review by impact, summary, publish |
| `08-smart-import.mjs` | `data-entry-smart-import` | a site spreadsheet: layout, matching, create and submit |
| `09-submit-approve.mjs` | `data-entry-submit-approve` | draft → submit → approve or send back |

A script exports `name`, `title`, `subtitle`, `run(v)` and optionally `setup(v)` (data the video needs, made through the API before the cut point). The helpers on `v` are in `lib.mjs`: `go`, `say` (caption), `point`, `click`, `type`, `select`, `upload`, `paste`, `excel` / `excelClose` (a spreadsheet drawn over the page), `scroll`, `top`, `facility`, `api`, `pdfAsImage`.

## Files used

`files/` holds what the videos upload. All of it is **invented** and marked DEMO: a fictional utility (“Harbourline Power & Water”), fictional suppliers and made-up figures. Never use a real utility's or supplier's name or layout with made-up figures. Regenerate them with:

```
node tools/help-videos/make-files.mjs
```

## Recording

1. Use a **disposable copy** of a database with the sample (demo) company, never one with client data. The videos use the facility *Al Qusais Packaging Plant* with no data for July–September 2026; each video should start from a fresh copy, because the scripts add meters, vehicles and entries.
2. Run the app against that copy, then:

```
APP_URL=http://localhost:4100 VIDEO_EMAIL=<sample super admin> VIDEO_PASSWORD=<its password> \
  PLAYWRIGHT_MODULE=<path to playwright/index.js> CHROMIUM_PATH=<chromium> \
  node tools/help-videos/record.mjs [name …]
```

Needs Playwright with a Chromium, `ffmpeg` (libx264) and `pdftoppm` (poppler) on the PATH. Recording one video takes one to two minutes; the result is about 1–2 MB per format.

3. Watch the result (or a contact sheet of frames) before committing: a changed screen may need a changed script.

When a screen changes, re-record its video so the manual matches the version in use.

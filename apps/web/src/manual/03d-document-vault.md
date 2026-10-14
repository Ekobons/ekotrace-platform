# Document vault

Every file of the company in one place — bills, invoices, delivery notes, permits, certificates, contracts, calibration records — filed by facility and period, and linked to the entries it supports. Menu → Capture → **Document vault**.

```flow
> 1 · File it | upload here, or attach it straight from an entry (Entries & results, Approvals); bills, purchase files, contractor tickets and the assurance statement appear by themselves
> 2 · Describe it | type, facility (or company-wide), period covered, valid until, data category, tags, note
> 3 · Link it | to the entries it supports — one file can support many entries, an entry can have many files
> 4 · Review | the approver and the verifier open the entry and see its evidence beside the calculation
> 5 · Keep it | versions, expiry reminders, archive with a reason; kept for the retention period
```

## What is in it

| From | What | Changed where |
|---|---|---|
| Uploaded here, or attached to an entry | any file | here |
| Bills | utility bills (PDF) — they support the entries made from their meter's readings | Bills |
| Purchases | the spend files uploaded | Purchases |
| Waste contractor portal | tickets, manifests and statements sent by contractors | Waste contractors |
| Audit & assurance | the signed assurance statement | Audit & assurance |

Accepted: PDF, PNG, JPEG, WEBP, Excel (XLSX, XLS), Word (DOCX, DOC), PowerPoint, CSV, text, emails (EML, MSG); up to 25 MB each, up to 30 at a time. Files are checked by their content, not just their name. The same file is never stored twice: uploading it again links the existing one instead.

**Types:** utility bill · invoice / receipt · supplier or contractor statement · waste manifest / ticket · meter photo / reading sheet · permit & licence · certificate (energy attributes, ISO, treatment) · contract / PPA · calibration record · refrigerant service log · travel booking / report · data file · policy / procedure · assurance / verification · other.

## Finding a file

The tiles at the top are also filters: **Files** (all, with the space they take), **Expiring in 60 days · expired** (anything with a *valid until* date), **Uploaded, not linked to an entry** (invoices, bills, logs and reports still waiting for their entry — permits, certificates, contracts, policies and calibration records do not need one), and **Kept for** (the retention period). Filter by facility, type, year and month (the period a file covers), or search names, titles, tags and notes. Click a file to see it beside its details.

## Evidence on an entry

Open an entry in **Entries & results** or **Approvals**: under the calculation, **Evidence** lists

- the files linked to the entry,
- the **bills of its meter** for the period (entries made from meter readings),
- **collection scans** with their tickets (waste entries rolled up from QR scans).

**+ Attach a file** uploads a file and links it in one step; it is filed under the entry's facility and period. **Unlink** removes the link — the file stays in the vault.

Entries with evidence count in the Home **Backed by evidence** tile, in the data-quality report and in **Audit & assurance** (the evidence share and the sample).

## Changing a file

- **Edit details** — type, facility, period, valid until, category, tags, note.
- **Upload a new version** — for a corrected invoice or a renewed permit: the new file takes over the details and the links; the old one is kept and marked replaced (Versions shows the chain).
- **Archive** — with a reason (uploaded twice, wrong facility…). Archived files are hidden, kept, and can be restored. A file that supports an **approved** entry cannot be archived: it is that entry's evidence. Upload a new version if it was wrong.
- **Delete for good** — super admin only, for an archived file past its retention date that supports no entry.

Files kept by other screens (bills, purchase files, contractor tickets, the assurance statement) are changed where they were added.

## Locked months

In a month locked for assurance, evidence can be **added** to an entry (the verifier often asks for more) but not **removed** — the database refuses it.

## Who can do what

| Role | Sees | Can |
|---|---|---|
| Super admin | everything | upload (any facility or company-wide), link, edit, version, archive, delete for good, set the retention period |
| Admin | files of their facilities and company-wide files; purchase files and assurance papers | upload (their facilities or company-wide), link, edit, version, archive |
| Manager, data preparer | files of their facilities and company-wide files | upload for their facilities, link to their entries, edit, version, archive |
| Verifier | everything | read and download only |

Every upload, view, download, link, change, archive and deletion is in the audit log.

## Retention

Files are kept for the company's retention period — **7 years** by default, counted from the end of the period a file covers (or from when it was added). The super admin can change it (1 to 30 years) on the **Kept for** tile. Use the longest period any rule you report under asks for.

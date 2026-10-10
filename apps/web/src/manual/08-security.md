# Security

How Ekotrace protects the company's data, layer by layer, and the safety checks built into data entry, meters, bills and the API. The controls follow OWASP guidance and the client's web application security standard.

## Layers of protection

```layers
Connection | HTTPS on servers (HSTS); security headers on every response: Content-Security-Policy (only the platform's own scripts run), no framing by other sites, no content sniffing, strict referrer
Login | passwords of 12+ characters, hashed with scrypt (OWASP settings) — never stored readable; 5 wrong passwords lock the account for 15 minutes; temporary passwords shown once and changed at first login
Session | random token in an http-only cookie (scripts cannot read it, never in a URL); only its fingerprint is stored; ends after 30 minutes without activity, after 12 hours at most, and at logout
Requests | changes are accepted only as JSON or file uploads (a form on another website cannot post to Ekotrace); every input checked against a schema; errors never show internal details
Roles | each request checked on the server: who may see, enter or manage which facility (see Getting started → Roles)
Company separation | the database itself keeps each company's rows apart (row-level security, forced for every connection): a query for one company cannot return another's data
Audit | every login (and failed attempt), change, recalculation, upload, booking and API batch is recorded with who, when and from where
```

## Data separation between companies

Every table holding company data carries the company id, and PostgreSQL row-level security is switched on and **forced** for all of them: each request runs inside a transaction that can see only its own company. This is tested automatically — a second company sees no entries, meters, readings, bills, certificates, sites or API clients of the first, even when it asks for them by id.

## Safety checks in data entry

```flow
! Calculated before saving | the result, the factor and any warning are shown before Save
! Duplicates flagged | month by month marks months that already have the same entry
! Certificates claimed once | each MWh of an I-REC / REC / PPA can be claimed once; claims are locked while saving, so two people cannot claim the same MWh at the same moment
! Factor history kept | corrections create new versions; entries keep the factor they used until recalculated (logged with old and new totals)
! Bookings traceable | every entry stores its inputs, factor, source and steps
```

## Safety checks for meters and bills

```flow
! Readings checked one by one | unknown meter, bad time, future time or negative consumption: that reading is refused with the reason, the rest are stored
! Corrections recorded | the same meter and time again replaces the value; logged
! Gaps and resets visible | coverage per month, estimates marked, resets and rollovers flagged
! Approved months locked | new readings or bills never change an approved entry; the difference is reported
! Bills: person in the loop | a bill is booked only after a person confirms its figures against the PDF
! Bills: one per period | overlapping bills for the same meter are refused
! Files checked | PDF only, 15 MB at most, same file recognised; read without running any code from the file (PDF.js 6, no fonts, no forms)
! Files stay inside | bills are stored in the company's own, separated data and shown only to people allowed to see that facility
```

## Safety checks for purchases

```flow
! Files checked | Excel or CSV only, 60 MB at most, read row by row without running anything from the file
! Duplicates | the same file is refused unless uploaded on purpose; lines seen before are marked and not counted
! Lines checked one by one | problems listed with the reason; good lines continue
! Facility rights | lines are published only for facilities the person may enter data for
! Published lines locked | changes need the batch reopened; approved entries are never removed
! Remembered choices visible | every remembered mapping is listed with who made it, and can be removed
```

## API security (systems sending readings)

```flow
> Client registered | a super admin creates one API client per sending system; the secret is shown once, only its fingerprint is kept
> Token | the system exchanges client id + secret for an access token valid 1 hour (OAuth 2.0 client credentials)
! Every call checked | valid token, client not revoked, company active, permission for what it sends (meter readings, purchase lines)
! Rate limit | 120 calls a minute per client; readings sent in batches (up to 100,000 per call)
! Validated | each reading checked against the schema; meters matched only within the client's own company
> Logged | each batch recorded: client, readings received, stored, corrected, refused
* Revoke | a super admin can revoke a client at once — its tokens stop working
```

## Responsibilities

| Area | Ekotrace (the application) | Hosting / deployment | The company |
|---|---|---|---|
| Access | roles, scopes, lockout, sessions | network rules, HTTPS certificate | who gets which role; leavers disabled promptly |
| Data | company separation, audit log, versioned factors | encryption at rest, backups, disaster recovery, data residency | approving data, keeping evidence |
| Integrations | OAuth clients, rate limits, validation | firewall to the sending systems | keeping client secrets safe; revoking unused clients |
| Software | dependencies pinned and checked for known vulnerabilities at each release | patching the servers | — |

## Decisions with security in mind

- **No email intake** of bills for now (mailbox access, phishing and malicious attachments) — upload in one place instead.
- **No AI service** receives company data unless the company approves the service and its location. Purchase mapping works without AI (remembered choices and text matching on the server); if the company switches on an approved AI service, it receives only descriptions and category names — never amounts, supplier names or files — and may only choose among the categories the text matching found.
- **Data residency:** where the data is hosted and backed up is agreed per deployment.

## Not yet available

Single sign-on (SSO), multi-factor authentication (MFA) and the approval workflow (maker–checker) are planned. Until then: strong passwords, lockout, short sessions and roles apply; approval status is recorded on each entry.

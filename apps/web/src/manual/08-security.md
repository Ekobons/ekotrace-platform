# Security

How Ekotrace protects the company's data, layer by layer, and the safety checks built into data entry, meters, bills and the API. The controls follow OWASP guidance and the client's web application security standard.

## Layers of protection

```layers
Connection | HTTPS (TLS 1.2+) on servers with HSTS; security headers on every response: Content-Security-Policy (only the platform's own scripts and stylesheets run — no inline scripts or style blocks), no framing by other sites, cross-origin isolation (COOP, CORP, COEP), no content sniffing, strict referrer, permissions policy; stored files open sandboxed
Sign-in | company sign-in (SSO, OpenID Connect: Microsoft Entra ID, Okta, Google…) or a password of 12+ characters hashed with scrypt; multi-factor authentication with an authenticator app (can be required for everyone); 5 wrong passwords or codes lock the account for 15 minutes
Session | random key in a cookie scripts cannot read (HttpOnly, Secure, SameSite), never in a web address, new at every sign-in; only its fingerprint is stored; ends after 30 minutes without activity, after 12 hours at most, and at log-out
Requests | every API request rate-limited (per person, per address, tighter on sign-in); changes accepted only as JSON or file uploads (a form on another website cannot post to Ekotrace); every input checked against a schema; errors never show internal details
Roles | each request checked on the server: who may see, enter or manage which facility (see Getting started → Roles)
Company separation | the database itself keeps each company's rows apart (row-level security, forced for every connection): a query for one company cannot return another's data
Encryption | stored files (bills, invoices, permits…), MFA keys and SSO client secrets encrypted with AES-256-GCM under a server key kept outside the database; the database disks and backups encrypted by the hosting as well
Audit | every sign-in (and failed attempt, also for unknown accounts), change, upload, download, export and API batch, with who, when and from where; append-only and sealed in a hash chain; kept at least 12 months; forwarded to the company's SIEM; security alerts raised from it within seconds
```

## Sign-in

**Multi-factor authentication (MFA).** After the password, a 6-digit code from an authenticator app (Microsoft Authenticator, Google Authenticator, a password manager). Set it up on your **account page** (your name → Password): scan the QR code, type the first code, save the ten **recovery codes** (each works once, for a lost phone). The super admin can **require MFA for everyone** (Setup → Security & audit log → Sign-in & MFA): people without it set it up at their next sign-in before doing anything else. A super admin can **reset** someone's MFA when they lose their phone. On servers, platform administrators must always use MFA — and they sign in through **Ekobon's own identity provider** (PLATFORM_SSO_… settings), with password sign-in refused except for the named break-glass accounts, which must use MFA.

**Company sign-in (single sign-on).** People sign in with their work account; the company's own MFA and conditional-access rules apply, and leavers lose access as soon as IT disables their account. The super admin sets it up under Sign-in & MFA:

```flow
> 1 · Register | in the identity provider (e.g. Microsoft Entra ID → App registrations), a web application with the redirect address shown on the page
> 2 · Fill in | issuer, client id, client secret, the company's email domains → Test
> 3 · Switch on | "Sign in with your company account" appears on the sign-in page; the email decides the company
! Checked | the provider's signature on every sign-in, the issuer, the application, expiry and a one-time value; with "must use MFA", a sign-in without a second factor is refused
* Company sign-in only | passwords refused, except for super admins who use MFA (break-glass, when the provider is down)
```

People still need a profile under People & access (role and facilities); the company account only proves who they are.

## Account sync (SCIM)

The company's identity provider keeps the people list up to date by itself (Microsoft Entra ID provisioning, Okta, OneLogin, JumpCloud — the SCIM 2.0 standard): joiners get an account, **leavers are switched off at once**, and roles follow the provider's groups. Set it up under Sign-in & MFA → Account sync:

```flow
> 1 · Token | the super admin makes a token (shown once) and copies the tenant URL shown on the page
> 2 · Provider | in the provider's provisioning settings: the tenant URL and token → Test connection; assign the users and groups; start provisioning
> 3 · Map groups | groups appear after the first sync: give each a role — Admin groups their sub-group, Manager / Preparer groups their facilities
! Rules | a person gets the highest role of their groups; in no mapped group they have no access (or read-only, if chosen); deleting someone in the provider switches them off and keeps their history; the last active super admin is never removed by a sync
```

People added by the sync have no password: they sign in with the company account. Their role, facilities and access are changed in the provider, not on People & access (shown as "synced"). Every change the sync makes is in the audit log as "Identity provider (SCIM)".

## Security alerts

Rules watch the audit log and raise an alert within seconds, also sent to the SIEM with a higher severity. The super admin reviews them under Security & audit log → **Alerts** (a red count on the menu) and marks each reviewed, with a note.

| Alert | When |
|---|---|
| Many failed sign-ins (high, platform) | 10 or more wrong passwords or codes from one address in 10 minutes — known or unknown accounts |
| Account locked (medium) | 5 wrong passwords or codes for one person in 15 minutes |
| MFA no longer required (high) · MFA switched off / reset (medium) | the company rule or a person's MFA changed |
| New super admin (high) | someone made a super admin, by hand or through a group mapping |
| Full data export (medium) | the company's data downloaded |
| Company sign-in changed · new account-sync token (medium) · new API client (low) | sign-in or integration settings changed |
| Company sign-ins refused (medium) | 5 or more in 10 minutes |
| Last super admin kept (medium) | a sync tried to remove the last super admin |
| Company data deleted · audit chain broken (high, platform) | for the Ekobon team |

The same alert is raised at most once an hour per person, address or setting.

## Audit log

Every sign-in, change, upload, download, export and API batch is recorded with who, when and from where (Setup → Security & audit log). Nobody can change or delete a record — not from the application, not in the database (it refuses). Every few seconds the new records are **sealed**: each carries the fingerprint (SHA-256) of the one before, so a record changed, removed or slipped in by anyone with direct database access breaks the chain, and the platform's **Check the whole chain** shows where. Records are kept for the retention period (24 months by default, never less than 12), then removed automatically — also after a company is deleted.

**SIEM.** The records go to the company's security monitoring system in two ways: the server forwards them as **syslog** (RFC 5424 over TLS, TCP or UDP), and a SIEM can **pull** them over the API (an API client with the "Audit events" permission: `GET /api/v1/audit-events?after=<last seq>`).

## Data export and deletion

The super admin can download **everything the company holds** at any time (Security & audit log → Data export): every table as CSV, every stored file, and a manifest with the SHA-256 checksum of each file. Password hashes, session keys and MFA / SSO secrets are left out. At the end of a contract, after the export is handed over, Ekobon deletes all of the company's data in one step and issues a **certificate of destruction** (what was deleted, when, by whom, the export's checksum, when the backups holding copies expire).

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

## Scanned bills are read on the server

Scanned bills are read by OCR (Tesseract, WebAssembly) on the Ekotrace server; the language data is part of the installation. No page is sent to an outside service and nothing is downloaded at run time. The PDF is drawn by PDF.js, which never runs code from the file. OCR can be switched off with `OCR=off`.

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
| Access | roles, scopes, SSO, MFA, lockout, sessions, rate limits | network rules, HTTPS certificate, WAF and anti-DDoS in front | who gets which role; leavers disabled promptly (automatic with SSO) |
| Data | company separation, sealed audit log, encrypted secrets, export, certificate of destruction | encryption at rest (AES-256 disks and backups), backups, disaster recovery, data residency | approving data, keeping evidence |
| Integrations | OAuth clients, rate limits, validation | firewall to the sending systems | keeping client secrets safe; revoking unused clients |
| Software | dependencies pinned and updated weekly; every change type-checked, tested, code-scanned (CodeQL, SAST), audited for known vulnerabilities, with a software bill of materials (SBOM); the running app scanned from outside (OWASP ZAP, DAST) | patching the servers; penetration tests | — |

## Decisions with security in mind

- **No email intake** of bills for now (mailbox access, phishing and malicious attachments) — upload in one place instead.
- **No AI service** receives company data unless the company approves the service and its location. Purchase mapping works without AI (remembered choices and text matching on the server); if the company switches on an approved AI service, it receives only descriptions and category names — never amounts, supplier names or files — and may only choose among the categories the text matching found.
- **Data residency:** where the data is hosted and backed up is agreed per deployment.

## For the server team (IT)

| Setting | What |
|---|---|
| `HTTPS=true`, `PUBLIC_URL` | HSTS and Secure cookies; the address people open (company sign-in returns there) |
| `TRUST_PROXY` | the load balancer / WAF in front (true, a hop count or its addresses), so the real client address is used |
| `DATA_KEY` | 64 hex characters from the secret store; encrypts MFA and SSO secrets |
| `REQUIRE_ADMIN_MFA` | platform administrators must use MFA (on by default with HTTPS) |
| `RATE_LIMIT_USER`, `_IP`, `_LOGIN` | requests per minute (600 / 300 / 20 by default) |
| `AUDIT_RETENTION_MONTHS` | audit records kept (24 by default, at least 12) |
| `SIEM_SYSLOG`, `SIEM_TLS_CA` | forward audit records, e.g. `tls://siem.example.com:6514` |
| `BACKUP_RETENTION_DAYS` | stated on certificates of destruction |
| `SECURITY_CONTACT` | published at `/.well-known/security.txt` for reporting vulnerabilities |
| `PLATFORM_SSO_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_DOMAINS`, `PLATFORM_SSO_ONLY`, `PLATFORM_BREAKGLASS` | Ekobon's identity provider for platform administrators; SSO only; the break-glass accounts |
| Database user | an ordinary role, never a superuser or BYPASSRLS (they would skip company separation): with HTTPS on, the server refuses to start that way |

The field app is a web page opened from the bin's QR label (no app-store app), so the mobile-app rules about stores, key-chains and certificate pinning do not apply to it; it runs over the same HTTPS, sign-in and roles as the rest.

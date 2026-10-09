# Ekotrace platform

GHG accounting platform. One codebase serves every deployment (Ekotrace, Carbontek, a client's own cloud); only the brand pack and settings differ.

## What is in here

```
packages/calc     Calculation engine (pure TypeScript, no database). Units, gases and GWP,
                  factor selection, fuel combustion, fugitive emissions. Fully unit-tested.
apps/api          API server (Fastify + PostgreSQL): editable catalogue, factor library,
                  DESNZ importer, calculate and save entries, per-gas reports.
apps/web          Screens (React): add data (stationary combustion, fugitive), entries & results,
                  factor library admin (factors, categories & items, units, gases & GWP, sources & import),
                  company & facilities. Same design as the prototype.
apps/api/migrations  Database tables (SQL, run in order).
data/defra        DESNZ (UK government) conversion factor flat files, 2022–2026.
data/gwp          Gases and GWP values (AR4, AR5, AR6) and verified refrigerant blend compositions.
brands/           Brand packs: name, colours, logo, support e-mail, enabled features.
docs/             Design notes and change log.
```

Built in stages, following the prototype (stationary combustion first; suppliers and product LCA later):
stage 1 login, roles, organisation, people, methodology, audit log, platform console (done) ·
stage 2 approvals and data collection · stage 3 home, dashboards, KPIs, reports, assurance · stage 4 net zero and the rest.

## Run it on a Windows laptop

Needs Node.js 22 and PostgreSQL 16 (`winget install -e --id PostgreSQL.PostgreSQL.16`).

```powershell
# 1. Database (once). Use the password you chose when installing PostgreSQL.
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -c "CREATE ROLE ekotrace LOGIN PASSWORD 'ekotrace' CREATEDB" -c "CREATE DATABASE ekotrace OWNER ekotrace"

# 2. Code
cd C:\Ekotrace
git clone https://github.com/Ekobons/ekotrace-platform.git
cd ekotrace-platform
copy .env.example .env
npm install
npm run db:migrate
npm run db:seed        # loads gases, GWP values, DESNZ 2022–2026, IPCC coals (≈10 s)

# 3. Your login (platform admin) — prints a temporary password once
npm run admin:create -- --email you@ekobon.com --name "Your Name"

# 4. Optional: demo company "BEEAH Group (demo)" with one login per role and 21 months of fuel data
npm run demo

# 5. Start (builds the screens and starts everything)
npm run app
```

Open **http://localhost:4000**. Stop with Ctrl + C. Next time only `npm run app` is needed.

After pulling new code: `git pull`, `npm install`, `npm run db:migrate`, `npm run app`.

For development with live reload: `npm run dev:api` and, in a second window, `npm run dev:web` (screens on http://localhost:5173).

## Tests

```powershell
npm test               # engine tests + API tests (API tests rebuild the database ekotrace_test)
```

## Settings (.env)

| Setting | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `PORT` | API port (4000) |
| `BRAND` | folder under `brands/` to use (`ekotrace`, `carbontek`) |
| `HOST` | `127.0.0.1` (default) = only this computer can connect. On a server behind HTTPS: `0.0.0.0`. |

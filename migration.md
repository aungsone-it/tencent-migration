# Supabase → Tencent Cloud Migration

Status document for the NEXA platform backend cutover. **Runtime target: Tencent CloudBase + TencentDB for PostgreSQL** (no Supabase dependency in production).

## Current status (July 2026)

| Workstream | Status | Notes |
|------------|--------|-------|
| Hono API on Cloud Functions | **Done** | `make-server-16010b6f` packaged to `.cloudbase/dist/make-server-16010b6f.zip` |
| KBZPay webhook | **Done** | `kpay-webhook` on TCB; `KPAY_NOTIFY_URL` points here |
| TencentDB schema | **Done** | `supabase/migrations/` → `npm run db:schema` |
| KV data import | **Done** | `import:supabase-data` — skips `kpay_txn:*`, `kpay_pwa_draft:*`, `chat:*` |
| SQL read-model import | **Done** | `app_*` tables via `import:supabase-sql-only` or full import |
| Frontend API client | **Done** | `VITE_CLOUDBASE_API_BASE_URL` + publishable key |
| Auth cutover | **Partial** | CloudBase Auth enabled; user password migration may need reset flow |
| Storage images | **Pending** | Copy Supabase Storage objects → CloudBase Storage manually |
| Chat KV | **Deferred** | Not imported; chat still on Supabase KV until separate cutover |
| Supabase decommission | **Pending** | Only after production validation on TCB |

## Target architecture

```mermaid
flowchart LR
  ReactSpa["React Vite SPA"] --> ApiClient["src/utils/api-client.ts"]
  ApiClient --> CloudBaseHttp["CloudBase HTTP Functions"]
  CloudBaseHttp --> CloudBaseAuth["CloudBase Auth"]
  CloudBaseHttp --> CloudBaseStorage["CloudBase Storage"]
  CloudBaseHttp --> TencentPostgres["TencentDB PostgreSQL"]
  KbzWebhook["KBZPay Webhook"] --> CloudBaseWebhook["kpay-webhook function"]
  CloudBaseWebhook --> TencentPostgres
```

## Key paths

| What | Where |
|------|-------|
| API source (deployed from) | `supabase/functions/make-server-16010b6f/` |
| CloudBase package output | `.cloudbase/functions/`, `.cloudbase/dist/*.zip` |
| DB migrations | `supabase/migrations/` |
| Import scripts | `scripts/import-supabase-except-kpay-chat.mjs`, `scripts/migrate-to-tencentdb.mjs` |
| Frontend config | `utils/tencent/cloudbase.ts` ← `VITE_CLOUDBASE_*` |
| Console setup guide | [docs/TCB_CONSOLE_SETUP.md](docs/TCB_CONSOLE_SETUP.md) |

## Commands cheat sheet

```bash
# Test DB URLs from .env
npm run test:db

# Schema only (safe re-run on populated TencentDB — skips KV backfill INSERTs)
npm run db:schema
# or
npm run setup:tcb-first

# Full data import (excludes KPay txn/draft + chat KV)
npm run import:supabase-data

# Data-only / SQL-only partial imports
npm run import:supabase-data-only
npm run import:supabase-sql-only

# Package functions for TCB console upload
npm run setup:tcb-first

# Validate KV ↔ SQL counts (needs EDGE_ADMIN_OPERATION_SECRET)
npm run validate:read-model
```

## `.env` for migration scripts

```bash
TENCENT_DATABASE_URL=postgresql://user:URL_ENCODED_PASSWORD@HOST:PORT/postgres
SOURCE_POSTGRES_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres
```

- URL-encode special characters in passwords (`$`, `%`, etc.)
- TencentDB managed hosts often use a custom port (e.g. `23100`), not `5432`
- Prefer Supabase **direct** connection host when IPv4 is enabled

## What was intentionally skipped

| Data | Reason |
|------|--------|
| `kpay_txn:*` | KPay already running on TCB |
| `kpay_pwa_draft:*` | Orphan drafts reconciled via admin recovery UI |
| `chat:*` | Separate cutover planned |

## Remaining risks

- **Auth:** Supabase password hashes may not import to CloudBase Auth — plan forced reset or migration login.
- **Realtime:** Pulse tables + CloudBase Realtime differ from Supabase channels — monitor after cutover.
- **Storage:** Product/vendor images must be copied; broken URLs until complete.
- **Read-model drift:** Run `validate:read-model` after bulk imports; order DELETE now syncs SQL synchronously.

## Related docs

- [README.md](README.md) — product overview + script index
- [docs/TCB_CONSOLE_SETUP.md](docs/TCB_CONSOLE_SETUP.md) — greenfield TCB deploy
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — hosting checklist
- [docs/READ_MODEL_ROLLOUT.md](docs/READ_MODEL_ROLLOUT.md) — post-deploy validation

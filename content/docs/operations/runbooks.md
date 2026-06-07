---
title: Runbooks
description: Practical operational playbooks — deploy, build-failure triage, database commands, and the docs site. Keep it short and accurate.
---

# Runbooks

**Status: Shipped (living).** Add to this as real incidents teach us things.

## Deploy

- **Trigger:** `twenty-server` on Railway (project `enso-crm`) auto-deploys from `main` (Builder = **DOCKERFILE**). Merging a PR to `main` is the deploy.
- **Build artifact:** the full image (server + frontend + the `/docs` static export) is built from `packages/twenty-docker/twenty/Dockerfile`, target `twenty`.
- **A failed build never swaps the live image** — production keeps running the previous image. So a broken build is safe for availability; it just means your change isn't live.
- **During the swap** you may see a brief `502` while the new container starts and the old one drains. It clears in under a minute. A *persistent* 502 across all paths (including `/healthz`) means the new container is crash-looping → check deploy logs.
- **After deploy:** hard-refresh — the browser may hold a stale frontend bundle.

## Build-failure / boot triage

1. Confirm whether it built at all: a build that never produced deploy logs **never started** → it's a build (compile) failure, and live is unaffected.
2. Read logs via the Railway CLI (`railway logs`, authenticated as the project owner) or the Railway dashboard. The read-only Railway MCP may lack deploy-log scope.
3. Smoke test after recovery:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://crm.enso.ro/healthz   # 200
   curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://crm.enso.ro/docs  # 302 -> sign-in (gated)
   ```

## Database

```bash
npx nx database:reset twenty-server                      # reset (destructive)
npx nx run twenty-server:database:migrate:prod           # run instance commands (fast)
npx nx run twenty-server:database:migrate:generate --name <name> --type <fast|slow>
```
A read-only Postgres MCP is configured for inspecting workspace/metadata/data while debugging. See `docs/UPGRADE_COMMANDS.md` for the instance/workspace command model.

## The /docs documentation site

- Built by the `enso-docs-build` Docker stage and served at `/docs` by `twenty-server`; gated by `DocsAuthMiddleware`. Full details: [deployment → documentation site](../deployment#documentation-site-docs).
- **Edit docs** only in repo-root `content/docs/` (the package copy is a build artifact). Code fences must use a Shiki-known language (e.g. `bash`, not `env`).
- **If `/docs` 404s a page** after editing: confirm the page is listed in the relevant `meta.json` and that the build (`npm run build:static` in `packages/enso-docs`) succeeds locally.

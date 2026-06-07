# enso-docs

Fumadocs viewer for the enso-crm documentation, served at **crm.enso.ro/docs**.

Standalone Next.js app (own `package-lock.json`, built with npm) — intentionally **not** a yarn/nx workspace, so it never touches the twenty monorepo dependency graph or the production `twenty-server` build.

## How it's wired
- **Content source of truth:** repo-root `content/docs/` (Markdown + `meta.json`). Not duplicated in git here — `scripts/sync-content.mjs` mirrors it into `./content/docs` (gitignored) before each build. Edit docs at the repo root, never here.
- **Static export:** `output: 'export'`, `basePath: '/docs'`, `trailingSlash: true`. Docs live at the app root route (`baseUrl: '/'`, `src/app/(docs)/`) so basePath lands them at `/docs/*`.
- **Serving:** `out/` is copied into `twenty-server`'s `dist/front/docs` (Dockerfile), served by NestJS `ServeStaticModule` at `/docs`, gated by `DocsAuthMiddleware`.
- **Search:** Fumadocs static (Orama); client fetches `/docs/api/search` (`src/components/search.tsx`).
- **Diagrams:** ` ```mermaid ` blocks render to static SVG at build via `beautiful-mermaid` (`src/components/mdx/mermaid.tsx` + `remarkMdxMermaid`).

## Commands
```bash
npm ci
npm run dev            # local dev (syncs content first)
npm run build:static   # sync content + static export to ./out
npm run start          # serve ./out
```
Code fences must use a Shiki-known language (e.g. `bash`, not `env`).

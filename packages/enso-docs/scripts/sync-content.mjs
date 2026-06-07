// Mirrors the canonical docs (repo-root content/docs) into this package so
// fumadocs-mdx can load them. The canonical source stays at the repo root;
// the copy here is a build artifact (gitignored). Run before every build/dev.
import { cpSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const src = join(repoRoot, 'content', 'docs');
const dest = join(here, '..', 'content', 'docs');

if (!existsSync(src)) {
  console.error(`[sync-content] source not found: ${src}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[sync-content] copied ${src} -> ${dest}`);

// Compiles both TypeScript projects into out/ and copies static assets
// (HTML/CSS) next to the compiled code.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const ASSET_EXTENSIONS = new Set(['.html', '.css']);

fs.rmSync(out, { recursive: true, force: true });

for (const project of ['tsconfig.json', 'src/settings/renderer/tsconfig.json']) {
  try {
    execFileSync(process.execPath, [tsc, '-p', path.join(root, project)], { stdio: 'inherit' });
  } catch {
    process.exit(1);
  }
}

function copyAssets(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const source = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      copyAssets(source);
    } else if (ASSET_EXTENSIONS.has(path.extname(entry.name))) {
      const target = path.join(out, path.relative(root, source));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
}

copyAssets(path.join(root, 'src'));

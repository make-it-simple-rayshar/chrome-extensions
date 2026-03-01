import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const cwd = process.cwd();
const name = basename(cwd);
const outDir = resolve(cwd, '..', '..', 'dist');

mkdirSync(outDir, { recursive: true });

const outFile = resolve(outDir, `${name}.zip`);

// If dist/ exists (TypeScript build), zip that; otherwise zip cwd (vanilla JS)
const sourceDir = existsSync(resolve(cwd, 'dist')) ? 'dist/' : '.';

// Remove old zip if exists
if (existsSync(outFile)) {
  unlinkSync(outFile);
}

const args = [
  '-r', outFile, sourceDir,
  '-x', 'node_modules/*',
  '-x', 'package.json',
  '-x', '.turbo/*',
  '-x', '*.zip',
  '-x', '.DS_Store',
  '-x', 'CLAUDE.md',
];

execFileSync('zip', args, { cwd, stdio: 'inherit' });

console.log(`\nPackaged: ${outFile}`);

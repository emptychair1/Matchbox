import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(pkg.version, '0.2.0');
assert.equal(pkg.private, false);
assert.equal(pkg.type, 'module');
assert.ok(pkg.exports?.['.']?.types);
assert.ok(pkg.exports?.['.']?.default);
assert.ok(existsSync(pkg.exports['.'].types));
assert.ok(existsSync(pkg.exports['.'].default));

const entry = await import('../dist/src/index.js');
for (const symbol of ['createMatchbox', 'defineMatch', 'reconcileExpired']) {
  assert.equal(typeof entry[symbol], 'function', `Missing public API: ${symbol}`);
}

const output = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { encoding:'utf8' });
const pack = JSON.parse(output)[0];
const paths = new Set(pack.files.map(x => x.path));
for (const required of ['dist/src/index.js', 'dist/src/index.d.ts', 'dist/src/engine.js',
  'dist/src/reconcile.js', 'README.md', 'LICENSE', 'MATCH_SPEC_V02.md']) {
  assert.ok(paths.has(required), `Missing from npm tarball: ${required}`);
}
assert.ok(![...paths].some(x => x.startsWith('test/') || x.startsWith('node_modules/')),
  'Tests or dependencies leaked into tarball');
console.log(`Verified Matchbox ${pkg.version} package: ${paths.size} files, public exports present.`);

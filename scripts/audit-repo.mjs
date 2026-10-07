import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(manifest.name, 'smokycannabisco-site');
assert.equal(manifest.private, true);
assert.equal(manifest.dependencies.emdash, '1.2.0');
assert.equal(manifest.devDependencies['@emdash-cms/cloudflare'], '1.2.0');
assert.equal(manifest.emdash?.seed, 'seed/seed.json');
for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const name of Object.keys(manifest[group] ?? {})) {
    assert.ok(!/^@dinkuskit\//.test(name) && name !== 'dinkuskit', `forbidden dependency ${name}`);
  }
}

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const forbiddenPath =
  /(^|\/)(node_modules|dist|\.local|\.astro|\.emdash|\.wrangler|uploads|worktrees|runs)(\/|$)|(^|\/)\.(?:env|dev\.vars)(?:\.|$)|\.(?:db|sqlite|sqlite3|pem|key|p12|jks|keystore)(?:-|$)/;
const rejectedPaths = files.filter((path) => forbiddenPath.test(path));
assert.deepEqual(rejectedPaths, [], `Forbidden paths: ${rejectedPaths.join(', ')}`);

const forbiddenContent = [
  { name: 'Access team domain', pattern: /[a-z0-9-]+\.cloudflareaccess\.com/i },
  { name: 'Access audience value', pattern: /CF_ACCESS_AUDIENCE\s*[=:]\s*["']?[0-9a-f]{64}/i },
  { name: 'EmDash encryption key value', pattern: /EMDASH_ENCRYPTION_KEY\s*[=:]\s*["']?[A-Za-z0-9+/=_-]{32,}/ },
  { name: 'Cloudflare account or resource id', pattern: /\b(?!0{8}-0{4}-0{4}-0{4}-0{10}[0-9a-f]{2}\b)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
];
const textFiles = files.filter((path) => /\.(?:mjs|js|ts|astro|json|jsonc|md|yml|yaml|css|txt|svg)$/.test(path));
const hits = [];
for (const path of textFiles) {
  const text = readFileSync(path, 'utf8');
  for (const rule of forbiddenContent) {
    if (rule.pattern.test(text)) hits.push(`${path}: ${rule.name}`);
  }
}
assert.deepEqual(hits, [], `Forbidden content: ${hits.join('; ')}`);

console.log(`Repository audit passed (${files.length} files, ${textFiles.length} scanned).`);

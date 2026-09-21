import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

test('README contains official links and local stdio notes', () => {
  const readme = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../README.md'),
    'utf8',
  );
  for (const url of [
    'https://pictostl.com',
    'https://pictostl.com/pricing',
    'https://pictostl.com/settings/api-keys',
    'https://pictostl.com/terms-of-service',
  ]) {
    assert.match(readme, new RegExp(url.replace(/[.]/g, '\\.')));
  }
  assert.match(readme, /stdio/i);
  assert.match(readme, /not (an? )?(engineering|construction)/i);
  assert.match(readme, /PICTOSTL_API_KEY/);
  assert.match(readme, /--package=github:qduoduo-hwh\/pictostl-mcp/);
  assert.doesNotMatch(readme, /npx -y pictostl-mcp/);
  assert.doesNotMatch(readme, /\/mcp[^\w]/);
});

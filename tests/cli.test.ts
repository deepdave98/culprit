import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function cli(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { encoding: 'utf8' });
}

test('CLI help describes the real command and budget', () => {
  const result = cli('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /culprit compare/);
  assert.match(result.stdout, /both directions/);
});

test('CLI rejects missing arguments, unknown flags, and invalid numbers', () => {
  for (const args of [[], ['compare'], ['compare', '--fake'],
    ['compare', '--base', 'http://localhost:3000', '--head', 'http://localhost:3001', '--target', 'button', '--budget', 'many']]) {
    const result = cli(...args);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.trim());
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findChanges, patchedSheet } from '../src/css.js';
import type { Observation, RuleRange, Sheet } from '../src/types.js';

function sheet(text: string, side: 'base' | 'head', key = '/style.css'): Sheet {
  return { id: `${side}:${key}`, key, url: `http://${side}.localhost${key}`, text };
}
function point(text: string, offset: number): { line: number; column: number } {
  const prefix = text.slice(0, offset);
  return { line: prefix.split('\n').length - 1, column: offset - prefix.lastIndexOf('\n') - 1 };
}
function range(value: Sheet, start = 0, end = value.text.length): RuleRange {
  const first = point(value.text, start);
  const last = point(value.text, end);
  return { sheetId: value.id, startLine: first.line, startColumn: first.column, endLine: last.line, endColumn: last.column };
}
function observation(sheets: Sheet[], rules = sheets.map(value => range(value))): Observation {
  return { sheets, relevantRules: rules, png: Buffer.alloc(0), target: { x: 0, y: 0, width: 1, height: 1 }, layout: [], dom: '', computed: [], matched: [], unsupported: [] };
}
function compare(before: string, after: string) {
  const base = sheet(before, 'base');
  const head = sheet(after, 'head');
  return { base, head, ...findChanges(observation([base]), observation([head])) };
}

test('maps exact source spans with CRLF, comments, and unchanged priority', () => {
  const before = '.target {\r\n  padding: /* leading */ 12px /* note */  !important;\r\n}';
  const after = before.replace('12px', '32px');
  const { base, head, declarations, unsupported } = compare(before, after);
  assert.deepEqual(unsupported, []);
  assert.equal(declarations.length, 1);
  const change = declarations[0]!;
  assert.equal(change.baseline.value, '12px /* note */');
  assert.equal(change.baseline.source.line, 2);
  assert.equal(change.baseline.source.column, 26);
  assert.equal(before.slice(change.baseline.source.start, change.baseline.source.end), change.baseline.value);
  assert.equal(change.important, true);
  assert.equal(patchedSheet(head, change, 'forward'), before);
  assert.equal(patchedSheet(base, change, 'reverse'), after);
});

test('keeps duplicate declarations, rule order, comments, and cascade context', () => {
  const before = '.target { padding: 4px; padding: 12px; }\n/* divider */\n.target { padding: 6px; }';
  const { head, declarations } = compare(before, before.replace('12px', '28px'));
  assert.equal(declarations.length, 1);
  assert.equal(patchedSheet(head, declarations[0]!, 'forward'), before);
});

test('finds ancestor custom properties and media values through matched style ranges', () => {
  const before = ':root { --gap: 12px; }\n@media (min-width: 600px) { .parent { gap: var(--gap); padding: 10px; } }\n.unrelated { color: red; }';
  const after = before.replace('12px', '24px').replace('10px', '30px').replace('red', 'blue');
  const base = sheet(before, 'base');
  const head = sheet(after, 'head');
  const rootRange = range(base, before.indexOf('{') + 1, before.indexOf('}'));
  const parentStart = after.indexOf('{', after.indexOf('.parent'));
  const parentRange = range(head, parentStart + 1, after.indexOf('}', parentStart));
  const result = findChanges(observation([base], [rootRange]), observation([head], [parentRange]));
  assert.deepEqual(result.unsupported, []);
  assert.deepEqual(result.declarations.map(item => item.property), ['--gap', 'padding']);
  assert.deepEqual(result.declarations[1]!.context, ['@media (min-width: 600px)']);
  assert.equal(result.declarations[1]!.selector, '.parent');
});

test('ignores unmatched value changes and accepts unchanged sheets', () => {
  const base = sheet('.a { color: red; }', 'base');
  const head = sheet('.a { color: blue; }', 'head');
  assert.deepEqual(findChanges(observation([base], []), observation([head], [])), { declarations: [], unsupported: [] });
  assert.deepEqual(compare(base.text, base.text).declarations, []);
});

test('rejects changed structure even in unmatched rules', () => {
  const before = '.target { padding: 12px; } .other { color: red; }';
  for (const after of [
    before.replace('.other', '.different'),
    before.replace('color: red;', 'background: red;'),
    before.replace('color: red;', 'color: red !important;'),
    before.replace('color: red;', 'color: red; display: block;'),
    before + ' .added { color: blue; }',
    before.replace('padding: 12px;', ''),
  ]) {
    const base = sheet(before, 'base');
    const head = sheet(after, 'head');
    assert.ok(findChanges(observation([base], []), observation([head], [])).unsupported.length > 0, after);
  }
});

test('rejects changed media conditions, unsupported at-rules, nesting, and malformed CSS', () => {
  assert.ok(compare('@media (min-width: 600px) { .a { color:red; } }', '@media (min-width: 700px) { .a { color:red; } }').unsupported.length);
  for (const css of ['@import "other.css";', '@layer a { .a { color:red; } }', '.a { & .b { color:red; } }', '.a { color:red;']) {
    assert.ok(compare(css, css).unsupported.length, css);
  }
});

test('rejects added, removed, reordered, and ambiguous sheets', () => {
  const a = sheet('.a { color:red; }', 'base', '/a.css');
  const b = sheet('.b { color:red; }', 'base', '/b.css');
  for (const head of [[a], [a, b, sheet('', 'head', '/c.css')], [b, a], [a, a]]) {
    assert.ok(findChanges(observation([a, b]), observation(head)).unsupported.length);
  }
});

test('patching refuses a stale or wrong stylesheet', () => {
  const { head, declarations } = compare('.a { margin: 2px; }', '.a { margin: 8px; }');
  const change = declarations[0]!;
  assert.throws(() => patchedSheet({ ...head, text: head.text.replace('8px', '9px') }, change, 'forward'), /no longer matches/);
  assert.throws(() => patchedSheet({ ...head, key: '/other.css' }, change, 'forward'), /no longer matches/);
});

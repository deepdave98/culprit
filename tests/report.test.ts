import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderReport } from '../src/report.js';
import type { Capture, DeclarationChange, Difference, Report } from '../src/types.js';

const measured: Difference = {
  targetPixels: 1234, surroundingPixels: 987, totalPixels: 2221,
  targetGeometry: 12.5, layoutNodes: 7, maxLayoutDelta: 16,
};
function capture(name: string): Capture {
  return { screenshot: `${name}.png`, evidence: `${name}.json`, target: { x: 10, y: 20, width: 30, height: 40 }, stable: true, samples: [`${name}.png`], instability: [] };
}
function declaration(): DeclarationChange {
  const source = { url: 'http://localhost/style.css', line: 4, column: 12, endLine: 4, endColumn: 16, start: 40, end: 44 };
  return { id: 'd1', sheetKey: '0:/style.css', selector: '.checkout', context: ['@media (min-width: 600px)'], property: 'padding', important: true,
    baseline: { value: '12px', source }, candidate: { value: '32px', source } };
}
function report(overrides: Partial<Report> = {}): Report {
  return {
    schemaVersion: 1, createdAt: '2026-10-12T00:00:00Z', state: 'Inconclusive', reasons: ['Insufficient evidence.'],
    options: { base: 'http://localhost:3000', head: 'http://localhost:3001', target: '.checkout', out: '/tmp/report', width: 1280, height: 800, budget: 12, interval: 120 },
    environment: { chromium: '123', platform: 'test', node: 'v22' }, baseline: capture('baseline'), candidate: capture('candidate'),
    difference: measured, region: { x: 6, y: 16, width: 38, height: 48 }, diffImage: 'difference.png',
    declarations: [], experiments: [], unsupported: [], budget: { limit: 12, used: 0, remaining: 12 }, ...overrides,
  };
}

test('report displays measured evidence and artifact links from the engine', () => {
  const value = report();
  const html = renderReport(value);
  assert.match(html, /Selected pixels changed<\/dt><dd>1,234<\/dd>/);
  assert.match(html, /Pixels outside selection<\/dt><dd>987<\/dd>/);
  assert.match(html, /Target geometry delta<\/dt><dd>12\.50 px<\/dd>/);
  assert.match(html, /Elements with changed bounds<\/dt><dd>7<\/dd>/);
  for (const filename of ['baseline.png', 'baseline.json', 'candidate.png', 'candidate.json', 'difference.png', 'report.json']) {
    assert.ok(html.includes(`href="${filename}"`), filename);
  }
  assert.ok(html.includes('class="box target"'));
  assert.ok(html.includes('class="box region"'));
  assert.ok(html.includes('No experiments were run.'));
  assert.ok(!html.includes('Forward experiment screenshot'));
});

test('hostile selectors, CSS values, source URLs, and reasons remain escaped text', () => {
  const hostile = '</code><script>alert("culprit")</script><img src=x onerror="alert(1)"> & \'quoted\'';
  const change = declaration();
  change.selector = hostile;
  change.property = hostile;
  change.context = [hostile];
  change.baseline.value = hostile;
  change.candidate.value = hostile;
  change.baseline.source = { ...change.baseline.source, url: `http://localhost/${hostile}` };
  change.candidate.source = { ...change.candidate.source, url: `http://localhost/${hostile}` };
  const value = report({ declarations: [change], reasons: [hostile], unsupported: [hostile], experiments: [{
    declarationId: change.id, state: 'Inconclusive', reason: hostile,
    forward: { direction: 'forward', restored: false, error: hostile },
    reverse: { direction: 'reverse', restored: false, error: hostile },
  }] });
  value.options.target = hostile;
  value.options.base = `http://localhost/${hostile}`;
  value.baseline!.instability = [hostile];
  value.baseline!.screenshot = `shot\" onerror=\"alert(1)${hostile}.png`;
  value.baseline!.evidence = `evidence\" onclick=\"alert(1)${hostile}.json`;
  const html = renderReport(value);
  assert.ok(!html.includes(hostile));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;culprit&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&amp; &#39;quoted&#39;'));
  assert.equal((html.match(/<script(?:\s|>)/gi) ?? []).length, 1, 'only the fixed outline-toggle script exists');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('src="shot" onerror='));
  assert.ok(!html.includes('href="evidence" onclick='));
});

test('failed and unrun trials show errors and incomplete verification without measurements', () => {
  const change = declaration();
  const html = renderReport(report({ declarations: [change], experiments: [{
    declarationId: change.id, state: 'Inconclusive', reason: 'The intervention did not complete.',
    forward: { direction: 'forward', restored: false, error: 'The stylesheet changed during the experiment.' },
  }] }));
  assert.ok(html.includes('The stylesheet changed during the experiment.'));
  assert.ok(html.includes('No valid measurement.'));
  assert.ok(html.includes('Browser restoration: not verified.'));
  assert.ok(html.includes('Not run. Verification is incomplete.'));
  assert.ok(!html.includes('Forward experiment screenshot'));
  assert.ok(!html.includes('Reverse experiment screenshot'));
});

test('verified experiments and untested declarations show their actual states', () => {
  const first = declaration();
  const second = { ...declaration(), id: 'd2', property: 'margin', selector: '.untested' };
  const zero = { ...measured, targetPixels: 0, surroundingPixels: 0, totalPixels: 0, targetGeometry: 0, layoutNodes: 0, maxLayoutDelta: 0 };
  const html = renderReport(report({ declarations: [first, second], experiments: [{
    declarationId: first.id, state: 'Reproduced impact', reason: 'Matched in both directions.',
    forward: { direction: 'forward', restored: true, capture: capture('forward'), difference: zero },
    reverse: { direction: 'reverse', restored: true, capture: capture('reverse'), difference: zero },
  }], budget: { limit: 2, used: 2, remaining: 0 } }));
  assert.ok(html.includes('Matched in both directions.'));
  assert.ok(html.includes('href="forward.png"'));
  assert.ok(html.includes('href="reverse.png"'));
  assert.ok(html.includes('Browser restoration: verified.'));
  assert.ok(html.includes('Untested declarations'));
  assert.ok(html.includes('.untested · margin: 12px → 32px'));
  assert.ok(html.includes('2 / 2 browser edits'));
  assert.ok(html.includes('!important'));
});

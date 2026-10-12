import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { compare } from '../src/engine.js';
import { startFixtures, type FixtureName } from '../fixtures/server.js';
import type { Capture, CompareOptions, Report } from '../src/types.js';

let servers: Awaited<ReturnType<typeof startFixtures>>;
let directory: string;
let run = 0;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'culprit-test-'));
  servers = await startFixtures();
});
after(async () => {
  await servers?.close();
  await rm(directory, { recursive: true, force: true });
});

function diagnose(name: FixtureName, overrides: Partial<CompareOptions> = {}) {
  return compare({ base: `${servers.base}/${name}`, head: `${servers.head}/${name}`,
    target: '.checkout-button', out: join(directory, `${name}-${run++}`), interval: 30, ...overrides });
}

async function evidence(report: Report, capture: Capture) {
  const png = await readFile(join(report.options.out, capture.screenshot));
  const image = PNG.sync.read(png);
  assert.equal(image.width, report.options.width);
  assert.equal(image.height, report.options.height);
  const metadata = JSON.parse(await readFile(join(report.options.out, capture.evidence), 'utf8'));
  assert.deepEqual(metadata.target, capture.target);
  assert.ok(metadata.computed.length > 1, 'capture includes ancestors');
  assert.ok(metadata.matched.length > 1, 'capture includes matched rules');
  assert.equal(metadata.sheets.length, 2);
  return { png, metadata };
}

const positives = [
  ['spacing', 'padding', '.checkout-button'],
  ['font', 'font-size', '.purchase-footer'],
  ['custom', '--button-space', '.checkout'],
  ['flex', 'gap', '.purchase-footer'],
  ['overflow', 'overflow', '.action-clip'],
  ['media', 'border-radius', '.checkout-button'],
  ['priority', 'background-color', '.checkout-button'],
] as const;

for (const [name, property, selector] of positives) {
  test(`synthetic ${name}: restores and reproduces a single value change`, { timeout: 90_000 }, async () => {
    const before = await (await fetch(`${servers.head}/${name}.css`)).text();
    const report = await diagnose(name);
    assert.equal(report.state, 'Reproduced impact', JSON.stringify(report.reasons));
    assert.deepEqual(report.unsupported, []);
    assert.equal(report.declarations.length, 1);
    assert.equal(report.experiments.length, 1);
    assert.equal(report.budget.used, 2);
    assert.equal(report.budget.remaining, 10);
    assert.ok(report.difference!.targetPixels > 0 || report.difference!.targetGeometry > 0);

    const declaration = report.declarations[0]!;
    assert.equal(declaration.property, property);
    assert.equal(declaration.selector, selector);
    if (name === 'media') assert.ok(declaration.context.some(context => context.includes('min-width: 900px')));
    if (name === 'priority') assert.equal(declaration.important, true);
    for (const version of [declaration.baseline, declaration.candidate]) {
      const source = await (await fetch(version.source.url)).text();
      assert.equal(source.slice(version.source.start, version.source.end), version.value);
      const prefix = source.slice(0, version.source.start).split('\n');
      assert.equal(version.source.line, prefix.length);
      assert.equal(version.source.column, prefix.at(-1)!.length + 1);
      assert.ok(source.split('\n')[version.source.line - 1]!.includes(`${property}:`));
      assert.equal(new URL(version.source.url).pathname, `/${name}.css`);
    }

    const trial = report.experiments[0]!;
    assert.equal(trial.state, 'Reproduced impact');
    for (const direction of [trial.forward, trial.reverse!]) {
      assert.equal(direction.error, undefined);
      assert.equal(direction.restored, true);
      assert.equal(direction.capture!.stable, true);
      assert.equal(direction.difference!.targetPixels, 0);
      assert.equal(direction.difference!.targetGeometry, 0);
      assert.equal(direction.difference!.surroundingPixels, 0);
      assert.ok(direction.versusOriginal!.targetPixels > 0 || direction.versusOriginal!.targetGeometry > 0);
      await evidence(report, direction.capture!);
    }
    for (const capture of [report.baseline!, report.candidate!]) {
      assert.equal(capture.stable, true);
      assert.equal(capture.samples.length, 6, 'three samples and three samples after a fresh load');
      const { png } = await evidence(report, capture);
      for (const sample of capture.samples) assert.deepEqual(await readFile(join(report.options.out, sample)), png);
    }

    // These are new captures after restoring the actual browser stylesheet.
    const basePng = await readFile(join(report.options.out, report.baseline!.screenshot));
    const headPng = await readFile(join(report.options.out, report.candidate!.screenshot));
    assert.deepEqual(await readFile(join(report.options.out, 'experiment-1-forward-reset-1.png')), headPng);
    assert.deepEqual(await readFile(join(report.options.out, 'experiment-1-reverse-reset-1.png')), basePng);
    assert.equal(await (await fetch(`${servers.head}/${name}.css`)).text(), before, 'application source is unchanged');

    const saved = JSON.parse(await readFile(join(report.options.out, 'report.json'), 'utf8'));
    assert.deepEqual(saved, report);
    const html = await readFile(join(report.options.out, 'index.html'), 'utf8');
    assert.ok(html.includes('Reproduced impact'));
    assert.ok(html.includes(property));
    assert.ok(html.includes(report.baseline!.screenshot));
    assert.ok(html.includes(trial.forward.capture!.screenshot));
    assert.ok(PNG.sync.read(await readFile(join(report.options.out, report.diffImage!))).width > 0);
  });
}

for (const name of ['unchanged', 'irrelevant'] as const) {
  test(`synthetic ${name}: does not invent a visual regression`, { timeout: 60_000 }, async () => {
    const report = await diagnose(name);
    assert.equal(report.state, 'Inconclusive');
    assert.ok(report.reasons.some(reason => reason.includes('No selected visual difference')));
    assert.equal(report.difference!.totalPixels, 0);
    assert.equal(report.difference!.layoutNodes, 0);
    assert.deepEqual(report.experiments, []);
    assert.equal(report.budget.used, 0);
    assert.deepEqual(report.declarations, []);
  });
}

test('synthetic unstable rendering is rejected before any experiment', { timeout: 60_000 }, async () => {
  const report = await diagnose('unstable');
  assert.equal(report.state, 'Inconclusive');
  assert.ok(report.reasons.some(reason => reason.includes('Unstable inputs')));
  assert.equal(report.baseline!.stable, false);
  assert.ok(report.baseline!.instability.length > 0);
  assert.deepEqual(report.experiments, []);
});

test('synthetic DOM change is unsupported even when the text looks the same', { timeout: 60_000 }, async () => {
  const report = await diagnose('dom');
  assert.equal(report.state, 'Inconclusive');
  assert.ok(report.unsupported.some(reason => reason.includes('DOM')));
  assert.deepEqual(report.experiments, []);
});

test('synthetic interacting values remain inconclusive after partial improvements', { timeout: 90_000 }, async () => {
  const report = await diagnose('interacting');
  assert.equal(report.state, 'Inconclusive');
  assert.equal(report.declarations.length, 2);
  assert.equal(report.experiments.length, 2);
  assert.equal(report.budget.used, 4);
  assert.ok(report.reasons.some(reason => reason.includes('Interacting')));
  for (const trial of report.experiments) {
    assert.equal(trial.state, 'Candidate');
    assert.equal(trial.forward.restored, true);
    assert.equal(trial.reverse!.restored, true);
    assert.ok(trial.forward.difference!.targetPixels > 0);
    assert.ok(trial.reverse!.difference!.targetPixels > 0);
  }
});

test('experiment budgets bound directional mutations and preserve incomplete evidence', { timeout: 90_000 }, async () => {
  for (const budget of [0, 1, 2]) {
    const report = await diagnose('spacing', { budget });
    assert.equal(report.budget.used, budget);
    assert.equal(report.budget.remaining, 0);
    assert.equal(report.state, budget === 2 ? 'Reproduced impact' : 'Inconclusive');
    if (budget < 2) assert.ok(report.reasons.some(reason => reason.includes('budget exhausted')));
    if (budget === 0) assert.deepEqual(report.experiments, []);
    if (budget === 1) {
      assert.equal(report.experiments[0]!.state, 'Candidate');
      assert.equal(report.experiments[0]!.reverse, undefined);
      assert.equal(report.experiments[0]!.forward.restored, true);
    }
  }
});

test('target must select exactly one visible element', { timeout: 90_000 }, async () => {
  for (const target of ['.does-not-exist', 'p']) {
    const report = await diagnose('spacing', { target });
    assert.equal(report.state, 'Inconclusive');
    assert.ok(report.unsupported.some(reason => reason.includes('Target must match one element')));
    assert.deepEqual(report.experiments, []);
  }
});

test('invalid options fail before launching a browser', async () => {
  for (const overrides of [{ base: 'https://example.com' }, { budget: -1 }, { width: 1 }, { target: '' }]) {
    await assert.rejects(diagnose('spacing', overrides));
  }
});

test('reports cannot silently overwrite earlier evidence', { timeout: 60_000 }, async () => {
  const report = await diagnose('unchanged');
  await assert.rejects(compare(report.options), /Output directory must be empty/);
  assert.deepEqual(JSON.parse(await readFile(join(report.options.out, 'report.json'), 'utf8')), report);
});

test('invisible target geometry alone cannot establish reproduced appearance', { timeout: 60_000 }, async () => {
  const report = await diagnose('invisible');
  assert.equal(report.state, 'Inconclusive');
  assert.deepEqual(report.experiments, []);
  assert.ok(report.unsupported.some(reason => /hidden|transparent/i.test(reason)), JSON.stringify(report.unsupported));
});

test('an untested matched declaration leaves the overall result inconclusive', { timeout: 60_000 }, async () => {
  const report = await diagnose('budget', { budget: 2 });
  assert.equal(report.state, 'Inconclusive');
  assert.equal(report.declarations.length, 2);
  assert.equal(report.experiments.length, 1);
  assert.equal(report.experiments[0]!.state, 'Reproduced impact');
  assert.equal(report.budget.used, 2);
  assert.ok(report.reasons.some(reason => /budget.*exhausted/i.test(reason)));
});

test('element scroll state is part of controlled page state', { timeout: 60_000 }, async () => {
  const report = await diagnose('scroll');
  assert.equal(report.state, 'Inconclusive');
  assert.deepEqual(report.experiments, []);
  assert.ok(report.unsupported.some(reason => /state|scroll/i.test(reason)));
});

for (const [name, reason] of [['inline', /inline/i], ['structure', /structure|selector/i]] as const) {
  test(`synthetic ${name}: unsupported input stops experiments`, { timeout: 60_000 }, async () => {
    const report = await diagnose(name);
    assert.equal(report.state, 'Inconclusive');
    assert.deepEqual(report.experiments, []);
    assert.ok(report.unsupported.some(item => reason.test(item)), JSON.stringify(report.unsupported));
  });
}

test('a stable page that changes on reload is inconclusive', { timeout: 60_000 }, async () => {
  const report = await diagnose('reload');
  assert.equal(report.state, 'Inconclusive');
  assert.equal(report.baseline!.stable, false);
  assert.ok(report.baseline!.instability.some(reason => reason.startsWith('Fresh load:')));
  assert.deepEqual(report.experiments, []);
});

test('stylesheet disabled state is part of controlled page state', { timeout: 60_000 }, async () => {
  const report = await diagnose('disabled');
  assert.equal(report.state, 'Inconclusive');
  assert.deepEqual(report.experiments, []);
  assert.ok(report.unsupported.some(reason => /state/i.test(reason)));
});

test('collateral stylesheet mutations cannot pass as a supported restoration', { timeout: 60_000 }, async () => {
  const source = await (await fetch(`${servers.head}/shared.css`)).text();
  const report = await diagnose('collateral');
  assert.equal(report.state, 'Inconclusive');
  assert.equal(report.baseline!.stable, true);
  assert.equal(report.candidate!.stable, true);
  assert.equal(report.experiments.length, 1);
  const forward = report.experiments[0]!.forward;
  assert.equal(forward.capture!.stable, true);
  assert.match(forward.error!, /Stylesheet state changed beyond the single intended value edit/);
  assert.equal(forward.restored, false);
  assert.equal(await (await fetch(`${servers.head}/shared.css`)).text(), source);
});

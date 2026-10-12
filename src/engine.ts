import { chromium, type Browser } from 'playwright';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openSession } from './browser.js';
import { findChanges, patchedSheet } from './css.js';
import { sample } from './evidence.js';
import { appearanceMatches, drift, measure, targetRegion } from './measure.js';
import { renderReport } from './report.js';
import type { CompareOptions, DeclarationChange, Observation, Report, Trial } from './types.js';

function options(input: CompareOptions): Required<CompareOptions> {
  const result = { width: 1280, height: 800, budget: 12, interval: 120, ...input, out: resolve(input.out) };
  for (const value of [result.base, result.head]) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password) throw new Error('Use local HTTP(S) URLs without credentials.');
  }
  if (!result.target.trim()) throw new Error('A target selector is required.');
  for (const [name, min, max] of [['width', 320, 3840], ['height', 240, 2160], ['budget', 0, 100], ['interval', 30, 5000]] as const) {
    if (!Number.isInteger(result[name]) || result[name] < min || result[name] > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return result;
}

async function captureInput(browser: Browser, url: string, report: Report, name: string) {
  const o = report.options;
  const first = await openSession(browser, url, o.target, o);
  let result;
  try { result = await sample(first, o.out, name, o.interval); }
  finally { await first.close(); }
  if (!result.capture.stable) return result;
  const repeat = await openSession(browser, url, o.target, o);
  try {
    const check = await sample(repeat, o.out, `${name}-reload`, o.interval);
    const instability = [...check.capture.instability, ...drift(result.observation, check.observation)];
    result.capture.samples.push(...check.capture.samples);
    result.capture.instability.push(...instability.map(reason => `Fresh load: ${reason}`));
    result.capture.stable = !result.capture.instability.length;
  } finally { await repeat.close(); }
  return result;
}

async function experiment(browser: Browser, report: Report, change: DeclarationChange, direction: 'forward' | 'reverse',
  original: Observation, expected: Observation, name: string): Promise<Trial> {
  const o = report.options;
  const trial: Trial = { direction, restored: false };
  const session = await openSession(browser, direction === 'forward' ? o.head : o.base, o.target, o);
  let originalText: string | undefined, sheetId: string | undefined;
  try {
    const before = await sample(session, o.out, `${name}-before`, o.interval);
    trial.preflight = before.capture;
    const changed = [...before.capture.instability, ...drift(original, before.observation)];
    if (changed.length) throw new Error(`Unstable experiment input: ${changed.join(' ')}`);
    const sheet = before.observation.sheets.find(item => item.key === change.sheetKey);
    if (!sheet) throw new Error('The stylesheet is missing from this experiment session.');
    originalText = sheet.text;
    sheetId = sheet.id;
    const replacement = patchedSheet(sheet, change, direction);
    report.budget.used++;
    await session.setSheet(sheetId, replacement);
    const after = await sample(session, o.out, name, o.interval);
    trial.capture = after.capture;
    if (!after.capture.stable) throw new Error(`Unstable experiment output: ${after.capture.instability.join(' ')}`);
    if (after.observation.dom !== original.dom) throw new Error('DOM or page state changed during the experiment.');
    if (after.observation.unsupported.length) throw new Error(after.observation.unsupported.join(' '));
    const expectedSheets = before.observation.sheets.map(({ key, text }) => ({ key, text: key === change.sheetKey ? replacement : text }));
    const actualSheets = after.observation.sheets.map(({ key, text }) => ({ key, text }));
    if (JSON.stringify(actualSheets) !== JSON.stringify(expectedSheets))
      throw new Error('Stylesheet state changed beyond the single intended value edit.');
    const result = measure(expected, after.observation, report.region!);
    trial.difference = result.difference;
    trial.versusOriginal = measure(original, after.observation, report.region!).difference;
    await writeFile(join(o.out, `${name}-diff.png`), result.diff);
  } catch (error) { trial.error = String(error instanceof Error ? error.message : error); }
  finally {
    try {
      if (sheetId && originalText !== undefined) await session.setSheet(sheetId, originalText);
      const reset = await sample(session, o.out, `${name}-reset`, o.interval);
      trial.reset = reset.capture;
      trial.restored = reset.capture.stable && !drift(original, reset.observation).length;
      if (!trial.restored) trial.error = [trial.error, 'Browser state did not return to the original capture.'].filter(Boolean).join(' ');
    } catch (error) { trial.error = [trial.error, `Restoration failed: ${String(error)}`].filter(Boolean).join(' '); }
    await session.close();
  }
  return trial;
}

export async function compare(input: CompareOptions): Promise<Report> {
  const o = options(input);
  await mkdir(o.out, { recursive: true });
  if ((await readdir(o.out)).length) throw new Error('Output directory must be empty; choose a new --out directory.');
  const report: Report = { schemaVersion: 1, createdAt: new Date().toISOString(), state: 'Inconclusive', reasons: [], options: o,
    environment: { chromium: '', platform: process.platform, node: process.version }, declarations: [], experiments: [],
    unsupported: [], budget: { limit: o.budget, used: 0, remaining: o.budget } };
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    report.environment.chromium = browser.version();
    const baseline = await captureInput(browser, o.base, report, 'baseline');
    report.baseline = baseline.capture;
    const candidate = await captureInput(browser, o.head, report, 'candidate');
    report.candidate = candidate.capture;
    const base = baseline.observation, head = candidate.observation;
    report.region = targetRegion(base.target, head.target, o.width, o.height);
    const initial = measure(base, head, report.region);
    report.difference = initial.difference;
    report.diffImage = 'difference.png';
    await writeFile(join(o.out, report.diffImage), initial.diff);
    report.unsupported.push(...base.unsupported, ...head.unsupported);
    if (base.dom !== head.dom) report.unsupported.push('DOM or page state differs between baseline and candidate.');
    const changes = findChanges(base, head);
    report.declarations = changes.declarations;
    report.unsupported = [...new Set([...report.unsupported, ...changes.unsupported])];
    if (!baseline.capture.stable || !candidate.capture.stable) {
      report.reasons.push('Unstable inputs: repeated captures or fresh loads disagree.');
    } else if (report.unsupported.length) {
      report.reasons.push('Unsupported input changes; no declaration experiments were run.');
    } else if (initial.difference.targetPixels === 0) {
      report.reasons.push('No selected visual difference was observed.');
    } else if (!changes.declarations.length) {
      report.reasons.push('No supported changed declarations were found on the target or its ancestors.');
    } else {
      for (let i = 0; i < changes.declarations.length && report.budget.used < o.budget; i++) {
        const change = changes.declarations[i]!;
        const name = `experiment-${i + 1}`;
        const forward = await experiment(browser, report, change, 'forward', head, base, `${name}-forward`);
        const entry = { declarationId: change.id, state: 'Inconclusive' as Report['state'],
          reason: 'The single declaration did not restore the selected appearance.', forward };
        report.experiments.push(entry);
        if (forward.error || !forward.difference) { entry.reason = forward.error ?? entry.reason; continue; }
        const restores = appearanceMatches(forward.difference);
        const improves = forward.difference.targetPixels < initial.difference.targetPixels
          || forward.difference.targetGeometry < initial.difference.targetGeometry;
        if (improves || restores) {
          entry.state = 'Candidate';
          entry.reason = restores ? 'Forward restoration matched; reverse verification is incomplete.' : 'Partial improvement; other declarations or unsupported dependencies may interact.';
        }
        // Test the reverse for every supported trial while budget permits, including no-effect trials.
        if (report.budget.used < o.budget) {
          const reverse = await experiment(browser, report, change, 'reverse', base, head, `${name}-reverse`);
          Object.assign(entry, { reverse });
          if (restores && reverse.difference && appearanceMatches(reverse.difference) && !reverse.error
            && forward.restored && reverse.restored
            && forward.difference.surroundingPixels <= initial.difference.surroundingPixels
            && reverse.difference.surroundingPixels <= initial.difference.surroundingPixels) {
            entry.state = 'Reproduced impact';
            entry.reason = 'Restoring this value matched the selected baseline appearance; the reverse edit matched the candidate appearance.';
          }
        }
      }
      const failed = report.experiments.some(item => item.forward.error || item.reverse?.error);
      const reproduced = report.experiments.some(item => item.state === 'Reproduced impact');
      const incomplete = report.experiments.some(item => item.state === 'Candidate' && appearanceMatches(item.forward.difference!));
      const exhausted = report.experiments.length < changes.declarations.length
        || report.experiments.some(item => !item.reverse);
      if (failed) report.reasons.push('At least one experiment was unstable, failed, or could not verify browser restoration.');
      else if (exhausted) report.reasons.push('Experiment budget exhausted; verification is incomplete.');
      else if (reproduced) {
        report.state = 'Reproduced impact';
        report.reasons.push('A single declaration reproduced the selected difference in both directions in the captured state. This does not establish a unique cause or a general fix.');
      } else if (incomplete) {
        report.state = 'Candidate';
        report.reasons.push('Forward restoration succeeded, but reverse verification did not establish reproduced impact.');
      } else report.reasons.push('Single-declaration experiments did not restore and reproduce the selected appearance. Interacting causes are not resolved.');
    }
  } catch (error) { report.reasons.push(`Capture or experiment failed: ${error instanceof Error ? error.message : String(error)}`); }
  finally { await browser?.close(); }
  report.budget.remaining = Math.max(0, o.budget - report.budget.used);
  await writeFile(join(o.out, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(o.out, 'index.html'), renderReport(report));
  return report;
}

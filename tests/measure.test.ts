import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { appearanceMatches, drift, measure, rectDelta, targetRegion } from '../src/measure.js';
import type { Observation, Rect } from '../src/types.js';

function png(width = 4, height = 3, edits: { x: number; y: number; channel: number; value: number }[] = []): Buffer {
  const image = new PNG({ width, height });
  for (let i = 0; i < image.data.length; i += 4) image.data.set([10, 20, 30, 255], i);
  for (const edit of edits) image.data[(edit.y * width + edit.x) * 4 + edit.channel] = edit.value;
  return PNG.sync.write(image);
}
const target: Rect = { x: 1, y: 1, width: 2, height: 1 };
function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    png: png(), target, layout: [{ path: 'body > button', rect: target }], dom: 'same DOM',
    computed: [{ path: 'body > button', styles: { color: 'rgb(0, 0, 0)' } }],
    sheets: [{ id: 'first-session', key: '0:/style.css', url: 'http://localhost/style.css', text: '.button { color: black; }' }],
    matched: [], relevantRules: [], unsupported: [], ...overrides,
  };
}

test('detects a one-byte difference in every RGBA channel without tolerance', () => {
  for (let channel = 0; channel < 4; channel++) {
    const value = [11, 21, 31, 254][channel]!;
    const result = measure(observation(), observation({ png: png(4, 3, [{ x: 1, y: 1, channel, value }]) }), target);
    assert.equal(result.difference.targetPixels, 1);
    assert.equal(result.difference.surroundingPixels, 0);
    assert.equal(result.difference.totalPixels, 1);
    assert.equal(appearanceMatches(result.difference), false);
    const diff = PNG.sync.read(result.diff);
    assert.equal(diff.width, 4);
    assert.equal(diff.height, 3);
    const changed = (1 * 4 + 1) * 4;
    assert.notDeepEqual([...diff.data.subarray(changed, changed + 4)], [...diff.data.subarray(0, 4)]);
  }
});

test('counts selected and surrounding pixels using an end-exclusive region', () => {
  const changed = observation({ png: png(4, 3, [
    { x: 1, y: 1, channel: 0, value: 12 },
    { x: 2, y: 1, channel: 0, value: 12 },
    { x: 3, y: 1, channel: 0, value: 12 },
    { x: 1, y: 2, channel: 0, value: 12 },
  ]) });
  const { difference } = measure(observation(), changed, target);
  assert.equal(difference.targetPixels, 2);
  assert.equal(difference.surroundingPixels, 2);
  assert.equal(difference.totalPixels, 4);
  assert.equal(difference.targetGeometry, 0);
  assert.equal(difference.layoutNodes, 0);
});

test('unions fractional target bounds, adds four pixels, and clamps to viewport', () => {
  assert.deepEqual(targetRegion(
    { x: 6.4, y: 7.8, width: 2.4, height: 3.1 },
    { x: 13.2, y: 10.2, width: 3.5, height: 2.2 }, 20, 20,
  ), { x: 2, y: 3, width: 18, height: 14 });
  assert.deepEqual(targetRegion(
    { x: 0.2, y: 0.2, width: 5, height: 5 },
    { x: 8.7, y: 6.9, width: 5, height: 5 }, 12, 10,
  ), { x: 0, y: 0, width: 12, height: 10 });
});

test('measures target and surrounding layout geometry independently of pixels', () => {
  const before = observation({ layout: [
    { path: 'button', rect: target }, { path: 'aside', rect: { x: 0, y: 0, width: 1, height: 1 } },
  ] });
  const nextTarget = { ...target, x: 1.5, height: 1.25 };
  const after = observation({ target: nextTarget, layout: [
    { path: 'button', rect: nextTarget }, { path: 'aside', rect: { x: 0, y: 2, width: 1, height: 1 } },
  ] });
  const { difference } = measure(before, after, target);
  assert.equal(difference.targetPixels, 0);
  assert.equal(difference.targetGeometry, 0.5);
  assert.equal(difference.layoutNodes, 2);
  assert.equal(difference.maxLayoutDelta, 2);
  assert.equal(rectDelta(target, nextTarget), 0.5);
  assert.equal(appearanceMatches(difference), false);
});

test('identical observations match while incompatible screenshot dimensions fail', () => {
  const before = observation();
  const result = measure(before, before, target);
  assert.deepEqual(result.difference, { targetPixels: 0, surroundingPixels: 0, totalPixels: 0, targetGeometry: 0, layoutNodes: 0, maxLayoutDelta: 0 });
  assert.equal(appearanceMatches(result.difference), true);
  assert.throws(() => measure(before, observation({ png: png(5, 3) }), target), /Screenshot dimensions changed/);
});

test('drift catches non-pixel DOM, layout, computed-style, and stylesheet changes', () => {
  const before = observation();
  for (const [after, expected] of [
    [observation({ dom: 'changed DOM' }), 'DOM or page state'],
    [observation({ layout: [{ path: 'body > button', rect: { ...target, x: 2 } }] }), 'Layout'],
    [observation({ computed: [{ path: 'body > button', styles: { color: 'red' } }] }), 'Computed styles'],
    [observation({ sheets: [{ ...before.sheets[0]!, text: '.button { color: red; }' }] }), 'Stylesheet contents'],
  ] as const) {
    const reasons = drift(before, after);
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0]!.includes(expected), reasons.join(' '));
  }
});

test('fresh session stylesheet IDs do not create drift, but source identity does', () => {
  const before = observation();
  assert.deepEqual(drift(before, observation({ sheets: [{ ...before.sheets[0]!, id: 'second-session' }] })), []);
  assert.ok(drift(before, observation({ sheets: [{ ...before.sheets[0]!, key: '0:/different.css' }] })).some(reason => reason.includes('Stylesheet')));
  assert.ok(drift(before, observation({ png: png(4, 3, [{ x: 0, y: 0, channel: 0, value: 11 }]) })).some(reason => reason.includes('Screenshot')));
});

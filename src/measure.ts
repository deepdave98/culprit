import { PNG } from 'pngjs';
import type { Difference, Observation, Rect } from './types.js';

export function targetRegion(a: Rect, b: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.floor(Math.min(a.x, b.x)) - 4);
  const y = Math.max(0, Math.floor(Math.min(a.y, b.y)) - 4);
  return { x, y, width: Math.min(width, Math.ceil(Math.max(a.x + a.width, b.x + b.width)) + 4) - x,
    height: Math.min(height, Math.ceil(Math.max(a.y + a.height, b.y + b.height)) + 4) - y };
}

export function rectDelta(a: Rect, b: Rect): number {
  return Math.max(...(['x', 'y', 'width', 'height'] as const).map(key => Math.abs(a[key] - b[key])));
}

export function measure(a: Observation, b: Observation, region: Rect): { difference: Difference; diff: Buffer } {
  const first = PNG.sync.read(a.png), second = PNG.sync.read(b.png);
  if (first.width !== second.width || first.height !== second.height) throw new Error('Screenshot dimensions changed.');
  const diff = new PNG({ width: first.width, height: first.height });
  let targetPixels = 0, surroundingPixels = 0;
  for (let y = 0; y < first.height; y++) for (let x = 0; x < first.width; x++) {
    const i = (y * first.width + x) * 4;
    const changed = first.data[i] !== second.data[i] || first.data[i + 1] !== second.data[i + 1]
      || first.data[i + 2] !== second.data[i + 2] || first.data[i + 3] !== second.data[i + 3];
    if (changed) {
      if (x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height) targetPixels++;
      else surroundingPixels++;
    }
    const gray = Math.round(((first.data[i]! + first.data[i + 1]! + first.data[i + 2]!) / 3) * 0.25 + 190);
    diff.data[i] = changed ? 240 : gray;
    diff.data[i + 1] = changed ? 52 : gray;
    diff.data[i + 2] = changed ? 100 : gray;
    diff.data[i + 3] = 255;
  }
  const other = new Map(b.layout.map(node => [node.path, node.rect]));
  let layoutNodes = 0, maxLayoutDelta = 0;
  for (const node of a.layout) {
    const rect = other.get(node.path);
    if (!rect) { layoutNodes++; continue; }
    const delta = rectDelta(node.rect, rect);
    if (delta > 0.01) layoutNodes++;
    maxLayoutDelta = Math.max(maxLayoutDelta, delta);
    other.delete(node.path);
  }
  layoutNodes += other.size;
  return { difference: { targetPixels, surroundingPixels, totalPixels: targetPixels + surroundingPixels,
    targetGeometry: rectDelta(a.target, b.target), layoutNodes, maxLayoutDelta }, diff: PNG.sync.write(diff) };
}

// Compare every channel exactly so small changes stay visible.
export function drift(a: Observation, b: Observation): string[] {
  const reasons: string[] = [];
  if (!a.png.equals(b.png)) reasons.push('Screenshot changed between captures.');
  if (a.dom !== b.dom) reasons.push('DOM or page state changed between captures.');
  if (JSON.stringify(a.layout) !== JSON.stringify(b.layout)) reasons.push('Layout changed between captures.');
  if (JSON.stringify(a.computed) !== JSON.stringify(b.computed)) reasons.push('Computed styles changed between captures.');
  const sheets = (value: Observation) => JSON.stringify(value.sheets.map(({ key, text, rules }) => ({ key, text, rules })));
  if (sheets(a) !== sheets(b)) reasons.push('Stylesheet contents changed between captures.');
  if (JSON.stringify(a.unsupported) !== JSON.stringify(b.unsupported)) reasons.push('Supported browser state changed between captures.');
  return reasons;
}

export function appearanceMatches(difference: Difference): boolean {
  return difference.targetPixels === 0 && difference.targetGeometry <= 0.01;
}

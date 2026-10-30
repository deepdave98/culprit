import postcss, { type ChildNode, type Declaration } from 'postcss';
import type { DeclarationChange, Observation, Sheet, SourceLocation } from './types.js';

interface ParsedDeclaration {
  property: string;
  selector: string;
  context: string[];
  important: boolean;
  value: string;
  source: SourceLocation;
  declarationStart: number;
}

function position(text: string, offset: number): { line: number; column: number } {
  const prefix = text.slice(0, offset);
  const line = prefix.split('\n').length;
  return { line, column: offset - prefix.lastIndexOf('\n') };
}

function offsetAt(text: string, line: number, column: number): number {
  let offset = 0;
  for (let i = 0; i < line; i++) {
    const newline = text.indexOf('\n', offset);
    if (newline === -1) return -1;
    offset = newline + 1;
  }
  return offset + column;
}

function readDeclaration(sheet: Sheet, node: Declaration, selector: string, context: string[]): ParsedDeclaration {
  const declarationStart = node.source?.start?.offset;
  if (declarationStart === undefined || sheet.text.slice(declarationStart, declarationStart + node.prop.length) !== node.prop) {
    throw new Error('Declaration source cannot be mapped without changing syntax.');
  }
  // PostCSS retains comments and whitespace in raw values. Its separate
  // "between" and "important" fields stay untouched during an edit.
  const raw = node.raws.value;
  const value = raw && raw.value === node.value ? raw.raw : node.value;
  const start = declarationStart + node.prop.length + (node.raws.between ?? ':').length;
  const end = start + value.length;
  if (sheet.text.slice(start, end) !== value || !value.trim()) {
    throw new Error('Declaration has no safely mapped value span.');
  }
  const first = position(sheet.text, start);
  const last = position(sheet.text, end);
  return {
    property: node.prop, selector, context, important: Boolean(node.important), value, declarationStart,
    source: { url: sheet.url, line: first.line, column: first.column, endLine: last.line, endColumn: last.column, start, end },
  };
}

function parseSheet(sheet: Sheet): { skeleton: string; declarations: ParsedDeclaration[] } {
  const root = postcss.parse(sheet.text, { from: sheet.url });
  const declarations: ParsedDeclaration[] = [];
  function walk(nodes: ChildNode[], context: string[], selector?: string): unknown[] {
    return nodes.filter(node => node.type !== 'comment').map(node => {
      if (node.type === 'decl' && selector !== undefined) {
        declarations.push(readDeclaration(sheet, node, selector, context));
        return ['declaration', node.prop, Boolean(node.important)];
      }
      if (node.type === 'rule' && selector === undefined) {
        return ['rule', node.selector, walk(node.nodes, context, node.selector)];
      }
      if (node.type === 'atrule' && node.name.toLowerCase() === 'media' && node.nodes && selector === undefined) {
        return ['media', node.params, walk(node.nodes, [...context, `@media ${node.params}`])];
      }
      throw new Error(`Unsupported CSS structure: ${node.type === 'atrule' ? `@${node.name}` : node.type}. Only plain rules and @media blocks are supported.`);
    });
  }
  return { skeleton: JSON.stringify(walk(root.nodes, [])), declarations };
}

function relevant(observation: Observation, sheet: Sheet, declaration: ParsedDeclaration): boolean {
  return observation.relevantRules.some(range => {
    if (range.sheetId !== sheet.id) return false;
    const start = offsetAt(sheet.text, range.startLine, range.startColumn);
    const end = offsetAt(sheet.text, range.endLine, range.endColumn);
    return start >= 0 && end >= start && declaration.declarationStart >= start && declaration.source.end <= end;
  });
}

export function findChanges(base: Observation, head: Observation): { declarations: DeclarationChange[]; unsupported: string[] } {
  const declarations: DeclarationChange[] = [];
  const unsupported: string[] = [];
  const baseline = new Map(base.sheets.map(sheet => [sheet.key, sheet]));
  const candidate = new Map(head.sheets.map(sheet => [sheet.key, sheet]));
  if (baseline.size !== base.sheets.length || candidate.size !== head.sheets.length) {
    return { declarations, unsupported: ['Stylesheet keys are ambiguous.'] };
  }
  if (JSON.stringify([...baseline.keys()]) !== JSON.stringify([...candidate.keys()])) {
    unsupported.push('Stylesheets were added, removed, reordered, or changed identity.');
  }
  for (const [key, baselineSheet] of baseline) {
    const candidateSheet = candidate.get(key);
    if (!candidateSheet) continue;
    try {
      const before = parseSheet(baselineSheet);
      const after = parseSheet(candidateSheet);
      if (before.skeleton !== after.skeleton) {
        unsupported.push(`${key}: CSS structure, selector, declaration order/name/priority, or media condition changed.`);
        continue;
      }
      before.declarations.forEach((old, index) => {
        const current = after.declarations[index]!;
        if (old.value === current.value || (!relevant(base, baselineSheet, old) && !relevant(head, candidateSheet, current))) return;
        declarations.push({
          id: `d${declarations.length + 1}`, sheetKey: key, property: old.property,
          selector: old.selector, context: old.context, important: old.important,
          baseline: { value: old.value, source: old.source }, candidate: { value: current.value, source: current.source },
        });
      });
    } catch (error) {
      unsupported.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { declarations, unsupported };
}

export function patchedSheet(sheet: Sheet, change: DeclarationChange, direction: 'forward' | 'reverse'): string {
  const expected = direction === 'forward' ? change.candidate : change.baseline;
  const replacement = direction === 'forward' ? change.baseline : change.candidate;
  const { start, end } = expected.source;
  if (sheet.key !== change.sheetKey || sheet.url !== expected.source.url || sheet.text.slice(start, end) !== expected.value) {
    throw new Error('The stylesheet no longer matches the captured declaration.');
  }
  return sheet.text.slice(0, start) + replacement.value + sheet.text.slice(end);
}

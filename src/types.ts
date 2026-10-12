export type ResultState = 'Reproduced impact' | 'Candidate' | 'Inconclusive';
export interface Rect { x: number; y: number; width: number; height: number }
export interface Sheet { id: string; key: string; url: string; text: string; rules?: string[] }
export interface RuleRange { sheetId: string; startLine: number; startColumn: number; endLine: number; endColumn: number }
export interface Observation {
  png: Buffer;
  target: Rect;
  layout: { path: string; rect: Rect }[];
  dom: string;
  computed: { path: string; styles: Record<string, string> }[];
  sheets: Sheet[];
  matched: unknown[];
  relevantRules: RuleRange[];
  unsupported: string[];
}
export interface Capture {
  screenshot: string;
  evidence: string;
  target: Rect;
  stable: boolean;
  samples: string[];
  instability: string[];
}
export interface SourceLocation {
  url: string; line: number; column: number; endLine: number; endColumn: number;
  start: number; end: number;
}
export interface DeclarationChange {
  id: string;
  sheetKey: string;
  property: string;
  selector: string;
  context: string[];
  important: boolean;
  baseline: { value: string; source: SourceLocation };
  candidate: { value: string; source: SourceLocation };
}
export interface Difference {
  targetPixels: number;
  surroundingPixels: number;
  totalPixels: number;
  targetGeometry: number;
  layoutNodes: number;
  maxLayoutDelta: number;
}
export interface Trial {
  direction: 'forward' | 'reverse';
  preflight?: Capture;
  capture?: Capture;
  reset?: Capture;
  difference?: Difference;
  versusOriginal?: Difference;
  restored: boolean;
  error?: string;
}
export interface Experiment {
  declarationId: string;
  state: ResultState;
  reason: string;
  forward: Trial;
  reverse?: Trial;
}
export interface CompareOptions {
  base: string; head: string; target: string; out: string;
  width?: number; height?: number; budget?: number; interval?: number;
}
export interface Report {
  schemaVersion: 1;
  createdAt: string;
  state: ResultState;
  reasons: string[];
  options: Required<CompareOptions>;
  environment: { chromium: string; platform: string; node: string };
  baseline?: Capture;
  candidate?: Capture;
  region?: Rect;
  difference?: Difference;
  diffImage?: string;
  declarations: DeclarationChange[];
  experiments: Experiment[];
  unsupported: string[];
  budget: { limit: number; used: number; remaining: number };
}

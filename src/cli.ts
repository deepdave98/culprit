#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { compare } from './engine.js';

const usage = `Test which CSS changes made an element look different.

culprit compare --base http://localhost:3000 --head http://localhost:3001 --target ".checkout-button"

  --out <directory>   Save the report to a new or empty directory
  --width <pixels>    Viewport width (1280)
  --height <pixels>   Viewport height (800)
  --budget <edits>    Maximum CSS edits (12)
  --interval <ms>     Time between captures (120)

Each CSS value is tested in both directions; each direction costs one edit.
Exit codes: 0 reproduced impact, 2 candidate or inconclusive, 1 invalid command or setup failure.`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    base: { type: 'string' }, head: { type: 'string' }, target: { type: 'string' }, out: { type: 'string' },
    width: { type: 'string' }, height: { type: 'string' }, budget: { type: 'string' }, interval: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) console.log(usage);
  else {
    if (positionals.length !== 1 || positionals[0] !== 'compare' || !values.base || !values.head || !values.target) throw new Error(usage);
    const numbers = Object.fromEntries((['width', 'height', 'budget', 'interval'] as const)
      .filter(key => values[key] !== undefined).map(key => [key, Number(values[key])]));
    const report = await compare({ base: values.base, head: values.head, target: values.target,
      out: values.out ?? `culprit-report-${Date.now()}`, ...numbers });
    console.log(`${report.state}\n${report.reasons.join('\n')}\nReport: ${report.options.out}/index.html`);
    process.exitCode = report.state === 'Reproduced impact' ? 0 : 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

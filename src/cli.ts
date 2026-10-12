#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { compare } from './engine.js';

const usage = `culprit compare --base http://localhost:3000 --head http://localhost:3001 --target ".checkout-button"

Options: --out <empty directory>  --width 1280  --height 800  --budget 12  --interval 120
Budget counts browser edits in both directions. Interval is milliseconds between stability samples.
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

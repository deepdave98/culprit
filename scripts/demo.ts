import { resolve } from 'node:path';
import { compare } from '../src/engine.js';
import { startFixtures } from '../fixtures/server.js';

const servers = await startFixtures();
try {
  const out = resolve('outputs/demo');
  const report = await compare({ base: `${servers.base}/spacing`, head: `${servers.head}/spacing`, target: '.checkout-button', out });
  console.log(`${report.state}: ${report.reasons.join(' ')}`);
  console.log(`Report: ${out}/index.html`);
  if (report.state !== 'Reproduced impact') process.exitCode = 1;
} finally {
  await servers.close();
}

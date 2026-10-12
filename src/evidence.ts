import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drift } from './measure.js';
import type { Session } from './browser.js';
import type { Capture, Observation } from './types.js';

export async function sample(session: Session, out: string, name: string, interval: number): Promise<{ observation: Observation; capture: Capture }> {
  const observations: Observation[] = [];
  const samples: string[] = [];
  for (let i = 0; i < 3; i++) {
    if (i) await session.page.waitForTimeout(interval);
    const observation = await session.observe();
    observations.push(observation);
    const filename = `${name}-${i + 1}.png`;
    await writeFile(join(out, filename), observation.png);
    samples.push(filename);
  }
  const observation = observations[0]!;
  const instability = [...new Set(observations.slice(1).flatMap(value => drift(observation, value)))];
  const { png: _, ...metadata } = observation;
  const evidence = `${name}.json`;
  await writeFile(join(out, evidence), JSON.stringify(metadata, null, 2));
  return { observation, capture: { screenshot: samples[0]!, evidence, target: observation.target,
    stable: instability.length === 0, samples, instability } };
}

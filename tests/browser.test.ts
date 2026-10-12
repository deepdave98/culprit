import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { openSession } from '../src/browser.js';
import { startFixtures } from '../fixtures/server.js';

let browser: Browser;
let fixtures: Awaited<ReturnType<typeof startFixtures>>;
before(async () => {
  fixtures = await startFixtures();
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await fixtures?.close();
});

test('live CSSOM rule insertion is captured when CDP source text stays unchanged', async () => {
  const session = await openSession(browser, `${fixtures.head}/spacing`, '.checkout-button', { width: 1280, height: 800 });
  try {
    const original = await session.observe();
    assert.deepEqual(original.unsupported, []);
    await session.page.evaluate(() => {
      const sheet = document.styleSheets[0]!;
      sheet.insertRule('.checkout { outline: 5px solid red; }', sheet.cssRules.length);
    });
    const changed = await session.observe();
    assert.equal(changed.sheets[0]!.text, original.sheets[0]!.text);
    assert.ok(changed.sheets[0]!.rules!.some(rule => rule.includes('outline: red solid 5px')));
    assert.ok(changed.unsupported.some(reason => reason.startsWith('Live CSSOM differs from captured stylesheet source:')));
    assert.equal(changed.sheets.length, original.sheets.length);
  } finally { await session.close(); }
});

test('live declaration edits are detected and exact source restoration clears the audit', async () => {
  const session = await openSession(browser, `${fixtures.head}/spacing`, '.checkout-button', { width: 1280, height: 800 });
  try {
    const original = await session.observe();
    await session.page.evaluate(() => {
      const rule = [...document.styleSheets[0]!.cssRules].find(rule =>
        rule instanceof CSSStyleRule && rule.selectorText === '.checkout-button') as CSSStyleRule;
      rule.style.setProperty('color', 'rgb(180, 0, 0)');
    });
    const changed = await session.observe();
    assert.ok(changed.unsupported.some(reason => reason.startsWith('Live CSSOM differs from captured stylesheet source:')));
    assert.ok(changed.sheets[0]!.rules!.some(rule => rule.includes('rgb(180, 0, 0)')));
    const sheet = original.sheets[0]!;
    await session.setSheet(sheet.id, sheet.text);
    const reset = await session.observe();
    const repeated = await session.observe();
    assert.deepEqual(reset.unsupported, []);
    assert.deepEqual(repeated.unsupported, []);
    assert.deepEqual(reset.sheets[0]!.rules, sheet.rules);
    assert.ok(reset.png.equals(original.png));
    assert.ok(repeated.png.equals(original.png));
  } finally { await session.close(); }
});

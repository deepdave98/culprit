# How it works

1. Capture each page three times, then reload it in a fresh Chromium context. Compare pixels, DOM state, layout, computed styles, and stylesheet text. Reject unstable pages.
2. Pair external stylesheets by order and URL path. Find changed CSS values in rules matching the target or its ancestors. PostCSS supplies the exact source spans.
3. Revert one value in the after page with CDP’s `CSS.setStyleSheetText`. Capture the result, reset all stylesheets, and check that the browser returns to its initial state.
4. Apply that value to a fresh before page. A value passes only when both directions match and neither adds differences outside the selected area.

Each value gets a fresh browser context. CSS edits preserve selectors, rule order, media conditions, whitespace, and priority. Live CSSOM rules are checked against source text to catch JavaScript `insertRule` changes.

The measured area covers both target rectangles plus a 4px margin. A match requires exact pixels and no more than 0.01px movement. The report also records surrounding pixels and bounds for up to 2,000 elements.

The budget counts CSS edits in both directions. Missing tests or failed browser resets leave the report inconclusive. Values are tested individually; combinations require further investigation. See [limits](usage.md#limits).

## APIs

- [Playwright CDPSession](https://playwright.dev/docs/api/class-cdpsession)
- [Chrome CSS protocol](https://chromedevtools.github.io/devtools-protocol/tot/CSS/)

CDP source ranges start at zero; report line and column numbers start at one. Range ends are exclusive. Animations stay enabled so repeated captures can detect changes.

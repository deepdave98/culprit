# Experiment boundary

The engine asks whether restoring one changed value restores a selected appearance in a captured state. It does not infer the best fix or rank a unique cause.

1. Open each local URL in an isolated Chromium context. Capture three times, then repeat in a fresh context. Compare pixels, DOM state, geometry, computed styles, and stylesheet text.
2. Pair external stylesheets by link order and URL path/query. Parse their CSS with PostCSS. Reject changes to stylesheet structure; identify value differences whose declarations belong to target or ancestor matched-rule ranges.
3. Open a fresh candidate context and require its captures to match the original. Splice a single baseline value into the captured stylesheet text with `CSS.setStyleSheetText`. The sheet identity, rule order, selector, media context, and priority stay in place.
4. Capture the edited page. Compare against the baseline and the original candidate. Restore the entire original sheet and verify that the browser returns to the original state before closing the context.
5. Repeat with the candidate value in a fresh baseline context. A result can be reproduced only when both directions match the selected appearance and neither increases the surrounding pixel difference.

The fixed region is the union of the original target rectangles with a four-pixel margin. This avoids cropping each element independently and hiding position or size changes. Geometry catches movement outside that region. The full viewport difference and all element bounds remain in the evidence.

The budget counts directional value edits, not screenshots. Partial improvements remain candidates; single-declaration trials cannot resolve interacting values. An exhausted budget makes the overall report inconclusive even if an individual experiment has verified evidence.

## API references

- [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots): repeated screenshot checks and environment-dependent rendering.
- [Playwright screenshot assertions](https://playwright.dev/docs/api/class-pageassertions): animations can be disabled by screenshot assertions. Culprit instead captures with animations allowed so sampled instability remains visible.
- [Playwright CDPSession](https://playwright.dev/docs/api/class-cdpsession): browser protocol access.
- [Chrome CSS protocol](https://chromedevtools.github.io/devtools-protocol/tot/CSS/): matched rules, stylesheet text, original source ranges, and in-memory edits. CDP ranges are zero-based and end-exclusive; report line/column values are one-based.
- [BackstopJS](https://github.com/garris/BackstopJS): reference/candidate screenshot comparison and visual reports. Culprit's experiment step tests declaration values; it does not replace a regression suite.
- [Percy](https://www.browserstack.com/docs/percy/overview/visual-testing-basics): screenshot capture, baseline comparison, and review. Culprit keeps its first experiment loop local.

These sources informed the design. No implementation code was reused.

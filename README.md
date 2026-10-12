# Culprit

Culprit compares a selected element on two local pages, finds changed CSS values in matched rules, and tests them in Chromium. Each experiment edits the original browser stylesheet, measures the result, then restores and checks browser state. It never edits application files. No account or model API is required.

## Install

Node 22 or newer:

```sh
git clone https://github.com/deepdave98/culprit.git
cd culprit
npm ci
npx playwright install chromium
npm run build
```

With baseline and candidate servers running:

```sh
node dist/cli.js compare --base http://localhost:3000 --head http://localhost:3001 --target ".checkout-button" --out culprit-report
```

Open `culprit-report/index.html`. The report works without a server. `report.json` contains results; adjacent JSON files contain computed styles, matched rules, geometry, DOM state, and stylesheet text. PNGs include repeated captures, interventions, resets, and pixel differences. Choose an empty output directory for each run.

`npm link` makes the same command available as `culprit compare`.

## Demo

```sh
npm run demo
```

This starts two temporary local fixture servers, compares `.checkout-button`, and writes `outputs/demo/index.html`. It tests the padding change from `14px 24px` to `14px 44px` at `spacing.css:3:12`. The fixture is synthetic. It is an executable example, not external validation.

For manual exploration, run `npm run fixtures`, then use the command above. Cases are available at `/spacing`, `/font`, `/custom`, `/flex`, `/overflow`, `/media`, and `/priority` on ports 3000 and 3001. Negative controls include `/unchanged`, `/irrelevant`, `/unstable`, `/dom`, and `/interacting`.

## Results

| State | Evidence |
| --- | --- |
| Reproduced impact | A value restored the selected baseline appearance and recreated the candidate appearance in reverse. |
| Candidate | A declaration improved the match, or forward restoration succeeded but verification remains incomplete. |
| Inconclusive | Unstable or unsupported inputs, no selected difference, unresolved interactions, failures, or an exhausted budget. |

Individual experiments and the overall report have separate states. A partial improvement can be a Candidate while the overall diagnosis remains Inconclusive. A verified experiment does not establish a unique root cause or a generally correct fix.

Exit codes: `0` reproduced impact, `2` candidate or inconclusive, `1` invalid options or output setup failure.

## Current limits

- Chromium only; one viewport, one uniquely matched target entirely inside it. Defaults: 1280 × 800, device scale 1, light mode, en-US, UTC, fresh storage, service workers blocked. Authentication and interaction scripts are not supported.
- Identical DOM, content, form/focus/scroll state, and stylesheet order. Stylesheets must be readable external links with matching paths. Only declaration values may change; selectors, property order, priority, and media conditions must stay the same.
- Plain CSS rules and `@media` blocks only. Inline styles, CSS nesting, imports, layers, `@font-face`, shadow DOM, frames, canvas, and video are unsupported.
- Candidate search covers matched target and ancestor rules, including custom properties and matched pseudo-element rules. It does not trace dependencies through siblings or descendants, or solve combinations of declarations.
- Three captures per state, plus fresh input loads, must agree exactly. Motion is not suppressed. Sampling can miss slow or periodic changes; callers must supply controlled pages. Images/scripts served under unchanged URLs are not independently content-hashed.
- Exact restoration can fail on browser repaint differences: changing and restoring font size produced a one-channel rounding difference at rounded card edges in local Chromium. That run remains inconclusive. The font fixture uses square corners to isolate inheritance deterministically.
- Selected pixels are measured inside the union of baseline/candidate target bounds plus 4 px. Surrounding pixels cover the rest of the viewport. Exact pixel equality and a 0.01 px geometry limit are required for a match. Surrounding pixel differences must not increase. Geometry for up to 2,000 DOM elements is recorded.
- Each single-value edit gets its own browser context. The reverse direction costs a second edit. `--budget 12` bounds edits; `--interval 120` sets milliseconds between samples. `--width` and `--height` set the viewport.
- Source locations refer to the served CSS value, with 1-based line/column and end-exclusive offsets. Source maps and original preprocessor files are not resolved. Screenshots and DOM evidence may contain page content; output stays local.

## Development

```sh
npm run check
npm test
npm run build
```

Tests use local, labeled synthetic fixtures. They check observable pixels, geometry, source spans, cascade priority, restoration, instability, unsupported changes, and budgets. No image goldens depend on a different machine's font rendering. See [design notes](docs/design.md) for the experiment and API choices.

Runtime dependencies: Playwright for Chromium/CDP, PostCSS for source-preserving declaration spans, and pngjs for exact PNG measurements. Tests use Node's test runner. No code from visual regression tools was copied.

[MIT license](LICENSE).

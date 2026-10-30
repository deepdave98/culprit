# Usage

Run a before and after version of your page on separate local servers. Both pages must have the same HTML; change only CSS values.

```sh
node dist/cli.js compare --base http://localhost:3000 --head http://localhost:3001 --target ".checkout-button" --out culprit-report
```

`--target` is a CSS selector that matches exactly one visible element. Choose a new or empty output directory for each run.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--out` | `culprit-report-<timestamp>` | Output directory |
| `--width` | `1280` | Viewport width in pixels |
| `--height` | `800` | Viewport height in pixels |
| `--budget` | `12` | Maximum CSS edits; reverting and reapplying each value counts as two edits |
| `--interval` | `120` | Milliseconds between repeated captures |

`npm link` installs the `culprit` command locally.

## Report

Open `index.html` in the output directory. It includes before/after screenshots, changed pixels, CSS values, file locations, and test results. It works without a server.

`report.json` contains the results. The other JSON files record styles, rules, layout, DOM state, and stylesheet text. PNG files record captures, CSS edits, browser resets, and pixel differences.

| Result | Meaning |
| --- | --- |
| Reproduced impact | Reverting a value matches before; applying it matches after. Both browser resets passed. |
| Candidate | A value reduced the difference, or matched before without a verified match to after. |
| Inconclusive | The pages changed between captures, used unsupported inputs, ran out of edits, or could not be explained by one value. |

The report and each CSS test have separate results. An individual value may pass while the overall report remains inconclusive. Several values can contribute to the same difference.

Exit codes: `0` for reproduced impact, `2` for candidate or inconclusive, `1` for invalid options or output setup failure.

## Limits

- Chromium only. One viewport and one visible target, entirely inside the viewport. Defaults: 1280 × 800, device scale 1, light mode, en-US, UTC, fresh storage, blocked service workers. No login or interaction scripts.
- Both pages need identical HTML, content, form values, focus, scroll position, and stylesheet order. Stylesheets must be readable external links with matching paths. Only declaration values may differ.
- Supports plain CSS rules and `@media`. Rejects inline styles, nesting, imports, layers, `@font-face`, shadow DOM, frames, canvas, and video. Live CSSOM rules must match captured source; JavaScript `insertRule` changes are rejected.
- Searches matching rules on the target and its ancestors, including custom properties and pseudo-elements. It does not trace sibling/descendant dependencies or test combinations of values.
- Three captures per state and fresh page loads must match exactly. Animations stay enabled. Slow or periodic changes can fall between samples. Images and scripts at unchanged URLs are not content-hashed.
- Browser repaint differences can prevent a verified reset. For example, Chromium may change rounded-edge pixels by one color level after a font-size reset; that result stays inconclusive.
- The measured area covers both target rectangles plus 4px. Matches require identical pixels and no more than 0.01px movement. Differences outside the area must not increase. Up to 2,000 element bounds are recorded.
- Source lines and columns refer to served CSS, starting at one. Offsets end before the next character. Source maps and preprocessor files are not resolved.
- Reports contain page content and stay local.

## Test pages

`npm run fixtures` serves test pages on ports 3000 and 3001. Cases: `/spacing`, `/font`, `/custom`, `/flex`, `/overflow`, `/media`, and `/priority`. `/unchanged`, `/irrelevant`, `/unstable`, `/dom`, and `/interacting` exercise cases where a change cannot be verified.

These are synthetic test pages. Run Culprit on your own pages to check whether it supports your setup.

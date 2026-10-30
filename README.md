# Culprit

Tests which CSS changes made an element look different.

Give it before/after local URLs and an element’s CSS selector. It tries changed CSS values in Chromium and saves a report with screenshots and source lines. Your files stay untouched.

## Try it

Node 22 or newer:

```sh
npm ci
npx playwright install chromium
npm run demo
```

Open `outputs/demo/index.html`. The demo tests a button whose padding changed from `14px 24px` to `14px 44px`.

## Compare your pages

```sh
npm run build
node dist/cli.js compare --base http://localhost:3000 --head http://localhost:3001 --target ".checkout-button" --out culprit-report
```

Open `culprit-report/index.html`.

Supports CSS value changes on otherwise identical pages. [Options and limits](docs/usage.md) · [How it works](docs/design.md)

## Development

```sh
npm run check
npm test
npm run build
```

[MIT](LICENSE)

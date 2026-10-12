import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const cases = [
  'spacing', 'font', 'custom', 'flex', 'overflow', 'media', 'priority',
  'unchanged', 'irrelevant', 'unstable', 'dom', 'interacting',
  'invisible', 'budget', 'scroll', 'inline', 'structure', 'reload',
  'disabled', 'collateral',
] as const;
export type FixtureName = typeof cases[number];

const descriptions: Record<FixtureName, string> = {
  spacing: 'Button padding', font: 'Inherited font size', custom: 'Inherited custom property',
  flex: 'Ancestor flex gap', overflow: 'Ancestor clipping', media: 'Active media query',
  priority: 'Important declaration', unchanged: 'Unchanged pages', irrelevant: 'Unmatched rule',
  unstable: 'Unstable rendering', dom: 'Changed DOM', interacting: 'Two interacting declarations',
  invisible: 'Invisible selected element', budget: 'More declarations than the experiment budget',
  scroll: 'Changed element scroll state', inline: 'Unsupported inline style',
  structure: 'Changed selector structure', reload: 'Changed state on a fresh load',
  disabled: 'Changed stylesheet state', collateral: 'Stylesheet mutation during an experiment',
};
const root = fileURLToPath(new URL('.', import.meta.url));

function html(name: FixtureName, side: 'base' | 'head') {
  const changed = name === 'dom' && side === 'head' ? '<span>Secure checkout</span>' : 'Secure checkout';
  const animation = name === 'unstable' ? `<script>
    let frame = 0;
    function animate() {
      document.querySelector('.checkout-button').style.width = (190 + frame++ % 130) + 'px';
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  </script>` : '';
  const stateScript = name === 'scroll' ? '<script src="/scroll-state.js"></script>'
    : name === 'reload' ? '<script src="/reload-state.js"></script>'
    : name === 'disabled' ? '<script src="/disabled-state.js"></script>'
    : name === 'collateral' ? '<script src="/collateral.js"></script>' : '';
  const inline = name === 'inline' ? ' style="color: green"' : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Culprit synthetic fixture · ${name}</title><link rel="stylesheet" href="/shared.css"><link rel="stylesheet" href="/${name}.css"></head>
<body><main>
  <header><a href="/">culprit / fixtures</a><span>SYNTHETIC · ${name}</span></header>
  <section class="fixture-heading"><p>CSS regression example</p><h1>${descriptions[name]}</h1>
    <p>A controlled checkout page. This is a labeled test fixture, not an external validation.</p></section>
  <section class="checkout" aria-label="Checkout preview">
    <div class="order-heading"><span>YOUR ORDER</span><span>01 ITEM</span></div>
    <div class="product"><div class="product-art" aria-hidden="true"><div class="notebook"></div></div>
      <div><p class="eyebrow">FIELD NOTES</p><h2>Everyday notebook</h2><p>Plain pages · Forest green</p><p class="quantity">Quantity: 1</p></div><strong>$24.00</strong></div>
    <div class="purchase-footer"><div class="purchase-price"><small>ORDER TOTAL</small><strong>$24.00</strong></div>
      <div class="action-clip"><button class="checkout-button"${inline}>${changed}<span aria-hidden="true"> →</span></button></div>
    </div>
  </section>
  <footer>Fixed viewport. Local assets. No network dependencies.</footer>
</main>${animation}${stateScript}</body></html>`;
}

function serve(side: 'base' | 'head'): Server {
  let reload = 0;
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const name = (path === '/' ? 'spacing' : path.slice(1).replace(/\.css$/, '')) as FixtureName;
      response.setHeader('Cache-Control', 'no-store');
      if (path === '/disabled-state.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(`document.querySelector('link[href="/disabled.css"]').sheet.disabled = ${side === 'head'};`);
      } else if (path === '/collateral.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(await readFile(resolve(root, 'collateral.js')));
      } else if (path === '/scroll-state.js' || path === '/reload-state.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        const offset = path === '/scroll-state.js' ? (side === 'head' ? 40 : 0) : (reload++ % 2) * 40;
        response.end(`document.querySelector('.action-clip').scrollLeft = ${offset};`);
      } else if (path === '/shared.css') {
        response.setHeader('Content-Type', 'text/css; charset=utf-8');
        response.end(await readFile(resolve(root, 'shared.css')));
      } else if (cases.includes(name)) {
        if (path.endsWith('.css')) {
          response.setHeader('Content-Type', 'text/css; charset=utf-8');
          response.end(await readFile(resolve(root, 'cases', name, `${side}.css`)));
        } else {
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(html(name, side));
        }
      } else {
        response.writeHead(404).end('Fixture not found');
      }
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
}

async function listen(server: Server, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture server');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

export async function startFixtures(options: { basePort?: number; headPort?: number } = {}) {
  const baseServer = serve('base');
  const headServer = serve('head');
  try {
    const base = await listen(baseServer, options.basePort ?? 0);
    const head = await listen(headServer, options.headPort ?? 0);
    return { base, head, close: async () => { await Promise.all([close(baseServer), close(headServer)]); } };
  } catch (error) {
    await Promise.all([close(baseServer), close(headServer)]);
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const servers = await startFixtures({ basePort: 3000, headPort: 3001 });
  console.log(`Synthetic fixtures: baseline ${servers.base} · candidate ${servers.head}`);
  console.log(`Cases: ${cases.join(', ')}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void servers.close());
}

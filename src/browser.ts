import type { Browser, CDPSession, Page } from 'playwright';
import type { Observation, RuleRange, Sheet } from './types.js';

export interface Session {
  page: Page;
  cdp: CDPSession;
  observe(): Promise<Observation>;
  setSheet(id: string, text: string): Promise<void>;
  close(): Promise<void>;
}

interface Header {
  styleSheetId: string;
  sourceURL: string;
  ownerNode?: number;
  origin: string;
  isInline: boolean;
  isConstructed: boolean;
  loadingFailed?: boolean;
}

export async function openSession(
  browser: Browser, url: string, target: string, viewport: { width: number; height: number },
): Promise<Session> {
  const context = await browser.newContext({
    viewport, deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-US',
    timezoneId: 'UTC', serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const headers = new Map<string, Header>();
    cdp.on('CSS.styleSheetAdded', ({ header }) => headers.set(header.styleSheetId, header));
    cdp.on('CSS.styleSheetRemoved', ({ styleSheetId }) => headers.delete(styleSheetId));
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await page.goto(url, { waitUntil: 'load', timeout: 15_000 });
    await page.waitForFunction(() => document.fonts.status === 'loaded'
      && [...document.images].every(image => image.complete), undefined, { timeout: 5_000 });
    await page.mouse.move(-1, -1);

    return {
      page, cdp,
      close: () => context.close(),
      async setSheet(id, text) {
        if (!headers.has(id)) throw new Error(`Stylesheet ${id} is no longer present`);
        await cdp.send('CSS.setStyleSheetText', { styleSheetId: id, text });
        // Let a paint follow style invalidation without disabling page animations.
        await page.evaluate(() => new Promise<void>(resolve => {
          document.documentElement.getBoundingClientRect();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
      },
      async observe() {
        const state = await page.evaluate((selector) => {
          const unsupported: string[] = [];
          const elements = [...document.querySelectorAll('*')];
          const limited = elements.length > 2_000;
          if (limited) unsupported.push('More than 2000 DOM elements');
          if (document.querySelector('[style], style')) unsupported.push('Inline styles or style elements');
          if (document.querySelector('iframe, frame, canvas, video')) unsupported.push('Frames, canvas, or video');
          if (elements.some(element => element.shadowRoot)) unsupported.push('Shadow DOM');
          if (document.adoptedStyleSheets.length) unsupported.push('Adopted stylesheets');
          if ([...document.images].some(image => !image.complete || !image.naturalWidth)) {
            unsupported.push('Unloaded or failed images');
          }
          const helpers = {
            path(element: Element): string {
              const parts: string[] = [];
              let current: Element | null = element;
              while (current) {
                const index = current.parentElement
                  ? [...current.parentElement.children].indexOf(current) + 1 : 1;
                parts.unshift(`${current.localName}:nth-child(${index})`);
                current = current.parentElement;
              }
              return parts.join(' > ');
            },
            rect(element: Element) {
              const { x, y, width, height } = element.getBoundingClientRect();
              return { x, y, width, height };
            },
          };
          const targets = document.querySelectorAll(selector);
          const selected = targets[0];
          if (targets.length !== 1) unsupported.push(`Target must match one element; matched ${targets.length}`);
          const targetRect = selected ? helpers.rect(selected) : { x: 0, y: 0, width: 0, height: 0 };
          if (selected && (targetRect.width <= 0 || targetRect.height <= 0
            || targetRect.x < 0 || targetRect.y < 0
            || targetRect.x + targetRect.width > innerWidth
            || targetRect.y + targetRect.height > innerHeight)) {
            unsupported.push('Target has no visible box or extends beyond the viewport');
          }
          const ancestry: Element[] = [];
          for (let node: Element | null = selected ?? null; node; node = node.parentElement) ancestry.push(node);
          const computed = ancestry.map(element => {
            const style = getComputedStyle(element);
            return { path: helpers.path(element), styles: Object.fromEntries(
              [...style].sort().map(property => [property, style.getPropertyValue(property)]),
            ) };
          });
          if (computed.some(({ styles }) => ['hidden', 'collapse'].includes(styles.visibility ?? '')
            || Number(styles.opacity) === 0 || styles['content-visibility'] === 'hidden')) {
            unsupported.push('Target or ancestor is hidden or fully transparent');
          }
          // Only URL-bearing attributes may differ by the two local server origins.
          const urlAttributes: Record<string, string[]> = {
            href: ['a', 'area', 'base', 'link'], src: ['audio', 'embed', 'iframe', 'img', 'input', 'script', 'source', 'track', 'video'],
            action: ['form'], formaction: ['button', 'input'], poster: ['video'], cite: ['blockquote', 'del', 'ins', 'q'], data: ['object'],
          };
          const serializer = { canonical(node: Node): unknown {
            if (!(node instanceof Element)) return [node.nodeType, node.nodeValue];
            const attributes = [...node.attributes].map(({ name, value }) => {
              if (urlAttributes[name]?.includes(node.localName)) {
                try {
                  const resolved = new URL(value, document.baseURI);
                  if (resolved.origin === location.origin && !resolved.username && !resolved.password) {
                    value = `$ORIGIN${resolved.pathname}${resolved.search}${resolved.hash}`;
                  }
                } catch { /* Non-URL attribute values are retained verbatim. */ }
              }
              return [name, value];
            }).sort(([a], [b]) => a!.localeCompare(b!));
            const form = node instanceof HTMLInputElement ? [node.value, node.checked, node.indeterminate]
              : node instanceof HTMLTextAreaElement ? [node.value]
              : node instanceof HTMLSelectElement ? [[...node.options].map(option => option.selected)] : [];
            const sheet = node instanceof HTMLLinkElement ? node.sheet?.disabled ?? null : null;
            return [node.localName, attributes, form, [node.scrollLeft, node.scrollTop], sheet,
              [...node.childNodes].map(child => serializer.canonical(child))];
          } };
          const dom = JSON.stringify({
            tree: limited ? 'DOM limit exceeded' : serializer.canonical(document.documentElement),
            focus: document.activeElement ? helpers.path(document.activeElement) : null,
            scroll: [scrollX, scrollY], hash: location.hash, mode: document.compatMode,
            doctype: document.doctype ? [document.doctype.name, document.doctype.publicId, document.doctype.systemId] : null,
          });
          const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet" i]')]
            .map(link => ({ path: helpers.path(link), href: link.href, loaded: !!link.sheet }));
          if (links.some(link => !link.loaded)) unsupported.push('Unloaded external stylesheets');
          return {
            target: targetRect, computed, dom, links, unsupported,
            layout: elements.filter(element => element === document.body || document.body?.contains(element))
              .slice(0, 2_000).map(element => ({ path: helpers.path(element), rect: helpers.rect(element) })),
          };
        }, target);

        const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
        const nodes = [root];
        while (nodes.length) {
          const node = nodes.pop()!;
          if (node.shadowRoots?.some(shadow => shadow.shadowRootType !== 'user-agent')) {
            state.unsupported.push('Shadow DOM');
          }
          nodes.push(...node.children ?? []);
        }
        const sheets: Sheet[] = [];
        for (const [index, link] of state.links.entries()) {
          const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: link.path });
          if (!nodeId) throw new Error('DOM changed during stylesheet capture');
          const { node } = await cdp.send('DOM.describeNode', { nodeId });
          const header = [...headers.values()].find(item => item.ownerNode === node.backendNodeId);
          if (!header || header.origin !== 'regular' || header.isInline || header.isConstructed || header.loadingFailed) {
            state.unsupported.push(`Unsupported or unreadable stylesheet: ${link.href}`);
            continue;
          }
          try {
            const { text } = await cdp.send('CSS.getStyleSheetText', { styleSheetId: header.styleSheetId });
            const source = new URL(header.sourceURL);
            sheets.push({ id: header.styleSheetId, key: `${index}:${source.pathname}${source.search}`, url: source.href, text });
          } catch {
            state.unsupported.push(`Unreadable stylesheet: ${link.href}`);
          }
        }
        // Imported and constructed sheets have no supported link owner or source pairing.
        for (const header of headers.values()) {
          if (header.origin === 'regular' && !sheets.some(sheet => sheet.id === header.styleSheetId)) {
            state.unsupported.push(`Stylesheet is not a supported external link: ${header.sourceURL || '(no URL)'}`);
          }
        }
        const matched: unknown[] = [];
        const ranges = new Map<string, RuleRange>();
        for (const element of state.computed) {
          const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: element.path });
          if (!nodeId) throw new Error('DOM changed during matched-rule capture');
          const styles = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
          matched.push({ path: element.path, styles });
          const ruleMatches = [
            ...(styles.matchedCSSRules ?? []),
            ...(styles.inherited ?? []).flatMap(entry => entry.matchedCSSRules),
            ...(styles.pseudoElements ?? []).flatMap(entry => entry.matches),
          ];
          for (const { rule } of ruleMatches) {
            const sheetId = rule.style.styleSheetId ?? rule.styleSheetId;
            if (!sheetId || !rule.style.range) continue;
            const range = { sheetId, ...rule.style.range };
            ranges.set(JSON.stringify(range), range);
          }
        }
        const png = await page.screenshot({ animations: 'allow', caret: 'initial', timeout: 10_000 });
        return {
          png, target: state.target, layout: state.layout, dom: state.dom, computed: state.computed,
          sheets, matched, relevantRules: [...ranges.values()], unsupported: [...new Set(state.unsupported)],
        };
      },
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

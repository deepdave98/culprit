import type { Capture, Difference, Report, Trial } from './types.js';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function restoration(trial: Trial): string {
  const status = trial.restored ? 'verified' : 'not verified';
  return `Browser reset: ${status}.${trial.reset ? ` <a href="${escape(trial.reset.evidence)}">Reset JSON</a>` : ''}`;
}

function metrics(value?: Difference): string {
  if (!value) return '<p class="muted">No valid measurement.</p>';
  return `<dl><div><dt>Changed pixels in target</dt><dd>${value.targetPixels.toLocaleString('en-US')}</dd></div>
    <div><dt>Changed pixels outside target</dt><dd>${value.surroundingPixels.toLocaleString('en-US')}</dd></div>
    <div><dt>Target size or position change</dt><dd>${value.targetGeometry.toFixed(2)} px</dd></div>
    <div><dt>Elements moved or resized</dt><dd>${value.layoutNodes}</dd></div></dl>`;
}

export function renderReport(report: Report): string {
  const { width, height } = report.options;
  function shot(capture: Capture | undefined, title: string): string {
    if (!capture) return '';
    const rect = capture.target;
    const region = report.region;
    const box = (r: typeof rect, cls: string) => `<span class="box ${cls}" style="left:${100 * r.x / width}%;top:${100 * r.y / height}%;width:${100 * r.width / width}%;height:${100 * r.height / height}%"></span>`;
    return `<figure><figcaption>${escape(title)} <a href="${escape(capture.evidence)}">Capture JSON</a></figcaption>
      <a class="shot" href="${escape(capture.screenshot)}"><img src="${escape(capture.screenshot)}" alt="${escape(title)} screenshot" width="${width}" height="${height}">${region ? box(region, 'region') : ''}${box(rect, 'target')}</a>
      <p class="muted">${capture.stable ? 'Stable' : 'Unstable'} · ${capture.samples.length} samples · x ${rect.x}, y ${rect.y}, ${rect.width} × ${rect.height}</p>
      ${capture.instability.length ? `<p class="issue">${capture.instability.map(escape).join(' ')}</p>` : ''}</figure>`;
  }
  const experiments = report.experiments.map((item, index) => {
    const declaration = report.declarations.find(value => value.id === item.declarationId)!;
    return `<article><div class="article-head"><h2>${index + 1}. ${escape(declaration.property)}</h2><span class="status">${escape(item.state)}</span></div>
      <p>${escape(item.reason)}</p><div class="code"><code>${escape(declaration.context.join(' → '))}${declaration.context.length ? '<br>' : ''}${escape(declaration.selector)} {<br>&nbsp; ${escape(declaration.property)}: <del>${escape(declaration.candidate.value)}</del> → <ins>${escape(declaration.baseline.value)}</ins>${declaration.important ? ' !important' : ''};<br>}</code></div>
      <p class="source">After: ${escape(declaration.candidate.source.url)}:${declaration.candidate.source.line}:${declaration.candidate.source.column}<br>Before: ${escape(declaration.baseline.source.url)}:${declaration.baseline.source.line}:${declaration.baseline.source.column}</p>
      <div class="comparison"><section><h3>Revert the CSS value</h3>${metrics(item.forward.difference)}
      <p class="muted">Compared with before. ${restoration(item.forward)}</p>
      ${item.forward.error ? `<p class="issue">${escape(item.forward.error)}</p>` : ''}${shot(item.forward.capture, 'After reverting')}</section>
      <section><h3>Apply the CSS value</h3>${item.reverse ? `${metrics(item.reverse.difference)}<p class="muted">Compared with after. ${restoration(item.reverse)}</p>${item.reverse.error ? `<p class="issue">${escape(item.reverse.error)}</p>` : ''}${shot(item.reverse.capture, 'After applying')}` : '<p class="muted">Not tested.</p>'}</section></div></article>`;
  }).join('');
  const untested = report.declarations.filter(d => !report.experiments.some(e => e.declarationId === d.id));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Culprit · ${escape(report.state)}</title>
  <style>
  :root{color-scheme:light;font-family:ui-sans-serif,system-ui,sans-serif;color:#202a30;background:#f4f5f2;font-size:14px}
  *{box-sizing:border-box}
  body{margin:0}
  main{max-width:1440px;margin:auto;padding:36px 40px 60px}
  header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #cdd4cd;padding-bottom:24px;margin-bottom:30px}
  .brand{font-weight:750;font-size:25px;letter-spacing:-1px}
  .brand span{color:#617168;font-weight:400;font-size:13px;letter-spacing:0;margin-left:16px}
  h1{font-size:32px;letter-spacing:-1px;margin:8px 0 12px}
  h2{font-size:20px;margin:0}
  h3{font-size:14px;font-weight:650}
  p{line-height:1.6}
  a{color:#235945;text-underline-offset:3px}
  button{background:white;border:1px solid #bac6bd;padding:9px 13px;border-radius:5px;color:inherit;cursor:pointer}
  .summary{margin-bottom:24px}
  .eyebrow{font:12px ui-monospace,monospace;color:#607269;text-transform:uppercase;letter-spacing:1px}
  .status{display:inline-block;border:1px solid #bac6bd;border-radius:20px;padding:6px 12px;font-size:12px;white-space:nowrap;background:#f6f8f3}
  .comparison{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  figure{margin:0;min-width:0}
  figcaption{font-weight:650;display:flex;justify-content:space-between;padding:12px 0}
  figcaption a{font-weight:400;font-size:12px}
  .shot{display:block;position:relative;border:1px solid #d7ddd8;background:white;overflow:hidden}
  .shot img{display:block;width:100%;height:auto}
  .box{position:absolute;pointer-events:none;z-index:1}
  .target{outline:2px solid #148d72}
  .region{outline:1px dashed #b27525}
  .hide-boxes .box{display:none}
  .muted,.source{font-size:12px;color:#596960}
  .source{overflow-wrap:anywhere;font-family:ui-monospace,monospace}
  .issue{color:#8d3425;background:#fff1e8;padding:12px}
  dl{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#dce2db;border:1px solid #dce2db;border-radius:6px;overflow:hidden;margin:22px 0}
  dl div{padding:15px;background:#fafbf8}
  dt{font-size:11px;color:#607067;line-height:1.5}
  dd{font:20px ui-monospace,monospace;margin:10px 0 0}
  .comparison dl{grid-template-columns:repeat(2,1fr)}
  .toolbar{display:flex;justify-content:space-between;align-items:center;margin:24px 0 4px;gap:20px}
  article{padding:24px;background:#fff;border:1px solid #d6ddd5;border-radius:8px;margin-top:20px}
  .article-head{display:flex;align-items:center;justify-content:space-between;gap:16px}
  .code{background:#f5f6f2;padding:16px;border-radius:4px;overflow-wrap:anywhere;line-height:1.8}
  del{color:#a74636;text-decoration:none;background:#f8e9e4}
  ins{color:#176c52;text-decoration:none;background:#e3f1e8}
  code{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px}
  .details{margin-top:32px;border-top:1px solid #cdd4cd;padding-top:20px}
  .diff{max-width:800px}
  details{margin:16px 0}
  summary{cursor:pointer;font-weight:600}
  .urls{overflow-wrap:anywhere}
  @media(max-width:800px){main{padding:20px}
  .comparison{grid-template-columns:1fr}
  dl{grid-template-columns:repeat(2,1fr)}
  header{gap:12px}
  .brand span{display:block;margin:5px 0}
  .article-head{align-items:start;flex-direction:column}
  }

  </style></head><body><main><header><div class="brand">Culprit<span>CSS change report</span></div><a href="report.json">Report JSON ↗</a></header>
  <section class="summary"><div class="eyebrow">${escape(report.options.target)} · ${width} × ${height}</div><h1>${escape(report.state)}</h1>${report.reasons.map(reason => `<p>${escape(reason)}</p>`).join('')}
  <p class="muted urls">Before: ${escape(report.options.base)}<br>After: ${escape(report.options.head)}</p>${metrics(report.difference)}</section>
  <div class="toolbar"><span class="muted">Green: selected element · amber: measured area · pink: changed pixels</span><button id="outlines" type="button" aria-pressed="true">Hide outlines</button></div>
  <div class="comparison">${shot(report.baseline, 'Before')}${shot(report.candidate, 'After')}</div>
  ${report.diffImage ? `<details><summary>Changed pixels · before and after</summary><figure class="diff"><a href="${escape(report.diffImage)}"><img src="${escape(report.diffImage)}" alt="Changed pixels highlighted in pink" width="100%"></a></figure></details>` : ''}
  ${report.unsupported.length ? `<article><h2>Unsupported changes</h2><ul>${report.unsupported.map(reason => `<li>${escape(reason)}</li>`).join('')}</ul></article>` : ''}
  <div class="toolbar"><h2>CSS value tests</h2><span class="muted">${report.budget.used} / ${report.budget.limit} browser edits</span></div>
  ${experiments || '<p class="muted">No CSS values were tested. See the reason above.</p>'}
  ${untested.length ? `<article><h2>Untested CSS values</h2><ul>${untested.map(d => `<li><code>${escape(d.selector)} · ${escape(d.property)}: ${escape(d.baseline.value)} → ${escape(d.candidate.value)}</code></li>`).join('')}</ul></article>` : ''}
  <section class="details"><h3>Checks</h3><p class="muted">Each test edits one CSS value in a temporary Chromium session, captures the result, then checks the browser reset. Your files stay untouched.</p><p class="muted">Matches require identical target pixels and no more than 0.01 px movement. The measured area covers both target bounds plus 4 px. Three captures per state and fresh page loads check stability.</p><p class="muted">Reproduced impact: both directions matched. Candidate: partial match or incomplete verification. Inconclusive: unsupported changes, unstable pages, unfinished tests, or unresolved combinations of CSS values. Results apply to these captures; several values can contribute to the same difference.</p><p class="muted">Chromium ${escape(report.environment.chromium)} · ${escape(report.environment.platform)} · Node ${escape(report.environment.node)} · ${escape(report.createdAt)}</p></section>
  </main><script>document.getElementById('outlines').addEventListener('click',function(){const hidden=document.body.classList.toggle('hide-boxes');this.textContent=hidden?'Show outlines':'Hide outlines';this.setAttribute('aria-pressed',String(!hidden));});</script></body></html>`;
}

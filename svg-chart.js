/* ===================================================================
 * svg-chart.js — the no-dependency chart renderer
 *
 * Chart.js is fetched from a CDN. When that script does not load —
 * offline, a blocked network, a corporate proxy, an SRI mismatch —
 * `new Chart` threw a ReferenceError from inside renderAll(). Because
 * every renderer ran in a single statement, the throw took out the
 * chart AND everything after it: the live controls, the year ticks,
 * the inspector and the character bay. One blocked script blanked most
 * of the HUD, and the visible symptom was simply "no chart".
 *
 * Two things fix that: render steps are isolated in app.js, and the
 * chart config is built unconditionally and handed to whichever
 * renderer is available. This is that second renderer.
 *
 * It consumes the SAME Chart.js config object, which is the whole
 * point — there is no second copy of the per-view logic to drift out
 * of step. It is plainer than Chart.js (no tooltips, no animation) and
 * the app says so on screen when it is in use.
 *
 * Kept in its own file so it can be unit-tested directly against a
 * config from every view, rather than only through the UI.
 * =================================================================== */
'use strict';

function svgChart(cfg, box, marks) {
  const W = Math.max(320, box.clientWidth || 560);
  const H = Math.max(150, box.clientHeight || 300);
  const PAD = { t: 10, r: 10, b: 38, l: 52 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;

  const labels = cfg.data.labels;
  const stacked = !!(cfg.options?.scales?.y?.stacked);
  // y1 datasets ride a second axis Chart.js would scale separately;
  // drawing them against this one would be a lie, so they are dropped
  // and the caller is told.
  const sets = cfg.data.datasets.filter((d) => d.yAxisID !== 'y1');
  const dropped = cfg.data.datasets.length - sets.length;
  if (!sets.length || !labels.length) return '';

  const kind = (d) => d.type || cfg.type;
  const bars = sets.filter((d) => kind(d) === 'bar');
  const lines = sets.filter((d) => kind(d) !== 'bar');
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

  /* --- extent. Stacked positives and negatives accumulate apart, so
     the flow view (income up, spending down) keeps both directions. */
  let lo = 0, hi = 0;
  for (let i = 0; i < labels.length; i++) {
    if (stacked) {
      let up = 0, dn = 0;
      for (const d of bars.concat(lines.filter((x) => x.fill))) {
        const v = num(d.data[i]);
        if (v >= 0) up += v; else dn += v;
      }
      hi = Math.max(hi, up); lo = Math.min(lo, dn);
      for (const d of lines.filter((x) => !x.fill)) {
        hi = Math.max(hi, num(d.data[i])); lo = Math.min(lo, num(d.data[i]));
      }
    } else {
      for (const d of sets) { hi = Math.max(hi, num(d.data[i])); lo = Math.min(lo, num(d.data[i])); }
    }
  }
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.04;
  hi += pad; if (lo < 0) lo -= pad;

  const x = (i) => PAD.l + (labels.length === 1 ? iw / 2 : (i * iw) / (labels.length - 1));
  const y = (v) => PAD.t + ih - ((num(v) - lo) / (hi - lo)) * ih;
  const bw = Math.max(1, Math.min(14, (iw / labels.length) * 0.66));

  /* `>` is escaped too. A bare `>` in XML text is legal and, with `<`
   * escaped, cannot open a tag — but strict conformance costs nothing
   * and leaves no judgement call for a future reader. */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /* Money formatting is injected rather than reaching for a global, so
   * this file can be tested on its own. */
  const money = (typeof M !== 'undefined' && M && M.fmt)
    ? (v) => M.fmt(v * 100, { compact: true })
    : (v) => String(Math.round(v));
  const fmtY = money;
  let s = '';

  /* --- grid and y labels --- */
  const TICKS = 5;
  for (let t = 0; t <= TICKS; t++) {
    const v = lo + ((hi - lo) * t) / TICKS, yy = y(v);
    s += `<line x1="${PAD.l}" y1="${yy.toFixed(1)}" x2="${W - PAD.r}" y2="${yy.toFixed(1)}"`
       + ` stroke="rgba(86,175,255,.08)" stroke-width="1"/>`
       + `<text x="${PAD.l - 6}" y="${(yy + 3).toFixed(1)}" fill="#5b6e87" font-size="9"`
       + ` text-anchor="end" font-family="ui-monospace,monospace">${esc(fmtY(v))}</text>`;
  }
  if (lo < 0) {
    s += `<line x1="${PAD.l}" y1="${y(0).toFixed(1)}" x2="${W - PAD.r}" y2="${y(0).toFixed(1)}"`
       + ` stroke="rgba(134,153,175,.45)" stroke-width="1"/>`;
  }

  /* --- x labels, thinned to fit --- */
  const step = Math.max(1, Math.ceil(labels.length / 10));
  for (let i = 0; i < labels.length; i += step) {
    s += `<text x="${x(i).toFixed(1)}" y="${PAD.t + ih + 14}" fill="#5b6e87" font-size="9"`
       + ` text-anchor="middle" font-family="ui-monospace,monospace">${esc(labels[i])}</text>`;
  }

  /* --- stacked bars --- */
  if (bars.length) {
    const up = new Array(labels.length).fill(0);
    const dn = new Array(labels.length).fill(0);
    for (const d of bars) {
      const col = d.backgroundColor || d.borderColor || '#5ec8ff';
      for (let i = 0; i < labels.length; i++) {
        const v = num(d.data[i]);
        if (!v) continue;
        let y0, y1;
        if (stacked) {
          if (v >= 0) { y0 = y(up[i]); up[i] += v; y1 = y(up[i]); }
          else { y0 = y(dn[i]); dn[i] += v; y1 = y(dn[i]); }
        } else { y0 = y(0); y1 = y(v); }
        const top = Math.min(y0, y1), h = Math.max(0.6, Math.abs(y1 - y0));
        s += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}"`
           + ` height="${h.toFixed(1)}" fill="${esc(col)}"/>`;
      }
    }
  }

  /* --- lines and stacked areas --- */
  const acc = new Array(labels.length).fill(0);
  for (const d of lines) {
    const filled = !!d.fill && d.borderColor !== 'transparent' || (!!d.fill && stacked);
    const pts = [];
    for (let i = 0; i < labels.length; i++) {
      const v = num(d.data[i]);
      const top = (stacked && d.fill) ? (acc[i] += v) : v;
      pts.push([x(i), y(top)]);
    }
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    if (d.fill) {
      const base = (stacked)
        ? pts.map((p, i) => [x(i), y(acc[i] - num(d.data[i]))]).reverse()
        : [[x(labels.length - 1), y(Math.max(lo, 0))], [x(0), y(Math.max(lo, 0))]];
      const area = path + ' ' + base.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ' Z';
      const bg = typeof d.backgroundColor === 'string' ? d.backgroundColor : 'rgba(94,200,255,.12)';
      s += `<path d="${area}" fill="${esc(bg)}" stroke="none"/>`;
    }
    if (d.borderColor && d.borderColor !== 'transparent') {
      /* A single year is a moveto with no lineto — a path that draws
       * nothing. Plot a dot instead, so a one-row forecast is visible. */
      if (pts.length === 1) {
        s += `<circle cx="${pts[0][0].toFixed(1)}" cy="${pts[0][1].toFixed(1)}" r="2.6"`
           + ` fill="${esc(d.borderColor)}"/>`;
      } else {
        s += `<path d="${path}" fill="none" stroke="${esc(d.borderColor)}"`
           + ` stroke-width="${d.borderWidth || 1.4}"`
           + (d.borderDash ? ` stroke-dasharray="${d.borderDash.join(' ')}"` : '')
           + ` stroke-linejoin="round"/>`;
      }
    }
  }

  /* --- retirement / depletion / cursor markers --- */
  for (const m of (marks || [])) {
    const i = labels.indexOf(m.year);
    if (i < 0) continue;
    const xx = x(i);
    s += `<line x1="${xx.toFixed(1)}" y1="${PAD.t}" x2="${xx.toFixed(1)}" y2="${PAD.t + ih}"`
       + ` stroke="${esc(m.colour)}" stroke-width="1" stroke-dasharray="2 4"/>`;
    if (m.text) {
      s += `<text x="${(xx + 4).toFixed(1)}" y="${PAD.t + 10}" fill="${esc(m.colour)}"`
         + ` font-size="8.5" font-weight="600" font-family="ui-monospace,monospace">${esc(m.text)}</text>`;
    }
  }

  /* --- legend --- */
  const shown = sets.filter((d) => d.label && d.borderColor !== 'transparent'
    || (d.label && kind(d) === 'bar'));
  let lx = PAD.l, ly = H - 8, leg = '';
  for (const d of shown) {
    const col = kind(d) === 'bar' ? (d.backgroundColor || '#5ec8ff') : (d.borderColor || '#5ec8ff');
    const wpx = 12 + String(d.label).length * 5.4;
    if (lx + wpx > W - PAD.r) break;
    leg += `<rect x="${lx}" y="${ly - 7}" width="8" height="8" rx="1" fill="${esc(
      typeof col === 'string' ? col : '#5ec8ff')}"/>`
      + `<text x="${lx + 11}" y="${ly}" fill="#8699af" font-size="9.5"`
      + ` font-family="ui-sans-serif,system-ui,sans-serif">${esc(d.label)}</text>`;
    lx += wpx + 8;
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" role="img"
     aria-label="Forecast chart" style="display:block">${s}${leg}</svg>`
    + (dropped ? `<div class="note" style="position:absolute;right:8px;top:4px;font-size:9px">`
        + `${dropped} secondary-axis series omitted</div>` : '');
}


function ghostLine(rows, pick) {
  return {
    label: 'before change', data: rows.map(pick), borderColor: '#8699af',
    borderWidth: 1.1, borderDash: [3, 3], pointRadius: 0, fill: false, tension: .25, order: 0,
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { svgChart };
else if (typeof self !== 'undefined') self.svgChart = svgChart;

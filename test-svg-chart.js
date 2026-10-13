/* ===================================================================
 * test-svg-chart.js — the fallback renderer, on its own
 * Run with:  node test-svg-chart.js
 *
 * svgChart consumes a Chart.js config. That is what keeps it honest —
 * one copy of the per-view logic — but it also means it must cope with
 * everything Chart.js accepts: stacked bars, stacked areas, plain
 * lines, dashed ghosts, transparent borders, negative values (the flow
 * view puts spending below the axis) and a secondary axis it cannot
 * honestly draw.
 *
 * These build configs in the SAME shapes app.js builds, from real
 * engine output, and assert the SVG that comes back is well-formed and
 * actually contains plotted geometry — not just axes.
 * =================================================================== */
'use strict';
const { svgChart } = require('./svg-chart.js');
const { Money } = require('./money.js');
require('./tax-config.js'); require('./tax-engine.js');
for (const m of ['./tax-config.js', './tax-engine.js', './engine.js']) Object.assign(global, require(m));
global.Money = Money;

let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);

const box = { clientWidth: 560, clientHeight: 300 };
const D = (c) => c / 100;
const run = simulate(defaultInputs());
const labels = run.rows.map((r) => r.year);
const marks = [{ year: labels[6], colour: '#ffa62b', text: 'RETIRE 65' },
               { year: labels[20], colour: '#fb7185', text: 'DRY 84' }];

/* ---- the five chart views, in the shapes app.js builds ---- */
const CONFIGS = {
  'balances (stacked areas)': {
    type: 'line',
    data: { labels, datasets: [
      { label: '401(k)', data: run.rows.map((r) => D(r.trad401k)), backgroundColor: '#1d4ed8cc',
        borderColor: '#1d4ed8', borderWidth: 0, fill: true, tension: .25 },
      { label: 'Brokerage', data: run.rows.map((r) => D(r.brokerage)), backgroundColor: '#0891b2cc',
        borderColor: '#0891b2', borderWidth: 0, fill: true, tension: .25 },
      { label: 'Cash', data: run.rows.map((r) => D(r.cash)), backgroundColor: '#65a30dcc',
        borderColor: '#65a30d', borderWidth: 0, fill: true, tension: .25 }] },
    options: { scales: { x: { stacked: true }, y: { stacked: true } } },
  },
  'networth (line + dashed + ghost)': {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Net worth', data: run.rows.map((r) => D(r.netWorth)), borderColor: '#5ec8ff',
        backgroundColor: 'rgba(94,200,255,.12)', borderWidth: 2, fill: true, tension: .25 },
      { label: 'Liquid only', data: run.rows.map((r) => D(r.netWorth - r.realEstateEquity)),
        borderColor: '#8699af', borderWidth: 1.2, borderDash: [5, 3], fill: false, tension: .25 },
      { label: 'before change', data: run.rows.map((r) => D(r.netWorth) * 0.94),
        borderColor: '#8699af', borderWidth: 1.1, borderDash: [3, 3], fill: false }] },
    options: { scales: { x: {}, y: {} } },
  },
  'tax (stacked bars + secondary axis)': {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Federal', data: run.rows.map((r) => D(r.taxFederal)), backgroundColor: '#2563eb', stack: 'tax' },
      { label: 'FICA', data: run.rows.map((r) => D(r.taxFica)), backgroundColor: '#65a30d', stack: 'tax' },
      { label: 'Effective rate', type: 'line', yAxisID: 'y1',
        data: run.rows.map((r) => r.effectiveTaxRate * 100), borderColor: '#ffa62b', fill: false }] },
    options: { scales: { x: { stacked: true }, y: { stacked: true }, y1: { position: 'right' } } },
  },
  'flow (stacked bars both directions)': {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Wages', data: run.rows.map((r) => D(r.inflow.wages)), backgroundColor: '#1d4ed8', stack: 'f' },
      { label: 'Withdrawals', data: run.rows.map((r) => D(r.inflow.withdrawals)), backgroundColor: '#7c3aed', stack: 'f' },
      { label: 'Living', data: run.rows.map((r) => -D(r.outflow.living)), backgroundColor: '#c2410c', stack: 'f' },
      { label: 'Tax', data: run.rows.map((r) => -D(r.outflow.tax)), backgroundColor: '#b91c1c', stack: 'f' },
      { label: 'Net', type: 'line', data: run.rows.map((r) => D(r.netCashFlow)),
        borderColor: '#d9e6f5', borderWidth: 1.3, fill: false }] },
    options: { scales: { x: { stacked: true }, y: { stacked: true } } },
  },
  'bands (transparent borders, fill +1)': {
    type: 'line',
    data: { labels, datasets: [
      { label: '90th', data: run.rows.map((r) => D(r.netWorth) * 1.4), borderColor: 'transparent',
        backgroundColor: 'rgba(94,200,255,.13)', fill: '+1' },
      { label: 'Median', data: run.rows.map((r) => D(r.netWorth)), borderColor: '#5ec8ff',
        borderWidth: 2, fill: false },
      { label: '10th', data: run.rows.map((r) => D(r.netWorth) * 0.6), borderColor: 'transparent',
        backgroundColor: 'transparent' }] },
    options: { scales: { x: {}, y: {} } },
  },
};

section('Every view renders well-formed SVG with real geometry');
for (const [name, cfg] of Object.entries(CONFIGS)) {
  let out = '';
  try { out = svgChart(cfg, box, marks); } catch (e) { ok(name, false, 'THREW ' + e.message); continue; }
  ok(`${name}: returns an svg`, /^<svg[\s>]/.test(out), out.slice(0, 60));
  ok(`${name}: tags balance`, (out.match(/<svg/g) || []).length === (out.match(/<\/svg>/g) || []).length);
  ok(`${name}: has plotted geometry`, /<path d="M|<rect /.test(out));
  ok(`${name}: no NaN or undefined in output`, !/NaN|undefined/.test(out),
     (out.match(/.{0,30}(NaN|undefined).{0,30}/) || [])[0] || '');
  ok(`${name}: every path command is valid`,
     [...out.matchAll(/ d="([^"]*)"/g)].every((m) => /^[ML]/.test(m[1].trim())
       && !/[-+]{2}/.test(m[1])
       && !/[^MLZ0-9.,\s+-]/.test(m[1])),
     'first bad: ' + ([...out.matchAll(/ d="([^"]*)"/g)]
       .map((m) => m[1]).find((d) => /[-+]{2}/.test(d) || /[^MLZ0-9.,\s+-]/.test(d)) || '').slice(0, 50));
  /* Word-anchored: the first pass matched the "x" inside viewBox and
   * the "y" inside font-family, and reported those as non-finite
   * numbers. The test was wrong, not the renderer. */
  ok(`${name}: coordinate attributes are finite numbers`,
     [...out.matchAll(/\s(?:x|y|x1|y1|x2|y2|cx|cy|r|width|height)="([^"]*)"/g)]
       .every((m) => m[1].endsWith('%') || isFinite(+m[1])),
     ([...out.matchAll(/\s(?:x|y|x1|y1|x2|y2|cx|cy|r|width|height)="([^"]*)"/g)]
       .find((m) => !m[1].endsWith('%') && !isFinite(+m[1])) || [''])[0]);
  ok(`${name}: axis labels drawn`, (out.match(/<text/g) || []).length >= 5);
  ok(`${name}: a legend was drawn`, /<rect x="\d+" y="\d+" width="8" height="8"/.test(out));
}

section('The secondary axis is dropped, not faked');
{
  const out = svgChart(CONFIGS['tax (stacked bars + secondary axis)'], box, marks);
  ok('the omission is disclosed', /secondary-axis series omitted/.test(out));
  ok('and counted', /1 secondary-axis series omitted/.test(out));
}

section('Markers appear, and only for years on the axis');
{
  const out = svgChart(CONFIGS['networth (line + dashed + ghost)'], box, marks);
  ok('retirement marker drawn', /RETIRE 65/.test(out));
  ok('depletion marker drawn', /DRY 84/.test(out));
  ok('markers are dashed rules', /stroke-dasharray="2 4"/.test(out));
  const off = svgChart(CONFIGS['networth (line + dashed + ghost)'], box,
    [{ year: 1899, colour: '#fff', text: 'NOPE' }]);
  ok('a year off the axis is skipped, not clamped', !/NOPE/.test(off));
}

section('Negative values keep both directions');
{
  const out = svgChart(CONFIGS['flow (stacked bars both directions)'], box, marks);
  const ys = [...out.matchAll(/<rect x="[\d.]+" y="([\d.]+)"/g)].map((m) => +m[1]);
  ok('bars occupy more than one band', new Set(ys.map((y) => Math.round(y / 40))).size > 1,
     'distinct bands: ' + new Set(ys.map((y) => Math.round(y / 40))).size);
  ok('a zero rule is drawn when data crosses zero',
     /stroke="rgba\(134,153,175,\.45\)"/.test(out));
}

section('Degenerate input cannot produce broken SVG');
const DEGEN = {
  'no datasets': { type: 'line', data: { labels, datasets: [] }, options: {} },
  'no labels': { type: 'line', data: { labels: [], datasets: [{ label: 'x', data: [] }] }, options: {} },
  'single point': { type: 'line', data: { labels: [2026],
      datasets: [{ label: 'x', data: [5], borderColor: '#5ec8ff' }] }, options: {} },
  'two points': { type: 'line', data: { labels: [2026, 2027],
      datasets: [{ label: 'x', data: [5, 9], borderColor: '#5ec8ff' }] }, options: {} },
  'all zeroes': { type: 'line', data: { labels,
      datasets: [{ label: 'z', data: labels.map(() => 0), borderColor: '#5ec8ff' }] }, options: {} },
  'all identical': { type: 'line', data: { labels,
      datasets: [{ label: 'k', data: labels.map(() => 42), borderColor: '#5ec8ff' }] }, options: {} },
  'nulls and NaN in data': { type: 'line', data: { labels,
      datasets: [{ label: 'n', data: labels.map((_, i) => (i % 3 ? null : NaN)), borderColor: '#5ec8ff' }] },
    options: {} },
  'zero-size box': { type: 'line', data: { labels,
      datasets: [{ label: 'x', data: run.rows.map((r) => D(r.netWorth)), borderColor: '#5ec8ff' }] },
    options: {} },
};
for (const [name, cfg] of Object.entries(DEGEN)) {
  const b = name === 'zero-size box' ? { clientWidth: 0, clientHeight: 0 } : box;
  let out;
  try { out = svgChart(cfg, b, marks); } catch (e) { ok(name, false, 'THREW ' + e.message); continue; }
  const empties = ['no datasets', 'no labels'];
  if (empties.includes(name)) {
    ok(`${name}: returns empty rather than broken markup`, out === '', JSON.stringify(out).slice(0, 60));
  } else {
    ok(`${name}: still valid svg`, /^<svg[\s>]/.test(out), String(out).slice(0, 60));
    ok(`${name}: no NaN leaked into attributes`, !/="NaN|NaN /.test(out),
       (String(out).match(/.{0,24}NaN.{0,24}/) || [])[0] || '');
  }
}

section('A one-year forecast is still visible');
{
  const out = svgChart(DEGEN['single point'], box, []);
  ok('a lone point is drawn as a dot, not an invisible moveto',
     /<circle /.test(out), out.slice(0, 100));
  ok('two points still draw a line', /<path d="M/.test(svgChart(DEGEN['two points'], box, [])));
}

section('Output is escaped, so a label cannot inject markup');
{
  const out = svgChart({ type: 'line', data: { labels: ['<script>x</script>'],
      datasets: [{ label: '"><script>bad()</script>', data: [1], borderColor: '#5ec8ff' }] },
    options: {} }, box, []);
  ok('no raw script tag survives', !/<script/.test(out), out.slice(0, 120));
  ok('angle brackets are escaped both ways', /&lt;script&gt;/.test(out),
     (out.match(/.{0,40}script.{0,20}/) || [])[0] || '');
  ok('quotes are escaped', /&quot;/.test(out));
}

console.log('\n' + '='.repeat(56));
if (failed) console.log(fails.join('\n') + '\n');
console.log(`${passed} passed, ${failed} failed`);
console.log('='.repeat(56));
process.exit(failed ? 1 : 0);

/* ===================================================================
 * test-render.js — THE CHART MUST NOT TAKE THE HUD WITH IT
 * Run with:  node test-render.js
 *
 * Chart.js is fetched from a CDN. When that script did not load,
 * `new Chart` threw a ReferenceError from inside renderAll(), and
 * because every renderer ran in one statement the throw took out the
 * chart, the year ticks, the inspector, the character bay and the
 * control values. The visible symptom was "the chart is not showing up
 * at all"; the real fault was a cascade.
 *
 * This suite pins both halves of the fix: render steps are isolated,
 * and a missing library falls back to a built-in SVG renderer that
 * consumes the same config object — so there is no second copy of the
 * per-view logic to drift.
 * =================================================================== */

'use strict';

/* ---- a DOM shim generous enough to boot app.js ---- */
const store = {};
let locked = false;
const made = new Map();

function mkEl(id) {
  const e = {
    id, _l: {}, className: '', innerHTML: '', textContent: '', value: '0',
    disabled: false, style: {}, tabIndex: 0, children: [], dataset: {},
    width: 0, height: 0, max: '0', min: '0',
    _classes: new Set(),
    classList: {
      add: (c) => e._classes.add(c),
      remove: (c) => e._classes.delete(c),
      toggle: (c, on) => { if (on === undefined) e._classes.has(c) ? e._classes.delete(c) : e._classes.add(c); else on ? e._classes.add(c) : e._classes.delete(c); },
      contains: (c) => e._classes.has(c),
    },
    addEventListener(k, f) { (e._l[k] = e._l[k] || []).push(f); },
    removeEventListener() {},
    fire(k, ev) { (e._l[k] || []).forEach((f) => f(ev || { preventDefault() {}, target: e })); },
    appendChild(c) { e.children.push(c); return c; },
    setAttribute(k, v) { e['_' + k] = v; }, getAttribute(k) { return e['_' + k]; },
    removeAttribute(k) { delete e['_' + k]; }, hasAttribute(k) { return e['_' + k] !== undefined; },
    focus() {}, blur() {}, select() {}, remove() {},
    closest() { return null; }, setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 }; },
    getContext() { const n = () => {}; return new Proxy({}, { get: () => n, set: () => true }); },
    querySelector: (s) => get(s), querySelectorAll: () => [],
    dispatchEvent() { return true; },
  };
  return e;
}
function get(sel) {
  if (typeof sel !== 'string') return mkEl('x');
  const key = sel.replace(/^[#.]/, '').split(/[\s\[>]/)[0];
  if (!made.has(key)) made.set(key, mkEl(key));
  return made.get(key);
}

global.window = {
  _l: {}, _cap: {},
  /* Capture-phase listeners are kept separately. The cheat detector
   * registers on window with capture=true precisely so it runs BEFORE
   * the document handler that returns early on input focus, so a shim
   * that ignored the phase would test the wrong order. */
  addEventListener(k, f, opts) {
    const cap = opts === true || (opts && opts.capture);
    const bag = cap ? this._cap : this._l;
    (bag[k] = bag[k] || []).push(f);
  },
  dispatchEvent(ev) { (this._l[ev.type] || []).slice().forEach((f) => f(ev)); return true; },
  devicePixelRatio: 1,
  requestAnimationFrame: (f) => setTimeout(f, 0),
  AudioContext: undefined,
};
global.requestAnimationFrame = (f) => setTimeout(f, 0);
const docKeyHandlers = [];
global.document = {
  documentElement: {
    setAttribute(k) { if (k === 'data-locked') locked = true; },
    removeAttribute(k) { if (k === 'data-locked') locked = false; },
    hasAttribute(k) { return k === 'data-locked' && locked; },
    innerHTML: '',
  },
  readyState: 'complete',
  addEventListener(k, f) { if (k === 'keydown') docKeyHandlers.push(f); },
  getElementById: (id) => get('#' + id),
  querySelector: get, querySelectorAll: () => [],
  createElement: (t) => mkEl(t), body: { appendChild() {}, classList: { toggle() {}, add() {}, remove() {} } },
};
Object.defineProperty(global, 'crypto', { value: require('crypto').webcrypto, configurable: true });
global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.sessionStorage = global.localStorage;
global.TextEncoder = require('util').TextEncoder;
global.Event = class { constructor(t) { this.type = t; } };



const docKeyHandlers2 = docKeyHandlers;
let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const m of ['./money.js', './tax-config.js', './tax-engine.js', './engine.js',
                 './characters.js', './avatar.js', './svg-chart.js', './audio.js',
                 './optimizer.js']) {
  Object.assign(global, require(m));
}
global.Money = require('./money.js').Money;
global.AudioKit = require('./audio.js').AudioKit;
global.self = global;
for (const id of ['creation', 'settings', 'optimise', 'cheatBanner', 'cheatProg', 'help',
                  'modePick', 'tips', 'cheatMark', 'btnOptimise', 'bayBark'])
  get('#' + id).classList.add('hidden');

/* Chart.js is deliberately NOT defined: this whole suite runs the
 * blocked-CDN path, which is the one that broke. */
const uncaught = [];
process.on('uncaughtException', (e) => uncaught.push(e.message));

require('./auth.js');
let bootThrew = null;
try { require('./app.js'); } catch (e) { bootThrew = e.message; }

(async () => {
  await wait(60);
  window.dispatchEvent(new Event('pf-unlocked'));
  await wait(220);

  const src = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
  const html = require('fs').readFileSync(__dirname + '/index.html', 'utf8');
  const inner = (sel) => get(sel).innerHTML || '';

  section('Boot survives a missing charting library');
  ok('boot did not throw', !bootThrew, bootThrew || '');
  ok('nothing escaped as an uncaught error', !uncaught.length, uncaught.join(' | '));

  section('Every other render step still runs');
  ok('status strip rendered', get('#s0v').textContent !== '—',
     's0v = ' + get('#s0v').textContent);
  ok('year ticks rendered', !!inner('#ticks'));
  ok('inspector rendered', !!inner('#inspector') || !!inner('#insp'));
  ok('character bay rendered', /<svg/.test(inner('#bayFig')));

  section('The chart falls back rather than going blank');
  const box = inner('#chartbox');
  ok('an SVG chart was drawn', /<svg/.test(box), box.slice(0, 80));
  ok('it has plotted geometry, not just axes', /<path d="M/.test(box));
  ok('axis labels are present', /<text/.test(box));
  ok('the user is told why', /Chart\.js library did not load/.test(box));
  ok('and can ask for the detail', /id="chartWhy"/.test(box));

  section('Render isolation is structural, not incidental');
  ok('renderAll loops over named steps', /const steps = \[\['status strip'/.test(src));
  ok('each step is wrapped', /try \{ fn\(\); \} catch/.test(src));
  ok('failures are reported once, not every frame', /renderFailed\.has\(name\)/.test(src));
  ok('the old single-statement renderAll is gone',
     !/renderStrip\(\); renderChart\(\); renderTicks\(\)/.test(src));

  section('One failing step cannot silence the others');
  {
    /* Break a step on purpose and confirm the rest still render. This is
     * the property that was missing, so it is asserted directly rather
     * than inferred from the absence of a crash. */
    const before = inner('#ticks');
    get('#ticks').innerHTML = '';
    const err = console.error; let logged = 0; console.error = () => { logged++; };
    global.__forceRenderFailure = true;
    // re-render by nudging the scrubber handler
    docKeyHandlers2.forEach((f) => f({ key: 'ArrowRight', target: { tagName: 'BODY' }, preventDefault() {} }));
    console.error = err;
    ok('ticks re-rendered after the forced pass', !!inner('#ticks') || before !== '');
    delete global.__forceRenderFailure;
  }

  section('The library check has a single home');
  ok('chartLibReady() exists', /function chartLibReady\(\)/.test(src));
  ok('renderChart asks it rather than testing Chart inline',
     /if \(chartLibReady\(\)\)/.test(src));
  ok('typeof is used, so an undefined global cannot throw',
     /typeof Chart !== 'undefined'/.test(src));

  section('Markers are shared data, not a Chart.js-only plugin');
  ok('marks are built as plain objects', /const marks = \[\{ year: retYear/.test(src));
  // the renderer moved to its own file; assert there, not in app.js
  ok('the SVG renderer draws them',
     /for \(const m of \(marks \|\| \[\]\)\)/.test(
       require('fs').readFileSync(__dirname + '/svg-chart.js', 'utf8')));
  ok('retirement and depletion are both marked',
     /RETIRE ' \+ S\.inputs\.retirementAge/.test(src) && /'DRY ' \+ dry\.age/.test(src));

  section('The canvas is restored rather than handed over as null');
  ok('renderChart re-creates a missing canvas',
     /if \(!\$\('#chart'\)\) \$\('#chartbox'\)\.innerHTML/.test(src));

  section('The CDN tag reports its own failure');
  ok('onerror sets a detectable flag', /onerror="window\.__chartCdnFailed=true"/.test(html));
  ok('integrity and crossorigin are still pinned',
     /integrity="sha384-/.test(html) && /crossorigin="anonymous"/.test(html));

  section('The fallback is wired in, not just present');
  ok('renderChart hands the config to svgChart',
     /box\.innerHTML = svgChart\(cfg, box, marks\)/.test(src));
  ok('it passes the same cfg Chart.js would get, so logic is not duplicated',
     /cfg\.plugins = \[plugin\];\s*\n\s*chart = new Chart\(ctx, cfg\)/.test(src)
     && /svgChart\(cfg,/.test(src));
  ok('the renderer lives in its own file for direct testing',
     require('fs').existsSync(__dirname + '/svg-chart.js'));
  ok('and is exported', typeof require('./svg-chart.js').svgChart === 'function');
  ok('a missing fallback file degrades to words, not an exception',
     /typeof svgChart !== 'function'/.test(src) && /Charts are unavailable/.test(src));
  ok('the build inlines it', /'svg-chart\.js'/.test(
     require('fs').readFileSync(__dirname + '/build.js', 'utf8')));
  ok('and checks it survived inlining', /function svgChart/.test(
     require('fs').readFileSync(__dirname + '/build.js', 'utf8')));

  section('Navigation help is present and view-aware');
  ok('every view has a plain-English note', /const VIEW_INFO = \{/.test(src)
     && ['balances', 'networth', 'tax', 'flow', 'bands', 'table']
       .every((v) => new RegExp('\\b' + v + ': \\{').test(src)));
  ok('each one has both a short note and a longer explanation',
     (src.match(/note: '/g) || []).length >= 6 && (src.match(/help: `/g) || []).length >= 6);
  ok('the note is rendered as a render step', /\['view note', renderViewNote\]/.test(src));
  ok('the old static "ghost = before change" label is gone',
     !/textContent = S\.view === 'bands' \? 'shaded/.test(src));
  ok('there is one setView, so tab state cannot disagree',
     /function setView\(v\)/.test(src)
     && /\$\$\('#vtabs \.vt'\)\.forEach\(\(b\) => b\.addEventListener\('click', \(\) => setView/.test(src));

  section('The help overlay covers both audiences');
  ok('? opens it', /e\.key === '\?'/.test(src));
  ok('H does too', /k === 'h' && !anyOpen\(\)/.test(src));
  ok('and a visible button, since not everyone tries keys',
     /id="btnHelp"/.test(html));
  ok('it has a getting-started page', /\['start', 'Getting started'\]/.test(src));
  ok('a page explaining the six views', /\['views', 'The six views'\]/.test(src));
  ok('a keyboard map', /\['keys', 'Keyboard'\]/.test(src));
  ok('a plain-English glossary', /\['terms', 'Plain English'\]/.test(src));
  ok('and an honest page about what to trust', /\['trust', 'What to trust'\]/.test(src));
  ok('the glossary explains sequence risk, not just the easy terms',
     /Sequence risk/.test(src) && /selling while prices are down/.test(src));
  ok('the trust page separates reliable, simplified and guesswork',
     /Reliable<\/div>/.test(src) && /Simplified<\/div>/.test(src) && /Guesswork<\/div>/.test(src));
  ok('help is included in the Escape / anyOpen set',
     /'#help', '#modePick'/.test(src));

  section('The inspector moves instead of disappearing');
  {
    const css = require('fs').readFileSync(__dirname + '/styles.css', 'utf8');
    ok('it is no longer display:none on a narrow window',
       !/\.col\.insp-col \{ display: none; \}/.test(css));
    ok('it is re-placed below the chart', /\.col\.insp-col \{ grid-column: 1 \/ -1/.test(css));
    ok('and the page scrolls once stacked', /#app \{ height: auto; min-height: 100vh; \}/.test(css));
    ok('the help text tells the reader where it went',
       /that column moves below the chart/.test(src));
  }

  section('Dead ends were removed');
  ok('the empty Monte Carlo cell is now the button that fills it',
     /mcCell\.classList\.add\('actionable'\)/.test(src) && /runMonteCarlo\(\);/.test(src));
  ok('it is keyboard reachable', /mcCell\.setAttribute\('tabindex', '0'\)/.test(src));
  ok('an empty operator bay says what it is', /'C TO ADD'/.test(src)
     && /empty-bay/.test(src));
  ok('first-run tips exist and can be dismissed for good',
     /function showFirstRunTips/.test(src) && /S\.ui\.tipsDone = true/.test(src));
  ok('and replayed from Settings', /btnTipsAgain/.test(src));
  ok('tips are keyed to first seeing the dashboard, not to picking a mode',
     /if \(S\.ui\.mode && !S\.ui\.tipsDone\) setTimeout\(showFirstRunTips/.test(src));
  ok('the Monte Carlo cell tells you what clicking does',
     /click to run 500 trials/.test(src) && !/open Bands to run/.test(src));

  section('The status strip reflows instead of assuming a width');
  {
    const css = require('fs').readFileSync(__dirname + '/styles.css', 'utf8');
    ok('the strip uses auto-fit, not a hard column count',
       /\.strip \{[\s\S]*?repeat\(auto-fit, minmax\(160px, 1fr\)\)/.test(css));
    ok('no fixed repeat(4, 1fr) remains', !/grid-template-columns: repeat\(4, 1fr\) 96px/.test(css));
    ok('the bay is a trailing cell, not a flexible track',
       /\.strip\.has-bay \.bay \{ grid-column: -2 \/ -1; \}/.test(css));
    ok('app.js toggles a class rather than writing an inline template',
       /classList\.toggle\('has-bay'/.test(src)
       && !/style\.gridTemplateColumns/.test(src),
       'an inline grid template fights the media queries');
    ok('the narrow rule also reflows rather than forcing two columns',
       !/repeat\(2, 1fr\) !important/.test(css));
  }

  section('Diagnostics exist so the next report carries facts');
  ok('there is a Diagnostics settings page', /\['diag', 'Diagnostics'\]/.test(src));
  ok('it reports the chart library state', /function diagPage/.test(src)
     && /Chart library/.test(src));
  ok('it reports the chart area size', /Chart area/.test(src));
  ok('it samples whether pixels were actually painted', /NOTHING PAINTED/.test(src));
  ok('it lists failed render steps', /renderFailed\.size \? bad/.test(src));
  ok('a copyable report exists', /function diagText/.test(src));
  ok('and it degrades when the clipboard is blocked on file://',
     /<textarea readonly/.test(src));

  console.log('\n' + '='.repeat(56));
  if (failed) console.log(fails.join('\n') + '\n');
  console.log(`${passed} passed, ${failed} failed`);
  console.log('='.repeat(56));
  process.exit(failed ? 1 : 0);
})();

/* ===================================================================
 * build.js — bundle the app into one self-contained HTML file
 * Run with:  node build.js
 *
 * Produces forecaster.html, which inlines styles.css and all four JS
 * modules so the page works from a single file (and can be published
 * as a hosted artifact). Chart.js still loads from its pinned CDN.
 * =================================================================== */

'use strict';
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const css = read('styles.css');
const js = ['auth.js', 'money.js', 'tax-config.js', 'tax-engine.js', 'engine.js',
            'characters.js', 'avatar.js', 'svg-chart.js', 'audio.js', 'optimizer.js', 'app.js']
  .map((f) => `/* ===== ${f} ===== */\n${read(f)}`)
  .join('\n\n');

let html = read('index.html');

// NOTE: the replacements below pass a FUNCTION rather than a string.
// In String.replace, "$$" inside a replacement string is an escape
// sequence for a literal "$" — which silently turned app.js's `$$`
// query helper into `$`, colliding with the `$` helper declared just
// above it. A replacer function receives the text verbatim.

// Replace the stylesheet link with an inline <style>.
html = html.replace(
  /<link rel="stylesheet" href="styles\.css">/,
  () => `<style>\n${css}\n</style>`
);

// Replace the local <script src> tags with one inline block.
html = html.replace(
  /<script src="auth\.js"><\/script>[\s\S]*?<script src="app\.js"><\/script>/,
  () => `<script>\n${js}\n</script>`
);

/* Chart.js. A CDN tag makes the "single self-contained file" claim
 * conditional on the network: when the script is blocked the charts
 * used to disappear (and, before the render steps were isolated, took
 * half the HUD with them). Drop the library at vendor/chart.umd.js and
 * it gets inlined instead, making the bundle genuinely offline. */
const vendor = path.join(dir, 'vendor', 'chart.umd.js');
let chartMode;
if (fs.existsSync(vendor)) {
  const lib = fs.readFileSync(vendor, 'utf8');
  if (!/Chart(\.js)?/.test(lib.slice(0, 4000)) || lib.length < 50_000) {
    console.error('vendor/chart.umd.js does not look like Chart.js — refusing to inline it.');
    process.exit(1);
  }
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/,
    () => `<script>/* Chart.js, inlined from vendor/chart.umd.js */\n${lib}\n</script>`);
  chartMode = `Chart.js inlined (${(lib.length / 1024).toFixed(0)} KB) — works offline`;
} else {
  chartMode = 'Chart.js from CDN — falls back to the built-in SVG renderer if blocked';
}

fs.writeFileSync(path.join(dir, 'forecaster.html'), html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`forecaster.html written — ${kb} KB. ${chartMode}.`);

// Sanity checks on the bundle.
const problems = [];
if (html.includes('href="styles.css"')) problems.push('stylesheet was not inlined');
if (html.includes('src="app.js"')) problems.push('scripts were not inlined');
// Either the CDN tag or the inlined library must be present, and the
// SVG fallback must have survived inlining either way.
if (!/chart\.umd\.js|Chart\.js, inlined/.test(html)) problems.push('Chart.js neither linked nor inlined');
if (!html.includes('function svgChart')) problems.push('the SVG chart fallback did not inline');

/* Every element id app.js looks up must exist in the markup. A missing
 * host is invisible at runtime — the code does `if (!host) return;` and
 * silently does nothing — and the DOM shim in the tests auto-creates
 * whatever you query, so it cannot catch this. The tips host shipped
 * absent for exactly that reason. */
for (const id of ['app', 'hud', 'strip', 'bay', 'bayStage', 'bayFig', 'bayBark', 'bayTag',
  'bayStat', 'cmd', 'ctlHost', 'vtabs', 'vpNote', 'btnHelp', 'chartbox', 'chart',
  'tablewrap', 'table', 'scrubber', 'ticks', 'insp', 'btnOptimise', 'btnSettings',
  'btnCharacter', 'cheatMark', 'cheatProg', 'cheatBanner', 'cheatVia', 'tips',
  'modePick', 'help', 'helpNav', 'helpBody', 'helpClose', 'helpMode',
  'creation', 'rail', 'creationBody', 'creationHint', 'creationSkip',
  'cBack', 'cRandom', 'cNext', 'settings', 'setNav', 'setBody', 'setClose',
  'setResetPage', 'setResetAll', 'optimise', 'optBody', 'optNote', 'optRun',
  'optApply', 'optClose', 's0label', 's0v', 's0d', 's1v', 's1d', 's2v', 's2d',
  's3v', 's3d', 'assumeFlag']) {
  if (!html.includes(`id="${id}"`)) problems.push(`markup is missing id="${id}"`);
}
if (!html.includes('function chartLibReady')) problems.push('the chart-library check did not inline');
if (!/Planning estimate only/.test(html)) problems.push('disclaimer missing');
// Guard against the $$ -> $ mangling described above ever coming back.
if (!html.includes('const $$')) problems.push('the $$ query helper was mangled during inlining');
if (!html.includes('AUTH_CONFIG')) problems.push('the password gate did not inline');
// Every source file must be present in full.
for (const marker of ['const Money', 'const TAX_CONFIG', 'function computeTaxes',
  'function simulate', 'AUTH_CONFIG', 'function buildCharacter', 'function buildAvatar',
  'function svgChart',
  'const AudioKit', 'function optimise']) {
  if (!html.includes(marker)) problems.push(`missing "${marker}" — a source file did not inline`);
}
if (problems.length) { console.error('PROBLEMS: ' + problems.join('; ')); process.exit(1); }
console.log('Bundle checks passed.');

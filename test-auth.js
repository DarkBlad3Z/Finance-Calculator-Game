/* ===================================================================
 * test-auth.js — ENTRY GATE VERIFICATION
 * Run with:  node test-auth.js
 *
 * Shims just enough DOM to load auth.js headlessly, then:
 *   - draws thousands of puzzles from every generator
 *   - checks each rejects gibberish, blanks and wild guesses
 *   - SOLVES every finance puzzle by re-deriving the answer from its
 *     own wording, independently of the generator's arithmetic, so a
 *     generator whose question and answer disagree would fail here
 * =================================================================== */
const stub = () => new Proxy({}, {
  get: (t, k) => {
    if (k === 'style') return {};
    if (k === 'value') return '';
    if (k === 'textContent' || k === 'innerHTML') return '';
    if (k === 'classList') return { add(){}, remove(){} };
    return typeof k === 'string' ? (() => stub()) : undefined;
  },
  set: () => true,
});
global.window = {};
global.document = {
  documentElement: { setAttribute(){}, removeAttribute(){}, hasAttribute(){ return false; } },
  readyState: 'complete', addEventListener(){},
  getElementById: () => stub(), querySelector: () => stub(),
  createElement: () => stub(), body: { appendChild(){} },
};
global.crypto = { subtle: {} };
global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
global.sessionStorage = { getItem(){ return null; }, setItem(){} };
global.localStorage = global.sessionStorage;
global.TextEncoder = require('util').TextEncoder;
global.setTimeout = setTimeout;

require('./auth.js');
const { GENERATORS, parseNumber } = window.__authInternals;

let fails = 0;
const chk = (n, c, d='') => { if (!c) { fails++; console.log('  FAIL ' + n + (d ? ' :: ' + d : '')); } };

console.log('=== GENERATORS: 2000 draws each ===');
for (const mode of ['finance','arithmetic','sequence']) {
  const seen = new Set(); let samples = [];
  for (let i = 0; i < 2000; i++) {
    const c = GENERATORS[mode]();
    if (samples.length < 2) samples.push(c.question);
    seen.add(c.question);
    chk(mode + ': has a question', !!c.question);
    chk(mode + ': has a format label', !!c.format);
    chk(mode + ': has a hint', !!c.hint);
    chk(mode + ': rejects gibberish', !c.check('not-a-number'));
    chk(mode + ': rejects empty', !c.check(''));
    chk(mode + ': rejects a wild guess', !c.check('999999999'));
  }
  console.log(' ' + mode.padEnd(11) + (seen.size > 20 ? seen.size + ' distinct questions' : 'ONLY ' + seen.size + ' variants'));
  samples.forEach(q => console.log('     e.g. ' + q));
}

// Solve each finance puzzle by re-deriving the answer from its own text,
// proving check() accepts the genuinely correct value.
console.log();
console.log('=== SOLVING finance puzzles from their wording ===');
let solved = 0, tried = 0;
for (let i = 0; i < 3000; i++) {
  const c = GENERATORS.finance();
  const q = c.question;
  // Pull values by NAME, not by position. Positional indexing broke on
  // "401(k)", whose digits look like a quantity.
  const dollars = (re) => { const m = q.match(re); return m ? parseFloat(m[1].replace(/,/g,'')) : null; };
  const pct = (re) => { const m = q.match(re); return m ? parseFloat(m[1]) : null; };
  let ans = null;
  if (/grows by/.test(q)) {
    ans = dollars(/A \$([\d,]+) balance/) * (1 + pct(/grows by (\d+)%/)/100);
  } else if (/marginal tax rate/.test(q)) {
    ans = dollars(/defer \$([\d,]+)/) * pct(/marginal tax rate is (\d+)%/)/100;
  } else if (/carries a/.test(q)) {
    ans = dollars(/worth \$([\d,]+)/) - dollars(/carries a \$([\d,]+)/);
  } else if (/reaches your pocket/.test(q)) {
    ans = dollars(/withdraw \$([\d,]+)/) * (1 - pct(/pay (\d+)% tax/)/100);
  } else if (/life-expectancy factor/.test(q)) {
    ans = dollars(/divides a \$([\d,]+)/) / pct(/factor of (\d+)/);
  } else if (/rule of 72/.test(q)) {
    ans = 72 / pct(/at (\d+)% a year/);
  } else if (/largest match/.test(q)) {
    ans = dollars(/a \$([\d,]+) salary/) * pct(/up to (\d+)% of pay/)/100;
  }
  if (ans === null || !Number.isFinite(ans)) continue;
  tried++;
  if (c.check(String(ans))) solved++;
  else if (solved + 8 > tried) console.log('  UNSOLVED: ' + q + '  computed ' + ans);
}
console.log('  solved ' + solved + '/' + tried + ' by independent derivation');
chk('every finance puzzle is solvable', solved === tried, solved + '/' + tried);

console.log();
console.log('=== parseNumber ===');
[['$212,000',212000],['212000',212000],['212,000',212000],['  4800 ',4800],['7%',7],
 ['$1,234.56',1234.56],['abc',NaN],['',NaN],['12abc',NaN],[null,NaN]]
 .forEach(([i,e]) => {
   const g = parseNumber(i);
   const ok = Number.isNaN(e) ? Number.isNaN(g) : g === e;
   chk('parseNumber(' + JSON.stringify(i) + ')', ok, 'got ' + g);
 });

console.log();
console.log(fails === 0 ? 'ALL GENERATOR CHECKS PASSED' : fails + ' FAILURES');
process.exit(fails ? 1 : 0);

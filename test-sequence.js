/* ===================================================================
 * test-sequence.js — RUNNING ORDER
 * Run with:  node test-sequence.js
 *
 * The order is UNLOCK -> CREATE -> DASHBOARD. Two bugs broke it once:
 * creation opened on DOMContentLoaded and so rendered *behind* the lock
 * overlay, and a storage key polluted by instrumented test builds made
 * a first-time visitor look like a returning one, skipping creation
 * altogether. Both are regression-guarded here.
 *
 * The order is now UNLOCK -> CREATE -> SETTINGS(page 1) -> DASHBOARD,
 * and the optimiser is a hidden cheat rather than an offered button,
 * so both of those are covered too.
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
    querySelector: (s) => get(s),
    /* Returns live stubs for [data-mode] so the mode picker's own
     * wiring runs and a choice can genuinely be clicked, rather than
     * the test asserting against markup nobody bound. */
    querySelectorAll(sel) {
      if (sel === '[data-mode]') {
        if (!e._modeBtns) {
          e._modeBtns = ['pro', 'arcade'].map((m) => {
            const b = mkEl('modebtn-' + m);
            b.dataset = { mode: m };
            return b;
          });
        }
        return e._modeBtns;
      }
      return [];
    },
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
const bodyClasses = new Set();
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
  createElement: (t) => mkEl(t),
  body: {
    appendChild() {},
    classList: {
      toggle: (c, on) => { on ? bodyClasses.add(c) : bodyClasses.delete(c); },
      add: (c) => bodyClasses.add(c), remove: (c) => bodyClasses.delete(c),
      contains: (c) => bodyClasses.has(c),
    },
  },
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
global.Chart = class { constructor() {} destroy() {} resize() {} };

let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

require('./money.js'); require('./tax-config.js'); require('./tax-engine.js');
require('./engine.js'); require('./characters.js'); require('./avatar.js');
require('./audio.js'); require('./optimizer.js');
// Bring browser-style globals into scope for auth.js / app.js.
for (const m of ['./money.js', './tax-config.js', './tax-engine.js', './engine.js',
                 './characters.js', './avatar.js', './audio.js', './optimizer.js']) {
  Object.assign(global, require(m));
}
global.Money = require('./money.js').Money;
global.AudioKit = require('./audio.js').AudioKit;
global.self = global;

/* Mirror the real markup: the three overlays ship with class="overlay
 * hidden". Without seeding that, the shim would start them visible and
 * the "not open behind the lock" assertion would test nothing. */
for (const id of ['creation', 'settings', 'optimise', 'cheatBanner', 'help', 'modePick',
                  'cheatProg', 'cheatMark', 'btnOptimise', 'bayBark', 'tips']) {
  get('#' + id).classList.add('hidden');
}

require('./auth.js');
require('./app.js');

(async () => {
  section('The page starts locked, with creation NOT open');
  await wait(60);
  ok('auth.js locked the document', locked);
  ok('creation was not opened behind the lock',
     get('#creation').classList.contains('hidden'),
     'creation classes: [' + [...get('#creation')._classes].join(',') + ']');
  ok('nor were settings or the optimiser',
     get('#settings').classList.contains('hidden') && get('#optimise').classList.contains('hidden'));

  section('Unlocking asks which front door first');
  /* The running order is UNLOCK -> CHOOSE A MODE -> (Arcade only)
   * CREATE -> SETTINGS -> dashboard. The mode answer decides whether
   * music starts and whether character creation happens at all, so it
   * cannot be asked later. */
  window.dispatchEvent(new Event('pf-unlocked'));
  await wait(120);
  ok('the mode picker opens after the unlock event',
     !get('#modePick').classList.contains('hidden'),
     'classes: ' + [...get('#modePick')._classes].join(','));
  ok('creation waits for that answer',
     get('#creation').classList.contains('hidden'));
  const pickHtml = get('.sheet').innerHTML || '';
  ok('both modes are offered',
     /data-mode="pro"/.test(pickHtml) && /data-mode="arcade"/.test(pickHtml),
     pickHtml.slice(0, 140));
  ok('it says the choice does not change the numbers',
     /Same engine either way/.test(pickHtml));
  ok('and that it can be changed later', /switch whenever you like/.test(pickHtml));

  section('Choosing Planner goes straight to the dashboard');
  {
    const btns = get('#modePick').querySelectorAll('[data-mode]');
    const pro = btns.find((b) => b.dataset.mode === 'pro');
    ok('the Planner button got wired', !!(pro && pro._l.click), 'no click handler');
    pro.fire('click');
    await wait(120);
  }
  ok('the picker closed', get('#modePick').classList.contains('hidden'));
  ok('character creation is NOT forced on a planner',
     get('#creation').classList.contains('hidden'),
     'creation classes: ' + [...get('#creation')._classes].join(','));
  ok('audio is off', AudioKit.state.enabledMusic === false
     && AudioKit.state.enabledCues === false);
  ok('the operator bay is off', get('#bay').classList.contains('hidden'));
  ok('Auto-optimise is on the toolbar, not hidden',
     !get('#btnOptimise').classList.contains('hidden'),
     'btnOptimise: [' + [...get('#btnOptimise')._classes].join(',') + ']');
  ok('plain wording is applied', bodyClasses.has('plain'));
  ok('orientation tips are offered instead of a forced tour',
     !get('#tips').classList.contains('hidden'));
  ok('the mode persisted',
     JSON.parse(store['pf-forecaster-state-v3']).ui.mode === 'pro');

  section('A mode changes presentation only, never the forecast');
  /* This is the property that makes switching safe at any time, so it
   * is asserted on the definitions rather than trusted to review. */
  {
    const src2 = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
    const block = src2.slice(src2.indexOf('const MODES = {'), src2.indexOf('function applyMode'));
    const INPUT_KEYS = Object.keys(defaultInputs());
    const leaked = INPUT_KEYS.filter((k) => new RegExp('\\b' + k + '\\s*:').test(block));
    ok('no mode definition mentions an input key', !leaked.length, 'leaked: ' + leaked.join(', '));
    ok('applyMode only ever writes S.ui',
       !/applyMode[\s\S]{0,600}?S\.inputs/.test(src2));
    ok('the mode page toggles go through UI_TOGGLES, not setPath',
       /if \(UI_TOGGLES\[key\]\) UI_TOGGLES\[key\]\(next\);/.test(src2));
    ok('Arcade keeps the order the user asked for (create, then settings)',
       /name === 'arcade'\) openCreation\(false\)/.test(src2));
    ok('Planner records the skip rather than pretending creation happened',
       /S\.ui\.skippedCreation = true; save\(\); showFirstRunTips\(\)/.test(src2));
  }

  section('Switching to Arcade restores the full HUD experience');
  /* The cheat code, the soundtrack and the operator belong to Arcade.
   * Testing them while in Planner would assert the wrong thing, so the
   * suite switches front doors here and continues in Arcade. */
  {
    get('#helpMode').fire('click');
    await wait(60);
    ok('the picker can be reopened from help',
       !get('#modePick').classList.contains('hidden'));
    const btns = get('#modePick').querySelectorAll('[data-mode]');
    const arc = btns.find((b) => b.dataset.mode === 'arcade');
    arc.fire('click');
    await wait(140);
  }
  ok('Arcade turns the soundtrack on', AudioKit.state.enabledMusic === true);
  ok('and the interface sounds', AudioKit.state.enabledCues === true);
  ok('the operator bay comes back', !get('#bay').classList.contains('hidden'));
  ok('plain wording is dropped', !bodyClasses.has('plain'));
  ok('Auto-optimise is hidden again — it is a cheat code',
     get('#btnOptimise').classList.contains('hidden'),
     'btnOptimise: [' + [...get('#btnOptimise')._classes].join(',') + ']');
  ok('and Arcade runs character creation',
     !get('#creation').classList.contains('hidden'));
  // close creation so the rest of the suite sees the dashboard
  get('#creationSkip').fire('click');
  await wait(80);

  section('The storage key was bumped past the polluted one');
  const src = require('fs').readFileSync(__dirname + '/app.js', 'utf8');
  ok('app.js uses the v3 key', /pf-forecaster-state-v3/.test(src));
  ok('and no longer reads v2', !/pf-forecaster-state-v2/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));

  section('Creation is gated on a CHARACTER, not a flag');
  ok('load() keys on d.character', /return !!d\.character \|\| d\.ui\?\.skippedCreation/.test(src));
  ok('the old created flag is gone', !/S\.ui\.created\s*=\s*true/.test(src));
  ok('declining is recorded distinctly', /skippedCreation = true/.test(src));

  section('auth.js announces the unlock rather than app.js guessing');
  const asrc = require('fs').readFileSync(__dirname + '/auth.js', 'utf8');
  ok('reveal() dispatches pf-unlocked', /dispatchEvent\(new Event\('pf-unlocked'\)\)/.test(asrc));
  ok('and sets a flag for an already-unlocked load', /__pfUnlocked = true/.test(asrc));
  ok('app.js waits for it', /addEventListener\('pf-unlocked'/.test(src));
  ok('and handles the already-unlocked case', /window\.__pfUnlocked/.test(src));

  section('Creation hands off to Settings, first page');
  ok('finishCreation opens settings',
     /function finishCreation\(\)[\s\S]*?openSettings\(\)/.test(src));
  ok('and pins it to page 1 (profile) first',
     /finishCreation\(\)[\s\S]*?settingsPage = 'profile';[\s\S]*?openSettings\(\)/.test(src));
  ok('the review step points at that confirmation step',
     /confirm these in Settings/.test(src));

  section('The optimiser is hidden — it is a cheat code');
  const html = require('fs').readFileSync(__dirname + '/index.html', 'utf8');
  ok('the button ships hidden',
     /id="btnOptimise"/.test(html)
     && /class="[^"]*hidden[^"]*"[^>]*id="btnOptimise"/.test(html));
  ok('the O hotkey is gated on the unlock',
     /k === 'o' && !anyOpen\(\) && S\.ui\.cheatUnlocked/.test(src));
  ok('the key hint is hidden too', /id="cheatMark"/.test(html)
     && /class="key hidden" id="cheatMark"/.test(html));
  ok('the nudge that advertised it is gone',
     !/id="nudge"/.test(html) && !/nudgeDismissed/.test(src));
  ok('nothing calls optimise() during boot',
     !/function boot\(\)[\s\S]*?[^n]optimise\(/.test(src.split('function selfCheck')[0]));
  ok('apply is a separate explicit action', /optApply.*addEventListener/.test(src));
  ok('the unlock persists', /cheatUnlocked = true;[\s\S]{0,80}save\(\)/.test(src));

  section('The cheat combination');
  /* Real order: window capture handlers, then the document handler —
   * and a swallowed key (stopPropagation) never reaches the document. */
  const keydown = (key, tagName = 'BODY') => {
    let stopped = false;
    const ev = { key, target: { tagName }, preventDefault() {},
                 stopPropagation() { stopped = true; } };
    (window._cap.keydown || []).forEach((f) => f(ev));
    if (!stopped) (docKeyHandlers || []).forEach((f) => f(ev));
    ev._stopped = stopped;
    return ev;
  };
  ok('the combination is not the Konami code',
     !/ArrowUp',\s*'ArrowUp'/.test(src), 'a borrowed sequence would be a let-down');
  ok('it is 11 moves long', (src.match(/const CHEAT = \[([\s\S]*?)\];/) || [])[1]
     .split(',').length === 11);

  // Wrong sequence: nothing happens.
  ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowUp'].forEach(keydown);
  ok('a wrong key does not unlock', get('#btnOptimise').classList.contains('hidden'));

  /* The real sequence — entered as if focus were in a number field,
   * which is the case that was broken. wireKeys returns early on input
   * focus, and after creation the app lands in Settings, wall-to-wall
   * number inputs: one click in a field and every key was swallowed
   * before the detector saw it. Testing only the easy case (focus on
   * the body) would have passed while the feature was unusable, so the
   * hard case is the one asserted. */
  const COMBO = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft',
                 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'm', 'a', 'x'];
  let swallowed = 0;
  for (const k of COMBO) if (keydown(k, 'INPUT')._stopped) swallowed++;
  await wait(30);
  ok('the combination unlocks WITH FOCUS IN A NUMBER FIELD',
     !get('#btnOptimise').classList.contains('hidden'),
     'btnOptimise classes: [' + [...get('#btnOptimise')._classes].join(',') + ']');
  ok('most of the sequence is swallowed rather than editing the field',
     swallowed >= 9, swallowed + ' of 11 swallowed');
  ok('the key hint appears', !get('#cheatMark').classList.contains('hidden'));
  ok('a banner confirms it', !get('#cheatBanner').classList.contains('hidden'));
  ok('and it survives a reload',
     JSON.parse(store['pf-forecaster-state-v3']).ui.cheatUnlocked === true);

  section('The combination works with focus in a form field');
  /* This was the bug. wireKeys returns early whenever focus is in an
   * input, and after creation the app lands in Settings — wall-to-wall
   * number fields. One click in a field and every key was swallowed
   * before the detector saw it: the code silently did not work. */
  ok('the detector registers on the capture phase',
     (window._cap.keydown || []).length > 0,
     'capture handlers: ' + (window._cap.keydown || []).length);
  ok('and it is not the same handler as the document one',
     (window._cap.keydown || [])[0] !== docKeyHandlers[0]);
  ok('app.js explains why the phase matters', /CAPTURE phase, deliberately/.test(src));
  ok('wireKeys still returns early on input focus (unchanged)',
     /if \(\/input\|select\|textarea\/i\.test\(e\.target\.tagName\)\)/.test(src));
  ok('the detector no longer sits after that guard',
     !/Escape'\) \{ closeAll\(\); return; \}\s*\n\s*\n?\s*\/\* The cheat detector/.test(src));

  section('Feedback starts at the first move, not the fifth');
  ok('progress renders from one move in', /'\\u25c6'\.repeat\(cheatPos\)/.test(src));
  ok('the old "only past move four" behaviour is gone',
     !/cheatPos > 4/.test(src));
  ok('a stalled attempt resets', /cheatPos = 0; renderCheatProgress\(\); \}, 3500\)/.test(src));
  ok('focus is pulled out of a field once the code is clearly deliberate',
     /cheatPos === 2 && document\.activeElement/.test(src));

  section('Clicking the operator is a second way in');
  ok('a click count unlocks it too', /bayClicks >= CHEAT_CLICKS\) unlockCheat\('clicks'\)/.test(src));
  ok('seven clicks, not an accidental number', /CHEAT_CLICKS = 7/.test(src));
  ok('the click reaction lasts long enough to reach seven',
     /bayClicks = 0; renderBay\(\); \}, 6000\)/.test(src));
  ok('unlocking twice is a no-op', /if \(S\.ui\.cheatUnlocked\) return;/.test(src));
  ok('the banner says which route was used', /how === 'clicks'/.test(src));

  section('The owner can find their own cheat code');
  ok('Diagnostics reports whether it is locked', /row\('Auto-optimise'/.test(src));
  ok('and offers the hint on request', /id="btnCheatHint"/.test(src));
  ok('the hint names both routes',
     /Press it anywhere in the app/.test(src) && /click the\n\s*operator/.test(src));
  ok('it is not printed in the main UI',
     !/CHEAT_HINT/.test(html), 'index.html must not carry the hint');

  section('Clicking the character reacts');
  ok('the stage is wired', /stage\.addEventListener\('click', pokeBay\)/.test(src));
  ok('pokeBay changes the pose', /pose: bayClicks \? avatarPose\(bayClicks - 1\)/.test(src));
  ok('and says something', /avatarLine\(c \? c\.attire : 'shirt', bayClicks - 1\)/.test(src));
  ok('the reaction decays back to idle', /bayClicks = 0; renderBay\(\)/.test(src));

  section('Audio is on by default and starts at the unlock');
  ok('cues default on', AudioKit.state.enabledCues === true);
  ok('music defaults on', AudioKit.state.enabledMusic === true);
  ok('the unlock is where audio is enabled',
     /AudioKit\.unlock\(\);[\s\S]{0,120}setMusic\(true\)/.test(src));

  console.log('\n' + '='.repeat(56));
  if (failed) console.log(fails.join('\n') + '\n');
  console.log(`${passed} passed, ${failed} failed`);
  console.log('='.repeat(56));
  process.exit(failed ? 1 : 0);
})();

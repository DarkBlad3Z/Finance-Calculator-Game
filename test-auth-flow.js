/* ===================================================================
 * test-auth-flow.js — GATE FLOW VERIFICATION
 * Run with:  node test-auth-flow.js
 *
 * Drives auth.js's REAL gate logic against a minimal DOM shim:
 * rendering, the submit handler, puzzle rotation on repeated wrong
 * answers, round progression, unlock, and persistence.
 *
 * test-auth.js covers the puzzle GENERATORS; this covers the WIRING.
 * =================================================================== */
function mkEl(id){
  return { id, _l:{}, value:'', type:'text', textContent:'', innerHTML:'',
    disabled:false, style:{}, classList:{add(){},remove(){}},
    addEventListener(k,f){ (this._l[k]=this._l[k]||[]).push(f); },
    fire(k,ev){ (this._l[k]||[]).forEach(f=>f(ev||{preventDefault(){}})); },
    setAttribute(){}, removeAttribute(){}, focus(){}, select(){}, remove(){ removed.push(id); },
    querySelectorAll(){ return []; },
    // Enough for the dial to mount harmlessly at load time; this suite
    // then switches to a text mode and re-mounts.
    children: [], appendChild(c){ this.children.push(c); },
    width: 0, height: 0, tabIndex: 0, getBoundingClientRect(){ return {left:0,top:0,width:300,height:300}; },
    setPointerCapture(){},
    getContext(){ const noop=()=>{};
      return new Proxy({}, { get:(t,k)=> typeof k==='string'? noop : undefined, set:()=>true }); } };
}
let removed=[], els={}, locked=false, stored={};
const get=(sel)=>{ const k=sel.replace(/^[#.]/,''); return els[k]=els[k]||mkEl(k); };

global.window={ addEventListener(){}, dispatchEvent(){}, devicePixelRatio:1 };
global.document={
  documentElement:{ setAttribute(k){ if(k==='data-locked') locked=true; },
    removeAttribute(k){ if(k==='data-locked') locked=false; },
    hasAttribute(k){ return k==='data-locked' && locked; }, innerHTML:'' },
  readyState:'complete', addEventListener(){},
  getElementById:(id)=>els[id]||null,
  querySelector:get,
  createElement:()=>{ const e=mkEl('authGate'); e.querySelector=get; els.authGate=e; return e; },
  body:{ appendChild(){} },
};
global.crypto={subtle:{}};
global.atob=s=>Buffer.from(s,'base64').toString('binary');
global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.sessionStorage={ getItem:k=>stored[k]??null, setItem:(k,v)=>{stored[k]=v;} };
global.localStorage=global.sessionStorage;
global.TextEncoder=require('util').TextEncoder;
global.Event=class{constructor(t){this.type=t;}};

require('./auth.js');

/* The shipped default is the interactive ring lock (covered by
 * test-auth-dial.js). This suite exercises the TEXT-mode wiring:
 * rounds, puzzle rotation, error messaging. Switch mode and re-mount. */
window.__authInternals.AUTH_CONFIG.mode = 'finance';
window.__authInternals.rebuild();

let fails=0;
const ok=(n,c,d='')=>{ if(!c){fails++;console.log('  FAIL '+n+(d?' :: '+d:''));} else console.log('  pass '+n); };
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));

function solve(text){
  const d=(re)=>{const m=text.match(re);return m?parseFloat(m[1].replace(/,/g,'')):null;};
  const p=(re)=>{const m=text.match(re);return m?parseFloat(m[1]):null;};
  if(/grows by/.test(text))            return d(/A \$([\d,]+) balance/)*(1+p(/grows by (\d+)%/)/100);
  if(/marginal tax rate/.test(text))   return d(/defer \$([\d,]+)/)*p(/marginal tax rate is (\d+)%/)/100;
  if(/carries a/.test(text))           return d(/worth \$([\d,]+)/)-d(/carries a \$([\d,]+)/);
  if(/reaches your pocket/.test(text)) return d(/withdraw \$([\d,]+)/)*(1-p(/pay (\d+)% tax/)/100);
  if(/life-expectancy factor/.test(text)) return d(/divides a \$([\d,]+)/)/p(/factor of (\d+)/);
  if(/rule of 72/.test(text))          return 72/p(/at (\d+)% a year/);
  if(/largest match/.test(text))       return d(/a \$([\d,]+) salary/)*p(/up to (\d+)% of pay/)/100;
  return null;
}

(async () => {
  console.log('=== GATE FLOW (real auth.js logic, shimmed DOM) ===');
  ok('locks the page on load', locked);
  ok('renders a question', els.authQ.textContent.length>20, els.authQ.textContent);
  ok('renders progress dots for 2 rounds', /auth-dot/.test(els.authProgress.innerHTML));
  ok('shows a subtitle mentioning 2 questions', /2 quick questions/.test(els.authSub.textContent));

  els.authHintBtn.fire('click');
  ok('hint button reveals a hint', els.authHint.textContent.length>5, els.authHint.textContent);

  const submit=async(v)=>{ els.authPw.value=String(v);
    els.authForm.fire('submit',{preventDefault(){}}); await wait(700); };

  const q1=els.authQ.textContent;
  await submit('123456789');
  ok('a wrong answer keeps it locked', locked);
  ok('a wrong answer sets an error', els.authErr.textContent.length>0, els.authErr.textContent);

  await submit('55555');
  await wait(600);
  ok('two wrong answers rotate to a new puzzle', els.authQ.textContent!==q1);

  let n=0;
  for(let i=0;i<8 && locked;i++){
    const a=solve(els.authQ.textContent);
    if(a===null){ ok('recognised wording',false,els.authQ.textContent); break; }
    await submit(a); n++;
  }
  ok('solving unlocks the page', !locked, 'submissions='+n);
  ok('required at least 2 correct answers', n>=2, 'n='+n);
  ok('gate element removed', removed.includes('authGate'));
  ok('solve persisted to storage', stored['pf-forecaster-unlocked']==='solved');

  /* ------------------------------------------------------------------
   * mode 'off' — no gate at all.
   * A combination lock is right for a copy published on the open web
   * and wrong for one someone runs on their own machine: the owner
   * should not solve a puzzle to look at their own forecast. This
   * asserts the escape hatch works and, just as important, that it
   * does not silently leave the page locked.
   * ---------------------------------------------------------------- */
  {
    locked = true;
    removed.length = 0;
    let built = 0;
    const realAppend = document.body.appendChild;
    document.body.appendChild = function (n) { built++; return realAppend.call(this, n); };
    delete window.__pfUnlocked;

    const src = require('fs').readFileSync(__dirname + '/auth.js', 'utf8')
      .replace("mode: 'dial',", "mode: 'off',");
    eval(src);
    document.body.appendChild = realAppend;

    ok('mode "off" unlocks the page immediately', !locked);
    ok('and builds no puzzle at all', built === 0, 'appended ' + built + ' nodes');
    ok('it still announces the unlock, so app.js proceeds',
       window.__pfUnlocked === true);
    ok('the default is NOT off — a published copy keeps its gate',
       /mode: 'dial',/.test(require('fs').readFileSync(__dirname + '/auth.js', 'utf8')));
    ok('and the option is documented where someone would look for it',
       /'off'\s+NO GATE/.test(require('fs').readFileSync(__dirname + '/auth.js', 'utf8')));
  }

  console.log();
  console.log(fails===0 ? 'GATE FLOW: ALL PASSED' : fails+' FAILURES');
  process.exit(fails?1:0);
})();

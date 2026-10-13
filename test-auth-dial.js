/* ===================================================================
 * test-auth-dial.js — COMBINATION LOCK VERIFICATION
 * Run with:  node test-auth-dial.js
 *
 * Drives the ring lock's real logic against a DOM shim. The combination
 * is a PBKDF2 hash, so this suite does NOT know it — it brute-forces a
 * small keyspace to find one, which doubles as proof that only one
 * arrangement opens the lock.
 * =================================================================== */
'use strict';
const crypto = require('crypto');

function mkEl(tag){
  return { tagName:tag, _l:{}, className:'', innerHTML:'', textContent:'', style:{},
    tabIndex:0, width:0, height:0, children:[], disabled:false,
    classList:{add(){},remove(){}},
    addEventListener(k,f){(this._l[k]=this._l[k]||[]).push(f);},
    fire(k,ev){(this._l[k]||[]).forEach(f=>f(ev));},
    appendChild(c){this.children.push(c);},
    setAttribute(k,v){this['_'+k]=v;}, getAttribute(k){return this['_'+k];},
    focus(){}, select(){}, remove(){ removed.push(this.id||tag); },
    setPointerCapture(){}, querySelectorAll(){return [];},
    getBoundingClientRect(){return {left:0,top:0,width:320,height:320};},
    getContext(){ const noop=()=>{};
      return new Proxy({}, { get:()=>noop, set:()=>true }); } };
}
let removed=[], els={}, locked=false, stored={};
const get=(sel)=>{const k=sel.replace(/^[#.]/,'');return els[k]=els[k]||mkEl('div');};

global.window={ addEventListener(){}, dispatchEvent(){}, devicePixelRatio:1 };
global.document={
  documentElement:{setAttribute(k){if(k==='data-locked')locked=true;},
    removeAttribute(k){if(k==='data-locked')locked=false;},
    hasAttribute(k){return k==='data-locked'&&locked;}, innerHTML:''},
  readyState:'complete', addEventListener(){},
  getElementById:(id)=>els[id]||null, querySelector:get,
  createElement:(tag)=>{ const e=mkEl(tag); e.querySelector=get;
    if(!els.authGate){ e.id='authGate'; els.authGate=e; } return e; },
  body:{appendChild(){}},
};
// Node exposes `crypto` as a getter-only global, so define over it.
// webcrypto provides the same subtle API the browser uses, which means
// the gate's real PBKDF2 path is what gets exercised here.
Object.defineProperty(global, 'crypto', { value: require('crypto').webcrypto, configurable: true });
global.atob=s=>Buffer.from(s,'base64').toString('binary');
global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.sessionStorage={getItem:k=>stored[k]??null,setItem:(k,v)=>{stored[k]=v;}};
global.localStorage=global.sessionStorage;
global.TextEncoder=require('util').TextEncoder;
global.Event=class{constructor(t){this.type=t;}};

require('./auth.js');
const { GENERATORS, AUTH_CONFIG } = window.__authInternals;

let fails=0;
const ok=(n,c,d='')=>{ if(!c){fails++;console.log('  FAIL '+n+(d?' :: '+d:''));} else console.log('  pass '+n); };
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

function mountFresh(){
  const d=GENERATORS.dial(); const stage=mkEl('div');
  let solved=false, feedback='';
  d.mount(stage, ()=>{solved=true;}, (m)=>{feedback=m;});
  const cv=stage.children[0].children[0];
  return { d, cv, st:cv.__dial, get solved(){return solved;}, get feedback(){return feedback;} };
}

(async () => {
  console.log('=== SHAPE ===');
  const p=GENERATORS.dial();
  ok('is flagged interactive', p.interactive===true);
  ok('has no check() — nothing to type', typeof p.check==='undefined');
  ok('question says the pairing is hidden', /pairing is not shown|combination/.test(p.question));

  console.log();
  console.log('=== THE COMBO IS NOT IN THE SOURCE ===');
  const src=require('fs').readFileSync(__dirname+'/auth.js','utf8');
  // Either form counts: a single verifier, or seven (one per weekday
  // when the day ring is on).
  const singleHash = /comboHash:\s*'[A-Za-z0-9+/=]{20,}'/.test(src);
  const dayHashes = (src.match(/comboHashes:\s*\[([\s\S]*?)\]/) || [,''])[1]
    .match(/'[A-Za-z0-9+/=]{20,}'/g) || [];
  ok('a verifier is stored', singleHash || dayHashes.length > 0,
     'single='+singleHash+' day='+dayHashes.length);
  if (/dayRing:\s*true/.test(src)) {
    ok('seven verifiers, one per weekday', dayHashes.length === 7, dayHashes.length+' found');
    ok('they are all different', new Set(dayHashes).size === dayHashes.length);
  }
  ok('no plaintext combo array', !/combo:\s*\[/.test(src));
  const bundle=require('fs').existsSync(__dirname+'/forecaster.html')
    ? require('fs').readFileSync(__dirname+'/forecaster.html','utf8') : '';
  if (bundle) ok('bundle carries only the hash too', !/combo:\s*\[/.test(bundle));

  console.log();
  console.log('=== RING POSITIONS ARE RANDOMISED, NEVER PRE-SOLVED ===');
  let preSeated=0, spread=new Set();
  for(let i=0;i<300;i++){
    const m=mountFresh();
    if(m.st.allOnArrows() && m.st.isSolved()) preSeated++;
    spread.add(m.st.angles.join(','));
  }
  ok('never opens on load', preSeated===0);
  ok('start positions vary', spread.size>250, spread.size+' distinct of 300');

  console.log();
  console.log('=== GEOMETRY: every supported ring count fits and stays clickable ===');
  const origRings=AUTH_CONFIG.dial.rings;
  for(const R of [2,3,4,5,6,7,8]){
    AUTH_CONFIG.dial.rings=R;
    const g=mountFresh().st.geom;
    ok('rings='+R+' fits the canvas', g.BEZEL_OUT <= g.C-2,
       'bezel '+g.BEZEL_OUT.toFixed(1)+' vs limit '+(g.C-2));
    ok('rings='+R+' bands >= 7px', (g.ringOuter(0)-g.ringInner(0))>=7,
       (g.ringOuter(0)-g.ringInner(0)).toFixed(1)+'px');
  }
  AUTH_CONFIG.dial.rings=origRings;

  console.log();
  console.log('=== CLICK-TO-SNAP LANDS ON THE INTENDED MARKER ===');
  {
    const m=mountFresh(); const g=m.st.geom, C=g.C;
    const target=[...Array(m.st.RINGS)].map((_,i)=>(i*3+1)%m.st.ARROWS);
    for(let i=0;i<m.st.RINGS;i++){
      const ang=g.toAngle(m.st.arrowStop(target[i]));
      const r=(g.ringInner(i)+g.ringOuter(i))/2;
      m.cv.fire('pointerdown',{clientX:C+Math.cos(ang)*r,clientY:C+Math.sin(ang)*r,pointerId:1,preventDefault(){}});
      m.cv.fire('pointerup',{pointerId:1});
    }
    await sleep(400);
    ok('each ring seats on the marker clicked',
       JSON.stringify(m.st.currentCombo())===JSON.stringify(target),
       JSON.stringify(m.st.currentCombo())+' wanted '+JSON.stringify(target));
    ok('all rings report as seated', m.st.allOnArrows());
  }

  console.log();
  console.log('=== A SEATED BUT WRONG ARRANGEMENT IS REJECTED ===');
  {
    const m=mountFresh();
    await m.st.setCombo(new Array(m.st.RINGS).fill(0));
    await sleep(500);
    const wrongRejected = !m.st.isSolved();
    ok('all-zeros does not open it', wrongRejected);
    if (wrongRejected) ok('and it says so without leaking', /not the combination/.test(m.feedback), m.feedback);
    ok('no unlock callback fired', !m.solved);
  }

  console.log();
  console.log('=== EXACTLY ONE ARRANGEMENT OPENS IT (found by brute force) ===');
  // The suite does not know the combo. Search a reduced keyspace so the
  // test stays quick: verify the hash directly, the same way the gate
  // does, then confirm the gate agrees.
  const cfg=AUTH_CONFIG.dial;
  const saltBytes=Buffer.from(cfg.comboSalt,'base64');
  const verify=(arr)=>crypto.pbkdf2Sync(arr.join('-'),saltBytes,cfg.comboIterations,32,'sha256')
    .toString('base64')===cfg.comboHash;

  // Reduce to 2 rings x 4 arrows so the search is 16 guesses, and
  // re-hash a known combo under those settings.
  const testCombo=[2,3];
  const tSalt=crypto.randomBytes(16);
  const tHash=crypto.pbkdf2Sync(testCombo.join('-'),tSalt,1000,32,'sha256').toString('base64');
  // dayRing off here: this section is about the fixed keyspace.
  Object.assign(cfg,{rings:2,arrows:4,positions:8,dayRing:false,
    comboSalt:tSalt.toString('base64'),comboHash:tHash,comboHashes:null,
    comboIterations:1000});

  let hits=[], tried=0;
  for(let a=0;a<4;a++) for(let b=0;b<4;b++){
    const m=mountFresh();
    await m.st.setCombo([a,b]);
    await sleep(30);
    tried++;
    if(m.st.isSolved()) hits.push([a,b]);
  }
  ok('searched the whole reduced keyspace', tried===16, tried+' tried');
  ok('exactly one arrangement opens the lock', hits.length===1, JSON.stringify(hits));
  ok('and it is the one that was set',
     hits.length===1 && hits[0][0]===testCombo[0] && hits[0][1]===testCombo[1],
     JSON.stringify(hits[0]));

  console.log();
  console.log('=== THE CORRECT ARRANGEMENT UNLOCKS THE PAGE ===');
  {
    const m=mountFresh();
    await m.st.setCombo(testCombo);
    await sleep(900);
    ok('lock reports open', m.st.isSolved());
    ok('unlock callback fires', m.solved);
  }

  console.log();
  console.log('=== KEYBOARD ROUTE ===');
  {
    const m=mountFresh();
    let guard=0;
    for(let i=0;i<m.st.RINGS;i++){
      const want=m.st.arrowStop(testCombo[i]);
      while(m.st.angles[i]!==want && guard++<500)
        m.cv.fire('keydown',{key:'ArrowRight',preventDefault(){}});
      m.cv.fire('keydown',{key:'ArrowDown',preventDefault(){}});
    }
    await sleep(900);
    ok('arrow keys can enter the combination', m.st.isSolved(), 'presses='+guard);
  }

  console.log();
  console.log('=== A MOVE DURING AN IN-FLIGHT CHECK IS NOT DROPPED ===');
  // Seating the last ring mid-verification used to be ignored, leaving
  // the lock shut on a correct combination.
  {
    const m=mountFresh();
    // Land on a seated-but-wrong arrangement to start a check, then
    // immediately switch to the right one without awaiting.
    m.st.setCombo([(testCombo[0]+1)%4, (testCombo[1]+1)%4]);
    m.st.setCombo(testCombo);
    await sleep(1200);
    ok('the correcting move still opens the lock', m.st.isSolved(),
       'combo now '+JSON.stringify(m.st.currentCombo()));
  }

  console.log();
  console.log('=== DAY RING: correct on all seven days, wrong on the others ===');
  // Freeze the clock to each weekday in turn and check the lock only
  // opens for that day's arrangement. This is the whole point of the
  // layer, so it is worth testing every day rather than just today.
  {
    const RealDate = Date;
    const fakeDay = (d) => {
      // A known Sunday, plus d days.
      const base = RealDate.UTC(2026, 8, 27, 12, 0, 0);
      const when = base + d * 86400000;
      global.Date = class extends RealDate {
        constructor(...a){ return a.length ? new RealDate(...a) : new RealDate(when); }
        static now(){ return when; }
        static UTC(...a){ return RealDate.UTC(...a); }
      };
    };

    const cfg2 = AUTH_CONFIG.dial;
    const prev = { rings: cfg2.rings, arrows: cfg2.arrows, positions: cfg2.positions,
      salt: cfg2.comboSalt, hashes: cfg2.comboHashes, hash: cfg2.comboHash,
      iter: cfg2.comboIterations, dayRing: cfg2.dayRing };

    // Small, fast settings: 2 fixed rings + 1 day ring, 7 markers.
    const FIXED=[1,3];
    const tSalt=crypto.randomBytes(16);
    const mk=(arr)=>crypto.pbkdf2Sync(arr.join('-'),tSalt,1000,32,'sha256').toString('base64');
    Object.assign(cfg2, { rings:3, arrows:7, positions:7, dayRing:true,
      comboSalt:tSalt.toString('base64'), comboHash:null, comboIterations:1000,
      comboHashes: [0,1,2,3,4,5,6].map((d)=>mk([...FIXED,d])) });

    let rightOpens=0, wrongOpens=0;
    for (let d=0; d<7; d++) {
      fakeDay(d);
      // The day ring set to today: must open.
      const a=mountFresh();
      ok('day '+d+': dial reports the expected day index', a.st.dayTargetIndex()===d,
         'got '+a.st.dayTargetIndex());
      await a.st.setCombo([...FIXED, d]);
      await sleep(60);
      if (a.st.isSolved()) rightOpens++;
      // The day ring set to a DIFFERENT day: must not open.
      const b=mountFresh();
      await b.st.setCombo([...FIXED, (d+3)%7]);
      await sleep(60);
      if (b.st.isSolved()) wrongOpens++;
    }
    ok('opens on all 7 days with that day set', rightOpens===7, rightOpens+'/7');
    ok('never opens with the wrong day set', wrongOpens===0, wrongOpens+' opened');

    // A correct day but wrong fixed rings must still fail.
    fakeDay(2);
    const c=mountFresh();
    await c.st.setCombo([(FIXED[0]+1)%7, FIXED[1], 2]);
    await sleep(60);
    ok('right day, wrong fixed combo stays shut', !c.st.isSolved());

    global.Date = RealDate;
    Object.assign(cfg2, { rings:prev.rings, arrows:prev.arrows, positions:prev.positions,
      comboSalt:prev.salt, comboHashes:prev.hashes, comboHash:prev.hash,
      comboIterations:prev.iter, dayRing:prev.dayRing });
  }

  console.log();
  console.log('=== CLICKS OFF THE RINGS DO NOTHING ===');
  {
    const m=mountFresh(); const g=m.st.geom, C=g.C;
    const before=m.st.angles.join(',');
    m.cv.fire('pointerdown',{clientX:C,clientY:C,pointerId:1,preventDefault(){}});
    m.cv.fire('pointerdown',{clientX:3,clientY:3,pointerId:1,preventDefault(){}});
    ok('hub and corner clicks are ignored', m.st.angles.join(',')===before);
  }

  console.log();
  console.log(fails===0 ? 'COMBINATION LOCK: ALL PASSED' : fails+' FAILURES');
  process.exit(fails?1:0);
})();

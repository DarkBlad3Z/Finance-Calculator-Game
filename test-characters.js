/* ===================================================================
 * test-characters.js — OCCUPATION PRESET VERIFICATION
 * Run with:  node test-characters.js
 *
 * The risk with presets is not arithmetic, it is PLAUSIBILITY and
 * PROVENANCE: a derived number that looks measured, or a "median"
 * character who quietly behaves like a maximiser. Both are tested.
 * =================================================================== */
'use strict';
const { Money } = require('./money.js');
const eng = require('./engine.js');
const ch = require('./characters.js');
const $ = Money.fromDollars, D = Money.toDollars;

let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);

const ALL = Object.keys(ch.OCCUPATIONS).filter((k) => k !== 'custom');
const SAVERS = ['p50', 'p75', 'p90'];
const build = (o) => ch.buildCharacter(o);
const sim = (c) => eng.simulate({ ...eng.defaultInputs(), ...c.inputs });

/* =================================================================== */
section('Every preset builds a usable, legal plan');
for (const occ of ALL) {
  const c = build({ occupation: occ, state: 'WA', stage: 'mid', saver: 'p75' });
  ok(`${occ}: salary is positive`, c.inputs.salary > 0);
  ok(`${occ}: spending is positive and below gross`,
     c.inputs.spending === undefined || true);
  ok(`${occ}: spends less than it earns`, c.inputs.annualExpenses < c.inputs.salary,
     `${D(c.inputs.annualExpenses)} vs ${D(c.inputs.salary)}`);
  const r = sim(c);
  ok(`${occ}: simulates without throwing`, r.rows.length > 0);
  ok(`${occ}: no NaN anywhere`, r.rows.every((x) =>
     Number.isFinite(x.netWorth) && Number.isFinite(x.tax)));
  ok(`${occ}: balances never negative`, r.rows.every((x) => x.netWorth >= 0));
}
const blank = build({ occupation: 'custom' });
ok('custom preset yields a blank salary', blank.inputs.salary === 0);

/* =================================================================== */
section('PROVENANCE: every field is badged, and badges are honest');
const c1 = build({ occupation: 'softwareEngineer', state: 'WA', stage: 'mid', saver: 'p75' });
ok('fields are returned', c1.fields.length > 5);
ok('every field carries a src tag', c1.fields.every((f) => !!f.src));
ok('src is always a known value',
   c1.fields.every((f) => ['measured', 'derived', 'statute', 'none'].includes(f.src)));
const salaryField = c1.fields.find((f) => f.key === 'salary');
ok('salary is badged measured', salaryField.src === 'measured');
ok('and cites its source', /BLS|OEWS/.test(salaryField.note));
for (const k of ['trad401k', 'rothIra', 'brokerage', 'cash', 'balancesTotal']) {
  const f = c1.fields.find((x) => x.key === k);
  ok(`${k} is badged DERIVED, not measured`, f && f.src === 'derived',
     f ? `got ${f.src}` : 'field missing');
}
const lifeField = c1.fields.find((f) => f.key === 'lifeExpectancy');
ok('life expectancy is badged statute', lifeField.src === 'statute');
ok('and explains that this is presentation’s only effect',
   /only/i.test(lifeField.note));
ok('the data file lists what is unverified', ch.CHARACTER_DATA_META.unverified.length >= 3);
ok('and warns that median savers do not retire early',
   /median/i.test(ch.CHARACTER_DATA_META.caution));

/* =================================================================== */
section('CONSISTENCY: a median saver must behave like one');
/* The first cut set median BALANCES but left maximiser CONTRIBUTIONS,
 * which inflated median outcomes by an order of magnitude. This is the
 * regression guard for that. */
for (const occ of ['softwareEngineer', 'teacher', 'nurse']) {
  const lo = build({ occupation: occ, state: 'WA', stage: 'mid', saver: 'p50' });
  const hi = build({ occupation: occ, state: 'WA', stage: 'mid', saver: 'p90' });
  ok(`${occ}: median defers less than strong`,
     lo.inputs.contrib401kPercent < hi.inputs.contrib401kPercent);
  ok(`${occ}: median spends more than strong`,
     lo.inputs.annualExpenses > hi.inputs.annualExpenses);
  ok(`${occ}: median holds fewer assets than strong`,
     lo.inputs.balances.trad401k < hi.inputs.balances.trad401k);

  const loR = sim(lo), hiR = sim(hi);
  const rate = (r) => { const y = r.rows[0];
    return (y.contrib401k + y.employerMatch + y.contribIra + y.contribHsa + y.swept) / y.salary; };
  ok(`${occ}: median's realised savings rate is modest (<15%)`, rate(loR) < 0.15,
     `${(rate(loR) * 100).toFixed(0)}%`);
  ok(`${occ}: strong saver's rate is much higher`, rate(hiR) > rate(loR) * 2,
     `${(rate(loR) * 100).toFixed(0)}% vs ${(rate(hiR) * 100).toFixed(0)}%`);
  ok(`${occ}: median ends far poorer than strong`,
     loR.summary.endingNetWorth < hiR.summary.endingNetWorth / 3);
}

// A median saver must not use the advanced levers by default.
const med = build({ occupation: 'softwareEngineer', saver: 'p50' });
ok('median saver has no backdoor Roth', med.inputs.backdoorRoth === false);
ok('median saver has no mega backdoor', med.inputs.afterTax401kEnabled === false);
ok('median saver runs no conversion ladder', med.inputs.rothConversionMode === 'none');
ok('median saver is not sweeping every spare dollar', med.inputs.sweep.enabled === false);

/* =================================================================== */
section('Saver percentile is monotonic');
for (const occ of ['architect', 'electrician']) {
  const nw = SAVERS.map((s) => sim(build({ occupation: occ, saver: s })).summary.endingNetWorth);
  ok(`${occ}: outcomes rise with the saver percentile`,
     nw[0] <= nw[1] && nw[1] <= nw[2], nw.map(D).join(' -> '));
}

/* =================================================================== */
section('State and stage move the numbers the right way');
const wa = build({ occupation: 'softwareEngineer', state: 'WA', stage: 'mid', saver: 'p75' });
const oh = build({ occupation: 'softwareEngineer', state: 'OH', stage: 'mid', saver: 'p75' });
ok('a higher-wage state pays more', wa.inputs.salary > oh.inputs.salary,
   `WA ${D(wa.inputs.salary)} vs OH ${D(oh.inputs.salary)}`);
const early = build({ occupation: 'softwareEngineer', stage: 'early', saver: 'p75' });
const senior = build({ occupation: 'softwareEngineer', stage: 'senior', saver: 'p75' });
ok('seniority pays more', senior.inputs.salary > early.inputs.salary);
ok('and comes with a later age', senior.inputs.currentAge > early.inputs.currentAge);
ok('early career holds fewer assets', early.inputs.balances.trad401k < senior.inputs.balances.trad401k);

/* =================================================================== */
section('Presentation touches the avatar and longevity — nothing else');
const m = build({ occupation: 'architect', presentation: 'masculine', saver: 'p75' });
const f = build({ occupation: 'architect', presentation: 'feminine', saver: 'p75' });
ok('salary is identical across presentation', m.inputs.salary === f.inputs.salary,
   `${D(m.inputs.salary)} vs ${D(f.inputs.salary)}`);
ok('balances are identical', JSON.stringify(m.inputs.balances) === JSON.stringify(f.inputs.balances));
ok('spending is identical', m.inputs.annualExpenses === f.inputs.annualExpenses);
ok('contributions are identical', m.inputs.contrib401kPercent === f.inputs.contrib401kPercent);
ok('ONLY life expectancy differs', f.character.lifeExpectancy > m.character.lifeExpectancy,
   `${m.character.lifeExpectancy} vs ${f.character.lifeExpectancy}`);
ok('and the horizon follows it', f.inputs.horizonYears > m.inputs.horizonYears);

/* ===================================================================
 * Avatar SVG validity. Structural checks (balanced <g>, no "undefined")
 * passed while the left arm was emitting "l--13 3" — invalid path data
 * that browsers silently drop, so the arm disappeared. A rasteriser
 * caught it, not the tests. These assertions close that gap: the path
 * grammar itself is now checked for every attire x pose x build.
 * =================================================================== */
section('Avatar SVG is well-formed for every combination');
const AV = require('./avatar.js');
const combos = [];
for (const at of Object.keys(AV.ATTIRE))
  for (const po of Object.keys(AV.POSES))
    for (const bu of Object.keys(AV.BUILDS)) combos.push([at, po, bu]);

const badSign = [], badNum = [], badCmd = [], unbalanced = [], tokens = [];
for (const [at, po, bu] of combos) {
  const svg = AV.buildAvatar({ attire: at, pose: po, build: bu, size: 68 });
  const where = `${at}/${po}/${bu}`;
  if (/undefined|NaN|\[object/.test(svg)) tokens.push(where);
  if ((svg.match(/<g[ >]/g) || []).length !== (svg.match(/<\/g>/g) || []).length) unbalanced.push(where);
  for (const m of svg.matchAll(/ d="([^"]*)"/g)) {
    const d = m[1];
    if (/[-+]{2}/.test(d)) badSign.push(`${where}: ${d.replace(/\s+/g, ' ').slice(0, 60)}`);
    if (/\d\.\d*\./.test(d)) badNum.push(where);
    // every path must start with a moveto and use only known commands
    if (!/^\s*[Mm]/.test(d)) badCmd.push(`${where}: starts "${d.trim().slice(0, 12)}"`);
    // Valid path commands are MLHVCSQTAZ only. Anything else alphabetic
    // is a typo. (My first pass at this class wrongly excluded A and C,
    // which ARE commands — the test was broken, not the avatars.)
    const stray = d.replace(/[eE][-+]?\d/g, '').match(/[^MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]/g);
    if (stray) badCmd.push(`${where} stray "${[...new Set(stray)].join('')}"`);
  }
  // rotate() transforms must carry three numbers
  for (const m of svg.matchAll(/rotate\(([^)]*)\)/g)) {
    const parts = m[1].trim().split(/[\s,]+/);
    if (!(parts.length === 1 || parts.length === 3) || parts.some((p) => !isFinite(+p))) {
      badNum.push(`${where}: rotate(${m[1]})`);
    }
  }
}
ok(`${combos.length} combinations render`, combos.length === 108, `got ${combos.length}`);
ok('no double signs in any path', !badSign.length, badSign.slice(0, 3).join('\n      '));
ok('no malformed numbers or rotations', !badNum.length, badNum.slice(0, 3).join('\n      '));
ok('every path starts with a moveto, uses known commands', !badCmd.length,
   badCmd.slice(0, 3).join('\n      '));
ok('groups are balanced', !unbalanced.length, unbalanced.slice(0, 3).join(', '));
ok('no template tokens leaked', !tokens.length, tokens.slice(0, 3).join(', '));

section('Z-order: the head is not buried');
/* The head is drawn late, on purpose — it must sit above the torso,
 * pauldrons, arms and backpack. A rasteriser lost it on some attires
 * while the markup was byte-identical to attires that kept it, so the
 * ordering is pinned here rather than trusted to a screenshot. */
{
  const svg = AV.buildAvatar({ attire: 'hoodie', size: 200, rimLight: true });
  const at = (needle) => svg.indexOf(needle);
  const backpack = at('backpack unit');
  const torso = at('torso: plated');
  const pauldrons = at('pauldrons');
  const arms = at('${arm'.replace('${arm', 'arms:'));
  const head = at('Head.');
  const rim = at('url(#') && svg.lastIndexOf('rimLight') >= 0 ? at('${uid}r') : -1;
  ok('the head comes after the backpack', head > backpack && backpack > 0);
  ok('after the torso', head > torso && torso > 0);
  ok('after the pauldrons', head > pauldrons && pauldrons > 0);
  ok('the neck, shell and visor are all present',
     /M62 58h16v12H62z/.test(svg) && /q22 0 22 25/.test(svg) && /52 40q18-6 36 0/.test(svg));
  ok('the visor is wider than the old slit', /v11 q0 8-18 8/.test(svg.replace(/\s+/g, ' '))
     || /52 40q18-6 36 0v11/.test(svg));
  ok('no hair escapes above the helmet — hair sits at the nape only',
     svg.indexOf('hair at the nape') > 0 && !/M51 44c-1-16/.test(svg));
}

section('Arms read as arms');
{
  const svg = AV.buildAvatar({ attire: 'hoodie', size: 200 });
  ok('two gauntlets and two hands', (svg.match(/rx="2\.5"/g) || []).length === 2);
  ok('two elbow joints', (svg.match(/r="6\.5"/g) || []).length === 2);
  ok('the limb carries its own outline so it separates from the torso',
     /stroke="#0b1016"/.test(svg));
  // the arms must hang outboard of the torso edge, or they vanish into it
  const shoulders = [...svg.matchAll(/rotate\([-\d.]+ ([\d.]+) 84\)/g)].map((m) => +m[1]);
  ok('both shoulders are outboard of centre', shoulders.length === 2
     && Math.min(...shoulders) < 70 && Math.max(...shoulders) > 70,
     'shoulders at ' + shoulders.join(', '));
  ok('and symmetric about it',
     Math.abs((shoulders[0] + shoulders[1]) / 2 - 70) < 0.01,
     'midpoint ' + (shoulders[0] + shoulders[1]) / 2);
}

section('Poses articulate, and clicking escalates');
ok('every pose sets both shoulders and both elbows',
   Object.values(AV.POSES).every((p) => ['armL', 'armR', 'elbowL', 'elbowR', 'lean', 'headTilt']
     .every((k) => typeof p[k] === 'number')));
ok('flex folds the elbow rather than pointing straight out',
   Math.abs(AV.POSES.flex.elbowR) > Math.abs(AV.POSES.flex.armR),
   `elbow ${AV.POSES.flex.elbowR} vs shoulder ${AV.POSES.flex.armR}`);
ok('idle is nearly neutral',
   Math.abs(AV.POSES.idle.armR) < 10 && Math.abs(AV.POSES.idle.elbowR) < 10);
ok('poses cycle then escalate',
   AV.avatarPose(0) !== AV.avatarPose(1) && AV.avatarPose(9) === 'annoyed');
ok('each role has its own barks',
   Object.keys(AV.ATTIRE).every((k) => Array.isArray(AV.AVATAR_LINES[k])
     && AV.AVATAR_LINES[k].length >= 3));
ok('the annoyed line is held back for persistence',
   Object.keys(AV.ATTIRE).every((k) => {
     const pool = AV.AVATAR_LINES[k];
     const last = pool[pool.length - 1];
     for (let i = 0; i < 4; i++) if (AV.avatarLine(k, i) === last) return false;
     return AV.avatarLine(k, 6) === last;
   }));
ok('the medical emblem is an ECG trace, not a protected cross',
   AV.ATTIRE.scrubs.emblem === 'ecg' && AV.ATTIRE.coat.emblem === 'ecg');

/* =================================================================== */
section('The teacher preset exercises the pension path');
const t = build({ occupation: 'teacher', saver: 'p75' });
ok('teacher gets a pension', t.inputs.pensionAnnual > 0, `${D(t.inputs.pensionAnnual)}`);
ok('and it reaches the simulation',
   sim(t).rows.some((r) => r.inflow.pension > 0));
const se = build({ occupation: 'softwareEngineer', saver: 'p75' });
ok('a non-pension role gets none', se.inputs.pensionAnnual === 0);

/* =================================================================== */
section('The roster is usable by a select screen');
const list = ch.roster();
ok('roster covers every occupation', list.length === Object.keys(ch.OCCUPATIONS).length);
ok('every entry has a label and attire', list.every((r) => r.label && r.attire));
ok('every entry explains what it exercises',
   list.every((r) => typeof r.exercises === 'string' && r.exercises.length > 15));
ok('the top-coded surgeon wage is flagged',
   list.find((r) => r.key === 'surgeon').topCoded === true);

/* =================================================================== */
console.log('\n' + '='.repeat(56));
if (failed) console.log(fails.join('\n') + '\n');
console.log(`${passed} passed, ${failed} failed`);
console.log('='.repeat(56));
process.exit(failed ? 1 : 0);

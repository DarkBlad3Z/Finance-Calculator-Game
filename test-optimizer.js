/* ===================================================================
 * test-optimizer.js — AUTO-OPTIMISER VERIFICATION
 * Run with:  node test-optimizer.js
 *
 * The optimiser's value is entirely in its CONSTRAINTS — without them
 * "maximise net worth" returns "spend nothing, buy only equities."
 * So this suite attacks the constraints rather than the arithmetic.
 * =================================================================== */
'use strict';
const { Money } = require('./money.js');
const cfgMod = require('./tax-config.js');
const tax = require('./tax-engine.js');
const eng = require('./engine.js');
const opt = require('./optimizer.js');

const $ = Money.fromDollars, D = Money.toDollars;
const CFG = cfgMod.getTaxConfig(2026, 0);
let passed = 0, failed = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) passed++; else { failed++; fails.push('  x ' + n + (d ? '\n      ' + d : '')); } };
const section = (t) => console.log('\n-- ' + t);

const PROFILE = {
  ...eng.defaultInputs(), currentAge: 40, salary: $(150000), stateCode: 'WA',
  annualExpenses: $(70000), retirementSpending: $(80000), retirementAge: 65,
};
const FAST = { mcTrials: 120, maxPasses: 3 };

/* =================================================================== */
section('It improves on the baseline, and never worsens it');
const r = opt.optimise(PROFILE, { targetAge: 65, ...FAST });
ok('optimised beats baseline', r.netWorthAtTarget > r.baselineNetWorth,
   `${D(r.baselineNetWorth)} -> ${D(r.netWorthAtTarget)}`);
ok('gain is reported positive', r.gain > 0);
ok('it reports its work', r.meta.evaluations > 20 && r.meta.passes >= 1);

// Optimising an already-optimised plan must not make it worse.
const again = opt.optimise(r.inputs, { targetAge: 65, ...FAST });
ok('re-optimising does not regress', again.netWorthAtTarget >= r.netWorthAtTarget - 100,
   `${D(r.netWorthAtTarget)} -> ${D(again.netWorthAtTarget)}`);

/* =================================================================== */
section('CONSTRAINT: spending is never touched');
ok('working spending unchanged', r.inputs.annualExpenses === PROFILE.annualExpenses,
   `${D(PROFILE.annualExpenses)} -> ${D(r.inputs.annualExpenses)}`);
ok('retirement spending unchanged', r.inputs.retirementSpending === PROFILE.retirementSpending);
ok('no constraint violations reported', r.violations.length === 0, r.violations.join('; '));

// The degenerate answer, proven unreachable: cutting spending would
// score far higher, so if spending were a lever it WOULD be chosen.
const starve = { ...r.inputs, annualExpenses: $(5000), retirementSpending: $(5000) };
const starveScore = opt.evaluate(starve, 65).netWorth;
ok('starving would score higher, so the constraint is load-bearing',
   starveScore > r.netWorthAtTarget,
   `starved ${D(starveScore)} vs optimised ${D(r.netWorthAtTarget)}`);

/* =================================================================== */
section('CONSTRAINT: facts are never rewritten');
for (const k of ['salary', 'currentAge', 'filingStatus', 'stateCode', 'retirementAge']) {
  ok(`${k} unchanged`, JSON.stringify(r.inputs[k]) === JSON.stringify(PROFILE[k]));
}
ok('starting balances unchanged',
   JSON.stringify(r.inputs.balances) === JSON.stringify(eng.normalizeInputs(PROFILE).balances));

/* =================================================================== */
section('CONSTRAINT: contributions stay legal');
const run = eng.simulate(r.inputs);
const cap401k = tax.max401kDeferral(40, CFG);
ok('401(k) deferral within the IRS limit', run.rows[0].contrib401k <= cap401k,
   `${D(run.rows[0].contrib401k)} vs cap ${D(cap401k)}`);
ok('after-tax stays inside 415(c) headroom',
   run.rows[0].contribAfterTax401k <= run.rows[0].afterTaxHeadroom,
   `${D(run.rows[0].contribAfterTax401k)} vs ${D(run.rows[0].afterTaxHeadroom)}`);
ok('IRA within limit', run.rows[0].contribIra <= tax.maxIraContribution(40, CFG));
ok('HSA within limit', run.rows[0].contribHsa <= tax.maxHsa(r.inputs.hsaCoverage, 40, CFG));
ok('no year exceeds the deferral cap',
   run.rows.filter((x) => !x.retired).every((x) => x.contrib401k <= tax.max401kDeferral(x.age, CFG)));

/* =================================================================== */
section('CONSTRAINT: risk is bounded, not maximised');
ok('equity weight stays inside the band',
   (r.inputs.allocations.brokerage.stocks ?? 0) <= 90,
   `${r.inputs.allocations.brokerage.stocks}%`);
ok('success rate clears the floor', r.successRate >= 0.80,
   `${(r.successRate * 100).toFixed(1)}%`);

// A wide band must not produce a 100%-equity answer that fails the floor.
const wide = opt.optimise(PROFILE,
  { targetAge: 65, equityBand: [40, 60, 80, 100], minSuccessRate: 0.85, ...FAST });
ok('a wide band still clears the floor', wide.successRate >= 0.85,
   `${(wide.successRate * 100).toFixed(1)}%`);

// The cash buffer must not be driven below a prudent floor.
ok('cash buffer never goes below 3 months', r.inputs.sweep.bufferMonths >= 3,
   `${r.inputs.sweep.bufferMonths} months`);
const bufLever = opt.buildLevers(eng.normalizeInputs(PROFILE),
  { equityBand: [80], allowMegaBackdoor: true, allowBackdoorRoth: true })
  .find((l) => l.id === 'buffer');
ok('1-month buffer is not even a candidate', !bufLever.candidates.includes(1),
   JSON.stringify(bufLever.candidates));
ok('and the exclusion is explained', !!bufLever.floored);

/* =================================================================== */
section('Moves are attributed honestly');
ok('at least one move is reported', r.moves.length > 0);
ok('moves are sorted by value', r.moves.every((m, i) =>
   i === 0 || r.moves[i - 1].worth >= m.worth));
ok('every move states a from and a to', r.moves.every((m) => m.from !== undefined && m.to !== undefined));
ok('every move carries a rationale', r.moves.every((m) => typeof m.why === 'string' && m.why.length > 20));
ok('a zero-value move is labelled neutral rather than a win',
   r.moves.every((m) => (m.worth === 0) === (m.neutral === true)));

// Reverting every reported move should land back near the baseline.
// It will not be exact, because levers interact — asserting that it is
// CLOSE is the honest claim, and asserting exactness would be wrong.
const attributed = r.moves.reduce((s, m) => s + m.worth, 0);
ok('attributed value is the right order of magnitude',
   attributed > r.gain * 0.3 && attributed < r.gain * 3,
   `attributed ${D(attributed)} vs actual gain ${D(r.gain)}`);

/* =================================================================== */
section('Determinism');
const a = opt.optimise(PROFILE, { targetAge: 65, ...FAST });
const b = opt.optimise(PROFILE, { targetAge: 65, ...FAST });
ok('same inputs give the same answer', a.netWorthAtTarget === b.netWorthAtTarget);
ok('and the same move list', JSON.stringify(a.moves.map((m) => m.id)) === JSON.stringify(b.moves.map((m) => m.id)));

/* =================================================================== */
section('A failing plan is rescued where that is possible');
/* Salvageable: the baseline runs dry at 93, and the optimiser should
 * push it past the horizon entirely. This exercises the depletion
 * ordering in the objective — without it every failing candidate
 * scores zero and the search is blind. */
const SALVAGE = {
  ...eng.defaultInputs(), stateCode: 'WA', horizonYears: 50,
  currentAge: 45, salary: $(95000), retirementAge: 55,
  annualExpenses: $(44000), retirementSpending: $(48000),
  balances: { cash: $(12000), trad401k: $(95000), roth401k: 0, tradIra: 0,
    rothIra: $(18000), hsa: 0, brokerage: $(25000), brokerageBasis: $(20000),
    commodities: 0, crypto: 0, c529: 0 },
};
const salv = opt.optimise(SALVAGE, { targetAge: 90, mcTrials: 80, maxPasses: 3, minSuccessRate: 0.3 });
ok('the failing baseline is detected', salv.baselineDepletedAge !== null,
   `baseline dry at ${salv.baselineDepletedAge}`);
ok('the optimiser pushes depletion out or removes it',
   salv.depletedAge === null || salv.depletedAge > salv.baselineDepletedAge,
   `${salv.baselineDepletedAge} -> ${salv.depletedAge}`);
ok('and it reports a real gain', salv.netWorthAtTarget > salv.baselineNetWorth);
ok('spending untouched while rescuing', salv.inputs.annualExpenses === SALVAGE.annualExpenses
   && salv.inputs.retirementSpending === SALVAGE.retirementSpending);

section('A hopeless plan is reported honestly, not flattered');
/* $103k of assets cannot fund retiring at 60 on $65k a year. No lever
 * reaches it. The optimiser must say so rather than manufacture a
 * gain — a planning tool that always claims a win is worthless. */
const HOPELESS = {
  ...eng.defaultInputs(), stateCode: 'WA', horizonYears: 45,
  currentAge: 45, salary: $(85000), retirementAge: 60,
  annualExpenses: $(60000), retirementSpending: $(65000),
  balances: { cash: $(12000), trad401k: $(70000), roth401k: 0, tradIra: 0,
    rothIra: $(6000), hsa: 0, brokerage: $(15000), brokerageBasis: $(13000),
    commodities: 0, crypto: 0, c529: 0 },
};
const hope = opt.optimise(HOPELESS, { targetAge: 85, mcTrials: 80, maxPasses: 3, minSuccessRate: 0.3 });
ok('it does not crash on an unsalvageable plan', !!hope.inputs);
ok('it reports the depletion rather than hiding it', hope.depletedAge !== null,
   `depleted at ${hope.depletedAge}`);
ok('it claims no gain it cannot deliver', hope.gain <= 0,
   `claimed gain ${D(hope.gain)}`);
ok('it still leaves spending alone', hope.inputs.annualExpenses === HOPELESS.annualExpenses);

section('Target age is honoured');
const early = opt.optimise(PROFILE, { targetAge: 55, ...FAST });
ok('target age is reported back', early.targetAge === 55);
ok('the horizon is extended to reach the target',
   early.inputs.horizonYears >= 55 - PROFILE.currentAge + 1);
// Optimising for 55 vs 65 should not give an identical plan.
ok('a different target gives a different plan',
   JSON.stringify(early.moves.map((m) => m.to)) !== JSON.stringify(r.moves.map((m) => m.to))
   || early.netWorthAtTarget !== r.netWorthAtTarget);

/* =================================================================== */
section('quickStart: a few facts in, a plan out');
const qs = opt.quickStart(
  { age: 34, salary: $(120000), state: 'TX', spending: $(55000), targetAge: 60 }, FAST);
ok('quickStart returns a full result', qs.inputs && qs.moves && qs.meta);
ok('it used the facts given', qs.inputs.currentAge === 34 &&
   qs.inputs.salary === $(120000) && qs.inputs.stateCode === 'TX');
ok('it respected the spending given', qs.inputs.annualExpenses === $(55000));
ok('it targeted the age given', qs.targetAge === 60);
ok('and produced a legal plan',
   eng.simulate(qs.inputs).rows[0].contrib401k <= tax.max401kDeferral(34, CFG));

/* =================================================================== */
section('Plan capability flags are respected');
const noMega = opt.optimise(PROFILE, { targetAge: 65, allowMegaBackdoor: false, ...FAST });
ok('no after-tax contributions when the plan forbids it',
   eng.simulate(noMega.inputs).rows[0].contribAfterTax401k === 0);
ok('and no mega-backdoor move is offered',
   !noMega.moves.some((m) => m.id === 'afterTax'));
const noBack = opt.optimise(PROFILE, { targetAge: 65, allowBackdoorRoth: false, ...FAST });
ok('backdoor stays off when disallowed', noBack.inputs.backdoorRoth !== true);

/* =================================================================== */
console.log('\n' + '='.repeat(56));
if (failed) console.log(fails.join('\n') + '\n');
console.log(`${passed} passed, ${failed} failed`);
console.log('='.repeat(56));
process.exit(failed ? 1 : 0);

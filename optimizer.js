/* ===================================================================
 * optimizer.js — AUTO-OPTIMISE ("the cheat code")
 * -------------------------------------------------------------------
 * Give it a profile and a target age; it searches the settings that
 * are genuinely YOUR CHOICE and returns the arrangement that maximises
 * net worth at that age — plus a ranked, costed list of what it
 * changed and why.
 *
 * -------------------------------------------------------------------
 * THE TRAP THIS AVOIDS
 *
 * "Maximise net worth" taken literally has a degenerate answer: spend
 * nothing, put everything in equities, and defer every dollar. That is
 * not advice, it is a arithmetic tautology. So:
 *
 *   1. SPENDING IS A CONSTRAINT, NOT A LEVER. You say what you spend;
 *      the optimiser may not touch it. Without this the answer is
 *      always "spend $0".
 *   2. EQUITY WEIGHT IS BOUNDED, and the winner must clear a Monte
 *      Carlo success floor. Without this the answer is always "100%
 *      stocks", which maximises the mean by widening the left tail.
 *   3. EVERY MOVE IS ATTRIBUTED. A black-box answer is useless in
 *      planning. Each change is re-run in isolation so you can see
 *      what it is individually worth and drop the ones you dislike.
 *
 * What it may change: the traditional/Roth split, contribution sizes
 * within IRS limits, backdoor and mega-backdoor use, HSA, the Roth
 * conversion bracket, equity weight inside a band, the cash buffer,
 * withdrawal order and lot selection.
 *
 * What it may never change: spending, salary, age, state, filing
 * status, or your starting balances. Those are facts, not choices.
 *
 * ESTIMATE ONLY. This finds the best arrangement under the model's
 * assumptions, which are simplified. It is not advice.
 * =================================================================== */

'use strict';

(function (root, factory) {
  const deps = typeof require === 'function'
    ? [require('./money.js').Money, require('./tax-config.js'),
       require('./tax-engine.js'), require('./engine.js')]
    : [root.Money, root, root, root];
  const api = factory(...deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function (Money, cfgMod, taxMod, eng) {

const { getTaxConfig } = cfgMod;
const { max401kDeferral, maxIraContribution, maxHsa } = taxMod;
const { simulate, monteCarlo, normalizeInputs } = eng;

const clone = (o) => JSON.parse(JSON.stringify(o));

/* -------------------------------------------------------------------
 * OBJECTIVE
 *
 * Net worth at the target age. If the plan runs dry before then, every
 * candidate would score zero and the search would be blind — so a
 * depleting plan is scored by how long it lasted instead, and any
 * surviving plan beats any depleting one.
 * ----------------------------------------------------------------- */
const DEPLETED_FLOOR = -1e15;

function evaluate(inputs, targetAge) {
  const run = simulate(inputs);
  const rows = run.rows;
  const row = rows.find((r) => r.age === targetAge)
    ?? rows[rows.length - 1];

  const dry = rows.find((r) => r.depleted);
  if (dry && dry.age <= targetAge) {
    // Later depletion is strictly better; all of these lose to survival.
    return { score: DEPLETED_FLOOR + dry.age * 1e9, netWorth: 0, run, depletedAge: dry.age };
  }
  return { score: row.netWorth, netWorth: row.netWorth, run, depletedAge: dry ? dry.age : null };
}

/* -------------------------------------------------------------------
 * LEVERS
 *
 * Each lever knows its candidate values for a given input state, how
 * to apply one, and how to describe the result. Candidates are derived
 * from the live IRS limits so the optimiser cannot propose something
 * illegal.
 * ----------------------------------------------------------------- */
function buildLevers(I, opts) {
  const cfg = getTaxConfig(I.startYear, 0);
  const age = I.currentAge;
  const cap401k = max401kDeferral(age, cfg);
  const capIra = maxIraContribution(age, cfg);
  const capHsa = maxHsa(I.hsaCoverage, age, cfg);
  const headroom = Money.floor0(
    Money.sub(cfg.limits.definedContribution415c, Money.add(cap401k, Money.mul(I.salary, I.employerMatchCapPct)))
  );
  const frac = (cap, parts) => parts.map((p) => Math.round(cap * p));

  const levers = [];

  levers.push({
    id: 'deferral',
    label: '401(k) employee deferral',
    candidates: frac(cap401k, [0, 0.25, 0.5, 0.75, 1]),
    read: (x) => x.contrib401kDollar,
    apply: (x, v) => { x.contrib401kMode = 'dollar'; x.contrib401kDollar = v; },
    fmt: (v) => Money.fmt(v),
    why: 'Deferrals cut taxable income at your top marginal rate now and come out later at a lower one.',
  });

  levers.push({
    id: 'rothSplit',
    label: 'Share of deferral to Roth',
    candidates: [0, 0.25, 0.5, 0.75, 1],
    read: (x) => x.roth401kSplit,
    apply: (x, v) => { x.roth401kSplit = v; },
    fmt: (v) => `${Math.round(v * 100)}% Roth`,
    why: 'Traditional wins when your rate now exceeds your rate later; Roth wins when it does not.',
  });

  if (opts.allowBackdoorRoth) {
    levers.push({
      id: 'backdoor',
      label: 'Backdoor Roth IRA',
      candidates: [false, true],
      read: (x) => x.backdoorRoth,
      apply: (x, v) => { x.backdoorRoth = v; x.contribRothIra = v ? capIra : x.contribRothIra; },
      fmt: (v) => (v ? 'on' : 'off'),
      why: 'Bypasses the Roth income phase-out. Free unless you hold a pre-tax IRA (pro-rata).',
    });
  }

  if (opts.allowMegaBackdoor && headroom > 0) {
    levers.push({
      id: 'afterTax',
      label: 'After-tax 401(k) (mega backdoor)',
      candidates: frac(headroom, [0, 0.25, 0.5, 0.75, 1]),
      read: (x) => (x.afterTax401kEnabled ? x.afterTax401kAmount : 0),
      apply: (x, v) => { x.afterTax401kEnabled = v > 0; x.afterTax401kAmount = v; },
      fmt: (v) => (v > 0 ? Money.fmt(v) : 'off'),
      why: 'Extra Roth space — but it is locked until 59.5, so it competes with a taxable bridge.',
    });
  }

  levers.push({
    id: 'hsa',
    label: 'HSA contribution',
    candidates: [0, capHsa],
    read: (x) => x.contribHsa,
    apply: (x, v) => { x.contribHsa = v; },
    fmt: (v) => (v > 0 ? Money.fmt(v) : 'off'),
    why: 'The only account that escapes FICA as well as income tax.',
  });

  levers.push({
    id: 'conversion',
    label: 'Roth conversion ladder',
    candidates: ['none', 0.10, 0.12, 0.22, 0.24],
    read: (x) => (x.rothConversionMode === 'none' ? 'none' : x.rothConversionFillToRate),
    apply: (x, v) => {
      if (v === 'none') { x.rothConversionMode = 'none'; }
      else { x.rothConversionMode = 'fillBracket'; x.rothConversionFillToRate = v; }
    },
    fmt: (v) => (v === 'none' ? 'off' : `fill to ${Math.round(v * 100)}%`),
    why: 'Uses low-income years to move pre-tax money out cheaply and kill future RMDs.',
  });

  levers.push({
    id: 'equity',
    label: 'Equity weight',
    candidates: opts.equityBand,
    read: (x) => (x.allocations?.brokerage?.stocks ?? 85),
    apply: (x, v) => {
      const a = { stocks: v, bonds: 100 - v };
      for (const k of ['trad401k', 'roth401k', 'tradIra', 'rothIra', 'hsa', 'brokerage']) {
        x.allocations[k] = { ...a };
      }
    },
    fmt: (v) => `${v}% equities`,
    why: 'Bounded on purpose. More equities lifts the average by fattening the bad tail.',
    risky: true,
  });

  levers.push({
    id: 'buffer',
    label: 'Cash buffer',
    /* Floored at 3 months ON PURPOSE. Left free, the optimiser drives
     * this to 1 month, because the model only sees the drag of idle
     * cash and never sees a job loss or a boiler. Same class of
     * judgment as bounding equity weight: the metric is not the goal. */
    candidates: [3, 6, 9, 12],
    read: (x) => x.sweep.bufferMonths,
    apply: (x, v) => { x.sweep.enabled = true; x.sweep.bufferMode = 'months'; x.sweep.bufferMonths = v; },
    fmt: (v) => `${v} month${v === 1 ? '' : 's'}`,
    why: 'Idle cash earns near nothing, but too small a buffer forces badly-timed sales.',
    floored: 'Not searched below 3 months — the model cannot see an emergency.',
  });

  levers.push({
    id: 'lots',
    label: 'Tax lot selection',
    candidates: ['ltFirst', 'hifo', 'fifo'],
    read: (x) => x.lotSelectionMethod,
    apply: (x, v) => { x.lotSelectionMethod = v; },
    fmt: (v) => ({ ltFirst: 'long-term first', hifo: 'highest cost first', fifo: 'oldest first' }[v]),
    why: 'Which shares you sell decides how much gain you realise.',
  });

  const ORDERS = {
    'taxable first': ['cash', 'brokerage', 'trad401k', 'tradIra', 'roth401k', 'rothIra', 'hsa'],
    'pre-tax first': ['cash', 'trad401k', 'tradIra', 'brokerage', 'roth401k', 'rothIra', 'hsa'],
    'Roth last, pre-tax mid': ['cash', 'brokerage', 'tradIra', 'trad401k', 'rothIra', 'roth401k', 'hsa'],
  };
  levers.push({
    id: 'order',
    label: 'Withdrawal order',
    candidates: Object.keys(ORDERS),
    read: (x) => Object.keys(ORDERS).find((k) =>
      ORDERS[k].join() === (x.withdrawalOrder || []).join()) ?? 'taxable first',
    apply: (x, v) => { x.withdrawalOrder = [...ORDERS[v]]; },
    fmt: (v) => v,
    why: 'Sequencing decides which bracket each dollar of spending is taxed in.',
  });

  return levers;
}

/* ===================================================================
 * MAIN ENTRY POINT
 * =================================================================== */
function optimise(baseInputs, options = {}) {
  const t0 = Date.now();
  const {
    targetAge = null,
    minSuccessRate = 0.80,
    mcTrials = 400,
    mcSeed = 2026,
    equityBand = [50, 60, 70, 80, 90],
    allowMegaBackdoor = true,
    allowBackdoorRoth = true,
    maxPasses = 5,
    validateRisk = true,
  } = options;

  // Normalise once so the search starts from legal, complete inputs.
  let current = normalizeInputs(clone(baseInputs));
  const target = targetAge ?? Math.min(
    current.currentAge + current.horizonYears - 1,
    Math.max(current.retirementAge, current.currentAge + 20)
  );

  // The horizon has to actually reach the target age.
  const needed = target - current.currentAge + 1;
  if (current.horizonYears < needed) current.horizonYears = needed;

  const opts = { equityBand, allowMegaBackdoor, allowBackdoorRoth };
  const levers = buildLevers(current, opts);

  const baselineInputs = clone(current);
  const baseline = evaluate(baselineInputs, target);
  const spendingBefore = { annual: current.annualExpenses, retirement: current.retirementSpending };

  let best = { ...baseline, inputs: clone(current) };
  let evaluations = 1;
  let passes = 0;

  /* --- coordinate ascent ---------------------------------------- */
  for (let pass = 0; pass < maxPasses; pass++) {
    passes = pass + 1;
    let improvedThisPass = false;

    for (const lever of levers) {
      let localBest = best;
      for (const cand of lever.candidates) {
        const trial = clone(best.inputs);
        lever.apply(trial, cand);
        const res = evaluate(trial, target);
        evaluations++;
        // Strictly better only, so ties keep the earlier (simpler) value.
        if (res.score > localBest.score) {
          localBest = { ...res, inputs: trial };
          improvedThisPass = true;
        }
      }
      best = localBest;
    }
    if (!improvedThisPass) break;
  }

  /* --- risk validation -------------------------------------------
   * The search runs on the fixed-return simulation because it is fast
   * and deterministic. That can favour an arrangement whose average is
   * great and whose bad tail is awful, so the winner is checked with a
   * real Monte Carlo and the riskiest lever is walked back until it
   * clears the floor. */
  let mc = null;
  let riskWalkbacks = 0;
  if (validateRisk) {
    mc = monteCarlo(best.inputs, { trials: mcTrials, seed: mcSeed });
    const band = [...equityBand].sort((a, b) => a - b);
    let idx = band.indexOf(best.inputs.allocations?.brokerage?.stocks ?? band[band.length - 1]);
    while (mc.successRate < minSuccessRate && idx > 0) {
      idx--; riskWalkbacks++;
      const safer = clone(best.inputs);
      levers.find((l) => l.id === 'equity').apply(safer, band[idx]);
      const res = evaluate(safer, target);
      evaluations++;
      const mc2 = monteCarlo(safer, { trials: mcTrials, seed: mcSeed });
      // Only accept the de-risking if it actually helps the floor.
      if (mc2.successRate > mc.successRate) { best = { ...res, inputs: safer }; mc = mc2; }
      else break;
    }
  }

  /* --- attribution ------------------------------------------------
   * Value each change by reverting JUST that one and re-running. This
   * is what makes the result arguable instead of oracular. */
  const moves = [];
  for (const lever of levers) {
    const from = lever.read(baselineInputs);
    const to = lever.read(best.inputs);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;

    const without = clone(best.inputs);
    lever.apply(without, from);
    const res = evaluate(without, target);
    evaluations++;
    const worth = Money.sub(best.netWorth, res.netWorth);
    moves.push({
      id: lever.id,
      label: lever.label,
      from: lever.fmt(from),
      to: lever.fmt(to),
      worth,
      /* A move can be picked up during the search and still be worth
       * nothing on its own — it may only pay off in combination, or it
       * may be genuinely neutral for this profile. Saying so is more
       * useful than quietly listing it as a win. */
      neutral: worth === 0,
      why: lever.why,
      risky: !!lever.risky,
      floored: lever.floored ?? null,
    });
  }
  moves.sort((a, b) => b.worth - a.worth);

  /* --- constraint audit: prove it left the facts alone ----------- */
  const violations = [];
  if (best.inputs.annualExpenses !== spendingBefore.annual ||
      best.inputs.retirementSpending !== spendingBefore.retirement) {
    violations.push('spending was modified');
  }
  for (const k of ['salary', 'currentAge', 'filingStatus', 'stateCode', 'retirementAge']) {
    if (JSON.stringify(best.inputs[k]) !== JSON.stringify(baselineInputs[k])) {
      violations.push(`${k} was modified`);
    }
  }
  if (JSON.stringify(best.inputs.balances) !== JSON.stringify(baselineInputs.balances)) {
    violations.push('starting balances were modified');
  }

  return {
    inputs: best.inputs,
    targetAge: target,
    netWorthAtTarget: best.netWorth,
    baselineNetWorth: baseline.netWorth,
    gain: Money.sub(best.netWorth, baseline.netWorth),
    depletedAge: best.depletedAge,
    baselineDepletedAge: baseline.depletedAge,
    successRate: mc ? mc.successRate : null,
    monteCarlo: mc,
    moves,
    violations,
    meta: { evaluations, passes, riskWalkbacks, ms: Date.now() - t0, minSuccessRate },
  };
}

/* -------------------------------------------------------------------
 * The one-screen path: a few facts in, a configured plan out.
 * Anything not supplied falls back to the engine defaults.
 * ----------------------------------------------------------------- */
function quickStart(facts, options = {}) {
  const d = eng.defaultInputs();
  const I = {
    ...d,
    currentAge: facts.age ?? d.currentAge,
    salary: facts.salary ?? d.salary,
    stateCode: facts.state ?? d.stateCode,
    filingStatus: facts.filingStatus ?? d.filingStatus,
    retirementAge: facts.retirementAge ?? d.retirementAge,
    annualExpenses: facts.spending ?? d.annualExpenses,
    retirementSpending: facts.retirementSpending ?? facts.spending ?? d.retirementSpending,
    balances: { ...d.balances, ...(facts.balances ?? {}) },
    employerMatchRate: facts.matchRate ?? d.employerMatchRate,
    employerMatchCapPct: facts.matchCapPct ?? d.employerMatchCapPct,
    employerMatchDollarCap: facts.matchDollarCap ?? d.employerMatchDollarCap,
  };
  if (facts.horizonYears) I.horizonYears = facts.horizonYears;
  return optimise(I, { targetAge: facts.targetAge ?? null, ...options });
}

return { optimise, quickStart, evaluate, buildLevers };
});

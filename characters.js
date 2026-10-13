/* ===================================================================
 * characters.js — OCCUPATION PRESETS
 * -------------------------------------------------------------------
 * Turns three choices (role, place, stage) into a filled-in plan, so a
 * new user is not staring at sixty blank inputs.
 *
 * >>> PROVENANCE IS THE POINT OF THIS FILE. <<<
 *
 * Every value carries a `src` tag, and the UI must show it:
 *
 *   'measured' — published for this occupation, from BLS OEWS.
 *   'derived'  — computed from age and income band. Nobody publishes
 *                balances by occupation, so these are inferred from
 *                the Fed's Survey of Consumer Finances and Vanguard's
 *                How America Saves. Plausible, not observed.
 *   'statute'  — fixed in law (state tax, SSA tables).
 *
 * A derived number that looks measured is the failure mode here, which
 * is why the badge never fades in the interface.
 *
 * ACCURACY: figures are transcribed for planning estimates and every
 * one is editable. Verify before relying on output.
 * =================================================================== */

'use strict';

const CHARACTER_DATA_META = {
  verifiedOn: '2026-09-29',
  sources: [
    'BLS Occupational Employment and Wage Statistics (OEWS), May 2025 — national median annual wages.',
    'Federal Reserve Survey of Consumer Finances — retirement balances by age band.',
    "Vanguard, How America Saves — median single-plan 401(k) balances by age.",
    'SSA period life tables — life expectancy by sex.',
  ],
  unverified: [
    'stateMultiplier — approximate wage indices, NOT transcribed from the per-state OEWS tables. Directionally right, individually imprecise.',
    'balanceBands — derived from age/income medians, not measured per occupation.',
    'EFF_TAX — a coarse effective-rate table used only to turn a savings rate into a spending figure. The engine computes real tax properly.',
    'SAVER_BEHAVIOUR savingsRate / deferralPct — plausible behaviour for each percentile, not a measured series.',
    'matchDefaults — typical plan design, not a survey of any specific employer.',
  ],
  caution:
    'A genuinely MEDIAN saver does not retire early. Median 401(k) is roughly '
    + '$40k at 35-44 and $68k at 45-54, and over half of US households report no '
    + 'retirement savings at all. The saver percentile is deliberately an explicit '
    + 'choice rather than a hidden assumption — quietly picking flattering numbers '
    + 'would make this a toy.',
};

/* ===================================================================
 * OCCUPATIONS — national median wage, BLS OEWS May 2025
 * `growth` is a typical real-terms wage trajectory for the field.
 * `attire` drives the avatar only.
 * =================================================================== */
const OCCUPATIONS = {
  surgeon: {
    label: 'Surgeon', medianWage: 239_200_00, src: 'measured',
    topCoded: true, growth: 0.030, attire: 'scrubs',
    note: 'BLS top-codes this occupation at $239,200, so the true median is higher.',
    exercises: 'Very high income, late start, large training debt.',
  },
  physician: {
    label: 'Physician (family med)', medianWage: 224_640_00, src: 'measured',
    growth: 0.028, attire: 'coat',
    exercises: 'High income with a compressed earning window.',
  },
  attorney: {
    label: 'Attorney', medianWage: 151_160_00, src: 'measured',
    growth: 0.035, attire: 'suit',
    exercises: 'High income, heavy debt, steep early trajectory.',
  },
  salesManager: {
    label: 'Sales manager', medianWage: 138_280_00, src: 'measured',
    growth: 0.040, attire: 'blazer', variableComp: 0.35,
    exercises: 'Large commission share — income is lumpy.',
  },
  softwareEngineer: {
    label: 'Software engineer', medianWage: 133_080_00, src: 'measured',
    growth: 0.035, attire: 'hoodie',
    exercises: 'Mega-backdoor access is common in this sector.',
  },
  architect: {
    label: 'Architect', medianWage: 95_180_00, src: 'measured',
    growth: 0.030, attire: 'rolledSleeves',
    exercises: 'Moderate pay, long unpaid licensure runway.',
  },
  nurse: {
    label: 'Registered nurse', medianWage: 93_600_00, src: 'measured',
    growth: 0.026, attire: 'scrubs',
    exercises: 'Shift differentials and strong employer benefits.',
  },
  accountant: {
    label: 'Accountant', medianWage: 81_680_00, src: 'measured',
    growth: 0.030, attire: 'shirt',
    exercises: 'Mid income, high financial literacy baseline.',
  },
  teacher: {
    label: 'Teacher (secondary)', medianWage: 65_220_00, src: 'measured',
    growth: 0.022, attire: 'cardigan', pensionFraction: 0.55,
    exercises: 'A PENSION — a completely different retirement model, and '
      + 'the only preset that exercises the engine’s pension field.',
  },
  electrician: {
    label: 'Electrician', medianWage: 62_350_00, src: 'measured',
    growth: 0.028, attire: 'hardHat',
    exercises: 'No degree debt and an early start, so compounding runs longer.',
  },
  custom: {
    label: 'Custom / blank', medianWage: null, src: 'none',
    growth: 0.030, attire: 'shirt',
    exercises: 'Start from nothing and enter your own figures.',
  },
};

/* ===================================================================
 * STATE — tax comes from statute (tax-config.js); the wage index and
 * cost-of-living ratio are approximations. Flagged in _meta.
 * =================================================================== */
const STATE_FACTORS = {
  WA: { wage: 1.10, cost: 1.06 }, CA: { wage: 1.15, cost: 1.15 },
  NY: { wage: 1.12, cost: 1.16 }, MA: { wage: 1.12, cost: 1.12 },
  CO: { wage: 1.04, cost: 1.03 }, TX: { wage: 0.97, cost: 0.93 },
  FL: { wage: 0.95, cost: 0.99 }, IL: { wage: 1.01, cost: 0.98 },
  AZ: { wage: 0.96, cost: 0.98 }, GA: { wage: 0.96, cost: 0.94 },
  NC: { wage: 0.95, cost: 0.93 }, OR: { wage: 1.05, cost: 1.05 },
  NV: { wage: 0.97, cost: 0.99 }, PA: { wage: 0.99, cost: 0.97 },
  OH: { wage: 0.94, cost: 0.90 }, MI: { wage: 0.95, cost: 0.91 },
  TN: { wage: 0.92, cost: 0.90 }, MN: { wage: 1.02, cost: 0.97 },
  VA: { wage: 1.02, cost: 1.01 }, NJ: { wage: 1.08, cost: 1.10 },
  UT: { wage: 0.96, cost: 0.96 }, ID: { wage: 0.91, cost: 0.94 },
};
const DEFAULT_STATE_FACTOR = { wage: 1.00, cost: 1.00 };

/* ===================================================================
 * CAREER STAGE — age band and where in the wage distribution you sit.
 * =================================================================== */
const STAGES = {
  early:  { label: 'Early career',  age: 27, wagePercentile: 0.25, wageFactor: 0.66 },
  mid:    { label: 'Mid career',    age: 38, wagePercentile: 0.50, wageFactor: 1.00 },
  senior: { label: 'Senior',        age: 48, wagePercentile: 0.75, wageFactor: 1.32 },
  late:   { label: 'Late career',   age: 57, wagePercentile: 0.75, wageFactor: 1.38 },
};

/* ===================================================================
 * SAVER PERCENTILE — the honest dial.
 *
 * Total retirement savings as a MULTIPLE OF CURRENT SALARY, by age
 * band. The 50th column is close to observed medians; 75th and 90th
 * are scaled from the same distributions. Deliberately explicit,
 * because a median saver mostly does not retire early and hiding that
 * would be dishonest.
 * =================================================================== */
const SAVER_BANDS = {
  //          age band        p50    p75    p90
  '25-34': { p50: 0.35, p75: 0.95, p90: 1.90 },
  '35-44': { p50: 0.85, p75: 2.10, p90: 4.00 },
  '45-54': { p50: 1.60, p75: 3.60, p90: 6.50 },
  '55-64': { p50: 2.40, p75: 5.20, p90: 9.00 },
  '65+':   { p50: 2.60, p75: 5.60, p90: 9.60 },
};
const SAVER_LABELS = { p50: 'Median saver', p75: 'Diligent saver', p90: 'Strong saver' };

/** How the total is split across account types, by saver level. */
const ACCOUNT_MIX = {
  p50: { trad401k: 0.72, rothIra: 0.10, brokerage: 0.10, cash: 0.08 },
  p75: { trad401k: 0.62, rothIra: 0.13, brokerage: 0.18, cash: 0.07 },
  p90: { trad401k: 0.55, rothIra: 0.15, brokerage: 0.24, cash: 0.06 },
};

/* ===================================================================
 * SAVER BEHAVIOUR — the fix for an internal contradiction.
 *
 * A first cut set median BALANCES but left the engine's default
 * CONTRIBUTIONS in place, which put 23% of gross away every year. That
 * is incoherent: someone saving 23% would not have median balances,
 * and the mistake inflated every median outcome by an order of
 * magnitude (a median software engineer "retired" with $18M).
 *
 * So the saver percentile now drives balances, contributions AND
 * spending together. Each character is internally consistent: the
 * money they have reflects the rate they save, which reflects what
 * they spend.
 *
 * `savingsRate` sizes SPENDING only (spend = gross less tax less this).
 * The rate actually achieved comes out higher, because the employer
 * match and the deferral's own tax saving add on top — so the realised
 * figure is read from the simulation rather than claimed here.
 * =================================================================== */
const SAVER_BEHAVIOUR = {
  p50: {
    savingsRate: 0.07, deferralPct: 0.05, useIra: false, useHsa: false,
    note: 'Contributes roughly enough to catch part of the match. This is what '
      + 'median balances actually imply, and it mostly does not fund an early exit.',
  },
  p75: {
    savingsRate: 0.16, deferralPct: 0.10, useIra: true, useHsa: true,
    note: 'Meaningful deferral plus an IRA and HSA.',
  },
  p90: {
    savingsRate: 0.27, deferralPct: 0.18, useIra: true, useHsa: true,
    note: 'Deferring hard, filling the tax-advantaged buckets.',
  },
};

/* Rough combined federal + FICA effective rate, used only to turn a
 * target savings rate into a spending figure. The real tax is computed
 * properly by the engine; this is just to make the two consistent. */
const EFF_TAX = [
  { upToWage: 60_000_00, rate: 0.17 },
  { upToWage: 100_000_00, rate: 0.21 },
  { upToWage: 160_000_00, rate: 0.25 },
  { upToWage: 250_000_00, rate: 0.29 },
  { upToWage: null, rate: 0.33 },
];

/** Typical plan design. Not a survey of any specific employer. */
const MATCH_DEFAULTS = { rate: 1.00, capPct: 0.04, dollarCap: 0 };

/** SSA period life tables, rounded. Presentation's only real job. */
const LIFE_EXPECTANCY = { masculine: 81, feminine: 85, unspecified: 83 };

/* ===================================================================
 * BUILD
 * =================================================================== */
function ageBand(age) {
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  if (age < 55) return '45-54';
  if (age < 65) return '55-64';
  return '65+';
}

function effTaxFor(wage) {
  for (const b of EFF_TAX) if (b.upToWage === null || wage <= b.upToWage) return b.rate;
  return 0.30;
}

/**
 * Build a character.
 *
 * @param {object} choice
 *   occupation  key into OCCUPATIONS
 *   state       two-letter code
 *   stage       'early' | 'mid' | 'senior' | 'late'
 *   saver       'p50' | 'p75' | 'p90'
 *   presentation 'masculine' | 'feminine' | 'unspecified'  (avatar + SSA table ONLY)
 *   age         optional explicit age, overriding the stage default
 * @returns {{ inputs, fields, character }}
 *   `fields` carries a provenance badge per value for the review screen.
 */
function buildCharacter(choice = {}) {
  const occKey = choice.occupation ?? 'softwareEngineer';
  const occ = OCCUPATIONS[occKey] ?? OCCUPATIONS.softwareEngineer;
  const stage = STAGES[choice.stage ?? 'mid'] ?? STAGES.mid;
  const saver = ['p50', 'p75', 'p90'].includes(choice.saver) ? choice.saver : 'p75';
  const stateCode = choice.state ?? 'WA';
  const sf = STATE_FACTORS[stateCode] ?? DEFAULT_STATE_FACTOR;
  const presentation = choice.presentation ?? 'unspecified';
  const age = choice.age ?? stage.age;

  const fields = [];
  const add = (key, label, value, src, note) => {
    fields.push({ key, label, value, src, note: note ?? null });
    return value;
  };

  /* --- salary: measured wage, indexed for state and stage --------- */
  let salary;
  if (occ.medianWage === null) {
    salary = add('salary', 'Gross salary', 0, 'none', 'Blank preset — enter your own.');
  } else {
    const national = Math.round(occ.medianWage * stage.wageFactor);
    salary = Math.round(national * sf.wage);
    add('salary', 'Gross salary', salary, 'measured',
      `BLS OEWS median for ${occ.label}, scaled for ${stateCode} and ${stage.label.toLowerCase()}.`
      + (occ.topCoded ? ' BLS top-codes this occupation, so the real figure is higher.' : ''));
  }
  add('salaryGrowth', 'Annual raise', occ.growth, 'derived',
    'Typical trajectory for the field, not a published series.');

  /* --- balances: DERIVED from age and income, never measured ------ */
  const band = SAVER_BANDS[ageBand(age)];
  const multiple = band[saver];
  const total = Math.round(salary * multiple);
  const mix = ACCOUNT_MIX[saver];
  const balances = {
    trad401k: Math.round(total * mix.trad401k),
    rothIra: Math.round(total * mix.rothIra),
    brokerage: Math.round(total * mix.brokerage),
    cash: Math.round(total * mix.cash),
    roth401k: 0, tradIra: 0, hsa: 0, commodities: 0, crypto: 0, c529: 0,
  };
  // Assume most of a taxable account is still basis at these sizes.
  balances.brokerageBasis = Math.round(balances.brokerage * 0.78);

  add('balancesTotal', 'Retirement + savings total', total, 'derived',
    `${SAVER_LABELS[saver]} — ${multiple}x salary at age ${age}. Inferred from SCF and `
    + 'Vanguard age bands; nobody publishes balances by occupation.');
  add('trad401k', 'Traditional 401(k)', balances.trad401k, 'derived');
  add('rothIra', 'Roth IRA', balances.rothIra, 'derived');
  add('brokerage', 'Taxable brokerage', balances.brokerage, 'derived');
  add('cash', 'Cash', balances.cash, 'derived');

  /* --- spending DERIVED FROM the savings rate ---------------------
   * Spending is whatever is left after tax and saving, so the two
   * cannot contradict each other. An expensive state erodes the
   * achievable savings rate rather than being bolted onto spending,
   * which would break the identity. */
  const behaviour = SAVER_BEHAVIOUR[saver];
  const effTax = effTaxFor(salary);
  const achievableSaving = behaviour.savingsRate / sf.cost;
  const spendShare = Math.max(0.25, 1 - effTax - achievableSaving);
  const spending = Math.round(salary * spendShare);
  add('annualExpenses', 'Annual spending, after tax', spending, 'derived',
    `What is left after roughly ${Math.round(effTax * 100)}% tax and saving `
    + `${Math.round(achievableSaving * 100)}% of gross${sf.cost !== 1
      ? ` (trimmed for ${stateCode} costs)` : ''}.`);
  /* Deliberately NOT reporting a savings rate here. A stated target
   * disagreed with what the model actually achieved — the employer
   * match and the deferral's own tax saving are both real money the
   * target did not account for, pushing the realised rate well above
   * it. The honest figure is the one the simulation produces, so the
   * UI reads it off year one rather than taking a claim from here. */
  add('saverProfile', 'Saver profile', SAVER_LABELS[saver], 'derived', behaviour.note);

  /* --- statute ---------------------------------------------------- */
  add('stateCode', 'State', stateCode, 'statute', 'Tax treatment comes from statute.');
  const life = LIFE_EXPECTANCY[presentation] ?? LIFE_EXPECTANCY.unspecified;
  add('lifeExpectancy', 'Life expectancy', life, 'statute',
    'SSA period life table. This is the ONLY number presentation affects — '
    + 'it changes how long the money must last, not what you earn.');

  /* --- plan design ------------------------------------------------ */
  add('employerMatch', 'Employer match', MATCH_DEFAULTS, 'derived',
    'Typical plan design. Check your own plan document.');

  /* --- pension, where the occupation has one ---------------------- */
  const pension = occ.pensionFraction
    ? Math.round(salary * occ.pensionFraction * 0.6)
    : 0;
  if (pension) {
    add('pensionAnnual', 'Pension at retirement', pension, 'derived',
      'Rough fraction of final pay. Real formulas are service-based — replace with yours.');
  }

  /* --- assemble engine inputs ------------------------------------ */
  const horizon = Math.max(30, (life + 6) - age);
  const inputs = {
    currentAge: age,
    spouseAge: age,
    horizonYears: horizon,
    filingStatus: 'single',
    stateCode,
    salary,
    salaryGrowth: occ.growth,
    annualExpenses: spending,
    retirementSpending: spending,
    retirementAge: Math.min(67, Math.max(age + 5, 65)),
    pensionAnnual: pension,
    employerMatchRate: MATCH_DEFAULTS.rate,
    employerMatchCapPct: MATCH_DEFAULTS.capPct,
    employerMatchDollarCap: MATCH_DEFAULTS.dollarCap,
    balances,

    /* Contributions follow the saver level, not the engine defaults.
     * Without this a "median" character saves like a maximiser. */
    contrib401kMode: 'percent',
    contrib401kPercent: behaviour.deferralPct,
    roth401kSplit: 0,
    contribRothIra: behaviour.useIra ? 750_000 : 0,
    contribTradIra: 0,
    contribHsa: behaviour.useHsa ? 440_000 : 0,
    contribBrokerage: 0,
    backdoorRoth: false,
    afterTax401kEnabled: false,
    afterTax401kAmount: 0,
    rothConversionMode: 'none',
    /* A median saver is not sweeping every spare dollar into equities
     * either — that is a maximiser behaviour. */
    sweep: { enabled: saver !== 'p50', bufferMode: 'months', bufferMonths: 3,
             frequency: 'monthly', destination: 'brokerage',
             allocation: { stocks: 90, bonds: 10 }, bufferDollar: 1_000_000 },
  };

  return {
    inputs,
    fields,
    character: {
      occupation: occKey, occupationLabel: occ.label, attire: occ.attire,
      state: stateCode, stage: choice.stage ?? 'mid', stageLabel: stage.label,
      saver, saverLabel: SAVER_LABELS[saver],
      presentation, age, lifeExpectancy: life,
      exercises: occ.exercises,
      skinTone: choice.skinTone ?? 3, hairColour: choice.hairColour ?? 0,
      build: choice.build ?? 'average',
    },
  };
}

/** Roster for the select screen, richest first. */
function roster() {
  return Object.entries(OCCUPATIONS).map(([key, o]) => ({
    key, label: o.label, medianWage: o.medianWage, attire: o.attire,
    exercises: o.exercises, topCoded: !!o.topCoded,
  }));
}

const _exports = {
  CHARACTER_DATA_META, OCCUPATIONS, STATE_FACTORS, STAGES,
  SAVER_BANDS, SAVER_LABELS, ACCOUNT_MIX, LIFE_EXPECTANCY, SAVER_BEHAVIOUR,
  buildCharacter, roster, ageBand,
};
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
else if (typeof self !== 'undefined') Object.assign(self, _exports);

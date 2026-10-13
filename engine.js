/* ===================================================================
 * engine.js — YEAR-BY-YEAR SIMULATION ENGINE
 * -------------------------------------------------------------------
 * Implements spec sections 2, 4, 5, 7, 8, 9.
 *
 *   INPUTS (per year) -> ENGINE (tax + growth) -> OUTPUTS (per year)
 *   Outputs for year N become starting balances for year N+1.
 *
 * All money is INTEGER CENTS. Pure computation: no DOM, no globals.
 *
 * ORDER OF OPERATIONS WITHIN A YEAR
 *   1.  Resolve age, inflation factor, working/retired status
 *   2.  Income (salary, bonus, pension, Social Security, rental)
 *   3.  Contributions, capped at IRS limits and phase-outs
 *   4.  Real estate: amortisation, carrying costs, appreciation, sale
 *   5.  Spending
 *   6.  RMDs (forced, even with no spending need)
 *   7.  Withdrawal solve — a FIXED-POINT LOOP, because withdrawing from
 *       a traditional account creates taxable income, which raises the
 *       tax bill, which raises the amount that must be withdrawn
 *   8.  Cash sweep (excess out to brokerage / shortfall back in)
 *   9.  Growth applied to ending balances
 *   10. Record the year's row
 * =================================================================== */

'use strict';

(function (root, factory) {
  const deps = typeof require === 'function'
    ? [require('./money.js').Money, require('./tax-config.js'), require('./tax-engine.js')]
    : [root.Money, root, root];
  const api = factory(...deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function (Money, cfgMod, taxMod) {

const { getTaxConfig, getRmdStartAge, getRmdDivisor, ASSET_CLASSES, DEFAULT_INFLATION } = cfgMod;
const {
  computeTaxes, max401kDeferral, maxIraContribution,
  allowedRothIra, deductibleTradIra, maxHsa, applyPassiveLossLimit,
} = taxMod;

/* ===================================================================
 * SEEDED RANDOM NUMBER GENERATION (for reproducible Monte Carlo)
 * =================================================================== */

/** mulberry32 — small, fast, good enough for return sequences. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller transform: uniform -> standard normal. */
function normalDraw(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Draw an annual return from a lognormal distribution parameterised so
 * that the ARITHMETIC mean equals `mean`. Lognormal is used rather than
 * a plain normal because it cannot produce a return below -100%, which
 * a normal draw at high volatility will eventually do.
 */
function drawReturn(rng, mean, stdev) {
  if (!stdev) return mean;
  const variance = Math.log(1 + (stdev * stdev) / Math.pow(1 + mean, 2));
  const mu = Math.log(1 + mean) - variance / 2;
  return Math.exp(mu + Math.sqrt(variance) * normalDraw(rng)) - 1;
}

/* ===================================================================
 * TAX LOTS (spec section 4)
 * -------------------------------------------------------------------
 * "each sweep creates its own tax lot with its own cost basis and
 *  purchase date, relevant for long-term vs short-term capital gains"
 *
 * A lot is { year, basis, value, label }. Because the simulation steps
 * in whole years, a lot acquired in year N and sold in year N or later
 * within the same year is SHORT-term; sold in year N+1 or later it is
 * LONG-term. That is the honest resolution an annual model supports.
 * =================================================================== */

function makeLot(year, amount, label = 'contribution') {
  return { year, basis: amount, value: amount, label };
}

/** Total market value of a lot set. */
function lotsValue(lots) { return lots.reduce((s, l) => Money.add(s, l.value), 0); }
/** Total cost basis of a lot set. */
function lotsBasis(lots) { return lots.reduce((s, l) => Money.add(s, l.basis), 0); }

/**
 * Apply one year of growth to every lot. Basis is unchanged.
 *
 * `currentYear` and `timingFactor` apply the SAME mid-year convention
 * the retirement accounts use: money that arrived during this year
 * earns only a partial year of growth. Without this, swept dollars
 * quietly earned a full year while a 401(k) contribution earned half,
 * which biases any comparison between sweeping and deferring.
 */
function growLots(lots, rate, currentYear, timingFactor = 1) {
  for (const lot of lots) {
    const r = (currentYear !== undefined && lot.year === currentYear)
      ? rate * timingFactor : rate;
    lot.value = Money.grow(lot.value, r);
  }
}

/**
 * Sell `target` cents of market value from a lot set.
 *
 * Methods:
 *   'ltFirst' — long-term lots first (default: minimises tax rate)
 *   'hifo'    — highest cost basis per dollar first (minimises gain)
 *   'fifo'    — oldest first
 *
 * Returns { proceeds, longTermGain, shortTermGain, detail[] }.
 */
function sellFromLots(lots, target, currentYear, method = 'ltFirst') {
  if (target <= 0) return { proceeds: 0, longTermGain: 0, shortTermGain: 0, detail: [] };

  const isLongTerm = (lot) => currentYear - lot.year >= 1;
  const ordered = [...lots];

  if (method === 'hifo') {
    ordered.sort((a, b) => {
      const ra = a.value > 0 ? a.basis / a.value : 0;
      const rb = b.value > 0 ? b.basis / b.value : 0;
      return rb - ra;
    });
  } else if (method === 'fifo') {
    ordered.sort((a, b) => a.year - b.year);
  } else {
    // Long-term first, and within that, highest basis first.
    ordered.sort((a, b) => {
      const la = isLongTerm(a) ? 0 : 1;
      const lb = isLongTerm(b) ? 0 : 1;
      if (la !== lb) return la - lb;
      const ra = a.value > 0 ? a.basis / a.value : 0;
      const rb = b.value > 0 ? b.basis / b.value : 0;
      return rb - ra;
    });
  }

  let remaining = target;
  let longTermGain = 0, shortTermGain = 0, proceeds = 0;
  const detail = [];

  for (const lot of ordered) {
    if (remaining <= 0) break;
    if (lot.value <= 0) continue;
    const take = Money.min(remaining, lot.value);
    const fraction = take / lot.value;
    const basisSold = Money.mul(lot.basis, fraction);
    const gain = Money.sub(take, basisSold);

    lot.value = Money.sub(lot.value, take);
    lot.basis = Money.sub(lot.basis, basisSold);
    remaining = Money.sub(remaining, take);
    proceeds = Money.add(proceeds, take);

    if (isLongTerm(lot)) longTermGain = Money.add(longTermGain, gain);
    else shortTermGain = Money.add(shortTermGain, gain);

    detail.push({ lotYear: lot.year, sold: take, basisSold, gain, longTerm: isLongTerm(lot) });
  }

  // Drop exhausted lots to keep the set from growing without bound.
  for (let i = lots.length - 1; i >= 0; i--) if (lots[i].value <= 0) lots.splice(i, 1);

  return { proceeds, longTermGain, shortTermGain, detail };
}

/* ===================================================================
 * ASSET ALLOCATION -> BLENDED RETURN (spec section 8)
 * =================================================================== */

/**
 * Blend per-asset-class returns by an allocation map.
 * `alloc` is e.g. { stocks: 80, bonds: 20 } (weights, any scale).
 */
function blendedReturn(alloc, returnsByClass) {
  const entries = Object.entries(alloc).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return 0;
  let r = 0;
  for (const [cls, w] of entries) r += (returnsByClass[cls] ?? 0) * (w / total);
  return r;
}

/**
 * Glide path: shift the equity weight toward bonds as retirement nears.
 * Returns a NEW allocation; the input is untouched.
 */
function applyGlidePath(alloc, yearsToRetirement, glide) {
  if (!glide || !glide.enabled) return alloc;
  const { startYearsOut = 20, endEquityPct = 40 } = glide;
  const startEquity = alloc.stocks ?? 0;
  if (yearsToRetirement >= startYearsOut) return alloc;
  const progress = Math.min(1, Math.max(0, (startYearsOut - yearsToRetirement) / startYearsOut));
  const targetEquity = startEquity + (endEquityPct - startEquity) * progress;
  const shift = startEquity - targetEquity;
  return { ...alloc, stocks: targetEquity, bonds: (alloc.bonds ?? 0) + shift };
}

/* ===================================================================
 * REAL ESTATE MODULE (spec section 9)
 * =================================================================== */

/** Standard fixed-rate monthly payment. */
function monthlyPayment(principal, annualRate, termYears) {
  if (principal <= 0 || termYears <= 0) return 0;
  const i = annualRate / 12;
  const n = termYears * 12;
  if (i === 0) return Money.div(principal, n);
  const factor = (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
  return Money.mul(principal, factor);
}

/**
 * Amortise twelve months, returning the exact principal/interest split.
 * Iterating month by month (rather than an annual approximation) is
 * what makes the early-year interest figures correct.
 */
function amortizeYear(balance, annualRate, payment) {
  if (balance <= 0) return { principal: 0, interest: 0, endingBalance: 0, payments: 0 };
  const i = annualRate / 12;
  let bal = balance, principalPaid = 0, interestPaid = 0, paymentsMade = 0;
  for (let m = 0; m < 12 && bal > 0; m++) {
    const interest = Money.mul(bal, i);
    let principal = Money.sub(payment, interest);
    if (principal <= 0) { // Negative amortisation guard.
      interestPaid = Money.add(interestPaid, interest);
      paymentsMade = Money.add(paymentsMade, payment);
      continue;
    }
    if (principal > bal) principal = bal;
    bal = Money.sub(bal, principal);
    principalPaid = Money.add(principalPaid, principal);
    interestPaid = Money.add(interestPaid, interest);
    paymentsMade = Money.add(paymentsMade, Money.add(principal, interest));
  }
  return { principal: principalPaid, interest: interestPaid, endingBalance: bal, payments: paymentsMade };
}

/**
 * Process one property for one year: carrying costs, amortisation,
 * appreciation, and (if this is its sale year) the sale itself.
 */
function processProperty(prop, year, inflationFactor, returns, status, cfg) {
  const out = {
    name: prop.name,
    value: prop.currentValue,
    mortgageBalance: prop.mortgageBalance,
    equity: 0,
    interest: 0, principal: 0,
    propertyTax: 0, insurance: 0, maintenance: 0,
    rentalIncome: 0, totalCost: 0,
    sold: false, saleProceeds: 0, saleGain: 0, taxableSaleGain: 0, excluded: 0,
  };

  if (prop.soldInPriorYear) { out.value = 0; out.mortgageBalance = 0; return out; }

  /* --- Carrying costs ------------------------------------------- */
  // Assessed value may be capped (e.g. California Prop 13 style).
  if (prop.reassessmentCapPct != null && prop.assessedValue != null) {
    const capped = Money.grow(prop.assessedValue, prop.reassessmentCapPct);
    prop.assessedValue = Money.min(capped, prop.currentValue);
  } else {
    prop.assessedValue = prop.currentValue;
  }
  out.propertyTax = Money.mul(prop.assessedValue, prop.propertyTaxRate ?? 0);
  out.insurance = Money.mul(prop.baseInsurance ?? 0, inflationFactor);
  out.maintenance = Money.mul(prop.currentValue, prop.maintenancePct ?? 0);

  /* --- Mortgage -------------------------------------------------- */
  if (prop.mortgageBalance > 0) {
    if (!prop._payment) {
      prop._payment = monthlyPayment(prop.originalLoan ?? prop.mortgageBalance,
        prop.mortgageRate ?? 0, prop.mortgageTermYears ?? 30);
    }
    const am = amortizeYear(prop.mortgageBalance, prop.mortgageRate ?? 0, prop._payment);
    out.interest = am.interest;
    out.principal = am.principal;
    prop.mortgageBalance = am.endingBalance;
    out.mortgageBalance = am.endingBalance;
  }

  /* --- Rental income and its own costs ---------------------------- */
  if (prop.isRental) {
    const gross = Money.mul(prop.annualRent ?? 0, inflationFactor);
    // Vacancy and management are real and routinely omitted from
    // back-of-envelope rental maths; together they are often 15% of rent.
    out.grossRent = gross;
    out.vacancyLoss = Money.mul(gross, prop.vacancyRate ?? 0);
    out.management = Money.mul(Money.sub(gross, out.vacancyLoss), prop.managementPct ?? 0);
    out.rentalIncome = Money.floor0(Money.sub(gross, Money.add(out.vacancyLoss, out.management)));

    /* Depreciation: building share of the ORIGINAL basis, straight line.
     * Stops once the property is fully depreciated. */
    const depreciable = Money.mul(prop.costBasis ?? prop.purchasePrice, 1 - (prop.landValuePct ?? 0.2));
    const annual = Money.div(depreciable, prop.depreciationYears ?? 27.5);
    const remaining = Money.floor0(Money.sub(depreciable, prop.accumulatedDepreciation ?? 0));
    out.depreciation = Money.min(annual, remaining);
    prop.accumulatedDepreciation = Money.add(prop.accumulatedDepreciation ?? 0, out.depreciation);
  }

  out.totalCost = Money.add(out.propertyTax, out.insurance, out.maintenance, out.interest, out.principal);

  /* --- Appreciation ---------------------------------------------- */
  const appr = prop.appreciationOverride ?? returns.realEstate ?? 0;
  prop.currentValue = Money.grow(prop.currentValue, appr);
  out.value = prop.currentValue;

  /* --- Sale event (spec section 9) -------------------------------- */
  if (prop.saleYear === year) {
    const sellingCosts = Money.mul(prop.currentValue, prop.sellingCostPct ?? 0.06);
    /* Adjusted basis = original basis less all depreciation taken. This
     * is why depreciation is a deferral, not a gift: every dollar
     * written off enlarges the eventual gain. */
    const accumDep = prop.accumulatedDepreciation ?? 0;
    const adjustedBasis = Money.sub(prop.costBasis ?? prop.purchasePrice, accumDep);
    const grossGain = Money.sub(Money.sub(prop.currentValue, adjustedBasis), sellingCosts);
    out.accumulatedDepreciation = accumDep;
    out.adjustedBasis = adjustedBasis;

    // IRC §121: primary residence, 2-of-5-year ownership and use test.
    const yearsOwned = year - (prop.purchaseYear ?? year);
    const ex = cfg.homeSaleExclusion;
    const eligible = prop.isPrimary && yearsOwned >= ex.minOwnershipYears;
    const exclusionCap = eligible ? (ex[status] ?? ex.single) : 0;
    const excluded = Money.min(Money.floor0(grossGain), exclusionCap);
    const taxableGain = Money.floor0(Money.sub(grossGain, excluded));

    /* Unrecaptured §1250 gain: depreciation previously taken comes back
     * at a flat 25%, ahead of ordinary long-term gain treatment, and the
     * §121 exclusion does not shelter it. */
    out.depreciationRecapture = Money.min(Money.floor0(grossGain), accumDep);
    out.sold = true;
    out.saleGain = grossGain;
    out.excluded = excluded;
    out.taxableSaleGain = Money.floor0(Money.sub(taxableGain, out.depreciationRecapture));
    // Any passive losses suspended over the holding period are freed on
    // a fully taxable disposition.
    out.releasedSuspendedLosses = prop.suspendedLosses ?? 0;
    prop.suspendedLosses = 0;
    out.saleProceeds = Money.floor0(
      Money.sub(Money.sub(prop.currentValue, sellingCosts), prop.mortgageBalance)
    );
    out.sellingCosts = sellingCosts;

    prop.soldInPriorYear = true;
    prop.currentValue = 0;
    prop.mortgageBalance = 0;
    out.value = 0;
    out.mortgageBalance = 0;
  }

  out.equity = Money.floor0(Money.sub(out.value, out.mortgageBalance));
  return out;
}

/* ===================================================================
 * DEFAULT INPUT SHAPE
 * -------------------------------------------------------------------
 * Every field the UI can set. Dollar-denominated fields are in CENTS.
 * =================================================================== */
function defaultInputs() {
  return {
    name: 'Baseline',

    /* --- Person & horizon --- */
    startYear: 2026,
    currentAge: 40,
    spouseAge: 40,
    horizonYears: 40,
    filingStatus: 'single',          // 'single' | 'mfj' | 'hoh'
    stateCode: 'WA',
    customStateRate: 0,

    /* --- Income (section 5) --- */
    salary: 15_000_000,              // $150,000
    salaryGrowth: 0.03,
    bonus: 0,
    otherIncome: 0,

    /* --- Retirement (section 7) --- */
    retirementAge: 65,
    retirementSpending: 8_000_000,   // $80,000 in today's dollars
    socialSecurityStartAge: 67,
    socialSecurityAnnual: 3_000_000, // $30,000 in today's dollars
    pensionAnnual: 0,

    /* --- Spending --- */
    annualExpenses: 7_000_000,       // $70,000 while working
    inflation: DEFAULT_INFLATION,

    /* --- Contributions (section 5) --- */
    contrib401kMode: 'percent',      // 'percent' | 'dollar'
    contrib401kPercent: 0.10,
    contrib401kDollar: 2_450_000,
    roth401kSplit: 0.0,              // share of the deferral going to Roth
    employerMatchRate: 1.00,         // 100% of...
    employerMatchCapPct: 0.04,       // ...the first 4% of salary
    employerMatchDollarCap: 0,       // ...and never more than this ($0 = no cap)

    /* Mega backdoor Roth: after-tax 401(k) contributions filling the
     * §415(c) headroom, immediately converted to Roth. Requires a plan
     * that permits BOTH after-tax contributions and in-plan conversion
     * (or in-service withdrawal) — many plans allow neither. */
    afterTax401kEnabled: false,
    afterTax401kAmount: 0,           // 0 with enabled = fill all headroom
    /* Plans may impose their own annual-additions cap below the IRS
     * §415(c) figure, or cap after-tax contributions as a percentage of
     * pay. Set this to model that; 0 uses the statutory limit. The
     * lower of the two always applies. */
    plan415cLimit: 0,

    /* Backdoor Roth IRA: a non-deductible traditional IRA contribution
     * converted immediately. Bypasses the Roth MAGI phase-out. Subject
     * to the pro-rata rule if any pre-tax traditional IRA balance
     * exists, which the engine computes and warns about. */
    backdoorRoth: false,

    /* ROTH CONVERSION LADDER (spec section 7, withdrawal strategy).
     * Moving traditional money to Roth voluntarily, recognising it as
     * ordinary income now to avoid a larger bill later. The classic use
     * is the low-income window between retiring early and Social
     * Security / RMDs starting, where bracket space would otherwise go
     * unused. It also solves early-retirement access: each conversion
     * becomes withdrawable penalty-free after its own 5-year clock.
     *
     *   'none'        no conversions
     *   'fillBracket' convert enough to fill taxable income to the top
     *                 of `rothConversionFillToRate` each year
     *   'fixed'       convert `rothConversionAmount` per year
     */
    rothConversionMode: 'none',
    rothConversionFillToRate: 0.12,
    rothConversionAmount: 0,
    rothConversionStartAge: 0,       // 0 = as soon as retired
    rothConversionEndAge: 999,

    contribTradIra: 0,
    contribRothIra: 750_000,
    contribHsa: 440_000,
    hsaCoverage: 'selfOnly',
    contribBrokerage: 0,             // direct, on top of the sweep
    coveredByEmployerPlan: true,

    /* --- Starting balances (section 3) --- */
    balances: {
      cash: 3_000_000,
      trad401k: 20_000_000,
      roth401k: 0,
      tradIra: 0,
      rothIra: 5_000_000,
      hsa: 1_000_000,
      brokerage: 10_000_000,
      brokerageBasis: 7_000_000,     // seeds the initial tax lot
      commodities: 0,
      crypto: 0,
      c529: 0,
    },

    /* --- Cash sweep (section 4) --- */
    sweep: {
      enabled: true,
      bufferMode: 'months',          // 'months' | 'dollar'
      bufferMonths: 3,
      bufferDollar: 1_000_000,
      frequency: 'monthly',          // 'monthly' | 'quarterly' | 'annual'
      destination: 'brokerage',      // 'brokerage' | 'commodities' | 'crypto'
      allocation: { stocks: 90, bonds: 10 },
    },

    /* --- Growth assumptions (section 8) --- */
    returns: Object.fromEntries(Object.entries(ASSET_CLASSES).map(([k, v]) => [k, v.mean])),
    volatility: Object.fromEntries(Object.entries(ASSET_CLASSES).map(([k, v]) => [k, v.stdev])),
    allocations: {
      trad401k:   { stocks: 80, bonds: 20 },
      roth401k:   { stocks: 90, bonds: 10 },
      tradIra:    { stocks: 80, bonds: 20 },
      rothIra:    { stocks: 90, bonds: 10 },
      hsa:        { stocks: 80, bonds: 20 },
      brokerage:  { stocks: 85, bonds: 15 },
      cash:       { cash: 100 },
      commodities:{ commodities: 100 },
      crypto:     { crypto: 100 },
      c529:       { stocks: 60, bonds: 40 },
    },
    glidePath: { enabled: false, startYearsOut: 20, endEquityPct: 40 },
    contributionTiming: 'mid',       // 'start' | 'mid' | 'end' — growth credited to new money

    /* --- Dividends & interest thrown off by the taxable account ---- */
    dividendYield: 0.015,            // % of brokerage value paid out annually
    qualifiedDividendShare: 0.90,    // share taxed at preferential rates
    cashInterestRate: 0.02,

    /* --- Withdrawal strategy (section 7) --- */
    withdrawalOrder: ['cash', 'brokerage', 'trad401k', 'tradIra', 'roth401k', 'rothIra', 'hsa'],
    lotSelectionMethod: 'ltFirst',
    penaltyExceptionApplies: false,
    coverShortfallsByWithdrawing: true,

    /* --- Real estate (section 9) --- */
    properties: [],

    /* --- Per-year overrides (section 2) ---------------------------
     * { [year]: { salary, bonus, oneTimeExpense, oneTimeIncome,
     *             extraWithdrawal, isRetired, returnsOverride } } */
    overrides: {},

    /* --- Display --- */
    displayRealDollars: false,       // deflate output to today's dollars
    indexBracketsToInflation: true,
  };
}

/** A property with all fields defaulted, for the UI's "add property". */
function defaultProperty(year = 2026) {
  return {
    name: 'Primary residence',
    purchaseYear: year,
    purchasePrice: 60_000_000,
    costBasis: 60_000_000,
    currentValue: 60_000_000,
    assessedValue: 60_000_000,
    reassessmentCapPct: null,
    mortgageBalance: 45_000_000,
    originalLoan: 45_000_000,
    mortgageRate: 0.065,
    mortgageTermYears: 30,
    appreciationOverride: null,
    propertyTaxRate: 0.011,
    baseInsurance: 180_000,
    maintenancePct: 0.01,
    isPrimary: true,
    isRental: false,
    annualRent: 0,
    /* Depreciation (rentals only). Land is not depreciable, so only the
     * building share is written off — 27.5 years straight line for
     * residential rental property, 39 for commercial. This both shelters
     * rental income and reduces adjusted basis, which is why it comes
     * back as recapture on sale. */
    landValuePct: 0.20,
    depreciationYears: 27.5,
    accumulatedDepreciation: 0,
    suspendedLosses: 0,     // passive losses disallowed under §469
    vacancyRate: 0.07,      // share of gross rent lost to vacancy
    managementPct: 0.08,    // property management, as a share of rent
    saleYear: null,
    sellingCostPct: 0.06,
    proceedsTo: 'brokerage',
  };
}

/* ===================================================================
 * THE SIMULATION
 * =================================================================== */

/* -------------------------------------------------------------------
 * Input sanitising.
 *
 * A number field the user has cleared reads back as blank, which
 * becomes 0 — and a horizon of 0 years yields a simulation with no
 * rows, which every downstream consumer then reads off the end of.
 * Rather than defend against that in each chart and table, clamp the
 * inputs once here so `simulate` can never return an unusable result.
 * ----------------------------------------------------------------- */
function num(v, fallback, lo = -Infinity, hi = Infinity) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (n === null || n === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, lo), hi);
}

function normalizeInputs(raw) {
  const d = defaultInputs();
  const I = { ...d, ...raw };

  I.horizonYears = Math.round(num(I.horizonYears, d.horizonYears, 1, 100));
  I.currentAge = Math.round(num(I.currentAge, d.currentAge, 0, 120));
  I.spouseAge = Math.round(num(I.spouseAge, I.currentAge, 0, 120));
  I.retirementAge = Math.round(num(I.retirementAge, d.retirementAge, 0, 120));
  I.socialSecurityStartAge = Math.round(num(I.socialSecurityStartAge, d.socialSecurityStartAge, 50, 120));
  I.startYear = Math.round(num(I.startYear, d.startYear, 1900, 2200));

  for (const k of ['salaryGrowth', 'inflation', 'contrib401kPercent', 'roth401kSplit',
    'employerMatchRate', 'employerMatchCapPct', 'dividendYield', 'qualifiedDividendShare',
    'cashInterestRate', 'customStateRate']) {
    I[k] = num(I[k], d[k], -1, 10);
  }

  for (const k of ['salary', 'bonus', 'otherIncome', 'annualExpenses', 'retirementSpending',
    'socialSecurityAnnual', 'pensionAnnual', 'contrib401kDollar', 'contribTradIra',
    'contribRothIra', 'contribHsa', 'contribBrokerage',
    'employerMatchDollarCap', 'afterTax401kAmount', 'rothConversionAmount',
    'plan415cLimit']) {
    I[k] = Math.round(num(I[k], d[k], 0, Number.MAX_SAFE_INTEGER));
  }

  I.balances = { ...d.balances, ...(I.balances ?? {}) };
  for (const k of Object.keys(I.balances)) {
    I.balances[k] = Math.round(num(I.balances[k], 0, 0, Number.MAX_SAFE_INTEGER));
  }
  // Cost basis cannot exceed the market value it belongs to.
  I.balances.brokerageBasis = Math.min(I.balances.brokerageBasis, I.balances.brokerage);

  I.returns = { ...d.returns, ...(I.returns ?? {}) };
  I.volatility = { ...d.volatility, ...(I.volatility ?? {}) };
  for (const k of Object.keys(I.returns)) I.returns[k] = num(I.returns[k], 0, -0.95, 10);
  for (const k of Object.keys(I.volatility)) I.volatility[k] = num(I.volatility[k], 0, 0, 5);

  I.sweep = { ...d.sweep, ...(I.sweep ?? {}) };
  I.sweep.bufferMonths = num(I.sweep.bufferMonths, d.sweep.bufferMonths, 0, 120);
  I.sweep.bufferDollar = Math.round(num(I.sweep.bufferDollar, d.sweep.bufferDollar, 0, Number.MAX_SAFE_INTEGER));

  if (!Array.isArray(I.withdrawalOrder) || !I.withdrawalOrder.length) {
    I.withdrawalOrder = d.withdrawalOrder;
  }
  if (!Array.isArray(I.properties)) I.properties = [];
  if (!I.overrides || typeof I.overrides !== 'object') I.overrides = {};

  return I;
}

function simulate(inputs, options = {}) {
  const {
    returnSequence = null,   // [{stocks, bonds, ...}, ...] one per year, for Monte Carlo
    seed = null,
    returnMultiplier = 1,    // for the optimistic/pessimistic stress view
  } = options;

  const I = normalizeInputs(inputs);
  const rng = seed !== null ? makeRng(seed) : null;
  const birthYear = I.startYear - I.currentAge;

  /* --- Mutable account state ------------------------------------- */
  const acct = {
    cash: I.balances.cash,
    trad401k: I.balances.trad401k,
    roth401k: I.balances.roth401k,
    tradIra: I.balances.tradIra,
    rothIra: I.balances.rothIra,
    hsa: I.balances.hsa,
    commodities: I.balances.commodities,
    crypto: I.balances.crypto,
    c529: I.balances.c529,
  };
  // The taxable brokerage is a set of tax lots (spec section 4).
  const lots = [];
  if (I.balances.brokerage > 0) {
    const seedLot = makeLot(I.startYear - 5, I.balances.brokerage, 'opening balance');
    seedLot.basis = Math.min(I.balances.brokerageBasis ?? I.balances.brokerage, I.balances.brokerage);
    lots.push(seedLot);
  }
  const properties = (I.properties ?? []).map((p) => ({ ...p }));

  const rows = [];
  const warnings = [];
  let priorYearTradBalance = Money.add(acct.trad401k, acct.tradIra);

  /* ================= YEAR LOOP ================= */
  for (let t = 0; t < I.horizonYears; t++) {
    const year = I.startYear + t;
    const age = I.currentAge + t;
    const spouseAge = I.spouseAge + t;
    const ov = I.overrides?.[year] ?? {};
    const inflationFactor = Math.pow(1 + I.inflation, t);
    const cfg = getTaxConfig(year, I.indexBracketsToInflation ? I.inflation : 0);

    const retired = ov.isRetired !== undefined ? ov.isRetired : age >= I.retirementAge;
    const yearsToRetirement = Math.max(0, I.retirementAge - age);

    /* A zero salary while still flagged as "working" is almost always a
     * mis-set input rather than an intent: it keeps working-year
     * spending and the contribution rules in force while no wages come
     * in. Flag it once, on the first year it happens. */
    if (!retired && I.salary === 0 && !ov.salary && t === 0) {
      warnings.push({ year, type: 'setup', message:
        `Salary is $0 but retirement age is set to ${I.retirementAge}, so this year still uses working-year spending and contribution rules. To model retiring now, set retirement age to ${age}.` });
    }

    /* --- Returns for this year --------------------------------- */
    let returns;
    if (ov.returnsOverride) {
      returns = ov.returnsOverride;
    } else if (returnSequence && returnSequence[t]) {
      returns = returnSequence[t];
    } else if (rng) {
      returns = {};
      for (const cls of Object.keys(I.returns)) {
        returns[cls] = drawReturn(rng, I.returns[cls], I.volatility[cls] ?? 0);
      }
    } else {
      returns = {};
      for (const cls of Object.keys(I.returns)) returns[cls] = I.returns[cls] * returnMultiplier;
    }

    /* ---------- 2. INCOME (spec section 5) --------------------- */
    const salary = retired ? 0
      : (ov.salary ?? Money.mul(I.salary, Math.pow(1 + I.salaryGrowth, t)));
    const bonus = retired ? 0 : (ov.bonus ?? I.bonus);
    const grossWages = Money.add(salary, bonus);
    const otherIncome = Money.add(ov.oneTimeIncome ?? 0, Money.mul(I.otherIncome, inflationFactor));
    const pension = retired ? Money.mul(I.pensionAnnual, inflationFactor) : 0;
    const socialSecurity = age >= I.socialSecurityStartAge
      ? Money.mul(I.socialSecurityAnnual, inflationFactor) : 0;

    /* ---------- 3. CONTRIBUTIONS (spec section 5) -------------- */
    let desired401k = 0;
    if (!retired && salary > 0) {
      desired401k = I.contrib401kMode === 'percent'
        ? Money.mul(salary, I.contrib401kPercent)
        : I.contrib401kDollar;
    }
    const cap401k = max401kDeferral(age, cfg);
    const total401k = Money.min(desired401k, cap401k, salary);
    if (desired401k > cap401k) {
      warnings.push({ year, type: 'limit', message: `401(k) deferral capped at ${Money.fmt(cap401k)} (IRS limit incl. catch-up).` });
    }

    // SECURE 2.0: high earners must make catch-up contributions as Roth.
    let roth401kSplit = I.roth401kSplit;
    const catchUpPortion = Money.floor0(Money.sub(total401k, cfg.limits.elective401k));
    if (catchUpPortion > 0 && salary > cfg.limits.rothCatchUpWageThreshold) {
      const forcedRoth = catchUpPortion;
      const baseRoth = Money.mul(Money.min(total401k, cfg.limits.elective401k), I.roth401kSplit);
      roth401kSplit = total401k > 0 ? Money.add(forcedRoth, baseRoth) / total401k : 0;
      warnings.push({ year, type: 'rule', message: 'Catch-up forced to Roth: prior-year wages exceed the SECURE 2.0 threshold.' });
    }
    const roth401kContrib = Money.mul(total401k, roth401kSplit);
    const trad401kContrib = Money.sub(total401k, roth401kContrib);

    // Employer match: `matchRate` of the first `matchCapPct` of salary
    // the employee actually defers, e.g. 100% up to 4% of salary — and
    // then capped in dollars if the plan does that too (very common:
    // "6% of pay, max $6,000"). With a rising salary the dollar cap
    // binds harder every year, which the percentage alone would miss.
    const deferralPct = salary > 0 ? total401k / salary : 0;
    const matchedPct = Math.min(deferralPct, I.employerMatchCapPct);
    let employerMatch = retired ? 0
      : Money.mul(Money.mul(salary, matchedPct), I.employerMatchRate);
    if (I.employerMatchDollarCap > 0) {
      employerMatch = Money.min(employerMatch, I.employerMatchDollarCap);
    }

    /* --- After-tax 401(k) / mega backdoor Roth --------------------
     * §415(c) caps total annual additions — deferrals + employer money
     * + after-tax — at one figure. Age-50 catch-up is exempt and sits
     * on top, so it is excluded from the base here. Whatever headroom
     * is left can be filled with AFTER-TAX dollars and converted to
     * Roth, which is why this is the largest single lever available to
     * a high earner whose plan supports it. */
    const catchUpPart = Money.floor0(Money.sub(total401k, cfg.limits.elective401k));
    const baseAnnualAdditions = Money.add(Money.sub(total401k, catchUpPart), employerMatch);
    const annualAdditionsCap = I.plan415cLimit > 0
      ? Money.min(I.plan415cLimit, cfg.limits.definedContribution415c)
      : cfg.limits.definedContribution415c;
    const afterTaxHeadroom = Money.floor0(
      Money.sub(annualAdditionsCap, baseAnnualAdditions)
    );
    let afterTax401k = 0;
    if (I.afterTax401kEnabled && !retired && salary > 0) {
      const wanted = I.afterTax401kAmount > 0 ? I.afterTax401kAmount : afterTaxHeadroom;
      // Cannot exceed headroom, and cannot exceed compensation left
      // after the deferrals already taken out of it.
      afterTax401k = Money.min(wanted, afterTaxHeadroom,
        Money.floor0(Money.sub(salary, total401k)));
      if (I.afterTax401kAmount > afterTaxHeadroom) {
        warnings.push({ year, type: 'limit', message:
          `After-tax 401(k) capped at ${Money.fmt(afterTaxHeadroom)} — the ${I.plan415cLimit > 0 ? 'plan' : '§415(c)'} annual additions limit of ${Money.fmt(annualAdditionsCap)} counts your deferrals and the employer match too.` });
      }
    }

    // HSA: legal with HDHP coverage and does NOT require earned income,
    // but two real limits apply. (1) The FICA exemption only attaches to
    // payroll deductions, so it is capped at wages; anything above that
    // is an above-the-line income-tax deduction only. (2) Contributions
    // are prohibited once enrolled in Medicare, modelled here as age 65.
    const hsaLimit = maxHsa(I.hsaCoverage, age, cfg);
    const hsaContrib = (retired || age >= 65) ? 0 : Money.min(I.contribHsa, hsaLimit);
    const hsaViaPayroll = Money.min(hsaContrib, grossWages);
    const hsaAboveTheLine = Money.sub(hsaContrib, hsaViaPayroll);

    // MAGI for the IRA phase-outs, estimated before withdrawals are known.
    const magiEstimate = Money.add(
      Money.sub(Money.sub(grossWages, trad401kContrib), hsaContrib),
      otherIncome, pension, Money.mul(lotsValue(lots), I.dividendYield)
    );

    /* IRC §219(b): an IRA contribution may not exceed TAXABLE
     * COMPENSATION for the year. Dividends, interest, capital gains,
     * pensions and Social Security are not compensation — so someone
     * living off a portfolio cannot fund an IRA at all, however large
     * that portfolio is. Without this cap the model quietly contributes
     * every year of an early retirement, which is not legal.
     *
     * Simplification: under MFJ a spousal IRA can be funded from the
     * other spouse's compensation. This model tracks one earner, so it
     * uses that earner's wages for both. */
    const earnedIncome = Money.add(salary, bonus);
    const iraCap = Money.min(maxIraContribution(age, cfg), earnedIncome);
    const wantedIra = Money.add(I.contribRothIra, I.contribTradIra);
    if (!retired && wantedIra > 0 && earnedIncome < wantedIra) {
      warnings.push({ year, type: 'limit', message: earnedIncome === 0
        ? 'IRA contributions set to $0: an IRA needs earned income (wages), and there is none this year. Investment income does not qualify.'
        : `IRA contributions capped at ${Money.fmt(earnedIncome)} — an IRA cannot exceed earned income.` });
    }

    /* Backdoor Roth: a NON-DEDUCTIBLE traditional IRA contribution
     * converted straight to Roth. The conversion step has no income
     * limit, which is what makes it work above the phase-out. */
    let rothIraContrib, backdoorTaxableAmount = 0;
    if (I.backdoorRoth && !retired) {
      rothIraContrib = Money.min(I.contribRothIra, iraCap);
      /* PRO-RATA RULE (IRC §408(d)(2)): the IRS treats all your
       * traditional IRAs as one pot. If any PRE-TAX traditional IRA
       * balance exists, that share of the conversion is taxable — you
       * cannot cherry-pick the non-deductible dollars. This is the trap
       * that makes the backdoor expensive for people with a rollover
       * IRA sitting around. */
      const preTaxIra = acct.tradIra;
      if (preTaxIra > 0 && rothIraContrib > 0) {
        const pot = Money.add(preTaxIra, rothIraContrib);
        backdoorTaxableAmount = Money.mul(rothIraContrib, preTaxIra / pot);
        warnings.push({ year, type: 'rule', message:
          `Backdoor Roth is ${Math.round(preTaxIra / pot * 100)}% taxable this year under the pro-rata rule — you hold ${Money.fmt(preTaxIra)} of pre-tax traditional IRA. Rolling that into a 401(k) first would make the conversion tax-free.` });
      }
    } else {
      rothIraContrib = retired ? 0
        : Money.min(allowedRothIra(I.contribRothIra, magiEstimate, I.filingStatus, age, cfg), iraCap);
      if (!retired && I.contribRothIra > 0 && rothIraContrib < I.contribRothIra && earnedIncome >= wantedIra) {
        warnings.push({ year, type: 'phaseout', message:
          `Roth IRA reduced to ${Money.fmt(rothIraContrib)} by the MAGI phase-out.` +
          (rothIraContrib === 0 ? ' A backdoor Roth would bypass this entirely — enable it in Contributions.' : '') });
      }
    }
    let tradIraContrib = retired ? 0 : Money.min(I.contribTradIra, Money.floor0(Money.sub(iraCap, rothIraContrib)));
    const tradIraDeductible = deductibleTradIra(tradIraContrib, magiEstimate, I.filingStatus, I.coveredByEmployerPlan, cfg);

    const brokerageDirect = retired ? 0 : I.contribBrokerage;

    /* ---------- 4. REAL ESTATE (spec section 9) ---------------- */
    // reCosts / reGrossRent are CASH FLOWS. reRentalNet is only used for
    // TAX: rent less deductible expenses. Keeping them separate avoids
    // subtracting the carrying costs twice.
    let reCosts = 0, reGrossRent = 0, reRentalNet = 0, reSaleProceeds = 0, reTaxableSaleGain = 0;
    let reEquity = 0, reValue = 0, reMortgage = 0;
    let reDepreciation = 0, reRecapture = 0, reReleasedLosses = 0, reSuspendedTotal = 0;
    const propertyDetail = [];
    for (const prop of properties) {
      const r = processProperty(prop, year, inflationFactor, returns, I.filingStatus, cfg);
      propertyDetail.push(r);
      reCosts = Money.add(reCosts, r.totalCost);
      reGrossRent = Money.add(reGrossRent, r.rentalIncome);
      if (r.rentalIncome > 0) {
        // Deductible rental expenses exclude mortgage PRINCIPAL but
        // include depreciation, which is what usually turns a
        // cash-flow-positive rental into a taxable loss.
        reRentalNet = Money.add(reRentalNet, Money.sub(r.rentalIncome,
          Money.add(r.propertyTax, r.insurance, r.maintenance, r.interest, r.depreciation ?? 0)));
        reDepreciation = Money.add(reDepreciation, r.depreciation ?? 0);
      }
      reRecapture = Money.add(reRecapture, r.depreciationRecapture ?? 0);
      reReleasedLosses = Money.add(reReleasedLosses, r.releasedSuspendedLosses ?? 0);
      reSuspendedTotal = Money.add(reSuspendedTotal, prop.suspendedLosses ?? 0);
      reSaleProceeds = Money.add(reSaleProceeds, r.saleProceeds);
      reTaxableSaleGain = Money.add(reTaxableSaleGain, r.taxableSaleGain);
      reEquity = Money.add(reEquity, r.equity);
      reValue = Money.add(reValue, r.value);
      reMortgage = Money.add(reMortgage, r.mortgageBalance);
    }

    /* --- Passive activity loss limitation (§469) -------------------
     * A net rental LOSS cannot simply be deducted. It offsets passive
     * income freely, but against ordinary income it is capped by the
     * $25,000 special allowance, which phases out entirely by $150,000
     * of MAGI. Anything disallowed is suspended and carried forward,
     * and is released when the property is sold. */
    let rentalLossSuspendedThisYear = 0, rentalLossAllowed = 0;
    if (reRentalNet < 0) {
      const loss = Money.floor0(-reRentalNet);
      const magiForPal = Money.add(
        Money.floor0(Money.sub(Money.sub(grossWages, trad401kContrib), hsaContrib)),
        otherIncome, pension, Money.mul(lotsValue(lots), I.dividendYield)
      );
      const pal = applyPassiveLossLimit(loss, magiForPal, 0, cfg);
      rentalLossAllowed = pal.allowed;
      rentalLossSuspendedThisYear = pal.suspended;
      // Only the allowed portion reaches taxable income this year.
      reRentalNet = -pal.allowed;
      if (pal.suspended > 0) {
        // Carry the disallowed amount on the properties themselves.
        const rentals = properties.filter((p) => p.isRental && !p.soldInPriorYear);
        if (rentals.length) {
          const shares = Money.split(pal.suspended, rentals.length);
          rentals.forEach((p, i) => {
            p.suspendedLosses = Money.add(p.suspendedLosses ?? 0, shares[i]);
          });
        }
        warnings.push({ year, type: 'rule', message:
          `${Money.fmt(pal.suspended)} of rental loss suspended under the passive activity rules — MAGI is too high for the $25,000 special allowance (fully phased out at $150,000). It carries forward and is released when you sell.` });
      }
    }
    // Losses freed by a sale are deductible in that year.
    if (reReleasedLosses > 0) reRentalNet = Money.sub(reRentalNet, reReleasedLosses);

    /* ---------- 5. SPENDING ------------------------------------ */
    const baseSpend = retired ? I.retirementSpending : I.annualExpenses;
    const spending = Money.add(Money.mul(baseSpend, inflationFactor), ov.oneTimeExpense ?? 0);

    /* ---------- Investment income thrown off this year --------- */
    const brokerageValue = lotsValue(lots);
    const dividends = Money.mul(brokerageValue, I.dividendYield);
    const qualifiedDividends = Money.mul(dividends, I.qualifiedDividendShare);
    const nonQualifiedDividends = Money.sub(dividends, qualifiedDividends);
    const cashInterest = Money.mul(acct.cash, I.cashInterestRate);

    /* ---------- 6. RMD (spec section 7) ------------------------ */
    const rmdAge = getRmdStartAge(birthYear, cfg);
    let rmdRequired = 0;
    if (age >= rmdAge) {
      const divisor = getRmdDivisor(age, cfg);
      if (divisor) rmdRequired = Money.div(priorYearTradBalance, divisor);
      rmdRequired = Money.min(rmdRequired, Money.add(acct.trad401k, acct.tradIra));
    }

    /* ---------- 7. WITHDRAWAL SOLVE (fixed point) -------------- *
     * Cash in and out are known except for tax, and tax depends on
     * how much we withdraw. Iterate until the withdrawal total is
     * stable to within one dollar.                                */

    const fixedCashIn = Money.add(grossWages, otherIncome, pension, socialSecurity,
      dividends, cashInterest, reSaleProceeds, reGrossRent);
    const fixedCashOut = Money.add(spending, reCosts, total401k, hsaContrib,
      rothIraContrib, tradIraContrib, brokerageDirect, afterTax401k);

    const sweepBuffer = I.sweep.enabled
      ? (I.sweep.bufferMode === 'months'
          ? Money.mul(Money.div(spending, 12), I.sweep.bufferMonths)
          : Money.mul(I.sweep.bufferDollar, inflationFactor))
      : 0;
    const cashFloor = I.sweep.enabled ? sweepBuffer : 0;

    /* --- Roth conversion sizing --------------------------------
     * Solved in two passes. The first sizes the conversion against
     * income before the conversion's own tax; the second re-runs the
     * withdrawal solve so the portfolio actually funds that tax. This
     * mirrors what a person does in December: look at the year's
     * income, convert up to the top of the target bracket, then find
     * the cash for the resulting bill. */
    let rothConversion = 0;
    const conversionEligible = retired
      && I.rothConversionMode !== 'none'
      && age >= (I.rothConversionStartAge || 0)
      && age <= I.rothConversionEndAge;

    let withdrawals = emptyWithdrawals();
    let taxResult = null;
    let iterations = 0;
    let lastGross = -1, prevGross = -2;
    const extraWithdrawal = ov.extraWithdrawal ?? 0;
    // Converge exactly. Each pass adds the shortfall and the tax grows
    // by the marginal rate on it, so the residual shrinks geometrically
    // and reaching zero costs only a few extra iterations.
    const TOL = 0;

    for (let iter = 0; iter < 60; iter++) {
      iterations = iter + 1;

      taxResult = computeTaxes({
        status: I.filingStatus, age, spouseAge, taxYear: year,
        grossWages,
        preTaxDeferrals: Money.add(trad401kContrib, tradIraDeductible),
        cafeteriaDeductions: hsaViaPayroll,
        aboveTheLineDeductions: hsaAboveTheLine,
        traditionalWithdrawals: Money.add(withdrawals.trad401k, withdrawals.tradIra),
        pensionIncome: pension,
        rentalNetIncome: reRentalNet,
        // Backdoor pro-rata amounts and deliberate Roth conversions are
        // both ordinary income.
        otherOrdinaryIncome: Money.add(otherIncome, backdoorTaxableAmount, rothConversion),
        taxableInterest: cashInterest,
        nonQualifiedDividends,
        shortTermGains: withdrawals.shortTermGain,
        qualifiedDividends,
        longTermGains: Money.add(withdrawals.longTermGain, reTaxableSaleGain),
        realEstateGains: reTaxableSaleGain,
        depreciationRecapture: reRecapture,
        socialSecurityBenefit: socialSecurity,
        earlyWithdrawalAmount: withdrawals.penaltyBase,
        penaltyExceptionApplies: I.penaltyExceptionApplies,
        stateCode: I.stateCode,
        customStateRate: I.customStateRate,
      }, cfg);

      // Cash position if we stopped withdrawing right now.
      const cashAfter = Money.sub(
        Money.add(acct.cash, fixedCashIn, withdrawals.grossProceeds),
        Money.add(fixedCashOut, taxResult.total)
      );

      // How much more (or less) do we need?
      let need = Money.sub(cashFloor, cashAfter);
      // Forced RMD floor: must distribute even with no spending need.
      const rmdShortfall = Money.floor0(
        Money.sub(rmdRequired, Money.add(withdrawals.trad401k, withdrawals.tradIra))
      );
      const extraShortfall = Money.floor0(Money.sub(extraWithdrawal, withdrawals.discretionary));

      if (need <= TOL && rmdShortfall <= TOL && extraShortfall <= TOL) break;
      if (!I.coverShortfallsByWithdrawing && !retired && rmdShortfall <= TOL) break;
      // Stop when the iteration stops producing new values. Matching
      // the previous pass means a fixed point (converged, or the
      // accounts are exhausted and the need cannot be met); matching
      // the one before that means a two-cycle, which can happen when a
      // one-cent increase in the withdrawal raises tax by exactly one
      // cent. Without this, a depleted plan would burn all 60
      // iterations and report a spurious convergence failure.
      if (iter > 0 && (withdrawals.grossProceeds === lastGross ||
                       withdrawals.grossProceeds === prevGross)) break;
      prevGross = lastGross;
      lastGross = withdrawals.grossProceeds;

      const targetTotal = Money.add(
        Money.max(0, Money.add(withdrawals.grossProceeds, Money.max(need, 0))),
        0
      );

      // Re-run the withdrawal from a clean snapshot each iteration so the
      // fixed point converges on a single consistent set of sales.
      withdrawals = executeWithdrawals({
        targetProceeds: targetTotal,
        rmdRequired,
        extraWithdrawal,
        acct, lots, year, age, I, cfg,
        snapshot: true,
      });

      if (iter === 59) {
        warnings.push({ year, type: 'convergence', message: 'Withdrawal solver hit its iteration cap; the tax figure for this year may be slightly off.' });
      }
    }

    /* --- Second pass: size the conversion, then re-solve ---------- */
    if (conversionEligible) {
      const availableTrad = Money.add(acct.trad401k, acct.tradIra);
      let target = 0;
      if (I.rothConversionMode === 'fixed') {
        target = I.rothConversionAmount;
      } else {
        // Room between current taxable ordinary income and the top of
        // the chosen bracket.
        const brackets = cfg.ordinaryBrackets[I.filingStatus] ?? cfg.ordinaryBrackets.single;
        const band = brackets.find((b) => b.rate === I.rothConversionFillToRate);
        if (band && band.upTo !== null) {
          target = Money.floor0(Money.sub(band.upTo, taxResult.taxableOrdinary));
        }
      }
      rothConversion = Money.min(Money.floor0(target), availableTrad);

      if (rothConversion > 0) {
        // Re-run the withdrawal solve with the conversion's tax included.
        lastGross = -1; prevGross = -2;
        for (let iter = 0; iter < 60; iter++) {
          taxResult = computeTaxes({
            status: I.filingStatus, age, spouseAge, taxYear: year,
            grossWages,
            preTaxDeferrals: Money.add(trad401kContrib, tradIraDeductible),
            cafeteriaDeductions: hsaViaPayroll,
            aboveTheLineDeductions: hsaAboveTheLine,
            traditionalWithdrawals: Money.add(withdrawals.trad401k, withdrawals.tradIra),
            pensionIncome: pension,
            rentalNetIncome: reRentalNet,
            otherOrdinaryIncome: Money.add(otherIncome, backdoorTaxableAmount, rothConversion),
            taxableInterest: cashInterest,
            nonQualifiedDividends,
            shortTermGains: withdrawals.shortTermGain,
            qualifiedDividends,
            longTermGains: Money.add(withdrawals.longTermGain, reTaxableSaleGain),
            realEstateGains: reTaxableSaleGain,
        depreciationRecapture: reRecapture,
            socialSecurityBenefit: socialSecurity,
            earlyWithdrawalAmount: withdrawals.penaltyBase,
            penaltyExceptionApplies: I.penaltyExceptionApplies,
            stateCode: I.stateCode,
            customStateRate: I.customStateRate,
          }, cfg);

          const cashAfter = Money.sub(
            Money.add(acct.cash, fixedCashIn, withdrawals.grossProceeds),
            Money.add(fixedCashOut, taxResult.total)
          );
          const need = Money.sub(cashFloor, cashAfter);
          if (need <= TOL) break;
          if (iter > 0 && (withdrawals.grossProceeds === lastGross ||
                           withdrawals.grossProceeds === prevGross)) break;
          prevGross = lastGross;
          lastGross = withdrawals.grossProceeds;
          withdrawals = executeWithdrawals({
            targetProceeds: Money.add(withdrawals.grossProceeds, Money.max(need, 0)),
            rmdRequired, extraWithdrawal, acct, lots, year, age, I, cfg, snapshot: true,
          });
        }
      }
    }

    // Commit the final withdrawal set to the real balances.
    withdrawals = executeWithdrawals({
      targetProceeds: withdrawals.grossProceeds,
      rmdRequired,
      extraWithdrawal,
      acct, lots, year, age, I, cfg,
      snapshot: false,
    });

    /* ---------- Apply cash flows -------------------------------- */
    let cash = Money.sub(
      Money.add(acct.cash, fixedCashIn, withdrawals.grossProceeds),
      Money.add(fixedCashOut, taxResult.total)
    );

    const netCashFlow = Money.sub(
      Money.add(fixedCashIn, withdrawals.grossProceeds),
      Money.add(fixedCashOut, taxResult.total)
    );

    let depleted = false;
    if (cash < 0) {
      depleted = true;
      warnings.push({ year, type: 'shortfall', message: `Cash shortfall of ${Money.fmt(-cash)} — assets are exhausted or withdrawals are blocked.` });
      cash = 0;
    }

    /* ---------- Execute the Roth conversion ---------------------- */
    if (rothConversion > 0) {
      let left = rothConversion;
      for (const k of ['trad401k', 'tradIra']) {
        const take = Money.min(left, acct[k]);
        acct[k] = Money.sub(acct[k], take);
        left = Money.sub(left, take);
      }
      // Converted dollars land in the Roth IRA. Each conversion starts
      // its own 5-year clock before the principal can be withdrawn
      // penalty-free before 59.5 — not modelled year by year, but the
      // reason a ladder is started several years before the money is
      // needed.
      acct.rothIra = Money.add(acct.rothIra, Money.sub(rothConversion, left));
    }

    /* ---------- Add contributions to their accounts -------------- */
    acct.trad401k = Money.add(acct.trad401k, trad401kContrib, employerMatch);
    // After-tax dollars are converted in-plan, so they land in Roth.
    acct.roth401k = Money.add(acct.roth401k, roth401kContrib, afterTax401k);
    acct.tradIra = Money.add(acct.tradIra, tradIraContrib);
    acct.rothIra = Money.add(acct.rothIra, rothIraContrib);
    acct.hsa = Money.add(acct.hsa, hsaContrib);
    if (brokerageDirect > 0) lots.push(makeLot(year, brokerageDirect, 'direct contribution'));

    /* ---------- 8. CASH SWEEP (spec section 4) ------------------- */
    let sweptAmount = 0;
    if (I.sweep.enabled) {
      const excess = Money.floor0(Money.sub(cash, sweepBuffer));
      if (excess > 0) {
        sweptAmount = excess;
        cash = Money.sub(cash, excess);
        // Frequency determines how many lots are created, which matters
        // for the short-term vs long-term holding period of each slice.
        const n = I.sweep.frequency === 'monthly' ? 12
          : I.sweep.frequency === 'quarterly' ? 4 : 1;
        const slices = Money.split(excess, n);
        const dest = I.sweep.destination;
        if (dest === 'brokerage') {
          for (const s of slices) if (s > 0) lots.push(makeLot(year, s, `sweep (${I.sweep.frequency})`));
        } else {
          acct[dest] = Money.add(acct[dest], excess);
        }
      }
    }
    acct.cash = cash;

    /* ---------- Real estate sale proceeds routing ---------------- */
    // (Already added to cash via fixedCashIn; the sweep then invests it.)

    /* ---------- 9. GROWTH --------------------------------------- */
    const timingFactor = I.contributionTiming === 'mid' ? 0.5
      : I.contributionTiming === 'start' ? 1 : 0;

    const rateFor = (key) => {
      const alloc = applyGlidePath(I.allocations[key] ?? { stocks: 100 }, yearsToRetirement, I.glidePath);
      return blendedReturn(alloc, returns);
    };

    // New money added this year earns a partial year of growth.
    const growWithTiming = (balance, added, rate) => {
      const seasoned = Money.sub(balance, added);
      return Money.add(
        Money.grow(Money.floor0(seasoned), rate),
        Money.add(added, Money.mul(added, rate * timingFactor))
      );
    };

    acct.trad401k = growWithTiming(acct.trad401k, Money.add(trad401kContrib, employerMatch), rateFor('trad401k'));
    acct.roth401k = growWithTiming(acct.roth401k, Money.add(roth401kContrib, afterTax401k), rateFor('roth401k'));
    acct.tradIra  = growWithTiming(acct.tradIra, tradIraContrib, rateFor('tradIra'));
    acct.rothIra  = growWithTiming(acct.rothIra, Money.add(rothIraContrib, rothConversion), rateFor('rothIra'));
    acct.hsa      = growWithTiming(acct.hsa, hsaContrib, rateFor('hsa'));
    acct.commodities = Money.grow(acct.commodities, rateFor('commodities'));
    acct.crypto      = Money.grow(acct.crypto, rateFor('crypto'));
    acct.c529        = Money.grow(acct.c529, rateFor('c529'));

    // Brokerage: growth is PRICE appreciation only — the dividend yield
    // was already paid out to cash above, so subtract it from the total
    // return to avoid double-counting.
    const brokerageTotalReturn = rateFor('brokerage');
    const brokeragePriceReturn = brokerageTotalReturn - I.dividendYield;
    // Same mid-year convention as the retirement accounts, so that
    // sweeping and deferring are compared on equal footing.
    growLots(lots, brokeragePriceReturn, year, timingFactor);

    /* ---------- 10. RECORD THE YEAR ------------------------------ */
    const brokerageEnd = lotsValue(lots);
    const totalNetWorth = Money.add(
      acct.cash, acct.trad401k, acct.roth401k, acct.tradIra, acct.rothIra,
      acct.hsa, brokerageEnd, acct.commodities, acct.crypto, acct.c529, reEquity
    );

    const deflator = I.displayRealDollars ? 1 / inflationFactor : 1;
    const real = (c) => (deflator === 1 ? c : Money.mul(c, deflator));

    rows.push({
      year, age, retired,
      grossIncome: real(Money.add(grossWages, otherIncome, pension, socialSecurity, dividends, cashInterest)),
      // Broken out so "gross income" is never an unexplained number.
      // Investment income persists even with no job, which is why zeroing
      // salary does not zero this line.
      earnedIncome: real(grossWages),
      otherIncomeTotal: real(Money.add(otherIncome, pension, socialSecurity)),
      investmentIncome: real(Money.add(dividends, cashInterest)),
      dividends: real(dividends),
      cashInterest: real(cashInterest),
      salary: real(salary),
      socialSecurity: real(socialSecurity),

      /* --- Cash-flow decomposition -----------------------------------
       * These are the exact components of netCashFlow, so that
       *   (sum of inflows) - (sum of outflows) === netCashFlow
       * holds to the cent. The Income vs spending chart stacks them,
       * and a test asserts the identity. The cash sweep is deliberately
       * absent: it moves money between your own accounts and is not a
       * flow in or out. */
      inflow: {
        wages: real(grossWages),
        pension: real(pension),
        socialSecurity: real(socialSecurity),
        other: real(otherIncome),
        dividends: real(dividends),
        interest: real(cashInterest),
        rent: real(reGrossRent),
        propertySale: real(reSaleProceeds),
        withdrawals: real(withdrawals.grossProceeds),
      },
      outflow: {
        living: real(spending),
        realEstate: real(reCosts),
        // Employer match is excluded: it is not money leaving your pocket.
        contributions: real(Money.add(total401k, tradIraContrib, rothIraContrib,
          hsaContrib, brokerageDirect, afterTax401k)),
        tax: real(taxResult.total),
      },

      // Balances (spec section 10 table columns)
      cash: real(acct.cash),
      trad401k: real(acct.trad401k),
      roth401k: real(acct.roth401k),
      tradIra: real(acct.tradIra),
      rothIra: real(acct.rothIra),
      rothTotal: real(Money.add(acct.roth401k, acct.rothIra)),
      hsa: real(acct.hsa),
      brokerage: real(brokerageEnd),
      brokerageBasis: real(lotsBasis(lots)),
      commodities: real(acct.commodities),
      crypto: real(acct.crypto),
      c529: real(acct.c529),
      realEstateEquity: real(reEquity),
      realEstateValue: real(reValue),
      mortgageBalance: real(reMortgage),
      netWorth: real(totalNetWorth),

      // Contributions
      contrib401k: real(total401k),
      contribTrad401k: real(trad401kContrib),
      contribRoth401k: real(roth401kContrib),
      employerMatch: real(employerMatch),
      contribIra: real(Money.add(tradIraContrib, rothIraContrib)),
      contribHsa: real(hsaContrib),
      contribBrokerage: real(brokerageDirect),
      contribAfterTax401k: real(afterTax401k),
      afterTaxHeadroom: real(afterTaxHeadroom),
      backdoorRothTaxable: real(backdoorTaxableAmount),
      rothConversion: real(rothConversion),
      rentalDepreciation: real(reDepreciation),
      rentalLossSuspended: real(rentalLossSuspendedThisYear),
      rentalLossCarryforward: real(reSuspendedTotal),
      depreciationRecapture: real(reRecapture),
      taxDepreciationRecapture: real(taxResult.depreciationRecaptureTax ?? 0),
      swept: real(sweptAmount),

      // Tax (spec section 6: broken out)
      tax: real(taxResult.total),
      taxFederal: real(taxResult.federalIncomeTax),
      taxCapitalGains: real(taxResult.capitalGainsTax),
      taxFica: real(taxResult.ficaTotal),
      taxState: real(taxResult.stateTax),
      taxNiit: real(taxResult.niit),
      taxPenalty: real(taxResult.earlyWithdrawalPenalty),
      effectiveTaxRate: taxResult.effectiveRate,
      marginalRate: taxResult.marginalOrdinaryRate,
      agi: real(taxResult.agi),
      taxableIncome: real(taxResult.taxableTotal),

      // Cash flow
      spending: real(spending),
      realEstateCosts: real(reCosts),
      netCashFlow: real(netCashFlow),
      depleted,

      // Withdrawal detail (spec section 10: separate table)
      withdrawals: {
        total: real(withdrawals.grossProceeds),
        cash: real(withdrawals.cash),
        brokerage: real(withdrawals.brokerage),
        trad401k: real(withdrawals.trad401k),
        tradIra: real(withdrawals.tradIra),
        roth401k: real(withdrawals.roth401k),
        rothIra: real(withdrawals.rothIra),
        hsa: real(withdrawals.hsa),
        longTermGain: real(withdrawals.longTermGain),
        shortTermGain: real(withdrawals.shortTermGain),
        penaltyBase: real(withdrawals.penaltyBase),
        rmdRequired: real(rmdRequired),
        rmdSatisfied: real(Money.min(rmdRequired, Money.add(withdrawals.trad401k, withdrawals.tradIra))),
        lotDetail: withdrawals.lotDetail,
      },

      properties: propertyDetail,
      returnsUsed: returns,
      solverIterations: iterations,
      inflationFactor,
    });

    priorYearTradBalance = Money.add(acct.trad401k, acct.tradIra);
  }

  return {
    rows,
    warnings,
    inputs: I,
    summary: summarize(rows),
  };
}

/* -------------------------------------------------------------------
 * Withdrawal execution (spec section 7)
 *
 * Honours RMDs first (they are not optional), then fills the remaining
 * need in the user's chosen account order, supporting partial
 * withdrawals across multiple accounts in one year.
 *
 * `snapshot: true` runs against copies so the fixed-point solver can
 * probe without mutating real balances.
 * ----------------------------------------------------------------- */
function emptyWithdrawals() {
  return {
    cash: 0, brokerage: 0, trad401k: 0, tradIra: 0, roth401k: 0, rothIra: 0, hsa: 0,
    grossProceeds: 0, longTermGain: 0, shortTermGain: 0, penaltyBase: 0,
    discretionary: 0, lotDetail: [],
  };
}

function executeWithdrawals({ targetProceeds, rmdRequired, extraWithdrawal, acct, lots, year, age, I, cfg, snapshot }) {
  const w = emptyWithdrawals();
  const A = snapshot ? { ...acct } : acct;
  const L = snapshot ? lots.map((l) => ({ ...l })) : lots;

  const penaltyAge = cfg.earlyWithdrawal.penaltyFreeAge;
  const isEarly = age < penaltyAge;

  /* --- RMDs are mandatory, and come out first ------------------- */
  let rmdLeft = rmdRequired;
  for (const key of ['trad401k', 'tradIra']) {
    if (rmdLeft <= 0) break;
    const take = Money.min(rmdLeft, A[key]);
    if (take > 0) {
      A[key] = Money.sub(A[key], take);
      w[key] = Money.add(w[key], take);
      w.grossProceeds = Money.add(w.grossProceeds, take);
      rmdLeft = Money.sub(rmdLeft, take);
    }
  }

  /* --- Remaining need, in the configured order ------------------
   * `extraWithdrawal` is a floor on DISCRETIONARY withdrawals (e.g. a
   * deliberate Roth conversion), additive to any spending shortfall. */
  let need = Money.max(
    Money.floor0(Money.sub(targetProceeds, w.grossProceeds)),
    Money.floor0(extraWithdrawal)
  );
  w.discretionary = 0;

  for (const key of I.withdrawalOrder) {
    if (need <= 0) break;

    if (key === 'cash') continue; // Cash is the destination, not a source.

    if (key === 'brokerage') {
      const available = lotsValue(L);
      const take = Money.min(need, available);
      if (take > 0) {
        const sale = sellFromLots(L, take, year, I.lotSelectionMethod);
        w.brokerage = Money.add(w.brokerage, sale.proceeds);
        w.longTermGain = Money.add(w.longTermGain, sale.longTermGain);
        w.shortTermGain = Money.add(w.shortTermGain, sale.shortTermGain);
        w.grossProceeds = Money.add(w.grossProceeds, sale.proceeds);
        w.discretionary = Money.add(w.discretionary, sale.proceeds);
        if (!snapshot) w.lotDetail = w.lotDetail.concat(sale.detail);
        need = Money.sub(need, sale.proceeds);
      }
      continue;
    }

    const available = A[key] ?? 0;
    const take = Money.min(need, available);
    if (take <= 0) continue;

    A[key] = Money.sub(A[key], take);
    w[key] = Money.add(w[key], take);
    w.grossProceeds = Money.add(w.grossProceeds, take);
    w.discretionary = Money.add(w.discretionary, take);
    need = Money.sub(need, take);

    // 10% penalty applies to pre-59.5 distributions from tax-advantaged
    // accounts. Roth basis is returnable tax- and penalty-free, but this
    // model conservatively treats the whole Roth distribution as subject
    // to penalty when early — flagged as a simplification.
    if (isEarly && ['trad401k', 'tradIra', 'roth401k', 'rothIra'].includes(key)) {
      w.penaltyBase = Money.add(w.penaltyBase, take);
    }
    // HSA distributions are tax-free for qualified medical expenses; this
    // model treats non-medical HSA withdrawals before 65 as penalised.
    if (age < 65 && key === 'hsa') w.penaltyBase = Money.add(w.penaltyBase, take);
  }

  if (snapshot) {
    // Nothing was committed; the caller re-runs with snapshot:false.
    return w;
  }
  return w;
}

/* -------------------------------------------------------------------
 * Summary statistics across the whole run.
 * ----------------------------------------------------------------- */
function summarize(rows) {
  if (!rows.length) return {};
  const last = rows[rows.length - 1];
  const totalTax = rows.reduce((s, r) => Money.add(s, r.tax), 0);
  const totalContrib = rows.reduce((s, r) =>
    Money.add(s, r.contrib401k, r.employerMatch, r.contribIra, r.contribHsa,
      r.contribBrokerage, r.contribAfterTax401k, r.swept), 0);
  const totalSwept = rows.reduce((s, r) => Money.add(s, r.swept), 0);
  const peak = rows.reduce((m, r) => (r.netWorth > m.netWorth ? r : m), rows[0]);
  const depletedRow = rows.find((r) => r.depleted);

  return {
    endingNetWorth: last.netWorth,
    endingYear: last.year,
    endingAge: last.age,
    totalTaxPaid: totalTax,
    totalContributions: totalContrib,
    totalSwept,
    peakNetWorth: peak.netWorth,
    peakYear: peak.year,
    depleted: !!depletedRow,
    depletedYear: depletedRow ? depletedRow.year : null,
    avgEffectiveRate: rows.reduce((s, r) => s + r.effectiveTaxRate, 0) / rows.length,
  };
}

/* ===================================================================
 * MONTE CARLO (spec section 8)
 * -------------------------------------------------------------------
 * Runs N independent return sequences and reports percentile bands plus
 * the share of trials that never ran out of money.
 * =================================================================== */
function monteCarlo(inputs, { trials = 500, seed = 12345, onProgress = null } = {}) {
  const results = [];
  const horizon = inputs.horizonYears;
  const perYearNetWorth = Array.from({ length: horizon }, () => []);
  let successCount = 0;

  for (let i = 0; i < trials; i++) {
    const run = simulate(inputs, { seed: seed + i * 7919 });
    results.push(run.summary.endingNetWorth);
    if (!run.summary.depleted) successCount++;
    run.rows.forEach((r, t) => { if (t < horizon) perYearNetWorth[t].push(r.netWorth); });
    if (onProgress && i % 25 === 0) onProgress(i / trials);
  }

  const pct = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b);
    const idx = (s.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? s[lo] : Math.round(s[lo] + (s[hi] - s[lo]) * (idx - lo));
  };

  const bands = perYearNetWorth.map((vals, t) => ({
    year: inputs.startYear + t,
    age: inputs.currentAge + t,
    p10: pct(vals, 0.10), p25: pct(vals, 0.25), p50: pct(vals, 0.50),
    p75: pct(vals, 0.75), p90: pct(vals, 0.90),
  }));

  return {
    trials,
    successRate: successCount / trials,
    bands,
    ending: {
      p10: pct(results, 0.10), p25: pct(results, 0.25), p50: pct(results, 0.50),
      p75: pct(results, 0.75), p90: pct(results, 0.90),
      min: Math.min(...results), max: Math.max(...results),
      mean: Math.round(results.reduce((a, b) => a + b, 0) / results.length),
    },
  };
}

/* ===================================================================
 * STRESS TEST (spec section 10: optimistic / average / pessimistic)
 * =================================================================== */
function stressTest(inputs) {
  return {
    pessimistic: simulate(inputs, { returnMultiplier: 0.45 }),
    average: simulate(inputs),
    optimistic: simulate(inputs, { returnMultiplier: 1.45 }),
  };
}

/**
 * Sequence-of-returns stress: the same average return, but the worst
 * years front-loaded into the start of retirement — the scenario that
 * does the most damage to a withdrawal plan.
 */
function sequenceRiskTest(inputs, { crashYears = 3, crashReturn = -0.15 } = {}) {
  const retirementIndex = Math.max(0, inputs.retirementAge - inputs.currentAge);
  const overrides = { ...inputs.overrides };
  for (let i = 0; i < crashYears; i++) {
    const y = inputs.startYear + retirementIndex + i;
    overrides[y] = {
      ...(overrides[y] ?? {}),
      returnsOverride: { ...inputs.returns, stocks: crashReturn, bonds: -0.02, realEstate: -0.05 },
    };
  }
  return simulate({ ...inputs, overrides });
}

return {
  simulate, monteCarlo, stressTest, sequenceRiskTest,
  defaultInputs, defaultProperty, normalizeInputs,
  makeLot, lotsValue, lotsBasis, growLots, sellFromLots,
  blendedReturn, applyGlidePath, monthlyPayment, amortizeYear, processProperty,
  makeRng, drawReturn, summarize,
};
});

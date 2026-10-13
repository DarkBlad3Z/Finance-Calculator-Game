/* ===================================================================
 * tax-engine.js — FEDERAL / STATE / FICA TAX CALCULATION
 * -------------------------------------------------------------------
 * Implements spec section 6. Pure functions only: no state, no DOM.
 * Every monetary argument and return value is INTEGER CENTS.
 *
 * ESTIMATE ONLY. Does not model AMT, itemized deductions, QBI, credits
 * (child tax credit, saver's credit, ACA premium credits), state
 * bracket detail, or local income tax.
 * =================================================================== */

'use strict';

(function (root, factory) {
  const deps = typeof require === 'function'
    ? [require('./money.js').Money, require('./tax-config.js')]
    : [root.Money, { STATE_TAX: root.STATE_TAX, getTaxConfig: root.getTaxConfig }];
  const api = factory(...deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function (Money, cfgMod) {

const { STATE_TAX } = cfgMod;

/* -------------------------------------------------------------------
 * Progressive bracket application.
 * Returns tax in cents on `taxable` (already net of deductions).
 * ----------------------------------------------------------------- */
function taxOnBrackets(taxable, brackets) {
  if (taxable <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const top = b.upTo === null ? Infinity : b.upTo;
    if (taxable <= lower) break;
    const slice = Math.min(taxable, top) - lower;
    if (slice > 0) tax = Money.add(tax, Money.mul(slice, b.rate));
    lower = top;
    if (taxable <= top) break;
  }
  return tax;
}

/** The rate that applies to the next dollar of ordinary income. */
function marginalRate(taxable, brackets) {
  let lower = 0;
  for (const b of brackets) {
    const top = b.upTo === null ? Infinity : b.upTo;
    if (taxable <= top) return b.rate;
    lower = top;
  }
  return brackets[brackets.length - 1].rate;
}

/* -------------------------------------------------------------------
 * Long-term capital gains / qualified dividends.
 *
 * LTCG "stacks on top of" ordinary income: your ordinary taxable income
 * fills the preferential brackets first, and the gain is taxed in
 * whatever bracket room is left above it. This is why a big traditional
 * withdrawal can push an otherwise 0%-rate gain into the 15% band.
 * ----------------------------------------------------------------- */
function taxOnLtcg(ordinaryTaxable, ltcgAmount, brackets) {
  if (ltcgAmount <= 0) return 0;
  const start = Math.max(0, ordinaryTaxable);
  let tax = 0;
  let remaining = ltcgAmount;
  let lower = 0;
  for (const b of brackets) {
    const top = b.upTo === null ? Infinity : b.upTo;
    // The portion of this bracket that sits above ordinary income.
    const bandLo = Math.max(lower, start);
    const bandHi = top;
    if (bandHi > bandLo) {
      const slice = Math.min(remaining, bandHi - bandLo);
      if (slice > 0) {
        tax = Money.add(tax, Money.mul(slice, b.rate));
        remaining -= slice;
      }
    }
    lower = top;
    if (remaining <= 0) break;
  }
  return tax;
}

/* -------------------------------------------------------------------
 * Taxable portion of Social Security benefits.
 *
 * Provisional income = AGI excluding SS + tax-exempt interest + 50% SS.
 * Below tier 1: none taxable. Between tiers: up to 50%. Above tier 2:
 * up to 85%. The thresholds are NOT inflation-indexed, so over a long
 * forecast an increasing share of benefits becomes taxable.
 * ----------------------------------------------------------------- */
function taxableSocialSecurity(ssBenefit, otherAgi, taxExemptInterest, status, cfg) {
  if (ssBenefit <= 0) return 0;
  const t = cfg.socialSecurityTaxability;
  const tier1 = t.tier1[status] ?? t.tier1.single;
  const tier2 = t.tier2[status] ?? t.tier2.single;

  const provisional = Money.add(otherAgi, taxExemptInterest, Money.mul(ssBenefit, 0.5));
  if (provisional <= tier1) return 0;

  if (provisional <= tier2) {
    const over = Money.sub(provisional, tier1);
    return Money.min(Money.mul(over, t.tier1Rate), Money.mul(ssBenefit, t.tier1Rate));
  }
  const tier1Amount = Money.mul(Money.sub(tier2, tier1), t.tier1Rate);
  const over2 = Money.sub(provisional, tier2);
  const combined = Money.add(Money.mul(over2, t.tier2Rate), tier1Amount);
  return Money.min(combined, Money.mul(ssBenefit, t.tier2Rate));
}

/* -------------------------------------------------------------------
 * Passive activity loss limitation (IRC §469).
 *
 * Returns how much of a rental loss may be deducted this year and how
 * much is suspended. The $25,000 special allowance phases out between
 * $100k and $150k of MAGI, so a high earner gets NO current deduction
 * from a rental loss — the shelter everyone assumes is automatic simply
 * does not arrive until income falls.
 * ----------------------------------------------------------------- */
function applyPassiveLossLimit(loss, magi, passiveIncome, cfg) {
  if (loss <= 0) return { allowed: 0, suspended: 0, allowance: 0 };
  const p = cfg.passiveActivityLoss;

  // Passive losses offset passive income without limit.
  const againstPassive = Money.min(loss, Money.floor0(passiveIncome));
  let remaining = Money.sub(loss, againstPassive);

  // The remainder may offset ordinary income only up to the allowance.
  const over = Money.floor0(Money.sub(magi, p.phaseOutStart));
  const allowance = Money.floor0(
    Money.sub(p.specialAllowance, Money.mul(over, p.phaseOutRate))
  );
  const againstOrdinary = Money.min(remaining, allowance);
  return {
    allowed: Money.add(againstPassive, againstOrdinary),
    suspended: Money.sub(remaining, againstOrdinary),
    allowance,
  };
}

/* -------------------------------------------------------------------
 * FICA — Social Security + Medicare on GROSS wages.
 *
 * Deliberately NOT reduced by 401(k) elective deferrals: deferrals are
 * exempt from income tax but remain subject to FICA. Pre-tax HSA and
 * other section 125 cafeteria deductions ARE FICA-exempt.
 * ----------------------------------------------------------------- */
function computeFica(grossWages, cafeteriaDeductions, status, cfg) {
  const base = Money.floor0(Money.sub(grossWages, cafeteriaDeductions));
  const f = cfg.fica;
  const ssWages = Money.min(base, f.socialSecurityWageBase);
  const socialSecurity = Money.mul(ssWages, f.socialSecurityRate);
  const medicare = Money.mul(base, f.medicareRate);
  const addlThreshold = f.additionalMedicareThreshold[status] ?? f.additionalMedicareThreshold.single;
  const addlBase = Money.floor0(Money.sub(base, addlThreshold));
  const additionalMedicare = Money.mul(addlBase, f.additionalMedicareRate);
  return {
    socialSecurity,
    medicare,
    additionalMedicare,
    total: Money.add(socialSecurity, medicare, additionalMedicare),
  };
}

/* -------------------------------------------------------------------
 * Net Investment Income Tax — 3.8% on the LESSER of net investment
 * income and the amount by which MAGI exceeds the threshold.
 * ----------------------------------------------------------------- */
function computeNiit(netInvestmentIncome, magi, status, cfg) {
  const threshold = cfg.niit.threshold[status] ?? cfg.niit.threshold.single;
  const excess = Money.floor0(Money.sub(magi, threshold));
  const taxBase = Money.min(Money.floor0(netInvestmentIncome), excess);
  return Money.mul(taxBase, cfg.niit.rate);
}

/* -------------------------------------------------------------------
 * State income tax — flat approximation (see tax-config.js caveat).
 * ----------------------------------------------------------------- */
function computeStateTax({
  ordinaryIncome,
  capitalGains,            // all preferential income (qual. dividends + LTCG)
  realizedGains = null,    // LTCG only, excluding dividends
  realEstateGains = 0,     // portion of realizedGains from property sales
  stateCode, customRate, customLtcgRate,
}) {
  const st = STATE_TAX[stateCode] ?? STATE_TAX.CUSTOM;
  const rate = st.custom ? (customRate ?? 0) : st.rate;
  const gainsRate = st.custom
    ? (customLtcgRate ?? customRate ?? 0)
    : (st.ltcgRate === null || st.ltcgRate === undefined ? rate : st.ltcgRate);

  const onOrdinary = Money.mul(Money.floor0(ordinaryIncome), rate);

  // Determine the base the state actually taxes.
  let gainsBase = st.ltcgRealizedGainsOnly && realizedGains !== null
    ? realizedGains
    : capitalGains;
  if (st.ltcgExemptsRealEstate) gainsBase = Money.sub(gainsBase, realEstateGains);
  if (st.ltcgStandardDeduction) gainsBase = Money.sub(gainsBase, st.ltcgStandardDeduction);

  const onGains = Money.mul(Money.floor0(gainsBase), gainsRate);
  return {
    onOrdinary,
    onGains,
    total: Money.add(onOrdinary, onGains),
    rate,
    gainsRate,
    gainsBase: Money.floor0(gainsBase),
    approximate: !!st.approx || !!st.custom,
    stateName: st.name,
  };
}

/* -------------------------------------------------------------------
 * Standard deduction including age-65 additions and the temporary
 * OBBBA senior deduction (which phases out on MAGI).
 * ----------------------------------------------------------------- */
function computeDeduction({ status, age, spouseAge, magi, taxYear, itemizedDeductions = 0 }, cfg) {
  let deduction = cfg.standardDeduction[status] ?? cfg.standardDeduction.single;

  const extra = cfg.additionalStandardDeductionAge65[status] ?? cfg.additionalStandardDeductionAge65.single;
  let seniors = 0;
  if (age >= 65) { deduction = Money.add(deduction, extra); seniors++; }
  if (status === 'mfj' && spouseAge >= 65) { deduction = Money.add(deduction, extra); seniors++; }

  // OBBBA senior bonus deduction — available whether or not you itemize.
  const sb = cfg.seniorBonusDeduction;
  let seniorBonus = 0;
  if (sb && seniors > 0 && taxYear <= sb.expiresAfter) {
    const gross = Money.mul(sb.amount, seniors);
    const start = sb.phaseOutStart[status] ?? sb.phaseOutStart.single;
    const reduction = Money.mul(Money.floor0(Money.sub(magi, start)), sb.phaseOutRate);
    seniorBonus = Money.floor0(Money.sub(gross, reduction));
  }

  const standard = deduction;
  const usedItemized = itemizedDeductions > standard;
  return {
    total: Money.add(usedItemized ? itemizedDeductions : standard, seniorBonus),
    standard,
    seniorBonus,
    usedItemized,
  };
}

/* ===================================================================
 * MAIN ENTRY POINT
 * -------------------------------------------------------------------
 * Computes a full year's tax bill. All inputs in cents.
 *
 *   grossWages            W-2 wages before any deferral
 *   preTaxDeferrals       traditional 401k + deductible trad IRA
 *   cafeteriaDeductions   pre-tax HSA/insurance (FICA-exempt)
 *   traditionalWithdrawals   taxed as ordinary income
 *   pensionIncome, rentalNetIncome, otherOrdinaryIncome
 *   taxableInterest, nonQualifiedDividends, shortTermGains  ordinary
 *   qualifiedDividends, longTermGains                        preferential
 *   socialSecurityBenefit    gross benefit; taxable share computed here
 *   earlyWithdrawalAmount    subject to the 10% penalty
 * =================================================================== */
function computeTaxes(input, cfg) {
  const {
    status = 'single',
    age = 40,
    spouseAge = 40,
    taxYear = 2026,
    grossWages = 0,
    preTaxDeferrals = 0,
    cafeteriaDeductions = 0,      // payroll-deducted, FICA-exempt
    aboveTheLineDeductions = 0,   // e.g. a direct HSA contribution with no wages
    traditionalWithdrawals = 0,
    pensionIncome = 0,
    rentalNetIncome = 0,
    otherOrdinaryIncome = 0,
    taxableInterest = 0,
    nonQualifiedDividends = 0,
    shortTermGains = 0,
    qualifiedDividends = 0,
    longTermGains = 0,
    socialSecurityBenefit = 0,
    taxExemptInterest = 0,
    itemizedDeductions = 0,
    earlyWithdrawalAmount = 0,
    penaltyExceptionApplies = false,
    stateCode = 'WA',
    customStateRate = 0,
    customStateLtcgRate = null,
    realEstateGains = 0,      // share of longTermGains from property sales
    depreciationRecapture = 0, // unrecaptured §1250 gain, flat 25%
  } = input;

  /* --- 1. Ordinary income before the Social Security calculation --- */
  const wagesAfterDeferral = Money.floor0(
    Money.sub(Money.sub(grossWages, preTaxDeferrals), cafeteriaDeductions)
  );
  const ordinaryExSs = Money.floor0(Money.sub(
    Money.add(
      wagesAfterDeferral, traditionalWithdrawals, pensionIncome, rentalNetIncome,
      otherOrdinaryIncome, taxableInterest, nonQualifiedDividends, shortTermGains
    ),
    aboveTheLineDeductions
  ));

  /* --- 2. Social Security taxable portion -------------------------- */
  const agiExSs = Money.add(ordinaryExSs, qualifiedDividends, longTermGains);
  const taxableSs = taxableSocialSecurity(socialSecurityBenefit, agiExSs, taxExemptInterest, status, cfg);

  /* --- 3. AGI and MAGI --------------------------------------------- */
  const ordinaryIncome = Money.add(ordinaryExSs, taxableSs);
  const preferentialIncome = Money.add(qualifiedDividends, longTermGains);
  const agi = Money.add(ordinaryIncome, preferentialIncome);
  const magi = Money.add(agi, taxExemptInterest);

  /* --- 4. Deductions ----------------------------------------------- */
  const deduction = computeDeduction({ status, age, spouseAge, magi, taxYear, itemizedDeductions }, cfg);

  /* --- 5. Split the deduction: ordinary income absorbs it first ----- */
  const taxableTotal = Money.floor0(Money.sub(agi, deduction.total));
  const taxableOrdinary = Money.floor0(Money.sub(ordinaryIncome, deduction.total));
  // Whatever deduction the ordinary income could not absorb shelters gains.
  const taxablePreferential = Money.floor0(Money.min(preferentialIncome, taxableTotal));

  /* --- 6. Federal tax ---------------------------------------------- */
  const brackets = cfg.ordinaryBrackets[status] ?? cfg.ordinaryBrackets.single;
  const ltcgBrackets = cfg.ltcgBrackets[status] ?? cfg.ltcgBrackets.single;
  const federalOrdinary = taxOnBrackets(taxableOrdinary, brackets);
  const federalLtcg = taxOnLtcg(taxableOrdinary, taxablePreferential, ltcgBrackets);

  /* --- 7. FICA ------------------------------------------------------ */
  const fica = computeFica(grossWages, cafeteriaDeductions, status, cfg);

  /* --- 8. NIIT ------------------------------------------------------ */
  const netInvestmentIncome = Money.add(
    taxableInterest, nonQualifiedDividends, qualifiedDividends,
    shortTermGains, longTermGains, Money.floor0(rentalNetIncome)
  );
  const niit = computeNiit(netInvestmentIncome, magi, status, cfg);

  /* --- 8b. Depreciation recapture ------------------------------------
   * Unrecaptured §1250 gain is taxed at a flat 25%, not at the
   * preferential long-term rates, and the §121 exclusion cannot shelter
   * it. Modelled as its own layer rather than folded into LTCG. */
  const recaptureTax = Money.mul(
    Money.floor0(depreciationRecapture), cfg.depreciationRecaptureRate ?? 0.25
  );

  /* --- 9. Early withdrawal penalty ---------------------------------- */
  const subjectToPenalty = age < cfg.earlyWithdrawal.penaltyFreeAge && !penaltyExceptionApplies;
  const penalty = subjectToPenalty
    ? Money.mul(Money.floor0(earlyWithdrawalAmount), cfg.earlyWithdrawal.penaltyRate)
    : 0;

  /* --- 10. State ----------------------------------------------------- */
  const state = computeStateTax({
    ordinaryIncome: Money.floor0(Money.sub(ordinaryIncome, deduction.standard)),
    capitalGains: preferentialIncome,
    realizedGains: longTermGains,
    realEstateGains,
    stateCode,
    customRate: customStateRate,
    customLtcgRate: customStateLtcgRate,
  });

  /* --- 11. Totals ---------------------------------------------------- */
  const federalTotal = Money.add(federalOrdinary, federalLtcg, niit, penalty, recaptureTax);
  const total = Money.add(federalTotal, fica.total, state.total);
  const grossIncomeForRate = Money.add(agi, preTaxDeferrals, cafeteriaDeductions,
    Money.sub(socialSecurityBenefit, taxableSs));

  return {
    // Income measures
    agi, magi, taxableSocialSecurity: taxableSs,
    ordinaryIncome, preferentialIncome,
    taxableOrdinary, taxablePreferential, taxableTotal,
    deduction,

    // Tax components (spec section 6: broken out by category)
    federalIncomeTax: federalOrdinary,
    capitalGainsTax: federalLtcg,
    depreciationRecaptureTax: recaptureTax,
    niit,
    earlyWithdrawalPenalty: penalty,
    federalTotal,
    fica,
    ficaTotal: fica.total,
    stateTax: state.total,
    stateDetail: state,
    total,

    // Rate measures
    effectiveRate: grossIncomeForRate > 0 ? total / grossIncomeForRate : 0,
    effectiveFederalRate: grossIncomeForRate > 0 ? federalTotal / grossIncomeForRate : 0,
    marginalOrdinaryRate: marginalRate(taxableOrdinary, brackets),
    marginalLtcgRate: marginalRate(Money.add(taxableOrdinary, taxablePreferential), ltcgBrackets),
    grossIncomeForRate,
  };
}

/* -------------------------------------------------------------------
 * Contribution eligibility helpers (spec section 5).
 * ----------------------------------------------------------------- */

/** Linear phase-out: returns the allowed amount given MAGI. */
function applyPhaseOut(amount, magi, range) {
  if (!range || magi <= range.start) return amount;
  if (magi >= range.end) return 0;
  const span = range.end - range.start;
  const remaining = (range.end - magi) / span;
  // IRS rounds the resulting limit up to the next $10, floor $200.
  const allowed = Money.mul(amount, remaining);
  const rounded = Math.ceil(allowed / 1000) * 1000;
  return Math.min(amount, Math.max(rounded, allowed > 0 ? 20000 : 0));
}

/** Maximum employee 401(k) deferral for this age. */
function max401kDeferral(age, cfg) {
  let limit = cfg.limits.elective401k;
  if (age >= 60 && age <= 63) limit = Money.add(limit, cfg.limits.catchUpSuper60to63);
  else if (age >= 50) limit = Money.add(limit, cfg.limits.catchUp50);
  return limit;
}

/** Maximum IRA contribution (traditional + Roth combined) for this age. */
function maxIraContribution(age, cfg) {
  return age >= 50 ? Money.add(cfg.limits.ira, cfg.limits.iraCatchUp50) : cfg.limits.ira;
}

/** Roth IRA contribution allowed after the MAGI phase-out. */
function allowedRothIra(desired, magi, status, age, cfg) {
  const cap = maxIraContribution(age, cfg);
  const range = cfg.rothIraPhaseOut[status] ?? cfg.rothIraPhaseOut.single;
  return Money.min(desired, applyPhaseOut(cap, magi, range));
}

/** Deductible portion of a traditional IRA contribution. */
function deductibleTradIra(contribution, magi, status, coveredByPlan, cfg) {
  if (!coveredByPlan) return contribution;
  const range = cfg.tradIraDeductionPhaseOut[status] ?? cfg.tradIraDeductionPhaseOut.single;
  return Money.min(contribution, applyPhaseOut(contribution, magi, range));
}

/** HSA limit for this coverage type and age. */
function maxHsa(coverage, age, cfg) {
  const base = coverage === 'family' ? cfg.limits.hsaFamily : cfg.limits.hsaSelfOnly;
  return age >= 55 ? Money.add(base, cfg.limits.hsaCatchUp55) : base;
}

return {
  taxOnBrackets, marginalRate, taxOnLtcg, taxableSocialSecurity,
  computeFica, computeNiit, computeStateTax, computeDeduction, computeTaxes,
  applyPhaseOut, max401kDeferral, maxIraContribution, allowedRothIra,
  deductibleTradIra, maxHsa, applyPassiveLossLimit,
};
});

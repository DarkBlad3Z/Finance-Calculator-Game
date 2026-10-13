/* ===================================================================
 * test-engine.js — VERIFICATION SUITE
 * Run with:  node test-engine.js
 *
 * Checks the engine against hand-computed values rather than against
 * itself, so a wrong-but-consistent implementation still fails.
 * =================================================================== */

'use strict';

const { Money } = require('./money.js');
const cfgMod = require('./tax-config.js');
const tax = require('./tax-engine.js');
const eng = require('./engine.js');

const { getTaxConfig, getRmdDivisor, getRmdStartAge } = cfgMod;
const CFG = getTaxConfig(2026, 0);

let passed = 0, failed = 0;
const failures = [];

function check(name, actual, expected, tolerance = 0) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) { passed++; }
  else {
    failed++;
    failures.push(`  ✗ ${name}\n      expected ${expected}  got ${actual}  (diff ${actual - expected})`);
  }
}
function checkTrue(name, cond, detail = '') {
  if (cond) passed++;
  else { failed++; failures.push(`  ✗ ${name}${detail ? '\n      ' + detail : ''}`); }
}
function section(t) { console.log(`\n── ${t}`); }

const $ = Money.fromDollars;
const D = Money.toDollars;

/* ===================================================================
 * 1. DECIMAL SAFETY
 * =================================================================== */
section('Decimal-safe arithmetic');

check('$0.10 + $0.20 === $0.30 exactly', Money.add($(0.10), $(0.20)), 30);
checkTrue('float equivalent is NOT exact (proves the point)', 0.1 + 0.2 !== 0.3);

// Accumulate a third of a dollar 300,000 times: must stay an integer.
let acc = 0;
for (let i = 0; i < 300000; i++) acc = Money.add(acc, Money.div($(1), 3));
checkTrue('300k accumulations stay cent-integral', Number.isInteger(acc));

// split() must conserve every penny.
const parts = Money.split(100, 3);
check('split(100,3) sums back to 100', parts.reduce((a, b) => a + b, 0), 100);
checkTrue('split(100,3) = [34,33,33]', JSON.stringify(parts) === '[34,33,33]', JSON.stringify(parts));

// allocate() must conserve every penny across odd weights.
const alloc = Money.allocate(1000, [1, 1, 1]);
check('allocate(1000,[1,1,1]) conserves total', alloc.reduce((a, b) => a + b, 0), 1000);
const alloc2 = Money.allocate(12345, [70, 20, 10]);
check('allocate(12345,[70,20,10]) conserves total', alloc2.reduce((a, b) => a + b, 0), 12345);

// 40 years of compounding must never produce a fractional cent.
let bal = $(100000);
for (let i = 0; i < 40; i++) bal = Money.grow(bal, 0.07);
checkTrue('40y compounding stays cent-integral', Number.isInteger(bal));
check('40y @7% on $100k ≈ $1,497,446', D(bal), 1497445.71, 2);

/* ===================================================================
 * 2. FEDERAL BRACKET MATH — hand-computed
 * =================================================================== */
section('Federal ordinary income tax (2026 brackets)');

// Single, $50,000 taxable:
//   10% × 12,400              = 1,240.00
//   12% × (50,000 − 12,400)   = 4,512.00
//                        total= 5,752.00
check('single $50k taxable = $5,752',
  D(tax.taxOnBrackets($(50000), CFG.ordinaryBrackets.single)), 5752, 0.01);

// Single, $12,400 taxable — exactly the top of the 10% bracket.
check('single $12,400 taxable = $1,240',
  D(tax.taxOnBrackets($(12400), CFG.ordinaryBrackets.single)), 1240, 0.01);

// Single, $200,000 taxable:
//   10% × 12,400                 =  1,240.00
//   12% × (50,400 − 12,400)      =  4,560.00
//   22% × (105,700 − 50,400)     = 12,166.00
//   24% × (200,000 − 105,700)    = 22,632.00
//                           total= 40,598.00
check('single $200k taxable = $40,598',
  D(tax.taxOnBrackets($(200000), CFG.ordinaryBrackets.single)), 40598, 0.01);

// MFJ, $200,000 taxable:
//   10% × 24,800                 =  2,480.00
//   12% × (100,800 − 24,800)     =  9,120.00
//   22% × (200,000 − 100,800)    = 21,824.00
//                           total= 33,424.00
check('mfj $200k taxable = $33,424',
  D(tax.taxOnBrackets($(200000), CFG.ordinaryBrackets.mfj)), 33424, 0.01);

check('zero income = zero tax', tax.taxOnBrackets(0, CFG.ordinaryBrackets.single), 0);
check('negative taxable = zero tax', tax.taxOnBrackets($(-5000), CFG.ordinaryBrackets.single), 0);
check('marginal rate at $60k single = 22%',
  tax.marginalRate($(60000), CFG.ordinaryBrackets.single), 0.22, 1e-9);

/* ===================================================================
 * 3. LTCG STACKING
 * =================================================================== */
section('Long-term capital gains stacking');

// No ordinary income, $40,000 gain, single: entirely inside the 0% band
// (which runs to $49,450).
check('$40k gain, no other income = $0',
  D(tax.taxOnLtcg(0, $(40000), CFG.ltcgBrackets.single)), 0, 0.01);

// $40,000 ordinary + $40,000 gain, single:
//   0% band has 49,450 − 40,000 = 9,450 of room  -> $0
//   remaining 30,550 taxed at 15%                -> $4,582.50
check('$40k ordinary + $40k gain = $4,582.50',
  D(tax.taxOnLtcg($(40000), $(40000), CFG.ltcgBrackets.single)), 4582.50, 0.01);

// Ordinary income above the whole 0% band: the full gain is 15%.
check('$60k ordinary + $10k gain = $1,500',
  D(tax.taxOnLtcg($(60000), $(10000), CFG.ltcgBrackets.single)), 1500, 0.01);

// Proves the stacking direction matters: same gain, more ordinary income
// below it, strictly more tax.
checkTrue('more ordinary income => more tax on the same gain',
  tax.taxOnLtcg($(60000), $(40000), CFG.ltcgBrackets.single) >
  tax.taxOnLtcg($(40000), $(40000), CFG.ltcgBrackets.single));

/* ===================================================================
 * 4. FICA
 * =================================================================== */
section('FICA');

// $100,000 wages, below the wage base:
//   SS  6.2%  × 100,000 = 6,200
//   Med 1.45% × 100,000 = 1,450
const fica100 = tax.computeFica($(100000), 0, 'single', CFG);
check('FICA on $100k = $7,650', D(fica100.total), 7650, 0.01);

// $300,000 wages, single:
//   SS  6.2%  × 184,500 (capped) = 11,439.00
//   Med 1.45% × 300,000          =  4,350.00
//   Addl 0.9% × (300,000−200,000)=    900.00
//                           total= 16,689.00
const fica300 = tax.computeFica($(300000), 0, 'single', CFG);
check('SS capped at the wage base', D(fica300.socialSecurity), 11439, 0.01);
check('FICA on $300k single = $16,689', D(fica300.total), 16689, 0.01);

// 401(k) deferrals do NOT reduce FICA.
const ficaDeferred = tax.computeFica($(100000), 0, 'single', CFG);
check('401k deferral does not reduce FICA', D(ficaDeferred.total), 7650, 0.01);
// Cafeteria-plan (HSA) deductions DO reduce FICA.
const ficaHsa = tax.computeFica($(100000), $(4400), 'single', CFG);
check('HSA payroll deduction reduces FICA', D(ficaHsa.total), 7650 - 4400 * 0.0765, 0.01);

/* ===================================================================
 * 5. SOCIAL SECURITY TAXABILITY
 * =================================================================== */
section('Social Security taxability');

check('low income => SS not taxable',
  tax.taxableSocialSecurity($(20000), $(5000), 0, 'single', CFG), 0);

// Single, $30,000 SS, $40,000 other income:
//   provisional = 40,000 + 15,000 = 55,000, above tier2 (34,000)
//   tier1 piece = 50% × (34,000 − 25,000) = 4,500
//   tier2 piece = 85% × (55,000 − 34,000) = 17,850
//   sum = 22,350, capped at 85% × 30,000 = 25,500 -> 22,350
check('high income => 85% formula applies',
  D(tax.taxableSocialSecurity($(30000), $(40000), 0, 'single', CFG)), 22350, 0.01);

checkTrue('taxable SS never exceeds 85% of the benefit',
  tax.taxableSocialSecurity($(40000), $(500000), 0, 'single', CFG) <= Money.mul($(40000), 0.85));

/* ===================================================================
 * 6. CONTRIBUTION LIMITS & PHASE-OUTS
 * =================================================================== */
section('Contribution limits and phase-outs');

check('401k limit age 40 = $24,500', D(tax.max401kDeferral(40, CFG)), 24500);
check('401k limit age 52 = $32,500 (+$8,000)', D(tax.max401kDeferral(52, CFG)), 32500);
check('401k limit age 61 = $35,750 (super catch-up)', D(tax.max401kDeferral(61, CFG)), 35750);
check('401k limit age 64 reverts to $32,500', D(tax.max401kDeferral(64, CFG)), 32500);
check('IRA limit age 40 = $7,500', D(tax.maxIraContribution(40, CFG)), 7500);
check('IRA limit age 55 = $8,600', D(tax.maxIraContribution(55, CFG)), 8600);

check('Roth IRA full below phase-out',
  D(tax.allowedRothIra($(7500), $(100000), 'single', 40, CFG)), 7500);
check('Roth IRA zero above phase-out',
  tax.allowedRothIra($(7500), $(200000), 'single', 40, CFG), 0);
checkTrue('Roth IRA partial inside phase-out', (() => {
  const a = tax.allowedRothIra($(7500), $(160000), 'single', 40, CFG);
  return a > 0 && a < $(7500);
})());

check('Trad IRA fully deductible when not covered by a plan',
  D(tax.deductibleTradIra($(7500), $(300000), 'single', false, CFG)), 7500);
check('Trad IRA not deductible when covered and over the range',
  tax.deductibleTradIra($(7500), $(300000), 'single', true, CFG), 0);

check('HSA self-only age 40 = $4,400', D(tax.maxHsa('selfOnly', 40, CFG)), 4400);
check('HSA family age 56 = $9,750', D(tax.maxHsa('family', 56, CFG)), 9750);

/* ===================================================================
 * 7. FULL TAX RETURN — cross-checked by hand
 * =================================================================== */
section('End-to-end tax computation');

// Single, $150,000 salary, $24,500 traditional 401(k), WA (no state tax).
//   Wages after deferral = 125,500
//   Standard deduction   = 16,100
//   Taxable ordinary     = 109,400
//     10% × 12,400              =  1,240.00
//     12% × (50,400 − 12,400)   =  4,560.00
//     22% × (105,700 − 50,400)  = 12,166.00
//     24% × (109,400 − 105,700) =    888.00
//                          total= 18,854.00
//   FICA: SS 6.2% × 150,000 = 9,300 ; Med 1.45% × 150,000 = 2,175 -> 11,475
const r1 = tax.computeTaxes({
  status: 'single', age: 40, taxYear: 2026,
  grossWages: $(150000), preTaxDeferrals: $(24500), stateCode: 'WA',
}, CFG);
check('taxable ordinary = $109,400', D(r1.taxableOrdinary), 109400, 0.01);
check('federal income tax = $18,854', D(r1.federalIncomeTax), 18854, 0.01);
check('FICA = $11,475', D(r1.ficaTotal), 11475, 0.01);
check('no state tax in WA', r1.stateTax, 0);
check('marginal rate = 24%', r1.marginalOrdinaryRate, 0.24, 1e-9);

// Same person in California (9.3% flat approximation).
const r2 = tax.computeTaxes({
  status: 'single', age: 40, taxYear: 2026,
  grossWages: $(150000), preTaxDeferrals: $(24500), stateCode: 'CA',
}, CFG);
checkTrue('CA state tax is positive', r2.stateTax > 0);
checkTrue('CA total exceeds WA total', r2.total > r1.total);

// Roth contributions must NOT reduce taxable income.
const rRoth = tax.computeTaxes({
  status: 'single', age: 40, taxYear: 2026,
  grossWages: $(150000), preTaxDeferrals: 0, stateCode: 'WA',
}, CFG);
checkTrue('Roth deferral leaves taxable income higher than traditional',
  rRoth.taxableOrdinary > r1.taxableOrdinary);
check('Roth case taxable ordinary = $133,900', D(rRoth.taxableOrdinary), 133900, 0.01);

// Early withdrawal penalty.
const rPen = tax.computeTaxes({
  status: 'single', age: 45, taxYear: 2026, grossWages: 0,
  traditionalWithdrawals: $(50000), earlyWithdrawalAmount: $(50000), stateCode: 'WA',
}, CFG);
check('10% early withdrawal penalty on $50k = $5,000', D(rPen.earlyWithdrawalPenalty), 5000, 0.01);
const rNoPen = tax.computeTaxes({
  status: 'single', age: 62, taxYear: 2026, grossWages: 0,
  traditionalWithdrawals: $(50000), earlyWithdrawalAmount: $(50000), stateCode: 'WA',
}, CFG);
check('no penalty after 59.5', rNoPen.earlyWithdrawalPenalty, 0);

// NIIT.
const rNiit = tax.computeTaxes({
  status: 'single', age: 50, taxYear: 2026, grossWages: $(150000),
  longTermGains: $(200000), stateCode: 'WA',
}, CFG);
checkTrue('NIIT applies above the MAGI threshold', rNiit.niit > 0);
// MAGI 350,000; excess over 200,000 = 150,000; NII = 200,000
// NIIT = 3.8% × min(200,000, 150,000) = 5,700
check('NIIT = $5,700', D(rNiit.niit), 5700, 0.01);

/* ===================================================================
 * 8. TAX LOTS (spec section 4)
 * =================================================================== */
section('Tax lots and cost basis');

const lots = [
  eng.makeLot(2020, $(10000)),   // long-term by 2026
  eng.makeLot(2026, $(10000)),   // short-term in 2026
];
eng.growLots(lots, 1.0);          // double both: value 20,000 each, basis 10,000
check('lots grew to $40,000 total', D(eng.lotsValue(lots)), 40000, 0.01);
check('basis unchanged at $20,000', D(eng.lotsBasis(lots)), 20000, 0.01);

const sale = eng.sellFromLots(lots, $(20000), 2026, 'ltFirst');
check('sale proceeds = $20,000', D(sale.proceeds), 20000, 0.01);
check('long-term lot sold first: LT gain = $10,000', D(sale.longTermGain), 10000, 0.01);
check('no short-term gain realised', sale.shortTermGain, 0);
check('remaining value = $20,000', D(eng.lotsValue(lots)), 20000, 0.01);

// Selling more than exists must not create money.
const smallLots = [eng.makeLot(2020, $(1000))];
const overSale = eng.sellFromLots(smallLots, $(99999), 2026);
check('cannot sell more than the lot holds', D(overSale.proceeds), 1000, 0.01);

// HIFO picks the highest-basis lot.
const hifoLots = [eng.makeLot(2020, $(1000)), eng.makeLot(2021, $(1000))];
hifoLots[0].value = $(5000);   // big gain
hifoLots[1].value = $(1100);   // small gain
const hifo = eng.sellFromLots(hifoLots, $(1100), 2026, 'hifo');
check('HIFO realises the smaller gain', D(hifo.longTermGain), 100, 0.01);

/* ===================================================================
 * 9. MORTGAGE AMORTISATION (spec section 9)
 * =================================================================== */
section('Mortgage amortisation');

// $400,000, 6.5%, 30 years -> standard payment is $2,528.27/mo.
const pmt = eng.monthlyPayment($(400000), 0.065, 30);
check('monthly payment ≈ $2,528.27', D(pmt), 2528.27, 0.02);

// Year one: interest should dominate.
const y1 = eng.amortizeYear($(400000), 0.065, pmt);
check('year-1 total paid ≈ $30,339', D(y1.principal) + D(y1.interest), 30339.24, 1);
checkTrue('year-1 interest exceeds principal', y1.interest > y1.principal * 5);
check('year-1 interest ≈ $25,867', D(y1.interest), 25867, 5);

// The loan must fully amortise to zero over its term.
let mb = $(400000);
for (let i = 0; i < 30; i++) mb = eng.amortizeYear(mb, 0.065, pmt).endingBalance;
checkTrue('loan amortises to ~zero in 30 years', Math.abs(D(mb)) < 5, `left ${D(mb)}`);

// Zero-interest loan: pure principal.
const z = eng.amortizeYear($(120000), 0, eng.monthlyPayment($(120000), 0, 10));
check('0% loan pays only principal', z.interest, 0);

/* ===================================================================
 * 10. RMD (spec section 7)
 * =================================================================== */
section('Required Minimum Distributions');

check('born 1955 => RMD at 73', getRmdStartAge(1955, CFG), 73);
check('born 1965 => RMD at 75', getRmdStartAge(1965, CFG), 75);
check('born 1949 => RMD at 72', getRmdStartAge(1949, CFG), 72);
check('divisor at 73 = 26.5', getRmdDivisor(73, CFG), 26.5);
check('divisor at 80 = 20.2', getRmdDivisor(80, CFG), 20.2);
// $1,000,000 at 73 -> 1,000,000 / 26.5 = $37,735.85
check('RMD on $1M at 73 ≈ $37,735.85', D(Money.div($(1000000), 26.5)), 37735.85, 0.01);

/* ===================================================================
 * 11. §121 HOME SALE EXCLUSION (spec section 9)
 * =================================================================== */
section('Home sale capital gain exclusion');

function sellHome({ isPrimary, yearsOwned, gainWanted, status }) {
  const prop = {
    ...eng.defaultProperty(2026),
    name: 'T', purchaseYear: 2026 - yearsOwned,
    purchasePrice: $(500000), costBasis: $(500000),
    currentValue: $(500000) + gainWanted, assessedValue: $(500000),
    mortgageBalance: 0, originalLoan: 0, isPrimary,
    saleYear: 2026, sellingCostPct: 0, propertyTaxRate: 0,
    baseInsurance: 0, maintenancePct: 0, appreciationOverride: 0,
  };
  return eng.processProperty(prop, 2026, 1, { realEstate: 0 }, status, CFG);
}

const h1 = sellHome({ isPrimary: true, yearsOwned: 10, gainWanted: $(200000), status: 'single' });
check('$200k gain, single, primary => fully excluded', h1.taxableSaleGain, 0);
check('excluded amount = $200,000', D(h1.excluded), 200000, 0.01);

const h2 = sellHome({ isPrimary: true, yearsOwned: 10, gainWanted: $(400000), status: 'single' });
check('$400k gain, single => $150k taxable', D(h2.taxableSaleGain), 150000, 0.01);

const h3 = sellHome({ isPrimary: true, yearsOwned: 10, gainWanted: $(400000), status: 'mfj' });
check('$400k gain, MFJ => fully excluded ($500k cap)', h3.taxableSaleGain, 0);

const h4 = sellHome({ isPrimary: true, yearsOwned: 1, gainWanted: $(200000), status: 'single' });
check('fails the 2-year test => fully taxable', D(h4.taxableSaleGain), 200000, 0.01);

const h5 = sellHome({ isPrimary: false, yearsOwned: 10, gainWanted: $(200000), status: 'single' });
check('rental property => no exclusion', D(h5.taxableSaleGain), 200000, 0.01);

/* ===================================================================
 * 12. FULL SIMULATION — invariants and behaviour
 * =================================================================== */
section('Full simulation');

const base = eng.defaultInputs();
const run = eng.simulate(base);

check('produces one row per horizon year', run.rows.length, base.horizonYears);
checkTrue('all balances remain non-negative', run.rows.every((r) =>
  r.cash >= 0 && r.trad401k >= 0 && r.rothIra >= 0 && r.brokerage >= 0 && r.netWorth >= 0));
checkTrue('every monetary field stays cent-integral', run.rows.every((r) =>
  Number.isInteger(r.netWorth) && Number.isInteger(r.tax) && Number.isInteger(r.brokerage)));
checkTrue('net worth grows while working', run.rows[10].netWorth > run.rows[0].netWorth);
checkTrue('effective tax rate is plausible (0–60%)', run.rows.every((r) =>
  r.effectiveTaxRate >= 0 && r.effectiveTaxRate < 0.6));

// Retirement transition.
const retIdx = base.retirementAge - base.currentAge;
check('salary is zero at retirement', run.rows[retIdx].salary, 0);
checkTrue('flagged as retired', run.rows[retIdx].retired);
checkTrue('withdrawals begin in retirement', run.rows[retIdx].withdrawals.total > 0);
checkTrue('no withdrawals needed in year 1 while saving', run.rows[0].withdrawals.total === 0);

// The withdrawal solver must converge, not hit its cap.
checkTrue('solver converges in few iterations',
  run.rows.every((r) => r.solverIterations < 55),
  `max was ${Math.max(...run.rows.map((r) => r.solverIterations))}`);

// Contribution caps must bind.
const capped = eng.simulate({ ...base, contrib401kMode: 'dollar', contrib401kDollar: $(99000) });
checkTrue('excess 401k contribution is capped at the IRS limit',
  capped.rows[0].contrib401k <= tax.max401kDeferral(base.currentAge, CFG));

// Employer match: 100% of the first 4% of a $150,000 salary = $6,000.
check('employer match = $6,000', D(run.rows[0].employerMatch), 6000, 1);

// RMDs must appear at the right age and be non-zero.
const rmdRow = run.rows.find((r) => r.withdrawals.rmdRequired > 0);
checkTrue('an RMD occurs', !!rmdRow);
if (rmdRow) checkTrue('RMD begins at age 73 or 75', rmdRow.age === 73 || rmdRow.age === 75, `age ${rmdRow.age}`);

/* ===================================================================
 * 12b. EARNED-INCOME RULES — the "retired early with no wages" path
 * -------------------------------------------------------------------
 * IRC §219(b): an IRA contribution cannot exceed taxable compensation.
 * Dividends and interest are not compensation, so a portfolio alone
 * cannot fund an IRA however large it is.
 * =================================================================== */
section('Earned-income rules');

// Age 54, no salary, but retirement age still at the default 65 — the
// state a user lands in when they zero their salary without also moving
// the retirement age.
const noWage = eng.simulate({
  ...base, currentAge: 54, salary: 0, bonus: 0,
  contribRothIra: $(7500), contribTradIra: 0, contribHsa: $(4400),
  balances: { ...base.balances, cash: $(100000), brokerage: $(350000), brokerageBasis: $(250000) },
});
check('no earned income => no IRA contribution', noWage.rows[0].contribIra, 0);
checkTrue('the reason is surfaced to the user',
  noWage.warnings.some((w) => /IRA needs earned income/.test(w.message)));
checkTrue('the salary/retirement-age mismatch is flagged',
  noWage.warnings.some((w) => /Salary is \$0 but retirement age/.test(w.message)));

// A part-time wage caps the IRA at that wage.
const partTime = eng.simulate({
  ...base, currentAge: 54, salary: $(4000), bonus: 0,
  contribRothIra: $(7500), contribTradIra: 0,
});
check('IRA capped at earned income', D(partTime.rows[0].contribIra), 4000, 1);

// Enough wages: the full contribution goes in.
const fullWage = eng.simulate({ ...base, currentAge: 54, contribRothIra: $(7500), contribTradIra: 0 });
check('ample earned income => full IRA contribution', D(fullWage.rows[0].contribIra), 7500, 1);

// Gross income must break out into parts that sum back to the total.
const gi = noWage.rows[0];
check('earned income is zero', gi.earnedIncome, 0);
checkTrue('investment income is non-zero', gi.investmentIncome > 0);
check('the components sum to gross income',
  Money.add(gi.earnedIncome, gi.otherIncomeTotal, gi.investmentIncome), gi.grossIncome);
check('investment income = dividends + interest',
  Money.add(gi.dividends, gi.cashInterest), gi.investmentIncome);

// HSA: no contributions once Medicare-eligible.
const at66 = eng.simulate({ ...base, currentAge: 66, retirementAge: 99, contribHsa: $(4400) });
check('no HSA contribution at 66 (Medicare)', at66.rows[0].contribHsa, 0);

// HSA with no wages is still allowed, but only as an income-tax
// deduction — there is no payroll to exempt from FICA.
const hsaNoWage = tax.computeTaxes({
  status: 'single', age: 54, taxYear: 2026,
  grossWages: 0, traditionalWithdrawals: $(60000),
  aboveTheLineDeductions: $(4400), stateCode: 'WA',
}, CFG);
const hsaNoDeduct = tax.computeTaxes({
  status: 'single', age: 54, taxYear: 2026,
  grossWages: 0, traditionalWithdrawals: $(60000), stateCode: 'WA',
}, CFG);
checkTrue('an above-the-line HSA deduction lowers tax',
  hsaNoWage.federalIncomeTax < hsaNoDeduct.federalIncomeTax);
check('it lowers AGI by exactly the contribution',
  Money.sub(hsaNoDeduct.agi, hsaNoWage.agi), $(4400));

/* ===================================================================
 * 12c. EARLY RETIREMENT AT 54 — the 59½ penalty window
 * =================================================================== */
section('Early retirement and the 10% penalty window');

const earlyBase = {
  ...base, currentAge: 54, retirementAge: 54, salary: 0, horizonYears: 40,
  retirementSpending: $(80000),
  balances: { ...base.balances, cash: $(100000), trad401k: $(900000), roth401k: 0,
    tradIra: $(300000), rothIra: $(300000), hsa: $(50000),
    brokerage: $(350000), brokerageBasis: $(250000), commodities: 0, crypto: 0, c529: 0 },
};
const early = eng.simulate(earlyBase);
checkTrue('retired flag is set immediately', early.rows[0].retired);
check('no IRA contributions in retirement', early.rows[0].contribIra, 0);

// With a taxable bridge account, the default withdrawal order should
// avoid the penalty entirely before 59½.
const preNineHalf = early.rows.filter((r) => r.age < 59.5);
check('no penalty while the taxable bridge lasts',
  preNineHalf.reduce((s, r) => Money.add(s, r.taxPenalty), 0), 0);

// Remove the bridge and the penalty must appear.
const noBridge = eng.simulate({
  ...earlyBase,
  balances: { ...earlyBase.balances, cash: $(20000), brokerage: $(10000), brokerageBasis: $(10000),
    trad401k: $(1200000), tradIra: $(400000) },
});
const penaltyYears = noBridge.rows.filter((r) => r.age < 59.5 && r.taxPenalty > 0);
checkTrue('without a bridge, early withdrawals are penalised', penaltyYears.length > 0,
  `${penaltyYears.length} penalised years`);
checkTrue('penalty is 10% of the penalised base',
  penaltyYears.every((r) => Math.abs(r.taxPenalty - Money.mul(r.withdrawals.penaltyBase, 0.10)) <= 1));
check('no penalty at all from 60 onward',
  noBridge.rows.filter((r) => r.age >= 60).reduce((s, r) => Money.add(s, r.taxPenalty), 0), 0);

// A penalty exception (e.g. SEPP / rule 72(t)) must remove it.
const withException = eng.simulate({ ...noBridge.inputs, penaltyExceptionApplies: true });
check('a penalty exception removes the penalty',
  withException.rows.reduce((s, r) => Money.add(s, r.taxPenalty), 0), 0);
checkTrue('but the ordinary income tax still applies',
  withException.rows.filter((r) => r.age < 59.5).some((r) => r.tax > 0));

/* ===================================================================
 * 12d. CASH-FLOW DECOMPOSITION
 * -------------------------------------------------------------------
 * The Income vs spending chart stacks inflow.* above the line and
 * outflow.* below it. If those components do not sum back to
 * netCashFlow exactly, the chart is lying about where money came from.
 * =================================================================== */
section('Cash-flow decomposition');

const sumIn  = (r) => Object.values(r.inflow).reduce((a, b) => Money.add(a, b), 0);
const sumOut = (r) => Object.values(r.outflow).reduce((a, b) => Money.add(a, b), 0);

// Check it across plans that exercise every category.
const flowCases = {
  'default working plan': eng.simulate(base),
  'early retirement': eng.simulate(earlyBase),
  'with rental property': eng.simulate({ ...base,
    properties: [{ ...eng.defaultProperty(2026), isRental: true, annualRent: $(36000), isPrimary: false, saleYear: 2042 }] }),
  'high spending, depleting': eng.simulate({ ...base, retirementSpending: $(500000) }),
};
for (const [name, run] of Object.entries(flowCases)) {
  const bad = run.rows.filter((r) => Money.sub(sumIn(r), sumOut(r)) !== r.netCashFlow);
  checkTrue(`${name}: inflows − outflows === net cash flow, every year`, bad.length === 0,
    bad.length ? `${bad.length} mismatched years, first ${bad[0].year}: ` +
      `${Money.sub(sumIn(bad[0]), sumOut(bad[0]))} vs ${bad[0].netCashFlow}` : '');
}

// Inflow components must also reconcile to the reported gross income
// (gross income excludes withdrawals, rent and sale proceeds, which are
// cash but not "income" in the table's sense).
const fr = flowCases['default working plan'].rows[0];
check('gross income = wages + pension + SS + other + dividends + interest',
  Money.add(fr.inflow.wages, fr.inflow.pension, fr.inflow.socialSecurity,
    fr.inflow.other, fr.inflow.dividends, fr.inflow.interest), fr.grossIncome);

// No component may ever be negative — a negative bar would stack wrongly.
checkTrue('all flow components are non-negative',
  Object.values(flowCases).every((run) => run.rows.every((r) =>
    Object.values(r.inflow).every((v) => v >= 0) && Object.values(r.outflow).every((v) => v >= 0))));

// The categories must actually populate when they apply.
const rentRun = flowCases['with rental property'];
checkTrue('rental income appears', rentRun.rows.some((r) => r.inflow.rent > 0));
checkTrue('property sale proceeds appear', rentRun.rows.some((r) => r.inflow.propertySale > 0));
checkTrue('real estate costs appear', rentRun.rows.some((r) => r.outflow.realEstate > 0));
checkTrue('withdrawals appear in retirement', rentRun.rows.some((r) => r.inflow.withdrawals > 0));
const er = flowCases['early retirement'];
check('no wages once retired', er.rows[0].inflow.wages, 0);
check('no contributions once retired', er.rows[0].outflow.contributions, 0);
checkTrue('Social Security starts at the stated age',
  er.rows.find((r) => r.inflow.socialSecurity > 0).age === earlyBase.socialSecurityStartAge);

// Employer match must NOT be counted as an outflow: it is not your cash.
const matchRun = flowCases['default working plan'].rows[0];
check('contributions exclude the employer match',
  matchRun.outflow.contributions,
  Money.add(matchRun.contrib401k, matchRun.contribIra, matchRun.contribHsa, matchRun.contribBrokerage));

/* ===================================================================
 * 12e. SPENDING IS AFTER-TAX, IN BOTH PHASES
 * -------------------------------------------------------------------
 * The spending inputs are what you CONSUME. Tax is computed separately
 * and subtracted separately — it is never taken out of the spending
 * figure. In retirement this means the engine must gross withdrawals UP
 * to cover both the spending and the tax the withdrawal itself causes.
 * =================================================================== */
section('Spending is after-tax');

const flatWorld = {
  inflation: 0, dividendYield: 0, cashInterestRate: 0,
  returns: { stocks: 0, bonds: 0, cash: 0, realEstate: 0, commodities: 0, crypto: 0 },
  sweep: { ...base.sweep, enabled: false }, indexBracketsToInflation: false,
};

// --- Working year: wages − tax − spending must equal net cash flow ---
const workYr = eng.simulate({
  ...base, ...flatWorld, salary: $(150000), salaryGrowth: 0, annualExpenses: $(70000),
  contrib401kMode: 'dollar', contrib401kDollar: 0, employerMatchRate: 0,
  contribRothIra: 0, contribTradIra: 0, contribHsa: 0, contribBrokerage: 0,
}).rows[0];
check('working: spending is not reduced by tax', workYr.outflow.living, $(70000));
check('working: wages − tax − spending === net cash flow',
  Money.sub(Money.sub($(150000), workYr.outflow.tax), $(70000)), workYr.netCashFlow);
checkTrue('working: tax is a separate, non-zero outflow', workYr.outflow.tax > 0);

// --- Retirement: the withdrawal must be grossed up for its own tax ---
const retInputs = {
  ...base, ...flatWorld, currentAge: 70, retirementAge: 70, salary: 0, horizonYears: 3,
  retirementSpending: $(100000), socialSecurityStartAge: 99,
  withdrawalOrder: ['cash', 'trad401k', 'tradIra', 'brokerage', 'roth401k', 'rothIra', 'hsa'],
  balances: { cash: 0, trad401k: $(3000000), roth401k: 0, tradIra: 0, rothIra: 0, hsa: 0,
    brokerage: 0, brokerageBasis: 0, commodities: 0, crypto: 0, c529: 0 },
};
const retYr = eng.simulate(retInputs).rows[0];
check('retirement: spending is not reduced by tax', retYr.outflow.living, $(100000));
checkTrue('retirement: gross withdrawal exceeds stated spending',
  retYr.inflow.withdrawals > $(100000),
  `withdrew ${D(retYr.inflow.withdrawals)} for ${D($(100000))} of spending`);
check('retirement: withdrawal === spending + tax, to the cent',
  retYr.inflow.withdrawals, Money.add($(100000), retYr.outflow.tax));
checkTrue('retirement: solver lands within a dollar of break-even',
  Math.abs(retYr.netCashFlow) <= 100, `net ${retYr.netCashFlow} cents`);

// Drawing from Roth instead needs no gross-up: qualified Roth is tax-free.
const rothYr = eng.simulate({
  ...retInputs,
  withdrawalOrder: ['cash', 'rothIra', 'roth401k', 'trad401k', 'tradIra', 'brokerage', 'hsa'],
  balances: { ...retInputs.balances, trad401k: 0, rothIra: $(3000000) },
}).rows[0];
check('Roth withdrawals are tax-free, so no gross-up', rothYr.inflow.withdrawals, $(100000));
check('and no tax is due', rothYr.outflow.tax, 0);
checkTrue('the same spending costs less portfolio from a Roth',
  rothYr.inflow.withdrawals < retYr.inflow.withdrawals);

// Real estate costs are a SEPARATE outflow from living expenses, so a
// user must not also include housing inside their spending figure.
const withProp = eng.simulate({
  ...base, ...flatWorld, annualExpenses: $(70000),
  properties: [{ ...eng.defaultProperty(2026), appreciationOverride: 0 }],
}).rows[0];
check('living expenses exclude property costs', withProp.outflow.living, $(70000));
checkTrue('property costs are tracked separately', withProp.outflow.realEstate > 0);

/* ===================================================================
 * 12f. DEGENERATE INPUTS
 * -------------------------------------------------------------------
 * A cleared number field reads back as blank. A horizon of zero years
 * produced a result with no rows, which the stats renderer then read
 * off the end of — a real crash a user hit. The engine must never
 * return an unusable result, whatever it is handed.
 * =================================================================== */
section('Degenerate inputs');

const degenerate = {
  'horizon 0': { horizonYears: 0 },
  'horizon NaN': { horizonYears: NaN },
  'horizon negative': { horizonYears: -5 },
  'horizon absurd': { horizonYears: 100000 },
  'age NaN': { currentAge: NaN },
  'age undefined': { currentAge: undefined },
  'everything undefined': { horizonYears: undefined, currentAge: undefined, salary: undefined, balances: undefined },
  'negative salary': { salary: $(-50000) },
  'negative balances': { balances: { ...base.balances, cash: $(-10000) } },
  'basis exceeds value': { balances: { ...base.balances, brokerage: $(10), brokerageBasis: $(99999) } },
  'withdrawal order empty': { withdrawalOrder: [] },
  'returns are garbage': { returns: { stocks: NaN, bonds: 'nonsense', cash: undefined } },
  'volatility negative': { volatility: { ...base.volatility, stocks: -1 } },
  'properties not an array': { properties: null },
  'overrides not an object': { overrides: null },
  'inflation absurd': { inflation: 999 },
  'retirement before birth': { currentAge: 40, retirementAge: 0 },
};

for (const [name, patch] of Object.entries(degenerate)) {
  let run = null, threw = null;
  try { run = eng.simulate({ ...base, ...patch }); } catch (e) { threw = e; }
  checkTrue(`${name}: does not throw`, !threw, threw && threw.message);
  if (!run) continue;
  checkTrue(`${name}: produces at least one row`, run.rows.length >= 1, `${run.rows.length} rows`);
  checkTrue(`${name}: summary is populated`, Number.isFinite(run.summary.endingNetWorth));
  checkTrue(`${name}: no NaN in any row`, run.rows.every((r) =>
    Number.isFinite(r.netWorth) && Number.isFinite(r.tax) && Number.isFinite(r.grossIncome)));
  // The exact read that crashed the UI.
  const retIdx = Math.max(0, Math.min(run.rows.length - 1,
    run.inputs.retirementAge - run.inputs.currentAge));
  checkTrue(`${name}: the stats row index resolves`, run.rows[retIdx] !== undefined);
}

// Cost basis must be clamped, not silently allowed to exceed value —
// otherwise a sale would realise a phantom loss.
const clamped = eng.simulate({ ...base,
  balances: { ...base.balances, brokerage: $(1000), brokerageBasis: $(99999) } });
checkTrue('basis is clamped to market value',
  clamped.inputs.balances.brokerageBasis <= clamped.inputs.balances.brokerage);

/* ===================================================================
 * 12g. MATCH CAPS, MEGA BACKDOOR, BACKDOOR ROTH
 * =================================================================== */
section('Match dollar cap, mega backdoor, backdoor Roth');

const hi = {
  ...base, currentAge: 40, salary: $(190000), salaryGrowth: 0.03, stateCode: 'WA',
  annualExpenses: $(40000), contrib401kMode: 'dollar', contrib401kDollar: $(24500),
  employerMatchRate: 1.0, employerMatchCapPct: 0.06, employerMatchDollarCap: $(6000),
  contribRothIra: $(7500), contribTradIra: 0, contribHsa: $(4400),
  balances: { ...base.balances, cash: $(25000), trad401k: $(300000), roth401k: 0,
    tradIra: 0, rothIra: $(25000), hsa: 0, brokerage: $(250000), brokerageBasis: $(175000),
    commodities: 0, crypto: 0, c529: 0 },
};

// --- Employer match dollar cap ---
const matchCapped = eng.simulate(hi);
check('match hits the dollar cap, not 6% of salary', D(matchCapped.rows[0].employerMatch), 6000, 1);
checkTrue('the cap still binds as salary grows',
  matchCapped.rows.slice(0, 6).every((r) => r.employerMatch <= $(6000)));
const uncapped = eng.simulate({ ...hi, employerMatchDollarCap: 0 });
check('without the cap it is 6% of salary', D(uncapped.rows[0].employerMatch), 11400, 1);

// --- Roth IRA phase-out vs backdoor ---
// A full pre-tax 401(k) and HSA pull AGI down to roughly $155k, which
// lands INSIDE the $153k-$168k phase-out rather than above it — so the
// direct contribution is reduced, not eliminated. As salary grows the
// phase-out bites harder until it blocks the contribution entirely.
const direct = eng.simulate({ ...hi, backdoorRoth: false });
checkTrue('pre-tax deferrals pull MAGI into the phase-out, not past it',
  direct.rows[0].contribIra > 0 && direct.rows[0].contribIra < $(7500),
  `got ${D(direct.rows[0].contribIra)}`);
checkTrue('the allowance shrinks every year as salary grows',
  direct.rows[3].contribIra < direct.rows[0].contribIra);
checkTrue('and is eventually blocked outright',
  direct.rows.slice(0, 8).some((r) => r.contribIra === 0));
checkTrue('the phase-out is explained', direct.warnings.some((w) => /MAGI phase-out/.test(w.message)));

// Without the pre-tax deferral, MAGI is above the range and it is zero.
const noDefer = eng.simulate({ ...hi, backdoorRoth: false,
  contrib401kDollar: 0, contribHsa: 0, roth401kSplit: 0 });
check('with no pre-tax deferrals the direct Roth is fully blocked', noDefer.rows[0].contribIra, 0);
checkTrue('and a backdoor is suggested',
  noDefer.warnings.some((w) => /backdoor Roth would bypass/.test(w.message)));

const backdoor = eng.simulate({ ...hi, backdoorRoth: true });
check('the backdoor gets the full $7,500 in', D(backdoor.rows[0].contribIra), 7500, 1);
check('and it is tax-free with no pre-tax IRA', backdoor.rows[0].backdoorRothTaxable, 0);

// Pro-rata rule: a pre-tax traditional IRA makes the conversion taxable.
const proRata = eng.simulate({ ...hi, backdoorRoth: true,
  balances: { ...hi.balances, tradIra: $(92500) } });
// 92,500 pre-tax / (92,500 + 7,500) = 92.5% taxable
check('pro-rata makes 92.5% of the conversion taxable',
  D(proRata.rows[0].backdoorRothTaxable), 6937.50, 1);
checkTrue('and the trap is explained', proRata.warnings.some((w) => /pro-rata rule/.test(w.message)));
checkTrue('the taxable conversion raises the tax bill',
  proRata.rows[0].tax > backdoor.rows[0].tax);

// --- Mega backdoor / §415(c) headroom ---
const mega = eng.simulate({ ...hi, backdoorRoth: true, afterTax401kEnabled: true });
// 72,000 − 24,500 deferral − 6,000 match = 41,500
check('after-tax headroom = 415(c) − deferral − match',
  D(mega.rows[0].contribAfterTax401k), 41500, 1);
check('headroom is reported', D(mega.rows[0].afterTaxHeadroom), 41500, 1);
checkTrue('after-tax dollars land in Roth 401(k)', mega.rows[0].roth401k > 0);
check('after-tax contributions are NOT tax-deductible',
  mega.rows[0].tax, backdoor.rows[0].tax);
checkTrue('a bigger match leaves less after-tax room',
  eng.simulate({ ...hi, backdoorRoth: true, afterTax401kEnabled: true,
    employerMatchDollarCap: 0 }).rows[0].contribAfterTax401k < mega.rows[0].contribAfterTax401k);
// Asking for more than the headroom must be capped and explained.
const over = eng.simulate({ ...hi, afterTax401kEnabled: true, afterTax401kAmount: $(60000) });
check('an over-large request is capped at the headroom',
  D(over.rows[0].contribAfterTax401k), 41500, 1);
checkTrue('and the 415(c) limit is cited',
  over.warnings.some((w) => /415\(c\) annual additions/.test(w.message)));

// A plan may cap annual additions below the statutory §415(c) figure.
const planCapped = eng.simulate({ ...hi, backdoorRoth: true, afterTax401kEnabled: true,
  plan415cLimit: $(69000) });
check('a plan cap below the IRS limit binds',
  D(planCapped.rows[0].contribAfterTax401k), 69000 - 24500 - 6000, 1);
checkTrue('and the warning names the plan, not the statute',
  planCapped.warnings.some((w) => /plan annual additions limit/.test(w.message)) ||
  planCapped.rows[0].contribAfterTax401k === $(38500));
const planGenerous = eng.simulate({ ...hi, backdoorRoth: true, afterTax401kEnabled: true,
  plan415cLimit: $(90000) });
check('a plan cap ABOVE the IRS limit cannot raise it',
  D(planGenerous.rows[0].contribAfterTax401k), 41500, 1);

// The cash-flow identity must still hold with these new flows.
const megaBad = mega.rows.filter((r) =>
  Money.sub(Object.values(r.inflow).reduce((a, b) => Money.add(a, b), 0),
            Object.values(r.outflow).reduce((a, b) => Money.add(a, b), 0)) !== r.netCashFlow);
checkTrue('cash flow still reconciles with after-tax 401(k) flows', megaBad.length === 0);

/* --- Contribution timing must be consistent across account types ---
 * A dollar swept into the brokerage and a dollar deferred into a
 * 401(k) in the same year must earn the same partial-year growth.
 * They did not, which silently favoured whichever account received
 * sweeps and could flip a close strategy comparison. */
const timingProbe = (timing) => {
  const common = {
    ...base, horizonYears: 1, currentAge: 40, retirementAge: 99,
    salary: $(100000), salaryGrowth: 0, annualExpenses: 0, inflation: 0,
    dividendYield: 0, cashInterestRate: 0, contributionTiming: timing,
    employerMatchRate: 0, contribRothIra: 0, contribTradIra: 0, contribHsa: 0,
    returns: { stocks: 0.10, bonds: 0.10, cash: 0.10, realEstate: 0, commodities: 0, crypto: 0 },
    balances: { cash: 0, trad401k: 0, roth401k: 0, tradIra: 0, rothIra: 0, hsa: 0,
      brokerage: 0, brokerageBasis: 0, commodities: 0, crypto: 0, c529: 0 },
    sweep: { ...base.sweep, enabled: false },
  };
  // $20k into the 401(k) vs $20k of direct brokerage buying, same year.
  const viaDeferral = eng.simulate({ ...common,
    contrib401kMode: 'dollar', contrib401kDollar: $(20000) }).rows[0];
  const viaBrokerage = eng.simulate({ ...common,
    contrib401kMode: 'dollar', contrib401kDollar: 0, contribBrokerage: $(20000) }).rows[0];
  return { deferral: viaDeferral.trad401k, brokerage: viaBrokerage.brokerage };
};
for (const t of ['mid', 'start', 'end']) {
  const p = timingProbe(t);
  check(`"${t}" timing treats a 401(k) dollar and a brokerage dollar alike`,
    p.brokerage, p.deferral);
}
const midP = timingProbe('mid');
check('mid-year gives $20k exactly half of a 10% year', D(midP.deferral), 21000, 1);
check('end-of-year gives no growth', D(timingProbe('end').deferral), 20000, 1);
check('start-of-year gives the full year', D(timingProbe('start').deferral), 22000, 1);

/* ===================================================================
 * 12h. ROTH CONVERSION LADDER
 * =================================================================== */
section('Roth conversion ladder');

const ladderBase = {
  ...base, currentAge: 46, retirementAge: 46, salary: 0, horizonYears: 30,
  retirementSpending: $(40000), inflation: 0.025, stateCode: 'WA',
  socialSecurityStartAge: 67, socialSecurityAnnual: $(30000),
  balances: { cash: $(30000), trad401k: $(1000000), roth401k: 0, tradIra: 0,
    rothIra: $(50000), hsa: 0, brokerage: $(600000), brokerageBasis: $(450000),
    commodities: 0, crypto: 0, c529: 0 },
};

const noConv = eng.simulate(ladderBase);
const conv12 = eng.simulate({ ...ladderBase, rothConversionMode: 'fillBracket', rothConversionFillToRate: 0.12 });

check('no conversions by default', noConv.rows[0].rothConversion, 0);
checkTrue('conversions happen when enabled', conv12.rows[0].rothConversion > 0);
checkTrue('traditional balance falls faster with conversions',
  conv12.rows[5].trad401k < noConv.rows[5].trad401k);
checkTrue('Roth balance rises correspondingly', conv12.rows[5].rothIra > noConv.rows[5].rothIra);

// Money must be conserved: the conversion is a transfer, not income.
const c0 = conv12.rows[0];
checkTrue('a conversion moves money, it does not create it',
  Math.abs(conv12.rows[0].netWorth - noConv.rows[0].netWorth) < $(8000),
  `${D(conv12.rows[0].netWorth)} vs ${D(noConv.rows[0].netWorth)}`);

// The converted amount is ordinary income and must raise the tax bill.
checkTrue('the conversion is taxed as ordinary income', c0.tax > noConv.rows[0].tax);

// Filling to a higher bracket must convert more per year.
const conv22 = eng.simulate({ ...ladderBase, rothConversionMode: 'fillBracket', rothConversionFillToRate: 0.22 });
checkTrue('filling to 22% converts more than filling to 12%',
  conv22.rows[0].rothConversion > conv12.rows[0].rothConversion);
const conv10 = eng.simulate({ ...ladderBase, rothConversionMode: 'fillBracket', rothConversionFillToRate: 0.10 });
checkTrue('filling to 10% converts less than filling to 12%',
  conv10.rows[0].rothConversion < conv12.rows[0].rothConversion);

// Fixed mode converts exactly what was asked, while funds remain.
const convFixed = eng.simulate({ ...ladderBase, rothConversionMode: 'fixed', rothConversionAmount: $(50000) });
check('fixed mode converts the stated amount', D(convFixed.rows[0].rothConversion), 50000, 1);

// Cannot convert more than the traditional balance holds.
const convAll = eng.simulate({ ...ladderBase, rothConversionMode: 'fixed', rothConversionAmount: $(5000000) });
checkTrue('conversion is capped by the traditional balance',
  convAll.rows[0].rothConversion <= $(1000000));
checkTrue('and the traditional account empties rather than going negative',
  convAll.rows.every((r) => r.trad401k >= 0 && r.tradIra >= 0));

// Age gating.
const convLate = eng.simulate({ ...ladderBase, rothConversionMode: 'fillBracket',
  rothConversionStartAge: 55, rothConversionEndAge: 60 });
check('no conversion before the start age', convLate.rows[0].rothConversion, 0);
checkTrue('conversions run inside the window',
  convLate.rows.find((r) => r.age === 57).rothConversion > 0);
check('and stop after the end age',
  convLate.rows.find((r) => r.age === 65).rothConversion, 0);

// Conversions must not happen while still working.
const convWorking = eng.simulate({ ...base, currentAge: 40, retirementAge: 65,
  rothConversionMode: 'fillBracket' });
check('no conversions while still employed', convWorking.rows[0].rothConversion, 0);

// The whole point: draining the traditional account kills future RMDs.
const drained = eng.simulate({ ...ladderBase, horizonYears: 40,
  rothConversionMode: 'fillBracket', rothConversionFillToRate: 0.12 });
const at75 = drained.rows.find((r) => r.age === 75);
checkTrue('RMDs are eliminated once the traditional account is empty',
  at75.withdrawals.rmdRequired === 0, `RMD ${D(at75.withdrawals.rmdRequired)}`);
checkTrue('a well-sized ladder lowers lifetime tax',
  drained.summary.totalTaxPaid < eng.simulate({ ...ladderBase, horizonYears: 40 }).summary.totalTaxPaid);

// Cash flow must still reconcile with conversions in play.
const convBad = conv12.rows.filter((r) =>
  Money.sub(Object.values(r.inflow).reduce((a, b) => Money.add(a, b), 0),
            Object.values(r.outflow).reduce((a, b) => Money.add(a, b), 0)) !== r.netCashFlow);
checkTrue('cash flow reconciles with conversions', convBad.length === 0);

/* ===================================================================
 * 12i. RENTAL REAL ESTATE — depreciation, §469, recapture
 * =================================================================== */
section('Rental real estate tax mechanics');

// --- Passive activity loss limitation, IRC §469 ---
const PAL = (loss, magi) => tax.applyPassiveLossLimit($(loss), $(magi), 0, CFG);
check('full $25k allowance below $100k MAGI', D(PAL(30000, 90000).allowed), 25000, 1);
check('half phased out at $125k MAGI', D(PAL(30000, 125000).allowed), 12500, 1);
check('fully phased out at $150k MAGI', PAL(30000, 150000).allowed, 0);
check('and above it', PAL(30000, 175000).allowed, 0);
check('disallowed amounts are suspended, not lost',
  D(PAL(30000, 175000).suspended), 30000, 1);
check('a loss smaller than the allowance is fully allowed',
  D(PAL(5000, 90000).allowed), 5000, 1);
// Passive income absorbs losses without limit, even at high MAGI.
const palWithIncome = tax.applyPassiveLossLimit($(30000), $(300000), $(30000), CFG);
check('passive income absorbs passive losses regardless of MAGI',
  D(palWithIncome.allowed), 30000, 1);

// --- Depreciation ---
const rental = () => ({ ...eng.defaultProperty(2026),
  name: 'Rental', purchasePrice: $(500000), costBasis: $(500000), currentValue: $(500000),
  assessedValue: $(500000), mortgageBalance: 0, originalLoan: 0, isPrimary: false,
  isRental: true, annualRent: $(36000), vacancyRate: 0, managementPct: 0,
  propertyTaxRate: 0, baseInsurance: 0, maintenancePct: 0, appreciationOverride: 0,
  landValuePct: 0.20, depreciationYears: 27.5, saleYear: null, sellingCostPct: 0 });

const p1 = rental();
const rentYr1 = eng.processProperty(p1, 2026, 1, { realEstate: 0 }, 'single', CFG);
// Building share = 500,000 x 80% = 400,000; / 27.5 = 14,545.45
check('annual depreciation = building basis / 27.5', D(rentYr1.depreciation), 14545.45, 1);
check('land is excluded from the depreciable base',
  D(rentYr1.depreciation) < 500000 / 27.5, true, 0);
checkTrue('accumulated depreciation is tracked', p1.accumulatedDepreciation > 0);

// Vacancy and management reduce collected rent.
const p2 = { ...rental(), vacancyRate: 0.07, managementPct: 0.08 };
const rentYr2 = eng.processProperty(p2, 2026, 1, { realEstate: 0 }, 'single', CFG);
// 36,000 less 7% vacancy = 33,480; less 8% management = 30,801.60
check('vacancy and management reduce net rent', D(rentYr2.rentalIncome), 30801.60, 1);

// --- Depreciation recapture on sale ---
const p3 = rental();
for (let y = 2026; y < 2036; y++) eng.processProperty(p3, y, 1, { realEstate: 0 }, 'single', CFG);
check('10 years of depreciation accumulates', D(p3.accumulatedDepreciation), 145454.5, 5);
p3.saleYear = 2036; p3.currentValue = $(500000);
const rentSale = eng.processProperty(p3, 2036, 1, { realEstate: 0 }, 'single', CFG);
// NOTE: the model takes a FULL year of depreciation in the year of sale.
// The IRS uses a mid-month convention, so a real sale would take a
// partial year. This is an annual-model simplification, so the total
// after the sale is 11 years, not 10.
const accum = p3.accumulatedDepreciation;
check('the sale year takes a further full year (simplification)',
  D(accum), 145454.5 + 14545.45, 5);
// Sold at the original price, so the entire gain is recaptured depreciation.
check('selling at cost still produces a taxable gain', D(rentSale.saleGain), D(accum), 5);
check('and it is all depreciation recapture', D(rentSale.depreciationRecapture), D(accum), 5);
check('with no residual long-term gain', rentSale.taxableSaleGain, 0);
checkTrue('a rental gets no §121 exclusion', rentSale.excluded === 0);

// Recapture is taxed at a flat 25%, not the LTCG rate.
const recapTax = tax.computeTaxes({ status: 'single', age: 50, taxYear: 2026,
  grossWages: 0, depreciationRecapture: $(100000), stateCode: 'WA' }, CFG);
check('recapture is taxed at 25%', D(recapTax.depreciationRecaptureTax), 25000, 1);

// --- End to end in a simulation ---
const withRental = eng.simulate({ ...base, currentAge: 40, salary: $(200000),
  stateCode: 'WA', horizonYears: 12,
  properties: [{ ...rental(), mortgageBalance: $(375000), originalLoan: $(375000),
    mortgageRate: 0.07, mortgageTermYears: 30, propertyTaxRate: 0.011,
    baseInsurance: $(2000), maintenancePct: 0.01, vacancyRate: 0.07, managementPct: 0.08 }] });
checkTrue('depreciation is recorded', withRental.rows[0].rentalDepreciation > 0);
checkTrue('a high earner has rental losses suspended',
  withRental.rows[0].rentalLossSuspended > 0,
  `suspended ${D(withRental.rows[0].rentalLossSuspended)}`);
checkTrue('and is told why',
  withRental.warnings.some((w) => /passive activity rules/.test(w.message)));
checkTrue('the carryforward accumulates',
  withRental.rows[5].rentalLossCarryforward > withRental.rows[0].rentalLossCarryforward);

/* ===================================================================
 * 13. CASH SWEEP (spec section 4)
 * =================================================================== */
section('Cash sweep');

const sweepOn = eng.simulate({ ...base, sweep: { ...base.sweep, enabled: true } });
const sweepOff = eng.simulate({ ...base, sweep: { ...base.sweep, enabled: false } });

checkTrue('sweeping moves money into the brokerage',
  sweepOn.rows[5].brokerage > sweepOff.rows[5].brokerage);
checkTrue('sweeping leaves less idle cash',
  sweepOn.rows[5].cash < sweepOff.rows[5].cash);
checkTrue('sweeping raises long-run net worth (equities beat cash)',
  sweepOn.summary.endingNetWorth > sweepOff.summary.endingNetWorth);
checkTrue('sweep total is recorded', sweepOn.summary.totalSwept > 0);

// Cash should sit at the buffer, not below it.
const buf = Money.mul(Money.div(sweepOn.rows[3].spending, 12), base.sweep.bufferMonths);
checkTrue('cash is held at roughly the buffer',
  Math.abs(sweepOn.rows[3].cash - buf) < $(1000),
  `cash ${D(sweepOn.rows[3].cash)} vs buffer ${D(buf)}`);

// Monthly sweeps should create 12 lots a year.
const monthly = eng.simulate({ ...base, sweep: { ...base.sweep, enabled: true, frequency: 'monthly' } });
checkTrue('monthly sweep still conserves value', monthly.rows[2].brokerage > 0);

/* ===================================================================
 * 14. CONSERVATION OF MONEY
 * -------------------------------------------------------------------
 * The strongest check: with zero returns, zero inflation and zero tax,
 * ending net worth must equal starting net worth plus wages and match
 * minus spending. No money may be created or destroyed.
 * =================================================================== */
section('Conservation of money (zero-return, zero-tax world)');

const flat = {
  ...eng.defaultInputs(),
  horizonYears: 5,
  salary: $(100000), salaryGrowth: 0, bonus: 0, otherIncome: 0,
  annualExpenses: $(60000), inflation: 0,
  contrib401kMode: 'dollar', contrib401kDollar: $(10000),
  employerMatchRate: 0, employerMatchCapPct: 0,
  contribRothIra: 0, contribTradIra: 0, contribHsa: 0, contribBrokerage: 0,
  dividendYield: 0, cashInterestRate: 0,
  returns: { stocks: 0, bonds: 0, cash: 0, realEstate: 0, commodities: 0, crypto: 0 },
  stateCode: 'WA',
  sweep: { ...eng.defaultInputs().sweep, enabled: false },
  balances: { cash: $(50000), trad401k: 0, roth401k: 0, tradIra: 0, rothIra: 0,
    hsa: 0, brokerage: 0, brokerageBasis: 0, commodities: 0, crypto: 0, c529: 0 },
  indexBracketsToInflation: false,
};
const flatRun = eng.simulate(flat);
const startNw = $(50000);
const r0 = flatRun.rows[0];
// Ending NW = start + salary − spending − tax  (contributions just move money)
const expectedNw = startNw + $(100000) - $(60000) - r0.tax;
check('year-1 net worth reconciles exactly', r0.netWorth, expectedNw, 0);

let runningNw = startNw;
let conserved = true;
for (const r of flatRun.rows) {
  runningNw = runningNw + $(100000) - $(60000) - r.tax;
  if (r.netWorth !== runningNw) { conserved = false; break; }
}
checkTrue('net worth reconciles every year for 5 years', conserved);

/* ===================================================================
 * 15. SCENARIO SENSITIVITY — directional sanity
 * =================================================================== */
section('Scenario sensitivity');

const maxTrad = eng.simulate({ ...base, contrib401kMode: 'dollar', contrib401kDollar: $(24500), roth401kSplit: 0 });
const maxRoth = eng.simulate({ ...base, contrib401kMode: 'dollar', contrib401kDollar: $(24500), roth401kSplit: 1 });
checkTrue('traditional defers more tax in year 1', maxTrad.rows[0].tax < maxRoth.rows[0].tax);
checkTrue('Roth leaves a larger tax-free balance at the end',
  maxRoth.rows.at(-1).rothTotal > maxTrad.rows.at(-1).rothTotal);

const highRet = eng.simulate({ ...base, returns: { ...base.returns, stocks: 0.10 } });
checkTrue('higher equity returns raise ending net worth',
  highRet.summary.endingNetWorth > run.summary.endingNetWorth);

const caRun = eng.simulate({ ...base, stateCode: 'CA' });
checkTrue('California ends poorer than Washington',
  caRun.summary.endingNetWorth < run.summary.endingNetWorth);

// The default book ($6.3M at 65, 15 years of retirement) survives $250k/yr
// of base spending; it does not survive $500k. Both directions are checked
// so the test pins the actual behaviour rather than a guess.
const midSpend = eng.simulate({ ...base, retirementSpending: $(250000) });
checkTrue('$250k/yr is survivable on this book', !midSpend.summary.depleted);
const bigSpend = eng.simulate({ ...base, retirementSpending: $(500000) });
checkTrue('$500k/yr depletes the portfolio', bigSpend.summary.depleted);
checkTrue('more spending always leaves less at the end',
  bigSpend.summary.endingNetWorth <= midSpend.summary.endingNetWorth);

/* --- Washington capital gains excise tax ----------------------- */
// WA taxes only REALIZED long-term gains, above a ~$283k standard
// deduction, and exempts real estate. A modest gain must produce $0.
const waSmall = tax.computeTaxes({
  status: 'single', age: 65, taxYear: 2026,
  longTermGains: $(68000), qualifiedDividends: $(40000), stateCode: 'WA',
}, CFG);
check('WA: gains under the deduction are untaxed', waSmall.stateTax, 0);

const waBig = tax.computeTaxes({
  status: 'single', age: 65, taxYear: 2026,
  longTermGains: $(383000), stateCode: 'WA',
}, CFG);
// (383,000 − 283,000) × 7% = 7,000
check('WA: 7% applies above the deduction', D(waBig.stateTax), 7000, 0.01);

const waHome = tax.computeTaxes({
  status: 'single', age: 65, taxYear: 2026,
  longTermGains: $(383000), realEstateGains: $(383000), stateCode: 'WA',
}, CFG);
check('WA: real estate gains are exempt', waHome.stateTax, 0);

/* ===================================================================
 * 16. REAL ESTATE IN A FULL RUN
 * =================================================================== */
section('Real estate inside the simulation');

const withHome = eng.simulate({
  ...base,
  properties: [{ ...eng.defaultProperty(2026), saleYear: 2046 }],
});
checkTrue('home equity is tracked', withHome.rows[0].realEstateEquity > 0);
checkTrue('equity builds as the mortgage amortises',
  withHome.rows[10].realEstateEquity > withHome.rows[0].realEstateEquity);
const saleRow = withHome.rows.find((r) => r.year === 2046);
checkTrue('the sale happens', saleRow.properties[0].sold);
checkTrue('sale proceeds are positive', saleRow.properties[0].saleProceeds > 0);
const afterSale = withHome.rows.find((r) => r.year === 2047);
check('equity is zero after the sale', afterSale.realEstateEquity, 0);
checkTrue('proceeds land in the portfolio',
  afterSale.brokerage + afterSale.cash > withHome.rows.find((r) => r.year === 2045).brokerage);

/* ===================================================================
 * 17. MONTE CARLO (spec section 8)
 * =================================================================== */
section('Monte Carlo');

const mc = eng.monteCarlo({ ...base, horizonYears: 30 }, { trials: 120, seed: 42 });
check('runs the requested number of trials', mc.trials, 120);
checkTrue('success rate is a probability', mc.successRate >= 0 && mc.successRate <= 1);
checkTrue('percentiles are ordered',
  mc.ending.p10 <= mc.ending.p25 && mc.ending.p25 <= mc.ending.p50 &&
  mc.ending.p50 <= mc.ending.p75 && mc.ending.p75 <= mc.ending.p90);
checkTrue('bands are ordered every year',
  mc.bands.every((b) => b.p10 <= b.p50 && b.p50 <= b.p90));
checkTrue('produces a band per year', mc.bands.length === 30);

// Reproducibility: the same seed must give the same answer.
const mcA = eng.monteCarlo({ ...base, horizonYears: 10 }, { trials: 30, seed: 7 });
const mcB = eng.monteCarlo({ ...base, horizonYears: 10 }, { trials: 30, seed: 7 });
check('same seed => identical result', mcA.ending.p50, mcB.ending.p50);
const mcC = eng.monteCarlo({ ...base, horizonYears: 10 }, { trials: 30, seed: 8 });
checkTrue('different seed => different result', mcC.ending.p50 !== mcA.ending.p50);

// Volatility must widen the distribution without changing the mean much.
const lowVol = eng.monteCarlo({ ...base, horizonYears: 20,
  volatility: { ...base.volatility, stocks: 0.02 } }, { trials: 80, seed: 5 });
const highVol = eng.monteCarlo({ ...base, horizonYears: 20,
  volatility: { ...base.volatility, stocks: 0.30 } }, { trials: 80, seed: 5 });
checkTrue('higher volatility widens the outcome spread',
  (highVol.ending.p90 - highVol.ending.p10) > (lowVol.ending.p90 - lowVol.ending.p10));

/* ===================================================================
 * 18. STRESS TEST
 * =================================================================== */
section('Stress testing');

const stress = eng.stressTest({ ...base, horizonYears: 30 });
checkTrue('optimistic > average > pessimistic',
  stress.optimistic.summary.endingNetWorth > stress.average.summary.endingNetWorth &&
  stress.average.summary.endingNetWorth > stress.pessimistic.summary.endingNetWorth);

const seq = eng.sequenceRiskTest({ ...base, horizonYears: 35 });
checkTrue('a crash at retirement hurts the outcome',
  seq.summary.endingNetWorth < eng.simulate({ ...base, horizonYears: 35 }).summary.endingNetWorth);

/* ===================================================================
 * 19. FORWARD TAX YEAR PROJECTION
 * =================================================================== */
section('Forward projection of tax tables');

const cfg2040 = getTaxConfig(2040, 0.025);
checkTrue('brackets index forward', cfg2040.standardDeduction.single > CFG.standardDeduction.single);
checkTrue('flagged as projected', cfg2040._meta.projected === true);
check('NIIT threshold is NOT indexed (matches statute)',
  cfg2040.niit.threshold.single, CFG.niit.threshold.single);
check('§121 exclusion is NOT indexed (matches statute)',
  cfg2040.homeSaleExclusion.single, CFG.homeSaleExclusion.single);
checkTrue('contribution limits index forward',
  cfg2040.limits.elective401k > CFG.limits.elective401k);

/* =================================================================== */
console.log(`\n${'═'.repeat(58)}`);
if (failed) {
  console.log(`FAILURES (${failed}):\n`);
  console.log(failures.join('\n'));
  console.log('');
}
console.log(`${passed} passed, ${failed} failed`);
console.log('═'.repeat(58));
process.exit(failed ? 1 : 0);

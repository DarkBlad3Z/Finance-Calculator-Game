/* ===================================================================
 * tax-config.js — VERSIONED TAX YEAR DATA
 * -------------------------------------------------------------------
 * Spec section 11: "Tax bracket and contribution limit tables should be
 * stored as versioned, easily-updatable config data (e.g. JSON per tax
 * year), not hardcoded, since these change annually."
 *
 * >>> THIS IS THE ONLY FILE YOU NEED TO EDIT FOR A NEW TAX YEAR. <<<
 *
 * HOW TO ADD A TAX YEAR
 *   1. Copy the most recent year block below.
 *   2. Change the key (e.g. 2027) and update every figure.
 *   3. Update `_meta.source` and `_meta.verifiedOn`.
 *   4. Move anything you could not verify into `_meta.unverified`.
 *   That's it — the engine picks up new years automatically.
 *
 * UNITS
 *   Every MONEY figure is an INTEGER NUMBER OF CENTS (see money.js).
 *   $16,100 is written 1_610_000. Rates are plain decimals (0.22 = 22%).
 *
 * BRACKETS
 *   Each bracket is { upTo, rate } where `upTo` is the TOP of that
 *   bracket in taxable-income cents and the final bracket uses
 *   upTo: null to mean "and everything above".
 *
 * ACCURACY DISCLAIMER
 *   These figures are transcribed from published sources for planning
 *   estimates. They are not a substitute for the IRS instructions or
 *   advice from a tax professional. Verify before relying on output.
 * =================================================================== */

'use strict';

const TAX_CONFIG = {

  /* =================================================================
   * TAX YEAR 2026
   * Reflects the One Big Beautiful Bill Act (OBBBA) amendments, which
   * made the TCJA rate structure permanent and applied an extra
   * inflation adjustment to the bottom two brackets.
   * ================================================================= */
  2026: {
    _meta: {
      taxYear: 2026,
      source: 'IRS Rev. Proc. 2025-32 (inflation adjustments); IRS Notice 2025-67 (retirement plan limits); SSA 2026 wage base.',
      verifiedOn: '2026-09-23',
      unverified: [
        'limits.compensationLimit401a17 — $360,000 assumed.',
        'stateFlatRates — simplified single-rate approximations, NOT real state bracket tables. See note below.',
      ],
    },

    /* --- Standard deduction (section 6) ---------------------------- */
    standardDeduction: {
      single: 1_610_000,   // $16,100
      mfj:    3_220_000,   // $32,200
      hoh:    2_415_000,   // $24,150
    },

    /* Extra standard deduction for age 65+ (per person). */
    additionalStandardDeductionAge65: {
      single: 208_000,     // $2,080
      mfj:    166_000,     // $1,660 per qualifying spouse
      hoh:    208_000,
    },

    /* OBBBA temporary senior deduction (age 65+), phases out on MAGI. */
    seniorBonusDeduction: {
      amount: 600_000,                  // $6,000 per qualifying individual
      phaseOutStart: { single: 7_500_000, mfj: 15_000_000 },
      phaseOutRate: 0.06,
      expiresAfter: 2028,
    },

    /* --- Ordinary income brackets (section 6) ---------------------- */
    ordinaryBrackets: {
      single: [
        { upTo:  1_240_000, rate: 0.10 },   // $0        – $12,400
        { upTo:  5_040_000, rate: 0.12 },   // $12,400   – $50,400
        { upTo: 10_570_000, rate: 0.22 },   // $50,400   – $105,700
        { upTo: 20_177_500, rate: 0.24 },   // $105,700  – $201,775
        { upTo: 25_622_500, rate: 0.32 },   // $201,775  – $256,225
        { upTo: 64_060_000, rate: 0.35 },   // $256,225  – $640,600
        { upTo: null,       rate: 0.37 },   // $640,600  +
      ],
      mfj: [
        { upTo:  2_480_000, rate: 0.10 },   // $0        – $24,800
        { upTo: 10_080_000, rate: 0.12 },   // $24,800   – $100,800
        { upTo: 21_140_000, rate: 0.22 },   // $100,800  – $211,400
        { upTo: 40_355_000, rate: 0.24 },   // $211,400  – $403,550
        { upTo: 51_245_000, rate: 0.32 },   // $403,550  – $512,450
        { upTo: 76_860_000, rate: 0.35 },   // $512,450  – $768,600
        { upTo: null,       rate: 0.37 },   // $768,600  +
      ],
      hoh: [
        { upTo:  1_770_000, rate: 0.10 },
        { upTo:  6_745_000, rate: 0.12 },
        { upTo: 10_580_000, rate: 0.22 },
        { upTo: 20_180_000, rate: 0.24 },
        { upTo: 25_620_000, rate: 0.32 },
        { upTo: 64_035_000, rate: 0.35 },
        { upTo: null,       rate: 0.37 },
      ],
    },

    /* --- Long-term capital gain / qualified dividend brackets ------
     * These stack ON TOP of ordinary taxable income (section 6). */
    ltcgBrackets: {
      single: [
        { upTo:  4_945_000, rate: 0.00 },   // $0       – $49,450
        { upTo: 54_550_000, rate: 0.15 },   // $49,450  – $545,500
        { upTo: null,       rate: 0.20 },
      ],
      mfj: [
        { upTo:  9_890_000, rate: 0.00 },   // $0       – $98,900
        { upTo: 61_370_000, rate: 0.15 },   // $98,900  – $613,700
        { upTo: null,       rate: 0.20 },
      ],
      hoh: [
        { upTo:  6_615_000, rate: 0.00 },
        { upTo: 57_960_000, rate: 0.15 },
        { upTo: null,       rate: 0.20 },
      ],
    },

    /* --- FICA (section 6) ------------------------------------------
     * Applies to GROSS wages. Note: 401(k) elective deferrals are NOT
     * exempt from FICA, only from federal income tax. Section 125
     * cafeteria-plan HSA contributions ARE FICA-exempt; this model
     * treats payroll HSA contributions as FICA-exempt. */
    fica: {
      socialSecurityRate: 0.062,
      socialSecurityWageBase: 18_450_000,   // $184,500
      medicareRate: 0.0145,
      additionalMedicareRate: 0.009,
      // NOT inflation-indexed; fixed in statute since 2013.
      additionalMedicareThreshold: { single: 20_000_000, mfj: 25_000_000, hoh: 20_000_000 },
    },

    /* --- Net Investment Income Tax --------------------------------- */
    niit: {
      rate: 0.038,
      // NOT inflation-indexed.
      threshold: { single: 20_000_000, mfj: 25_000_000, hoh: 20_000_000 },
    },

    /* --- Contribution limits (section 5) --------------------------- */
    limits: {
      elective401k:            2_450_000,   // $24,500 employee deferral
      catchUp50:                 800_000,   // $8,000  age 50+
      catchUpSuper60to63:      1_125_000,   // $11,250 ages 60–63 (SECURE 2.0)
      // SECURE 2.0: if prior-year FICA wages from this employer exceeded
      // this amount, catch-up contributions MUST be Roth. Effective 2026.
      rothCatchUpWageThreshold: 15_000_000, // $150,000
      // §415(c) annual additions cap: employee deferrals + employer
      // contributions + after-tax contributions. Age-50 catch-up is
      // EXEMPT and sits on top. The gap between this and what the
      // employee plus employer put in is the "mega backdoor" space.
      definedContribution415c: 7_200_000,   // $72,000 (verified 2026-09-24)
      compensationLimit401a17: 36_000_000,  // $360,000 (UNVERIFIED — see _meta)

      ira:                       750_000,   // $7,500
      iraCatchUp50:              110_000,   // $1,100

      hsaSelfOnly:               440_000,   // $4,400
      hsaFamily:                 875_000,   // $8,750
      hsaCatchUp55:              100_000,   // $1,000 (fixed in statute)
    },

    /* --- Roth IRA eligibility phase-out (section 5) ---------------- */
    rothIraPhaseOut: {
      single: { start: 15_300_000, end: 16_800_000 },   // $153k – $168k
      mfj:    { start: 24_200_000, end: 25_200_000 },   // $242k – $252k
      hoh:    { start: 15_300_000, end: 16_800_000 },
    },

    /* --- Traditional IRA DEDUCTIBILITY phase-out (section 5) -------
     * Only applies when the taxpayer is covered by an employer plan.
     * `spouseCoveredOnly` is the wider range that applies when the
     * contributor is NOT covered but their spouse is. */
    tradIraDeductionPhaseOut: {
      single:            { start:  8_100_000, end:  9_100_000 },   // $81k – $91k
      mfj:               { start: 12_900_000, end: 14_900_000 },   // $129k – $149k
      hoh:               { start:  8_100_000, end:  9_100_000 },
      spouseCoveredOnly: { start: 24_200_000, end: 25_200_000 },   // $242k – $252k
    },

    /* --- Early withdrawal penalty (section 6) ---------------------- */
    earlyWithdrawal: {
      penaltyRate: 0.10,
      penaltyFreeAge: 59.5,
      // Exceptions the UI exposes as toggles. Each suppresses the 10%
      // penalty but NOT the ordinary income tax.
      exceptions: [
        { id: 'rule55',        label: 'Separation from service at 55+ (401k only)' },
        { id: 'sepp72t',       label: 'SEPP / Rule 72(t) substantially equal payments' },
        { id: 'disability',    label: 'Total and permanent disability' },
        { id: 'medical',       label: 'Unreimbursed medical > 7.5% AGI' },
        { id: 'firstHome',     label: 'First-time home purchase (IRA, $10k lifetime)' },
        { id: 'education',     label: 'Qualified higher education (IRA)' },
      ],
    },

    /* --- Primary residence capital gain exclusion, IRC §121 -------- */
    homeSaleExclusion: {
      single: 25_000_000,   // $250,000
      mfj:    50_000_000,   // $500,000
      hoh:    25_000_000,
      // 2-of-5-year ownership AND use test.
      minOwnershipYears: 2,
      lookbackYears: 5,
    },

    /* --- Passive activity losses, IRC §469 ------------------------
     * Rental losses are passive. They offset passive income freely, but
     * offsetting ORDINARY income requires active participation and is
     * capped at $25,000 — reduced by 50 cents per dollar of MAGI over
     * $100,000 and gone entirely at $150,000. Those thresholds are NOT
     * inflation-indexed, so they bind on more people every year. Losses
     * disallowed are suspended and carried forward, and are released in
     * full when the property is sold in a taxable disposition. */
    passiveActivityLoss: {
      specialAllowance: 2_500_000,          // $25,000
      phaseOutStart: 10_000_000,            // $100,000 MAGI
      phaseOutEnd: 15_000_000,              // $150,000 MAGI
      phaseOutRate: 0.50,
    },

    /* Unrecaptured §1250 gain — depreciation taken on real property is
     * recaptured at a flat 25% on sale, ahead of long-term gain rates. */
    depreciationRecaptureRate: 0.25,

    /* --- Social Security benefit taxability -----------------------
     * Provisional income thresholds. NOT inflation-indexed (1983/1993). */
    socialSecurityTaxability: {
      tier1: { single: 2_500_000, mfj: 3_200_000, hoh: 2_500_000 },  // 50% tier
      tier2: { single: 3_400_000, mfj: 4_400_000, hoh: 3_400_000 },  // 85% tier
      tier1Rate: 0.50,
      tier2Rate: 0.85,
    },

    /* --- Required Minimum Distributions (section 7) ---------------- */
    rmd: {
      // SECURE 2.0 Act phase-in by birth year.
      startAgeByBirthYear: [
        { bornBefore: 1951, age: 72 },
        { bornBefore: 1960, age: 73 },
        { bornBefore: null, age: 75 },   // born 1960 or later
      ],
      // IRS Uniform Lifetime Table (Table III), effective 2022+.
      // Divide prior-year-end balance by the divisor for your age.
      uniformLifetimeTable: {
        72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
        78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7,
        84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
        90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94:  9.5, 95:  8.9,
        96:  8.4, 97:  7.8, 98:  7.3, 99:  6.8, 100: 6.4, 101: 6.0,
        102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
        108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4, 112: 3.3, 113: 3.1,
        114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3,
        120: 2.0,
      },
      // Roth 401(k) no longer has RMDs (SECURE 2.0, from 2024).
      rothSubjectToRmd: false,
      shortfallPenaltyRate: 0.25,   // 10% if corrected promptly
    },
  },
};

/* ===================================================================
 * STATE INCOME TAX (spec section 6: "configurable per state; zero for
 * Washington, Texas, Florida, etc.")
 * -------------------------------------------------------------------
 * IMPORTANT SIMPLIFICATION: these are single flat approximations of a
 * state's effective rate on ordinary income, not real bracket tables.
 * Graduated states (CA, NY, NJ …) will be materially wrong at the
 * extremes. Pick "Custom rate" in the UI to enter your own figure.
 *
 * `ltcgRate: null` means "same rate as ordinary income", which is how
 * most states treat capital gains.
 * =================================================================== */
const STATE_TAX = {
  _meta: {
    note: 'Flat-rate approximations for planning only. Graduated-bracket states are simplified. Verify against your state DOR.',
    verifiedOn: '2026-09-23',
  },

  // --- No state income tax -----------------------------------------
  // Washington has no wage income tax, but does levy a 7% EXCISE tax on
  // long-term capital gains. Three features of that tax matter here and
  // are modelled via the extra fields below:
  //   - it applies only to REALIZED long-term gains, not to dividends
  //   - it allows a large annual standard deduction (indexed)
  //   - real estate sales are exempt entirely
  WA: {
    name: 'Washington', rate: 0.000, ltcgRate: 0.070,
    ltcgRealizedGainsOnly: true,
    ltcgStandardDeduction: 28_300_000,   // ~$283,000, indexed from $250k (2022)
    ltcgExemptsRealEstate: true,
    note: 'No wage income tax. 7% excise tax on long-term capital gains above a ~$283k annual standard deduction; real estate sales exempt.',
  },
  TX: { name: 'Texas',         rate: 0.000, ltcgRate: null },
  FL: { name: 'Florida',       rate: 0.000, ltcgRate: null },
  NV: { name: 'Nevada',        rate: 0.000, ltcgRate: null },
  SD: { name: 'South Dakota',  rate: 0.000, ltcgRate: null },
  WY: { name: 'Wyoming',       rate: 0.000, ltcgRate: null },
  AK: { name: 'Alaska',        rate: 0.000, ltcgRate: null },
  TN: { name: 'Tennessee',     rate: 0.000, ltcgRate: null },
  NH: { name: 'New Hampshire', rate: 0.000, ltcgRate: null, note: 'Interest & dividends tax fully repealed as of 2025.' },

  // --- Flat-rate states (accurate) ---------------------------------
  AZ: { name: 'Arizona',       rate: 0.0250, ltcgRate: null },
  CO: { name: 'Colorado',      rate: 0.0425, ltcgRate: null },
  GA: { name: 'Georgia',       rate: 0.0519, ltcgRate: null },
  ID: { name: 'Idaho',         rate: 0.0530, ltcgRate: null },
  IL: { name: 'Illinois',      rate: 0.0495, ltcgRate: null, note: 'Retirement income is exempt.' },
  IN: { name: 'Indiana',       rate: 0.0300, ltcgRate: null },
  IA: { name: 'Iowa',          rate: 0.0380, ltcgRate: null },
  KY: { name: 'Kentucky',      rate: 0.0400, ltcgRate: null },
  MI: { name: 'Michigan',      rate: 0.0425, ltcgRate: null },
  MS: { name: 'Mississippi',   rate: 0.0440, ltcgRate: null },
  NC: { name: 'North Carolina',rate: 0.0425, ltcgRate: null },
  PA: { name: 'Pennsylvania',  rate: 0.0307, ltcgRate: null, note: 'Retirement distributions after 59.5 are exempt.' },
  UT: { name: 'Utah',          rate: 0.0455, ltcgRate: null },

  // --- Graduated states: APPROXIMATE effective rates ---------------
  CA: { name: 'California',    rate: 0.0930, ltcgRate: null, approx: true, note: 'Graduated 1%–13.3%. 9.3% is the bracket covering roughly $75k–$375k single.' },
  NY: { name: 'New York',      rate: 0.0685, ltcgRate: null, approx: true },
  NJ: { name: 'New Jersey',    rate: 0.0637, ltcgRate: null, approx: true },
  MA: { name: 'Massachusetts', rate: 0.0500, ltcgRate: null, approx: true, note: '4% surtax on income above ~$1M.' },
  OR: { name: 'Oregon',        rate: 0.0900, ltcgRate: null, approx: true },
  MN: { name: 'Minnesota',     rate: 0.0785, ltcgRate: null, approx: true },
  VA: { name: 'Virginia',      rate: 0.0575, ltcgRate: null, approx: true },
  MD: { name: 'Maryland',      rate: 0.0475, ltcgRate: null, approx: true, note: 'Excludes county piggyback tax of roughly 2.25%–3.2%.' },
  OH: { name: 'Ohio',          rate: 0.0275, ltcgRate: null, approx: true },
  WI: { name: 'Wisconsin',     rate: 0.0530, ltcgRate: null, approx: true },
  CT: { name: 'Connecticut',   rate: 0.0500, ltcgRate: null, approx: true },
  SC: { name: 'South Carolina',rate: 0.0620, ltcgRate: null, approx: true },
  MO: { name: 'Missouri',      rate: 0.0470, ltcgRate: null, approx: true },
  CUSTOM: { name: 'Custom rate', rate: 0.000, ltcgRate: null, custom: true },
};

/* ===================================================================
 * DEFAULT MARKET ASSUMPTIONS (spec section 8)
 * -------------------------------------------------------------------
 * `mean` is the expected ARITHMETIC nominal annual return.
 * `stdev` is the annual standard deviation, used only in Monte Carlo.
 * Figures are long-run historical approximations, editable in the UI.
 * =================================================================== */
const ASSET_CLASSES = {
  stocks:      { label: 'Stocks / equity funds', mean: 0.070, stdev: 0.160, color: '#2563eb' },
  bonds:       { label: 'Bonds',                 mean: 0.040, stdev: 0.055, color: '#0891b2' },
  cash:        { label: 'Cash / money market',   mean: 0.020, stdev: 0.010, color: '#65a30d' },
  realEstate:  { label: 'Real estate',           mean: 0.035, stdev: 0.110, color: '#c2410c' },
  commodities: { label: 'Commodities / gold',    mean: 0.030, stdev: 0.180, color: '#a16207' },
  crypto:      { label: 'Crypto',                mean: 0.080, stdev: 0.650, color: '#7c3aed' },
};

/* Inflation default, applied to spending, property tax, insurance and
 * (optionally) the tax brackets themselves. Spec section 8. */
const DEFAULT_INFLATION = 0.025;

/* ===================================================================
 * HELPERS — resolve config for a simulated year
 * =================================================================== */

/** Most recent configured tax year at or before `year`. */
function resolveTaxYear(year) {
  const years = Object.keys(TAX_CONFIG).map(Number).sort((a, b) => a - b);
  let chosen = years[0];
  for (const y of years) if (y <= year) chosen = y;
  return chosen;
}

/**
 * Return the tax config for a simulated year.
 *
 * Simulated years beyond the last configured year are handled by
 * INDEXING the latest table forward at `indexRate`. Brackets, standard
 * deduction and contribution limits all inflate; statutory figures that
 * Congress did not index (NIIT thresholds, additional-Medicare
 * thresholds, Social Security taxability thresholds) deliberately do
 * NOT — which is what produces real-world bracket creep in the forecast.
 */
function getTaxConfig(year, indexRate = DEFAULT_INFLATION) {
  const baseYear = resolveTaxYear(year);
  const base = TAX_CONFIG[baseYear];
  const yearsForward = year - baseYear;
  if (yearsForward <= 0 || indexRate === 0) return base;

  const f = Math.pow(1 + indexRate, yearsForward);
  // Round indexed figures to the nearest $50, as the IRS does.
  const idx = (cents) => Math.round((cents * f) / 5000) * 5000;
  const idxBrackets = (list) => list.map((b) => ({ upTo: b.upTo === null ? null : idx(b.upTo), rate: b.rate }));
  const mapStatuses = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));

  return {
    ...base,
    _meta: { ...base._meta, projectedFrom: baseYear, indexRate, projected: true },
    standardDeduction: mapStatuses(base.standardDeduction, idx),
    additionalStandardDeductionAge65: mapStatuses(base.additionalStandardDeductionAge65, idx),
    ordinaryBrackets: mapStatuses(base.ordinaryBrackets, idxBrackets),
    ltcgBrackets: mapStatuses(base.ltcgBrackets, idxBrackets),
    fica: {
      ...base.fica,
      socialSecurityWageBase: idx(base.fica.socialSecurityWageBase),
      // Additional Medicare threshold is NOT indexed — left as-is.
    },
    // NIIT threshold is NOT indexed — left as-is.
    limits: mapStatuses(base.limits, (v) => (typeof v === 'number' ? idx(v) : v)),
    rothIraPhaseOut: mapStatuses(base.rothIraPhaseOut, (r) => ({ start: idx(r.start), end: idx(r.end) })),
    tradIraDeductionPhaseOut: mapStatuses(base.tradIraDeductionPhaseOut, (r) => ({ start: idx(r.start), end: idx(r.end) })),
    homeSaleExclusion: {
      ...base.homeSaleExclusion,
      // §121 exclusion is NOT indexed — a real and often-overlooked drag.
      single: base.homeSaleExclusion.single,
      mfj: base.homeSaleExclusion.mfj,
      hoh: base.homeSaleExclusion.hoh,
    },
    // Social Security taxability thresholds are NOT indexed.
  };
}

/** RMD start age under SECURE 2.0, by birth year. */
function getRmdStartAge(birthYear, cfg) {
  for (const rule of cfg.rmd.startAgeByBirthYear) {
    if (rule.bornBefore === null || birthYear < rule.bornBefore) return rule.age;
  }
  return 75;
}

/** Uniform Lifetime Table divisor, clamped to the table's range. */
function getRmdDivisor(age, cfg) {
  const t = cfg.rmd.uniformLifetimeTable;
  if (age >= 120) return t[120];
  return t[Math.floor(age)] ?? null;
}

/* Export. See the note in money.js: browser globals must be attached
 * explicitly, because a top-level `const` is not a property of window. */
const _taxConfigExports = {
  TAX_CONFIG, STATE_TAX, ASSET_CLASSES, DEFAULT_INFLATION,
  getTaxConfig, resolveTaxYear, getRmdStartAge, getRmdDivisor,
};
if (typeof module !== 'undefined' && module.exports) module.exports = _taxConfigExports;
else if (typeof self !== 'undefined') Object.assign(self, _taxConfigExports);

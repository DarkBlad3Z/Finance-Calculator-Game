/* ===================================================================
 * money.js — DECIMAL-SAFE MONETARY ARITHMETIC
 * -------------------------------------------------------------------
 * Spec section 11: "All monetary calculations should use fixed-point/
 * decimal handling, not floating point, to avoid rounding errors
 * compounding over many simulated years."
 *
 * STRATEGY: every monetary value in this application is stored as an
 * INTEGER NUMBER OF CENTS. JavaScript numbers are IEEE-754 doubles,
 * which represent integers exactly up to 2^53 - 1 (9,007,199,254,740,991
 * cents = ~$90 trillion). No simulated net worth will approach that, so
 * integer-cent storage is exact.
 *
 * RULE: never let a fractional cent survive an operation. Every
 * multiplication by a rate immediately rounds back to a whole cent via
 * Money.mul(). Addition and subtraction of integers are already exact.
 *
 * Rates, percentages and divisors stay as ordinary floats — they are not
 * money, and rounding them would be wrong.
 * =================================================================== */

'use strict';

const Money = {
  ZERO: 0,

  /** Largest value we consider safe (~$90 trillion), used by assertSafe. */
  MAX_SAFE_CENTS: Number.MAX_SAFE_INTEGER,

  /** Dollars (number or numeric string) -> integer cents. */
  fromDollars(d) {
    const n = typeof d === 'string' ? parseFloat(d) : d;
    if (n === null || n === undefined || Number.isNaN(n)) return 0;
    // Scale then round half-away-from-zero so -0.005 -> -1 cent, not 0.
    return Money._roundHalfAway(n * 100);
  },

  /** Integer cents -> dollars as a float. For DISPLAY and charting only. */
  toDollars(c) {
    return c / 100;
  },

  /** Exact addition. Any number of arguments. */
  add(...vals) {
    let sum = 0;
    for (const v of vals) sum += (v | 0) === v ? v : Math.round(v);
    return sum;
  },

  /** Exact subtraction: a - b. */
  sub(a, b) {
    return Math.round(a) - Math.round(b);
  },

  /**
   * Multiply money by a dimensionless rate (growth rate, tax rate, a
   * percentage, a fraction of a lot). Rounds to the nearest whole cent.
   */
  mul(cents, rate) {
    if (!rate) return 0;
    return Money._roundHalfAway(cents * rate);
  },

  /** Divide money by a plain number (e.g. an RMD life-expectancy divisor). */
  div(cents, divisor) {
    if (!divisor) return 0;
    return Money._roundHalfAway(cents / divisor);
  },

  /**
   * Split `cents` into `n` parts that sum EXACTLY back to `cents`.
   * Remainder pennies are distributed one-per-part from the front.
   */
  split(cents, n) {
    const base = Math.trunc(cents / n);
    let remainder = cents - base * n;
    const parts = new Array(n).fill(base);
    const step = remainder >= 0 ? 1 : -1;
    for (let i = 0; remainder !== 0; i = (i + 1) % n) {
      parts[i] += step;
      remainder -= step;
    }
    return parts;
  },

  /**
   * Allocate `cents` across weights so the pieces sum EXACTLY to `cents`.
   * Used for asset-allocation splits of a cash sweep. Largest-remainder
   * method: no penny is created or destroyed.
   */
  allocate(cents, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return weights.map(() => 0);
    const raw = weights.map((w) => (cents * w) / total);
    const floors = raw.map((r) => Math.trunc(r));
    let allocated = floors.reduce((a, b) => a + b, 0);
    let leftover = cents - allocated;
    // Hand out leftover pennies to the largest fractional remainders.
    const order = raw
      .map((r, i) => ({ i, frac: r - Math.trunc(r) }))
      .sort((a, b) => b.frac - a.frac);
    const step = leftover >= 0 ? 1 : -1;
    let k = 0;
    while (leftover !== 0 && order.length) {
      floors[order[k % order.length].i] += step;
      leftover -= step;
      k++;
    }
    return floors;
  },

  max(...vals) { return Math.max(...vals.map(Math.round)); },
  min(...vals) { return Math.min(...vals.map(Math.round)); },

  /** Clamp to >= 0. Balances and tax amounts must never go negative. */
  floor0(cents) { return cents > 0 ? Math.round(cents) : 0; },

  clamp(cents, lo, hi) { return Math.min(Math.max(cents, lo), hi); },

  /**
   * Compound growth applied once per year, rounding to the cent each
   * year. Callers should apply year by year (the engine does) rather
   * than using pow() over the whole horizon, so that the rounding
   * behaviour matches the year-by-year ledger the user sees.
   */
  grow(cents, rate) {
    return Money.add(cents, Money.mul(cents, rate));
  },

  /** Format integer cents for display, e.g. 123456789 -> "$1,234,568". */
  fmt(cents, { decimals = 0, sign = false, compact = false } = {}) {
    const d = cents / 100;
    if (compact) {
      const abs = Math.abs(d);
      const unit = abs >= 1e9 ? ['B', 1e9] : abs >= 1e6 ? ['M', 1e6] : abs >= 1e3 ? ['K', 1e3] : ['', 1];
      const v = d / unit[1];
      const s = `$${v.toFixed(abs >= 1e3 ? 1 : 0)}${unit[0]}`;
      return sign && d > 0 ? `+${s}` : s;
    }
    const s = d.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return sign && d > 0 ? `+${s}` : s;
  },

  /** Round half away from zero — avoids Math.round's bias on negatives. */
  _roundHalfAway(x) {
    // Nudge by an ulp-scale epsilon to defeat cases like 1.005*100 = 100.49999...
    const eps = Math.abs(x) * Number.EPSILON * 4;
    return x >= 0 ? Math.round(x + eps) : -Math.round(-x + eps);
  },

  /** Development guard: catches silent precision loss. */
  assertSafe(cents, label = 'value') {
    if (!Number.isFinite(cents)) throw new Error(`${label} is not finite: ${cents}`);
    if (!Number.isInteger(cents)) throw new Error(`${label} lost cent-integrality: ${cents}`);
    if (Math.abs(cents) > Money.MAX_SAFE_CENTS) throw new Error(`${label} exceeds safe integer range`);
    return cents;
  },
};

/* Export. In a browser, a top-level `const` lives in the script-global
 * lexical scope and is NOT a property of `window`, so the later modules
 * (which read `root.Money`) would not find it. Attach it explicitly. */
if (typeof module !== 'undefined' && module.exports) module.exports = { Money };
else if (typeof self !== 'undefined') self.Money = Money;

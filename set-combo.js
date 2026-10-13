#!/usr/bin/env node
/* ===================================================================
 * set-combo.js — set the ring lock's combination
 *
 *   node set-combo.js                 random combo, writes the hash
 *   node set-combo.js 7 2 11 4 9      a combo you choose (1-based)
 *   node set-combo.js --print         show it, write nothing
 *
 * Prints the combination ONCE to your terminal and writes only a
 * PBKDF2-SHA256 verifier into auth.js. The combination itself is never
 * written to disk, so it cannot leak through the repository.
 *
 * Generating it here rather than being told it is strictly better:
 * nobody else, and no chat log, ever sees it.
 *
 * Remember what this protects — see the header of auth.js. The markers
 * are visible, so the keyspace is arrows^rings and the gate is a
 * barrier, not security.
 * =================================================================== */

'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTH_FILE = path.join(__dirname, 'auth.js');
const ITERATIONS = 250000;

function readConfig(src) {
  const num = (key, dflt) => {
    const m = src.match(new RegExp(key + ':\\s*(\\d+)'));
    return m ? parseInt(m[1], 10) : dflt;
  };
  const dayRing = /dayRing:\s*true/.test(src);
  return { rings: num('rings', 6), arrows: num('arrows', 12), dayRing };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const src = fs.readFileSync(AUTH_FILE, 'utf8');
const { rings, arrows, dayRing } = readConfig(src);

const printOnly = process.argv.includes('--print');
const given = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);

/* With a day ring, only the inner rings are a fixed secret — the
 * outermost is derived from the weekday, so it is not something you
 * choose or write down. */
const fixedCount = dayRing ? rings - 1 : rings;

let combo;
if (given.length) {
  if (given.length !== fixedCount) {
    console.error(`Expected ${fixedCount} numbers`
      + (dayRing ? ` (rings 1-${fixedCount}; ring ${rings} is the day ring)` : ' (one per ring)')
      + `, got ${given.length}.`);
    process.exit(1);
  }
  if (given.some((n) => n < 1 || n > arrows)) {
    console.error(`Marker numbers must be between 1 and ${arrows}.`);
    process.exit(1);
  }
  combo = given.map((n) => n - 1);          // store 0-based
} else {
  combo = Array.from({ length: fixedCount }, () => crypto.randomInt(0, arrows));
}

if (dayRing && arrows < 7) {
  console.error(`A day ring needs at least 7 markers to cover the week; arrows is ${arrows}.`);
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const pbkdf2 = (probe) =>
  crypto.pbkdf2Sync(probe, salt, ITERATIONS, 32, 'sha256').toString('base64');

/* One verifier per weekday, indexed by Date#getDay(). The day ring's
 * target index equals getDay() (Sunday 0 -> marker 1), so each day's
 * hash covers the WHOLE arrangement and no ring is ever compared in
 * plaintext at runtime. */
const hash = dayRing ? null : pbkdf2(combo.join('-'));
const hashes = dayRing
  ? DAYS.map((_, d) => pbkdf2([...combo, d].join('-')))
  : null;

const keyspace = Math.pow(arrows, fixedCount);
console.log('');
console.log('  ┌─────────────────────────────────────────────┐');
console.log('  │  COMBINATION — write this down now.         │');
console.log('  │  It is not saved anywhere.                  │');
console.log('  └─────────────────────────────────────────────┘');
console.log('');
combo.forEach((k, i) => {
  console.log(`      ring ${i + 1}  ->  marker ${k + 1}`);
});
if (dayRing) {
  console.log(`      ring ${rings}  ->  the day of the week  (changes daily)`);
}
console.log('');
console.log(`      short form:  ${combo.map((k) => k + 1).join('-')}`
  + (dayRing ? '  + day' : ''));
if (dayRing) {
  console.log('');
  console.log(`  Ring ${rings} is the day ring — Sunday is marker 1 through Saturday marker 7,`);
  console.log('  in whatever timezone the visitor is in:');
  console.log('');
  DAYS.forEach((n, d) => console.log(`      ${n.padEnd(10)} ->  marker ${d + 1}`));
  const today = new Date().getDay();
  console.log('');
  console.log(`      today is ${DAYS[today]}, so right now it is:  `
    + `${combo.map((k) => k + 1).join('-')}-${today + 1}`);
}
console.log('');
console.log(`  ${fixedCount} fixed rings, ${arrows} markers = ${keyspace.toLocaleString()} combinations.`);
if (dayRing) {
  console.log('  The day ring adds no keyspace against someone reading auth.js — the');
  console.log('  rule is in the source and the date is public. It protects against a');
  console.log('  combination that leaks by sticky note, screenshot or word of mouth.');
}
const hours = (keyspace * 0.05) / 2 / 3600;
console.log(`  Roughly ${hours < 1 ? (hours * 60).toFixed(0) + ' minutes' : hours.toFixed(1) + ' hours'}`
  + ' to brute-force on one core, much less on a GPU.');
console.log('');

if (printOnly) process.exit(0);

const block =
`    comboSalt: '${salt.toString('base64')}',
    comboHash: ${hash ? `'${hash}'` : 'null'},
    comboHashes: ${hashes ? '[\n' + hashes.map((h) => `      '${h}',`).join('\n') + '\n    ]' : 'null'},
    comboIterations: ${ITERATIONS},`;

const re = /    comboSalt: '[^']*',\s*\n    comboHash: [^\n]*\n    comboHashes: (?:null,|\[[\s\S]*?\],)\s*\n    comboIterations: \d+,/;
if (!re.test(src)) {
  console.error('Could not find the combo block in auth.js. Paste this in by hand:\n');
  console.error(block);
  process.exit(1);
}
fs.writeFileSync(AUTH_FILE, src.replace(re, () => block));

console.log('  auth.js updated (hash only — the combo above is not in it).');
console.log('  Next:  node build.js');
console.log('');

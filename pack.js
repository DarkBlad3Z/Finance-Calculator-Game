/* pack.js — assemble the GitHub zip, refusing to ship anything personal. */
const fs = require('fs'), path = require('path'), cp = require('child_process');

const SHIP = ['README.md', 'package.json', '.gitignore', 'index.html', 'styles.css',
  'money.js', 'tax-config.js', 'tax-engine.js', 'engine.js', 'characters.js',
  'avatar.js', 'audio.js', 'optimizer.js', 'auth.js', 'app.js',
  'build.js', 'set-combo.js', 'set-password.js', 'gen-sheet.js', 'pack.js', '.gitignore', 'svg-chart.js',
  'test-render.js', 'test-svg-chart.js', 'vendor/README.md', 'forecaster.html',
  'test-engine.js', 'test-optimizer.js', 'test-characters.js', 'test-sequence.js',
  'test-auth.js', 'test-auth-flow.js', 'test-auth-dial.js', 'ui-concept.html'];

/* What must never ship. These are SHAPES, not names: a scrub that
 * hard-codes the owner's name and email contains the owner's name and
 * email, which is how this file flagged itself on the first run. The
 * specific identities come from outside the repo instead — a
 * gitignored `.scrub-names` file, one pattern per line, or the
 * SCRUB_NAMES environment variable (comma-separated).
 */
const BANNED = [
  { re: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, why: 'an email address' },
  { re: /\bTech\$\w+/i, why: 'a password the owner pasted once' },
  { re: /\b\d{3}-\d{2}-\d{4}\b/, why: 'looks like a government ID' },
];

/* Card numbers get a Luhn check rather than a pattern. The pattern
 * alone ("13-16 digits with optional separators") matched SVG path
 * data — "4 3-16 3-20 1-4 1-6 4-8" is geometry, not a Visa. Luhn plus
 * a strict grouping rule gives no false positives on coordinates. */
function looksLikeCard(text) {
  const cands = text.match(/\b(?:\d{4}[ -]){3}\d{4}\b|\b\d{13,19}\b/g) || [];
  return cands.filter((c) => {
    const d = c.replace(/\D/g, '');
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = +d[i];
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return d.length >= 13 && sum % 10 === 0;
  });
}

/* Geometry attributes are coordinates by definition. Scanning them for
 * identifiers is what produced the false positive above. */
const stripGeometry = (t) => t
  .replace(/\sd="[^"]*"/g, ' d=""')
  .replace(/\s(?:viewBox|points|transform|values|keyTimes)="[^"]*"/g, ' ');

/* Local identities, never committed. */
const extra = [];
try {
  extra.push(...fs.readFileSync(path.join(__dirname, '.scrub-names'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
} catch (e) { /* no local list: the shape rules above still apply */ }
if (process.env.SCRUB_NAMES) extra.push(...process.env.SCRUB_NAMES.split(','));
for (const n of extra) {
  BANNED.push({ re: new RegExp('\\b' + n.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'),
                why: 'a name on the local scrub list' });
}

const missing = SHIP.filter((f) => !fs.existsSync(path.join(__dirname, f)));
if (missing.length) { console.error('MISSING: ' + missing.join(', ')); process.exit(1); }

let bad = [];
for (const f of SHIP) {
  const raw = fs.readFileSync(path.join(__dirname, f), 'utf8');
  const t = stripGeometry(raw);
  for (const b of BANNED) {
    const m = t.match(b.re);
    if (m) bad.push(`${f}: ${b.why} — "${m[0].slice(0, 40)}"`);
  }
  for (const c of looksLikeCard(t)) bad.push(`${f}: passes Luhn, may be a card — "${c}"`);
}

/* Combination leak check. The verifiers are base64 PBKDF2 output and
 * the salt is base64 too — my first pass looked for hex and a SALT
 * constant, found neither, and cheerfully reported "0 verifiers": a
 * scrub that tested nothing and passed. So this now asserts it found
 * the verifiers, and runs a POSITIVE CONTROL proving the detector
 * actually bites, without needing to know the real combination.
 */
(async () => {
  const auth = fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8');
  const saltB64 = (auth.match(/comboSalt:\s*'([^']+)'/) || [])[1];
  const iters = +((auth.match(/comboIterations:\s*(\d+)/) || [])[1] || 250000);
  const block = (auth.match(/comboHashes:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  const verifiers = [...block.matchAll(/'([A-Za-z0-9+/=]{40,})'/g)].map((m) => m[1]);
  const single = (auth.match(/comboHash:\s*'([A-Za-z0-9+/=]{40,})'/) || [])[1];
  if (single) verifiers.push(single);

  if (!saltB64) { console.error('SCRUB BROKEN: no comboSalt found in auth.js'); process.exit(1); }
  if (verifiers.length < 7) {
    console.error(`SCRUB BROKEN: expected 7 day verifiers, found ${verifiers.length}`);
    process.exit(1);
  }

  const crypto = require('crypto');
  const salt = Buffer.from(saltB64, 'base64');
  const hash = (s) => crypto.pbkdf2Sync(Buffer.from(s, 'utf8'), salt, iters, 32, 'sha256')
    .toString('base64');

  // Every 5-number run in every shipped file.
  const seqs = new Set();
  for (const f of SHIP) {
    const t = fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (const m of t.matchAll(/\b(\d{1,2})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})\b/g)) {
      seqs.add(m.slice(1, 6).join('-'));
    }
  }

  const check = (list) => [...seqs].filter((s) => list.includes(hash(s)));

  // Positive control: plant the hash of a sequence that IS in the files
  // and confirm the detector finds it. If this fails, the scrub is dead.
  const sample = [...seqs][0];
  if (!sample) { console.error('SCRUB BROKEN: no number sequences extracted'); process.exit(1); }
  if (!check([...verifiers, hash(sample)]).includes(sample)) {
    console.error('SCRUB BROKEN: positive control did not trip'); process.exit(1);
  }

  const leaks = check(verifiers);
  for (const l of leaks) bad.push(`COMBINATION LEAK: ${l} is a live answer`);

  console.log(`scrubbed ${SHIP.length} files; tested ${seqs.size} number sequences`
    + ` against ${verifiers.length} verifiers (${iters} iterations); control tripped as expected`);

  if (bad.length) { console.error('REFUSING TO PACK:\n  ' + bad.join('\n  ')); process.exit(1); }

  const stage = '/tmp/pf-pkg/personal-finance-forecaster';
  cp.execSync(`rm -rf /tmp/pf-pkg && mkdir -p ${stage}`);
  // Some shipped paths sit in subdirectories (vendor/README.md), so the
  // destination directory has to exist before the copy.
  for (const f of SHIP) {
    const dest = path.join(stage, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(__dirname, f), dest);
  }
  cp.execSync(`cd /tmp/pf-pkg && zip -qr9 "${__dirname}/personal-finance-forecaster.zip" personal-finance-forecaster`);
  const kb = Math.round(fs.statSync(path.join(__dirname, 'personal-finance-forecaster.zip')).size / 1024);
  console.log(`personal-finance-forecaster.zip — ${SHIP.length} files, ${kb} KB, clean`);
})();

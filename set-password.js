#!/usr/bin/env node
/* ===================================================================
 * set-password.js — change the gate password
 *
 *   node set-password.js               prompts, hidden input
 *   node set-password.js --print       show the block, don't write
 *
 * Generates a fresh random salt and a PBKDF2-SHA256 verifier, then
 * rewrites the AUTH_CONFIG block in auth.js. The plaintext password is
 * never written to disk.
 *
 * Remember what this protects: see the header of auth.js. The gate
 * stops casual visitors. It does not protect anything committed to the
 * repository, and it does not stop anyone who opens devtools.
 * =================================================================== */

'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ITERATIONS = 250000;
const AUTH_FILE = path.join(__dirname, 'auth.js');

function derive(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
}

/** Read a line without echoing it to the terminal. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (ch) => {
      const s = ch.toString('utf8');
      if (s === '\n' || s === '\r' || s === '\u0004') process.stdin.removeListener('data', onData);
      else readline.moveCursor(process.stdout, -s.length, 0);
    };
    process.stdout.write(question);
    process.stdin.on('data', onData);
    rl.question('', (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const printOnly = process.argv.includes('--print');

  const pw = await promptHidden('New password: ');
  if (!pw) { console.error('Nothing entered — aborted.'); process.exit(1); }
  const again = await promptHidden('Confirm:      ');
  if (pw !== again) { console.error('Passwords did not match — aborted.'); process.exit(1); }

  // Advisory only; the gate is a speed bump either way.
  const weak = [];
  if (pw.length < 12) weak.push('shorter than 12 characters');
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw)) weak.push('no mixed case');
  if (!/[0-9]/.test(pw)) weak.push('no digits');
  if (!/[^A-Za-z0-9]/.test(pw)) weak.push('no symbols');
  if (weak.length) console.warn(`\nNote: ${weak.join(', ')}. Offline guessing is unmetered here, so length matters more than complexity.\n`);

  const salt = crypto.randomBytes(16);
  const hash = derive(pw, salt);

  const block = `const AUTH_CONFIG = {
  // PBKDF2-SHA256 verifier. Regenerate with set-password.js.
  salt: '${salt.toString('base64')}',
  hash: '${hash.toString('base64')}',
  iterations: ${ITERATIONS},`;

  if (printOnly) { console.log('\n' + block + '\n'); process.exit(0); }

  const src = fs.readFileSync(AUTH_FILE, 'utf8');
  const re = /const AUTH_CONFIG = \{[\s\S]*?iterations: \d+,/;
  if (!re.test(src)) {
    console.error('Could not find the AUTH_CONFIG block in auth.js. Use --print and paste it in by hand.');
    process.exit(1);
  }
  fs.writeFileSync(AUTH_FILE, src.replace(re, () => block));

  console.log('auth.js updated.');
  console.log('Now run:  node build.js      (to refresh forecaster.html)');
  console.log('\nReminder: on a public repo this gate is a courtesy barrier only.');
  console.log('Never reuse a password here that you use anywhere that matters.');
})();

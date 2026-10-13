/* ===================================================================
 * auth.js — ENTRY GATE
 * ===================================================================
 *
 *   READ THIS BEFORE RELYING ON IT.
 *
 * Every mode here runs in the VISITOR'S BROWSER. Nothing is checked on
 * a server, because GitHub Pages has no server to check it on. So none
 * of this is security in the sense of keeping out someone who wants in.
 *
 * What it genuinely does:
 *   - stops crawlers, scrapers and bots, which will not solve a puzzle
 *   - stops drive-by visitors who cannot be bothered
 *   - signals the page is not meant to be public
 *
 * What it does NOT do:
 *   - protect anything committed to the repository. Files in the repo
 *     are visible to anyone who can see the repo, gate or no gate.
 *   - stand up to anyone who opens devtools
 *
 * -------------------------------------------------------------------
 * WHY A PUZZLE BEATS A PASSWORD ON A PUBLIC REPO
 *
 * A password's whole value is that the visitor knows a secret. Publish
 * the repo and that secret is public, so the value is gone — and you
 * have burned a password you might have reused elsewhere.
 *
 * A GENERATED puzzle stores no answer at all. The question and its
 * solution are computed fresh on each load from random parameters.
 * There is nothing in the source to look up. Reading the code tells a
 * visitor how to solve it, but the code already tells them this is a
 * finance calculator, so nothing is lost by publishing it.
 *
 * Trade-off, stated plainly: a puzzle is weaker against a determined
 * human, who simply solves it. It is stronger against everything else,
 * and it survives being published. For this use that is the better bet.
 *
 * -------------------------------------------------------------------
 * If you need ACTUAL access control, authenticate on a server before
 * the page is ever sent:
 *   - Cloudflare Access — free for small teams, real identity checks
 *   - Netlify / Vercel password protection — paid tiers, server-side
 *   - any host with HTTP Basic auth
 * =================================================================== */

'use strict';

const AUTH_CONFIG = {
  /* ---------------------------------------------------------------
   * mode:
   *   'dial'       INTERACTIVE. Rotate concentric rings until their
   *                slots line up with the bezel marker. The answer is
   *                a physical arrangement, not a string, so there is
   *                nothing for a text model to type. (default)
   *   'finance'    a finance question with randomised numbers. Easy
   *                for a human — and easy for a language model, which
   *                is why it is no longer the default.
   *   'arithmetic' plain generated sums. Fastest, dullest, most
   *                effective purely as a bot filter.
   *   'sequence'   spot the next number in a generated sequence.
   *   'riddle'     a fixed question and answer you write yourself.
   *                This IS a shared secret, so publishing burns it —
   *                but it is pleasant to pass on verbally.
   *   'password'   the PBKDF2 password gate.
   *   'off'        NO GATE. Opens straight to the app. Right for a
   *                private copy on your own machine; wrong for
   *                anything published, where it means no barrier at
   *                all. Nothing else about the app changes.
   * --------------------------------------------------------------- */
  mode: 'dial',

  /* How many puzzles must be solved in a row. 2 makes a lucky guess
   * unlikely without being tedious. Ignored by dial/password/riddle. */
  rounds: 2,

  /* --- 'dial' mode ---------------------------------------------- */
  dial: {
    rings: 6,          // how many rings must be set. 2–8.
    arrows: 12,        // numbered markers on the bezel. 2–24.
    positions: 24,     // snap stops per ring. Must be >= arrows.

    /* DAY RING. When true, the OUTERMOST ring is not part of the fixed
     * combination: its target is the day of the week, Sunday = marker 1
     * through Saturday = marker 7, in the VISITOR'S LOCAL timezone.
     *
     * What this buys, honestly: nothing against someone reading this
     * file, because the rule is right here in the source and the day is
     * public. What it does buy is protection against human leakage — a
     * combination written on a sticky note, screenshotted, or passed on
     * verbally is wrong six days out of seven unless the rule travels
     * with it. For a tool shared with a handful of people that is the
     * realistic threat, so it is a real gain.
     *
     * Note: the day is read fresh on every check, so a session spanning
     * midnight will want the outer ring moved on. */
    dayRing: true,

    /* THE COMBINATION IS NOT IN THIS FILE.
     * Stored instead is a PBKDF2-SHA256 verifier over it, so reading
     * the source does not hand the answer over — pulling it out means
     * writing a brute-forcer and paying 250,000 iterations per guess.
     *
     * KEYSPACE, stated honestly: the markers are VISIBLE, so an
     * attacker already knows every valid target angle. The only secret
     * is which ring goes to which marker, giving arrows^rings
     * combinations — 12^5 = 248,832 at these defaults. At roughly
     * 50ms per verified guess on one core that is about 1.7 hours of
     * grinding, and far less on a GPU. Raise `arrows` and `rings` to
     * buy more; nothing client-side buys security outright.
     *
     * Generate a fresh combination with:  node set-combo.js
     * It prints the combo once, to your terminal, and writes only the
     * hashes here.
     *
     * With dayRing on there are SEVEN verifiers, indexed by
     * Date#getDay() (0 = Sunday). Each covers the whole arrangement
     * including the day ring, so no ring is ever compared in plaintext.
     * `comboHash` (singular) is the fallback when dayRing is off. */
    comboSalt: 'SZYsefVayVIYAaL5sijX7A==',
    comboHash: null,
    comboHashes: [
      'grh7W86n5N2dJiJiAuahsWhkt3bYKR6flwZJ7kz5F+I=',
      'X+Ve4ibzFkj9QghGWWuyCNsTcxCqGnch7tEV1whAArs=',
      'G0bgtzvsjSpJNUipvZ/d3TVInw0dWA+j9wtpYzq9wls=',
      '4J3Vvh0fEUu+BiMmDi7UNsEOjfVaDdpWLYzNkK/zXf0=',
      'Ixef6dsrEb2teEoQZV4I03A/X5KKqyvEGDvS5iHtoQs=',
      'jNfr3sEBex2j9VsZq96KqL1zP49GyVVvfS1qeLVZC7w=',
      'GtNDXBt5ClzAcPjyWQGwKG+l3hSSkMOXf2ji+dsZgU4=',
    ],
    comboIterations: 250000,
  },

  /* --- 'riddle' mode -------------------------------------------- */
  riddle: {
    question: 'What rate does this tool assume for long-run equity returns, as a whole number percent?',
    // Accepted answers, lower-cased and trimmed before comparison.
    answers: ['7', '7%', 'seven'],
    hint: 'Check the Return assumptions panel in the README.',
  },

  /* --- 'password' mode ------------------------------------------
   * PBKDF2-SHA256 verifier. The plaintext is not stored. Regenerate
   * with:  node set-password.js
   * ------------------------------------------------------------- */
  salt: 'wDHmfBhzBJYt3iZ0Jf4rxA==',
  hash: 'oZjWyyFctr+oK5QQrbrYlE4bF4GQMy62C0+hqnmdGdg=',
  iterations: 250000,

  /* Remember a solve for the browser tab's session only. 'local'
   * persists across restarts; null asks every time. */
  remember: 'session',
  storageKey: 'pf-forecaster-unlocked',
};

(function () {

  /* =================================================================
   * PUZZLE GENERATORS
   * Each returns { question, check(input), hint, format }.
   * `check` receives the raw string and decides. No answer is stored
   * anywhere outside the closure that generated it.
   * ================================================================= */

  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const money = (n) => '$' + n.toLocaleString('en-US');

  /** Pull the first number out of whatever the visitor typed. */
  function parseNumber(raw) {
    if (raw == null) return NaN;
    const cleaned = String(raw).replace(/[$,\s_]/g, '').replace(/%$/, '');
    if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
    return parseFloat(cleaned);
  }

  /** Numeric answer, tolerant of rounding and of "$" / "," formatting. */
  const numericCheck = (expected, tolerance = 0) => (raw) => {
    const v = parseNumber(raw);
    return Number.isFinite(v) && Math.abs(v - expected) <= tolerance;
  };

  /* --- Finance questions, all mentally solvable ------------------- */
  const FINANCE_PUZZLES = [
    // Growth on a round balance.
    () => {
      const bal = randInt(1, 9) * 100000;
      const rate = pick([5, 10, 20, 25, 50]);
      return {
        question: `A ${money(bal)} balance grows by ${rate}% over one year. What is it worth at the end?`,
        hint: `${rate}% of ${money(bal)} is ${money(bal * rate / 100)}.`,
        format: 'Enter a dollar amount',
        check: numericCheck(bal * (1 + rate / 100)),
      };
    },
    // Marginal rate tax saving on a deferral — the core idea of the tool.
    () => {
      const amt = randInt(1, 5) * 10000;
      const rate = pick([10, 20, 25, 50]);
      return {
        question: `You defer ${money(amt)} into a 401(k) and your marginal tax rate is ${rate}%. How much tax does that deferral avoid this year?`,
        hint: `It is simply ${rate}% of ${money(amt)}.`,
        format: 'Enter a dollar amount',
        check: numericCheck(amt * rate / 100),
      };
    },
    // Equity in a property.
    () => {
      const value = randInt(3, 9) * 100000;
      const debt = randInt(1, Math.floor(value / 100000) - 1) * 100000;
      return {
        question: `A property is worth ${money(value)} and carries a ${money(debt)} mortgage. What is the equity?`,
        hint: 'Value less what is owed.',
        format: 'Enter a dollar amount',
        check: numericCheck(value - debt),
      };
    },
    // Net of tax — mirrors the gross-up logic in the withdrawal solver.
    () => {
      const gross = randInt(1, 8) * 10000;
      const rate = pick([10, 20, 25, 50]);
      return {
        question: `You withdraw ${money(gross)} from a traditional account and pay ${rate}% tax on it. How much reaches your pocket?`,
        hint: `Subtract ${rate}% of ${money(gross)}.`,
        format: 'Enter a dollar amount',
        check: numericCheck(gross * (1 - rate / 100)),
      };
    },
    // An RMD divisor calculation.
    () => {
      const divisor = pick([20, 25, 40, 50]);
      const bal = divisor * randInt(2, 8) * 10000;
      return {
        question: `A required minimum distribution divides a ${money(bal)} balance by a life-expectancy factor of ${divisor}. What is the distribution?`,
        hint: 'Straight division.',
        format: 'Enter a dollar amount',
        check: numericCheck(bal / divisor),
      };
    },
    // Doubling time, via the rule of 72 — tolerant, since it's an estimate.
    () => {
      const rate = pick([6, 8, 9, 12]);
      return {
        question: `Using the rule of 72, roughly how many years does money take to double at ${rate}% a year?`,
        hint: 'Divide 72 by the rate.',
        format: 'Enter a number of years',
        check: numericCheck(72 / rate, 0.5),
      };
    },
    // Employer match.
    () => {
      const salary = randInt(1, 4) * 100000;
      const pct = pick([2, 4, 5, 10]);
      return {
        question: `Your employer matches 100% of your contributions up to ${pct}% of pay. On a ${money(salary)} salary, what is the largest match you can earn?`,
        hint: `${pct}% of ${money(salary)}.`,
        format: 'Enter a dollar amount',
        check: numericCheck(salary * pct / 100),
      };
    },
  ];

  function financePuzzle() { return pick(FINANCE_PUZZLES)(); }

  /* =================================================================
   * 'dial' — INTERACTIVE RING LOCK
   * -----------------------------------------------------------------
   * Concentric rings, each with one radial slot. A marker sits on the
   * fixed outer bezel at a random angle. Rotate every ring so its slot
   * points at the marker and the slots form one unbroken channel from
   * the hub to the rim.
   *
   * WHY THIS RESISTS AUTOMATION
   * The solution is a physical arrangement, not a value. There is no
   * string to type, so a text-only model has nothing to emit. Getting
   * in requires driving a real pointer to computed coordinates on
   * specific rings — a much higher bar than reading a question.
   *
   * Nothing is stored: the marker angle and the starting positions are
   * randomised per load, and "solved" is a geometric test on live
   * state.
   *
   * ACCESSIBILITY: this is a visual, pointer-driven challenge, so it
   * is a poor fit for screen readers. Arrow-key control is wired up
   * (Tab to focus, up/down picks a ring, left/right rotates it) but
   * that does not make it equivalent. If any of your visitors rely on
   * assistive technology, use 'riddle' or 'password' mode instead.
   * ================================================================= */
  function dialPuzzle() {
    const RINGS  = Math.max(2, Math.min(8, AUTH_CONFIG.dial?.rings ?? 5));
    const ARROWS = Math.max(2, Math.min(24, AUTH_CONFIG.dial?.arrows ?? 12));
    const STOPS  = Math.max(ARROWS, Math.min(48, AUTH_CONFIG.dial?.positions ?? 24));
    const STEP = (Math.PI * 2) / STOPS;

    /* Arrow k sits on this stop. Arrows are evenly spaced, so the combo
     * can be told as plain numbers ("ring 1 to arrow 7"). */
    const arrowStop = (k) => Math.round((k * STOPS) / ARROWS) % STOPS;
    const stopToArrow = (stop) => {
      for (let k = 0; k < ARROWS; k++) if (arrowStop(k) === stop) return k;
      return -1;
    };

    // Rings start somewhere random, so it is never part-solved for you.
    const angles = Array.from({ length: RINGS }, () => randInt(0, STOPS - 1));

    /* Layout is DERIVED from the ring count: a fixed band width ran the
     * dial off the canvas at five or six rings. */
    const SIZE = 320, C = SIZE / 2;
    const HUB = 24;
    const MARGIN = 6, BEZEL_W = 16, FIRST = HUB + 4;
    const GAP = RINGS > 5 ? 3 : 4;
    const usable = C - MARGIN - BEZEL_W - 4 - FIRST;
    const BAND = (usable - (RINGS - 1) * GAP) / RINGS;
    const ringInner = (i) => FIRST + i * (BAND + GAP);
    const ringOuter = (i) => ringInner(i) + BAND;
    const BEZEL_IN = ringOuter(RINGS - 1) + 4;
    const BEZEL_OUT = BEZEL_IN + BEZEL_W;
    const SLOT_HALF = STEP * 0.55;
    const DAY_RING = !!AUTH_CONFIG.dial?.dayRing;
    const toAngle = (idx) => idx * STEP - Math.PI / 2;   // 0 = straight up

    let selected = 0;
    let solvedAt = null;
    let onSolved = null;
    let canvas = null, ctx = null;
    let checking = false;
    let pendingRecheck = false; // a move arrived while a check was running
    let lastVerdict = '';       // feedback after a full but wrong attempt
    let onFeedback = null;

    /* --- Which ring sits on which arrow, or -1 ---------------------- */
    const currentCombo = () => angles.map((a) => stopToArrow(a));
    const allOnArrows = () => currentCombo().every((k) => k >= 0);

    /* --- Verify against the stored hash ----------------------------
     * The combination is NOT in this file. What is stored is a PBKDF2
     * verifier over it, so reading the source does not hand it over —
     * extracting it means writing a brute-forcer and paying 250,000
     * iterations per guess. See the header for the honest keyspace. */
    /** The day ring's target marker index: Sunday 0 ... Saturday 6. */
    const dayTargetIndex = () => new Date().getDay();

    async function comboMatches() {
      const cfg = AUTH_CONFIG.dial ?? {};

      /* Pick the verifier for today. With a day ring there are seven,
       * indexed by getDay(); the day is read at check time, not at load,
       * so a page left open across midnight behaves correctly. */
      const expected = (DAY_RING && Array.isArray(cfg.comboHashes))
        ? cfg.comboHashes[dayTargetIndex()]
        : cfg.comboHash;

      if (!expected || !cfg.comboSalt) {
        // Nothing configured: fall back to "every slot on marker 1", so
        // a fresh clone is usable before set-combo.js has been run.
        return currentCombo().every((k) => k === 0);
      }

      const probe = currentCombo().join('-');
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(probe), { name: 'PBKDF2' }, false, ['deriveBits']
      );
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: b64ToBytes(cfg.comboSalt),
          iterations: cfg.comboIterations ?? 250000, hash: 'SHA-256' }, key, 256
      );
      return constantTimeEqual(bytesToB64(bits), expected);
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== SIZE * dpr) {
        canvas.width = SIZE * dpr; canvas.height = SIZE * dpr;
        canvas.style.width = SIZE + 'px'; canvas.style.height = SIZE + 'px';
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      const solved = !!solvedAt;
      const combo = currentCombo();
      const onArrow = combo.filter((k) => k >= 0).length;

      // Rings: a full annulus minus the slot.
      for (let i = 0; i < RINGS; i++) {
        const a = toAngle(angles[i]);
        const ri = ringInner(i), ro = ringOuter(i);
        const seated = combo[i] >= 0;

        ctx.beginPath();
        ctx.arc(C, C, ro, a + SLOT_HALF, a - SLOT_HALF + Math.PI * 2);
        ctx.arc(C, C, ri, a - SLOT_HALF + Math.PI * 2, a + SLOT_HALF, true);
        ctx.closePath();
        // Seated on SOME arrow is shown; whether it is the RIGHT arrow
        // is deliberately not, or the lock would leak its own answer.
        const isDayRing = DAY_RING && i === RINGS - 1;
        ctx.fillStyle = solved ? '#bbf7d0'
          : seated ? (isDayRing ? '#e6dcfb' : '#d6e4fb')
          : (isDayRing ? '#e7e3f0' : '#dfe4ea');
        ctx.fill();
        ctx.lineWidth = i === selected ? 2 : 1;
        ctx.strokeStyle = i === selected ? '#2563eb'
          : seated ? (isDayRing ? '#b49ae8' : '#9ec0f0')
          : (isDayRing ? '#cbc2de' : '#c2c9d2');
        ctx.stroke();

        // A short spoke in the slot, so each ring's aim is unambiguous.
        ctx.beginPath();
        ctx.moveTo(C + Math.cos(a) * (ri + 1), C + Math.sin(a) * (ri + 1));
        ctx.lineTo(C + Math.cos(a) * (ro - 1), C + Math.sin(a) * (ro - 1));
        ctx.strokeStyle = solved ? '#15803d' : seated ? '#2563eb' : '#aab2bd';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Ring number, riding in the slot.
        const lr = (ri + ro) / 2;
        ctx.save();
        ctx.fillStyle = solved ? '#166534' : seated ? '#1d4ed8' : '#7c8694';
        ctx.font = '600 9px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1),
          C + Math.cos(a + STEP * 1.5) * lr, C + Math.sin(a + STEP * 1.5) * lr);
        ctx.restore();
      }

      // Fixed bezel.
      ctx.beginPath();
      ctx.arc(C, C, BEZEL_OUT, 0, Math.PI * 2);
      ctx.arc(C, C, BEZEL_IN, Math.PI * 2, 0, true);
      ctx.closePath();
      ctx.fillStyle = '#eef1f5'; ctx.fill();
      ctx.strokeStyle = '#cbd2db'; ctx.lineWidth = 1; ctx.stroke();

      // Every arrow, numbered. Identical: none of them says which ring
      // it belongs to — that mapping is the secret.
      for (let k = 0; k < ARROWS; k++) {
        const ang = toAngle(arrowStop(k));
        ctx.save();
        ctx.translate(C, C);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(BEZEL_IN + 1, 0);
        ctx.lineTo(BEZEL_OUT - 5, -5);
        ctx.lineTo(BEZEL_OUT - 5, 5);
        ctx.closePath();
        ctx.fillStyle = solved ? '#15803d' : '#b91c1c';
        ctx.fill();
        ctx.restore();

        const lr = BEZEL_OUT - 1;
        ctx.save();
        ctx.fillStyle = '#4b5563';
        ctx.font = '600 8px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(k + 1), C + Math.cos(ang) * lr, C + Math.sin(ang) * lr);
        ctx.restore();
      }

      // Hub.
      ctx.beginPath();
      ctx.arc(C, C, HUB, 0, Math.PI * 2);
      ctx.fillStyle = solved ? '#15803d' : checking ? '#7c3aed' : '#2563eb';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 10px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(solved ? 'OPEN' : checking ? '...' : `${onArrow}/${RINGS}`, C, C);

      canvas.setAttribute('aria-label',
        `Combination lock, ${RINGS} rings and ${ARROWS} numbered markers. ` +
        `${onArrow} of ${RINGS} rings are seated on a marker. Ring ${selected + 1} selected. ` +
        'Up and down arrows pick a ring, left and right turn it.');
    }

    function setFeedback(msg) {
      lastVerdict = msg;
      if (onFeedback) onFeedback(msg);
    }

    async function afterMove() {
      draw();
      if (solvedAt) return;
      if (!allOnArrows()) { if (lastVerdict) setFeedback(''); return; }

      /* A verification costs 250,000 PBKDF2 iterations, so only one runs
       * at a time. Turning a ring while one is in flight must not be
       * dropped, though: dragging quickly can seat the final ring mid
       * check, and the lock would then sit closed on a correct
       * combination. So record the arrangement being tested and, once
       * the check returns, re-run if the rings have moved since. */
      if (checking) { pendingRecheck = true; return; }
      checking = true; draw();

      const tested = currentCombo().join('-');
      let match = false, errored = false;
      try { match = await comboMatches(); }
      catch {
        errored = true;
        setFeedback('This browser could not run the check (needs HTTPS or localhost).');
      }
      checking = false;

      const movedSince = currentCombo().join('-') !== tested;
      if (pendingRecheck || movedSince) {
        pendingRecheck = false;
        return afterMove();
      }
      if (errored) { draw(); return; }

      if (match) {
        solvedAt = Date.now();
        setFeedback('');
        draw();
        setTimeout(() => onSolved && onSolved(), 550);
      } else {
        setFeedback('All rings are seated, but that is not the combination.');
        draw();
      }
    }

    function nudge(ring, dir) {
      angles[ring] = (angles[ring] + dir + STOPS) % STOPS;
      afterMove();
    }

    function ringAt(r) {
      for (let i = 0; i < RINGS; i++) {
        if (r >= ringInner(i) - 2 && r <= ringOuter(i) + 2) return i;
      }
      return -1;
    }

    function pointerAngleIndex(x, y) {
      const raw = Math.atan2(y - C, x - C) + Math.PI / 2;
      const idx = Math.round(raw / STEP);
      return ((idx % STOPS) + STOPS) % STOPS;
    }

    function mount(container, solvedCb, feedbackCb) {
      onSolved = solvedCb;
      onFeedback = feedbackCb;
      const wrap = document.createElement('div');
      wrap.className = 'dial-wrap';
      canvas = document.createElement('canvas');
      canvas.className = 'dial-canvas';
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'application');
      wrap.appendChild(canvas);
      container.appendChild(wrap);
      ctx = canvas.getContext('2d');

      let dragging = -1;
      const localPoint = (ev) => {
        const b = canvas.getBoundingClientRect();
        return [((ev.clientX - b.left) / b.width) * SIZE, ((ev.clientY - b.top) / b.height) * SIZE];
      };

      canvas.addEventListener('pointerdown', (ev) => {
        if (solvedAt) return;
        const [x, y] = localPoint(ev);
        const ring = ringAt(Math.hypot(x - C, y - C));
        if (ring < 0) return;
        ev.preventDefault();
        canvas.focus();
        canvas.setPointerCapture?.(ev.pointerId);
        dragging = ring; selected = ring;
        angles[ring] = pointerAngleIndex(x, y);
        afterMove();
      });
      canvas.addEventListener('pointermove', (ev) => {
        if (dragging < 0 || solvedAt) return;
        const [x, y] = localPoint(ev);
        const next = pointerAngleIndex(x, y);
        if (next !== angles[dragging]) { angles[dragging] = next; afterMove(); }
      });
      const endDrag = () => { dragging = -1; };
      canvas.addEventListener('pointerup', endDrag);
      canvas.addEventListener('pointercancel', endDrag);
      canvas.addEventListener('pointerleave', endDrag);

      canvas.addEventListener('keydown', (ev) => {
        if (solvedAt) return;
        const k = ev.key;
        if (k === 'ArrowLeft') { nudge(selected, -1); ev.preventDefault(); }
        else if (k === 'ArrowRight') { nudge(selected, 1); ev.preventDefault(); }
        else if (k === 'ArrowUp') { selected = (selected - 1 + RINGS) % RINGS; draw(); ev.preventDefault(); }
        else if (k === 'ArrowDown') { selected = (selected + 1) % RINGS; draw(); ev.preventDefault(); }
      });

      draw();
      // Test harness only. `setCombo` drives it to a known arrangement;
      // it cannot reveal the answer, because the answer is a hash.
      canvas.__dial = {
        angles, RINGS, ARROWS, STOPS, arrowStop, stopToArrow,
        currentCombo, allOnArrows, comboMatches, nudge, draw,
        geom: { SIZE, C, ringInner, ringOuter, BEZEL_IN, BEZEL_OUT, HUB, toAngle, STEP },
        isSolved: () => !!solvedAt,
        DAY_RING, dayTargetIndex,
        setCombo: (arrowIdx) => {
          for (let i = 0; i < RINGS; i++) angles[i] = arrowStop(arrowIdx[i]);
          return afterMove();
        },
      };
    }

    return {
      interactive: true,
      question: DAY_RING
        ? `Each of the ${RINGS} rings has to point at one specific numbered marker, out of ${ARROWS}. `
          + `The inner ${RINGS - 1} are a fixed combination. The outermost ring (the pale violet one) `
          + `changes every day.`
        : `Each of the ${RINGS} rings has to point at one specific numbered marker. `
          + `There are ${ARROWS} markers and the pairing is not shown — you need the combination.`,
      hint: `Click straight onto a ring at the marker you want; it snaps there. `
        + `Ring numbers ride in each slot, marker numbers sit on the outer bezel. `
        + `Arrow keys work too: up and down pick a ring, left and right turn it.`,
      mount,
    };
  }

  function arithmeticPuzzle() {
    const style = pick(['add', 'sub', 'mul']);
    if (style === 'mul') {
      const a = randInt(3, 12), b = randInt(3, 12);
      return { question: `What is ${a} × ${b}?`, hint: 'Times tables.',
        format: 'Enter a number', check: numericCheck(a * b) };
    }
    if (style === 'sub') {
      const a = randInt(40, 99), b = randInt(10, 39);
      return { question: `What is ${a} − ${b}?`, hint: 'Subtract.',
        format: 'Enter a number', check: numericCheck(a - b) };
    }
    const a = randInt(11, 59), b = randInt(11, 39);
    return { question: `What is ${a} + ${b}?`, hint: 'Add.',
      format: 'Enter a number', check: numericCheck(a + b) };
  }

  function sequencePuzzle() {
    const kind = pick(['arith', 'geo', 'square']);
    let terms, next, hint;
    if (kind === 'geo') {
      const start = randInt(1, 4), ratio = pick([2, 3]);
      terms = [0, 1, 2, 3].map((i) => start * Math.pow(ratio, i));
      next = start * Math.pow(ratio, 4);
      hint = 'Each term is a fixed multiple of the one before.';
    } else if (kind === 'square') {
      const off = randInt(0, 3);
      terms = [1, 2, 3, 4].map((i) => (i + off) * (i + off));
      next = (5 + off) * (5 + off);
      hint = 'These are square numbers.';
    } else {
      const start = randInt(2, 9), step = randInt(3, 9);
      terms = [0, 1, 2, 3].map((i) => start + i * step);
      next = start + 4 * step;
      hint = 'The gap between terms is constant.';
    }
    return {
      question: `What comes next?   ${terms.join(',  ')},  ?`,
      hint, format: 'Enter a number', check: numericCheck(next),
    };
  }

  function riddlePuzzle() {
    const r = AUTH_CONFIG.riddle;
    const accepted = r.answers.map((a) => String(a).trim().toLowerCase());
    return {
      question: r.question,
      hint: r.hint,
      format: 'Enter your answer',
      check: (raw) => accepted.includes(String(raw ?? '').trim().toLowerCase()),
    };
  }

  /* --- Password mode -------------------------------------------- */
  const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const bytesToB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));

  async function derive(password) {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: b64ToBytes(AUTH_CONFIG.salt),
        iterations: AUTH_CONFIG.iterations, hash: 'SHA-256' }, key, 256
    );
    return bytesToB64(bits);
  }

  function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function passwordChallenge() {
    return {
      question: 'This tool is password protected.',
      format: 'Password',
      isPassword: true,
      check: async (raw) => {
        try { return constantTimeEqual(await derive(raw), AUTH_CONFIG.hash); }
        catch { throw new Error('Web Crypto is unavailable — the page must be served over HTTPS or localhost.'); }
      },
    };
  }

  const GENERATORS = {
    dial: dialPuzzle,
    finance: financePuzzle,
    arithmetic: arithmeticPuzzle,
    sequence: sequencePuzzle,
    riddle: riddlePuzzle,
    password: passwordChallenge,
  };

  function makeChallenge() {
    const gen = GENERATORS[AUTH_CONFIG.mode] ?? dialPuzzle;
    return gen();
  }

  /* =================================================================
   * GATE UI
   * ================================================================= */

  const singleRound = () => ['password', 'riddle', 'dial'].includes(AUTH_CONFIG.mode);
  const totalRounds = () => (singleRound() ? 1 : Math.max(1, AUTH_CONFIG.rounds));

  const store = () => {
    try {
      return AUTH_CONFIG.remember === 'local' ? localStorage
        : AUTH_CONFIG.remember === 'session' ? sessionStorage : null;
    } catch { return null; }
  };
  const TOKEN = 'solved';
  const alreadyUnlocked = () => {
    try { return store()?.getItem(AUTH_CONFIG.storageKey) === TOKEN; } catch { return false; }
  };
  const rememberUnlock = () => {
    try { store()?.setItem(AUTH_CONFIG.storageKey, TOKEN); } catch { /* fine */ }
  };

  function reveal() {
    document.documentElement.removeAttribute('data-locked');
    document.getElementById('authGate')?.remove();
    // Charts size from a visible container, so nudge them once shown.
    window.dispatchEvent(new Event('resize'));
    /* Announce the unlock so the app can sequence what comes next.
     * Character creation must open AFTER the gate clears, not behind
     * it — otherwise it renders under the lock overlay and the user
     * never sees it. */
    window.__pfUnlocked = true;
    window.dispatchEvent(new Event('pf-unlocked'));
  }

  function buildGate() {
    let round = 0;
    let challenge = makeChallenge();
    let attempts = 0;

    const el = document.createElement('div');
    el.id = 'authGate';
    el.innerHTML = `
      <div class="auth-card">
        <h1 class="auth-title">Personal Finance &amp; Retirement Forecasting Tool</h1>
        <p class="auth-sub" id="authSub"></p>
        <div class="auth-progress" id="authProgress"></div>
        <p class="auth-question" id="authQ"></p>
        <div id="authStage"></div>
        <form id="authForm" autocomplete="off">
          <label class="auth-label" for="authPw" id="authFormat">Answer</label>
          <input class="auth-input" id="authPw" autocomplete="off" autofocus spellcheck="false">
          <button class="auth-btn" type="submit" id="authGo">Submit</button>
        </form>
        <p class="auth-error" id="authErr" role="alert"></p>
        <p class="auth-hint-line"><button type="button" class="auth-hintbtn" id="authHintBtn">Need a hint?</button>
          <span id="authHint"></span></p>
        <p class="auth-note">
          Nothing you enter into the tool is transmitted anywhere &mdash; every
          calculation runs locally in your browser and nothing is stored on a
          server. This gate keeps out bots and passers-by; it is not security.
        </p>
      </div>`;
    document.body.appendChild(el);

    const form = el.querySelector('#authForm');
    const input = el.querySelector('#authPw');
    const err = el.querySelector('#authErr');
    const btn = el.querySelector('#authGo');
    const qEl = el.querySelector('#authQ');
    const subEl = el.querySelector('#authSub');
    const fmtEl = el.querySelector('#authFormat');
    const hintEl = el.querySelector('#authHint');
    const hintBtn = el.querySelector('#authHintBtn');
    const progEl = el.querySelector('#authProgress');
    const stage = el.querySelector('#authStage');

    function render() {
      const n = totalRounds();
      subEl.textContent = challenge.isPassword
        ? challenge.question
        : challenge.interactive
          ? 'Open the lock to continue.'
          : (n > 1 ? `Solve ${n} quick questions to continue.` : 'Solve this to continue.');
      qEl.textContent = challenge.isPassword ? '' : challenge.question;
      qEl.style.display = challenge.isPassword ? 'none' : '';

      /* An interactive challenge owns its own surface and reports back
       * when it is solved, so the text field and submit button have no
       * role — there is nothing to type. */
      if (challenge.interactive) {
        form.style.display = 'none';
        stage.innerHTML = '';
        challenge.mount(stage, () => {
          if (AUTH_CONFIG.remember) rememberUnlock();
          reveal();
        }, (msg) => { err.textContent = msg || ''; });
        hintEl.textContent = '';
        hintBtn.style.display = challenge.hint ? '' : 'none';
        progEl.innerHTML = '';
        return;
      }
      form.style.display = '';
      stage.innerHTML = '';
      fmtEl.textContent = challenge.format ?? 'Answer';
      input.type = challenge.isPassword ? 'password' : 'text';
      input.setAttribute('autocomplete', challenge.isPassword ? 'current-password' : 'off');
      input.value = '';
      hintEl.textContent = '';
      hintBtn.style.display = challenge.hint ? '' : 'none';
      progEl.innerHTML = n > 1
        ? Array.from({ length: n }, (_, i) =>
            `<span class="auth-dot${i < round ? ' done' : i === round ? ' active' : ''}"></span>`).join('')
        : '';
      input.focus();
    }

    hintBtn.addEventListener('click', () => {
      hintEl.textContent = challenge.hint ?? '';
      hintBtn.style.display = 'none';
      input.focus();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      err.textContent = '';
      const busyLabel = challenge.isPassword ? 'Checking…' : 'Checking…';
      btn.textContent = busyLabel;
      await new Promise((r) => setTimeout(r, 20));   // let the label paint

      let ok = false;
      try {
        ok = await challenge.check(input.value);
      } catch (ex) {
        err.textContent = ex.message || 'Could not check that answer.';
        btn.disabled = false; btn.textContent = 'Submit';
        return;
      }

      if (ok) {
        round++;
        if (round >= totalRounds()) {
          if (AUTH_CONFIG.remember) rememberUnlock();
          reveal();
          return;
        }
        attempts = 0;
        challenge = makeChallenge();
        btn.disabled = false; btn.textContent = 'Submit';
        render();
        return;
      }

      attempts++;
      err.textContent = attempts >= 3
        ? 'Still not right — try the hint.'
        : 'Not quite. Try again.';
      // A wrong answer on a generated puzzle earns a NEW puzzle, so
      // guessing repeatedly at one question gets you nowhere.
      if (!singleRound() && attempts >= 2) {
        challenge = makeChallenge();
        err.textContent = 'Not quite — here is a different one.';
        attempts = 0;
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Submit'; render(); }, 400);
        return;
      }
      const wait = Math.min(1500, 250 * attempts);
      input.select();
      setTimeout(() => { btn.disabled = false; btn.textContent = 'Submit'; }, wait);
    });

    render();
  }

  function init() {
    /* mode 'off' means no gate at all. A combination lock is the right
     * default for something published on the open web, but it is a wall
     * in front of a tool someone runs on their own machine — and the
     * owner should not have to solve a puzzle to look at their own
     * forecast. Set it here, or leave the default for a public copy. */
    if (AUTH_CONFIG.mode === 'off') { reveal(); return; }
    if (alreadyUnlocked()) { reveal(); return; }
    buildGate();
  }

  // Lock immediately so the app never flashes before the gate appears.
  document.documentElement.setAttribute('data-locked', '');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* Exposed only so the test harness can drive the gate. `rebuild` lets
   * a test switch AUTH_CONFIG.mode and re-mount, since the gate is
   * constructed once at load. */
  window.__authInternals = {
    makeChallenge, parseNumber, GENERATORS, AUTH_CONFIG,
    rebuild() {
      document.getElementById('authGate')?.remove();
      document.documentElement.setAttribute('data-locked', '');
      buildGate();
    },
  };

})();

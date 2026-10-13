# Personal Finance & Retirement Forecasting Tool

A client-side, year-by-year personal finance simulator built to the
`Personal_Finance_Forecasting_Tool_Spec.txt` brief. No backend, no build step,
no dependencies except Chart.js from a CDN.

**This is a planning estimate tool, not tax or investment advice.**

---

## Quick start

```
git clone <your-repo-url>
cd personal-finance-forecaster
open index.html          # or just double-click it
npm test                 # 504 assertions across six suites
```

No dependencies, no build step, no server. Node is needed only for the
tests and the helper scripts.

### Putting it on GitHub Pages

1. Push this folder to a repository.
2. Settings -> Pages -> Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Your tool appears at `https://<user>.github.io/<repo>/`.

`index.html` is the entry point and loads the source files separately.
`forecaster.html` is the same app bundled into one file, useful for emailing or
running from a USB stick. **Set your own combination before you publish** — the
one shipped here is not private:

```
node set-combo.js        # prints a new combo once, writes only its hash
node build.js            # refresh forecaster.html
```

One caveat on Pages: the lock uses the Web Crypto API, which needs a secure
context. `https://` and `localhost` are fine. If you serve it over plain
`http://` the lock cannot verify and will tell you so.

## Running it

Open `index.html` in a browser. That's it.

`forecaster.html` is the same app bundled into one self-contained file — useful
for emailing, hosting, or opening from a USB stick. Regenerate it after any
source change with:

```
node build.js
```

Run the test suite with:

```
node test-engine.js        # 336 assertions
```

---

## Files

| File | What it is |
|---|---|
| `tax-config.js` | **All tax data.** Brackets, deductions, contribution limits, phase-outs, RMD tables, state rates. The only file to edit for a new tax year. |
| `money.js` | Decimal-safe arithmetic. Every monetary value is an integer number of cents. |
| `tax-engine.js` | Pure tax functions: brackets, LTCG stacking, FICA, NIIT, Social Security taxability, phase-outs. |
| `engine.js` | The simulation. Year loop, cash sweep, tax lots, withdrawals, RMDs, real estate, Monte Carlo. |
| `app.js` | HUD controller: bindings, delta badges, charts, settings, creation, optimiser. |
| `optimizer.js` | Auto-optimise. Coordinate ascent with spending held as a constraint. |
| `characters.js` | Occupation presets with provenance tags. The only file with preset data. |
| `avatar.js` | Layered SVG character. No image files. |
| `audio.js` | Synthesised interface audio. No sound files. |
| `index.html` / `styles.css` | Markup and styling. |
| `test-engine.js` | Engine verification suite. |
| `auth.js` | Entry gate — puzzle or password. Read its header before trusting it. |
| `test-auth-dial.js` / `test-auth.js` / `test-auth-flow.js` | Gate verification: ring lock, text generators, wiring. |
| `set-combo.js` | Set the lock's combination. Prints it once; writes only a hash. |
| `set-password.js` | Change the password if using `password` mode. |
| `build.js` | Bundler. |
| `forecaster.html` | Generated single-file build. |

---

## Spec coverage

| § | Requirement | Status |
|---|---|---|
| 2 | Year-by-year engine, global assumptions, per-year overrides, named scenarios | Done |
| 3 | Cash, Trad 401(k), Roth 401(k)/IRA, Trad IRA, brokerage, real estate, bonds bucket, HSA/529/gold/crypto | Done |
| 4 | Cash sweep: buffer, frequency, allocation, per-sweep tax lots, per-scenario toggle | Done |
| 5 | Salary + growth, 401(k) $ or %, match formula, Roth/Trad IRA with phase-outs, direct brokerage, filing status, state | Done |
| 6 | Federal brackets, pre-tax vs Roth, FICA with wage cap, LT/ST gains, ordinary treatment of Trad withdrawals, 10% penalty with exception toggle, state module, §121 exclusion, tax broken out by category | Done |
| 7 | Target spending, configurable withdrawal order, per-account detail, partial withdrawals across accounts, RMDs | Done |
| 8 | Per-asset-class returns, fixed mode, Monte Carlo, inflation, real-vs-nominal toggle | Done |
| 9 | Purchase price/date, amortisation, appreciation, property tax with reassessment cap, insurance, maintenance, sale with exclusion + costs + proceeds routing | Done |
| 10 | Stacked balance chart, net worth line, full table, withdrawal detail table, 2–4 scenario comparison, optimistic/average/pessimistic | Done |
| 11 | Client-side, versioned config, fixed-point money, fixed-return first then Monte Carlo, disclaimers | Done |
| 12 | Plaid, multi-currency, estate tax, self-employment tax | Out of scope, not built |

---

## Three things worth knowing about the implementation

**Money is integer cents, everywhere.** Section 11 asked for fixed-point
arithmetic. Every balance, contribution and tax figure is a whole number of
cents; every multiplication by a rate rounds straight back to a cent. A test
compounds a balance for 40 years and asserts the result is still an integer.
`Money.split()` and `Money.allocate()` distribute remainder pennies so no money
is created or destroyed when a sweep is divided into twelve monthly lots.

**Withdrawals are solved, not estimated.** Drawing from a traditional account
creates taxable income, which raises the tax bill, which raises the amount you
have to draw. The engine resolves that circularity with a fixed-point iteration
that converges to within a dollar — typically in three or four passes. A
single-pass approximation would understate retirement tax noticeably.

**The strongest test is conservation.** In a world with zero returns, zero
inflation and no state tax, ending net worth must equal starting net worth plus
wages minus spending minus tax, exactly, every year. That test catches
double-counted cash flows that directional "did it go up?" tests miss — it is
how the rental-income double-count and the Washington capital-gains bug were
found.

---

## Updating for a new tax year

Open `tax-config.js`, copy the most recent year block, change the key and the
figures, update `_meta.source` and `_meta.verifiedOn`, and list anything you
could not verify in `_meta.unverified` (the Assumptions tab displays that list
to the user). Nothing else needs to change.

Simulated years past the last configured year are projected by indexing the
latest table forward at your inflation assumption. Figures Congress did **not**
index are deliberately held flat — the NIIT threshold, the additional-Medicare
threshold, the Social Security taxability thresholds and the §121 home-sale
exclusion. That is what produces realistic bracket creep over a long forecast.

---

## Known simplifications

These are real and worth reading before trusting a number.

- **State tax is one flat rate per state, not a bracket table.** Graduated
  states (CA, NY, NJ, OR, MN…) are materially wrong at the extremes. Use the
  "Custom rate" option with a figure from your own return.
- **No AMT, itemised deductions, QBI deduction, or credits** (child tax credit,
  saver's credit, ACA premium credits).
- **Roth withdrawals before 59½ are treated as fully penalised.** In reality
  your own contributions come out tax- and penalty-free first. This is
  conservative, not accurate.
- **HSA withdrawals are modelled as non-medical.** Qualified medical
  withdrawals are tax-free at any age.
- **Annual granularity.** A lot bought and sold in the same calendar year is
  short-term; any earlier year is long-term. Real holding periods are daily.
- **Rental income is modelled simply** — no depreciation, no depreciation
  recapture on sale, no passive-activity loss limits.
- **Two figures in the 2026 config were not web-verified**: the §415(c)
  defined-contribution limit and the §401(a)(17) compensation limit. Both are
  flagged in `_meta.unverified` and surfaced in the Assumptions tab. They only
  affect after-tax / mega-backdoor modelling, which this version does not use.

---

## Tax data sources

2026 figures verified 23 September 2026 against:

- IRS Rev. Proc. 2025-32 — inflation adjustments (brackets, standard deduction)
- IRS Notice 2025-67 — retirement plan contribution limits
- SSA — 2026 Social Security wage base

---

## Security, and what the entry gate is really worth

`auth.js` puts a challenge in front of the tool. **Read this before trusting
it.**

### Modes

Set `AUTH_CONFIG.mode` in `auth.js`:

| Mode | What the visitor sees | Notes |
|---|---|---|
| `dial` *(default)* | An interactive combination lock to open | **Answer is an arrangement, not a string** |
| `finance` | A finance question with randomised numbers | Easy for a human — and easy for a language model |
| `arithmetic` | Generated sums | Fastest; best pure bot filter |
| `sequence` | Spot the next number | Generated |
| `riddle` | A fixed question you write | A shared secret — publishing burns it |
| `password` | Password prompt | PBKDF2 verifier, `node set-password.js` |

`AUTH_CONFIG.rounds` sets how many puzzles must be solved in a row for the text
modes (default 2); a wrong answer twice swaps in a different puzzle, so guessing
at one question gets nowhere. `dial` is a single challenge. A solve is
remembered for the browser tab's session.

**Accessibility:** `dial` is visual and pointer-driven, so it is a poor fit for
screen readers. Arrow-key control is wired up, but that does not make it
equivalent. If any of your visitors rely on assistive technology, use `riddle`
or `password` instead.

### The combination lock, and how to solve it

Six concentric rings, each cut with one slot. Twelve numbered red markers on
the outer bezel. **Every ring has to point at one specific marker, and the
pairing is not shown** — you need the combination. The inner five are fixed;
the outermost changes daily (see below).

Ring numbers ride inside each slot; marker numbers sit on the bezel. A ring
turns blue once it is seated on *any* marker, and the hub counts how many are
seated. It deliberately does **not** tell you whether a ring is on the *right*
marker — that would leak the answer one ring at a time. Seat them all and it
either opens or says "that is not the combination."

**Click straight onto a ring, at the marker you want.** It snaps there. Six
clicks and you are in. Dragging fine-tunes; arrow keys work too (up/down picks
a ring, left/right turns it).

### The day ring

The **outermost** ring (tinted pale violet) is not part of the fixed
combination. Its target is the day of the week, in the visitor's own timezone:

| Day | Marker |
|---|---|
| Sunday | 1 |
| Monday | 2 |
| Tuesday | 3 |
| Wednesday | 4 |
| Thursday | 5 |
| Friday | 6 |
| Saturday | 7 |

So if your fixed rings were `4-1-7-10-2`, you would enter `4-1-7-10-2-1` on a
Sunday and `4-1-7-10-2-6` on a Friday. (An illustration — not a live
combination.)

`set-combo.js` stores **seven** PBKDF2 verifiers, one per weekday, each covering
the whole six-ring arrangement. No ring is ever compared in plaintext, and the
day is read at check time rather than page load, so a tab left open across
midnight simply wants the outer ring moved on.

**What this buys, honestly:** nothing against someone reading `auth.js` — the
rule is in the source and the date is public, so the keyspace stays at
`arrows ^ fixed rings`. What it does buy is protection against the *likely*
leak: a combination on a sticky note, in a screenshot, or passed on verbally is
wrong six days out of seven unless the rule travels with it. For a tool shared
with a few people, that is the realistic threat.

Turn it off with `dayRing: false` and re-run `set-combo.js`.

### Setting the combination

```
node set-combo.js              # random, prints it once
node set-combo.js 4 1 7 10 2   # one you choose (fixed rings only)
node set-combo.js --print      # show without writing
node build.js                  # refresh forecaster.html
```

With `dayRing` on you supply one number fewer than `rings` — the day ring is
derived, not chosen.

The combination is **never written to disk.** `set-combo.js` prints it to your
terminal and writes only a PBKDF2-SHA256 verifier into `auth.js`. Generating it
yourself is strictly better than being told it — nobody else, and no chat log,
ever sees it.

### Keyspace — the honest number

The markers are **visible**, so an attacker already knows every valid target
angle. The only secret is which ring pairs with which marker, giving
`arrows ^ rings` combinations:

| Markers | Rings | Combinations | Brute force, 1 core @50ms/guess |
|---|---|---|---|
| 8 | 4 | 4,096 | ~2 min |
| 8 | 5 | 32,768 | ~14 min |
| **12** | **5 fixed + day** | **248,832** | **~1.7 hours** |
| 12 | 6 | 2,985,984 | ~21 hours |
| 16 | 6 | 16,777,216 | ~5 days |

Hashing the combination is what makes those numbers mean anything: reading
`auth.js` gives a verifier, not an answer, so extracting it means writing a
brute-forcer and paying 250,000 iterations per guess. A GPU collapses all of it.
Raise `arrows` and `rings` to buy more time; nothing client-side buys security
outright.

### Why an interactive puzzle beats both a password and a text puzzle

A text question — even a randomised one — is exactly what a language model is
good at. That is why `finance` is no longer the default: it reads the question
and types the answer.

The combination lock has **no answer to type**. The solution is a physical
arrangement of rings, checked against a hash. A text-only model has nothing to
emit, and cannot read the answer out of the source either. Getting in requires
both the combination and a real pointer driven to computed coordinates on
specific rings.

### Why a generated challenge beats a password here

A password's whole value is that the visitor knows a secret. Publish the repo
and the secret is public — the value is gone, and you have burned a password you
might have reused. A **generated** puzzle stores no answer at all: the question
and its solution are computed fresh on each load from random parameters. There
is nothing in the source to look up.

Stated plainly: a puzzle is **weaker** against a determined human, who just
solves it. It is **stronger** against everything else, and it survives being
published. For a public repo that is the better bet, which is why `finance` is
the default.

### What none of it does

Every mode runs in the visitor's browser. Nothing is checked on a server,
because GitHub Pages has no server to check it on. It is a **doormat, not a
lock.**

What it genuinely does:

- stops crawlers, scrapers and bots, which will not solve a puzzle
- stops drive-by visitors who cannot be bothered
- signals the page is not meant to be public

What it does **not** do:

- protect anything committed to the repository
- stand up to anyone who opens devtools

### If you use `password` mode

The password itself is not stored. What is stored is a PBKDF2-SHA256 verifier
over a random salt at 250,000 iterations, so the plaintext isn't sitting in the
repo and offline guessing is slowed. Slowed, not stopped — a short or
predictable password still falls to a wordlist quickly, and **on a public repo
it is public**, so never reuse one that matters.

```
node set-password.js      # prompts, hidden input, rewrites auth.js
node build.js             # refresh forecaster.html
```

### Tests

```
node test-auth-dial.js    # the combination lock. Does NOT know the combo:
                          # it brute-forces a reduced keyspace to prove
                          # exactly one arrangement opens the lock. Also
                          # geometry for 2-8 rings, click-to-snap,
                          # rejection of seated-but-wrong, keyboard route
node test-auth.js         # text puzzle generators: 2,000 draws per mode,
                          # and every finance puzzle solved by independent
                          # re-derivation from its own wording
node test-auth-flow.js    # the gate's wiring, against a DOM shim
```

### If you want actual access control

Host the page behind something that authenticates on a **server**, before the
page is ever sent:

| Option | Notes |
|---|---|
| **Cloudflare Access** | Free for small teams. Real identity checks in front of any origin, including GitHub Pages via a custom domain. The closest thing to "free and actually secure". |
| Netlify / Vercel password protection | Server-side, on paid tiers. One toggle. |
| Any host with HTTP Basic auth | Crude but genuinely server-side. |
| Private repo, no public hosting | Fully secure; clone and open `index.html` locally. |

GitHub Pages has no server-side auth of its own, so a gate served from it is
always client-side.

### Keep your own numbers out of the repository

**This matters more than the gate.** These files contain real salary figures,
account balances and a name, and the password gate does nothing to protect
them — anything in the repo is visible to anyone who can see the repo:

- your own scenario file (anything matching `*-scenario.js`)
- anything generated for an adviser (`cpa-review.*`)

Both are listed in `.gitignore`. Verify before your first push:

```
git status --ignored     # confirm they appear under "Ignored files"
git ls-files             # confirm they do NOT appear here
```

If either has already been committed, removing it in a later commit is not
enough — it stays in the history. Use `git filter-repo` or start the repo
fresh.

The tool itself holds no data. Everything you type stays in memory in your own
browser; nothing is transmitted or persisted server-side. So the calculator is
safe to publish. Your scenario files are not.

---

## The HUD

The interface is a dark instrument panel rather than a form. One rule runs
through it: **cyan carries data, amber carries state.** That keeps a cool glass
readout and a warm industrial character bay on the same screen without them
fighting, and it gives the warmth a job.

- **Status strip** — net worth at your target age, lifetime tax, Monte Carlo
  success, plan status. Every one shows a **delta badge** when you move a
  control, so a change here is visibly a consequence there.
- **Command card** — the six settings you actually tune, in fixed positions.
  `1`–`6` to focus, `↑`/`↓` to adjust.
- **Six views** — Balances, Net worth, Tax, Flow, Bands, Table. The net-worth
  view keeps a **ghost trace** of the previous run so you see before and after
  on the same axes. Retirement and depletion are drawn as markers on every one.
- **Year scrubber and inspector** — drag along the horizon and the right column
  decomposes that single year: every source in, every destination out, the tax
  breakdown, conversions, RMDs, penalties, and any warnings the engine raised.
- **Character bay** — a compact portrait niche inside the strip, holding an
  armoured operator portrait built from your creation choices. Click it and it
  reacts: salute, flex, and eventually visible irritation, with a line of
  role-appropriate chatter. Purely cosmetic, and structurally unable to stretch
  the header.
- **Settings** — ten pages, live-applying, with an amber dot on any page holding
  a non-default value.

Keys: `S` settings · `C` character · `M` mute · `Esc` close.

## Running order

1. **Entry lock** — the combination dial (see above).
2. **Character creation** — its own page, on first visit. Pick an occupation,
   presentation, state and saver percentile; the presets fill the settings from
   published medians.
3. **Settings, page 1** — creation hands straight off here, so the numbers a
   preset just derived get confirmed by a human rather than silently assumed.
   Every field keeps its provenance badge: `measured`, `derived` or `statute`.
4. **The HUD.**

Solving the lock is also the browser gesture that lets audio start, which is why
music and cues can ship switched on. Both are togglable in Settings → Audio.

## Two front doors

The first thing the app asks is how you want to use it. Same engine either way —
same tax rules, same arithmetic, same forecast. The choice only decides how much
theatre comes with it, and it is switchable any time from **Settings › Mode**.

| | **Planner** | **Arcade** |
|---|---|---|
| Soundtrack and sounds | off | on |
| Your operator in the corner | hidden | animated, clickable |
| Wording | ordinary sentence case | uppercase HUD |
| Auto-optimise | on the toolbar | hidden behind a cheat code |
| Character creation | offered, not required | first stop |
| On opening | dashboard, with three pointers | build your operator, then confirm in Settings |

A mode writes nothing but presentation flags. It cannot touch a number in your
forecast — the toggles go through a separate lookup from the ones that feed the
engine, and there is a test asserting no mode definition so much as mentions an
input key. That boundary is what makes switching safe mid-session.

### Why this exists

Everything about the app assumed one kind of visitor. Someone opening it to plan
their own retirement met a combination lock, then compulsory character creation,
then a 128bpm soundtrack, then six tabs named things like "Bands", with the most
useful feature hidden behind a key sequence. Every one of those was a deliberate
choice and all of them were right for the arcade reading. None of them were
right for a planner, and the planner had no door.

## Finding your way around

- **Press `?`** (or `H`, or the `?` button beside the chart tabs) for help:
  getting started, what each of the six views actually shows, the keyboard map, a
  plain-English glossary — pre-tax vs Roth, effective rate, RMDs, sequence risk —
  and an honest page separating what the model gets right, what it simplifies and
  what is pure guesswork.
- **A line under the chart tabs** says what the current view is for, instead of
  leaving "Bands" to be guessed at.
- **Three pointers on first run**, dismissed for good once read, replayable from
  Settings › Mode.
- **The Monte Carlo cell** in the top strip used to sit at `—` reading "open Bands
  to run", with no way to act on it. It is now the button that runs it.

### The inspector no longer disappears

The right-hand column decomposes a single year completely — every source of money
in, every destination out, the tax breakdown, conversions, RMDs, penalties and
warnings. It was `display: none` below 1100px, so on any laptop with a narrow
window the richest panel in the app silently vanished. It now moves below the
chart and the page scrolls.

### No gate, if you want

`auth.js` supports `mode: 'off'`, which opens straight to the app. Right for a
private copy on your own machine; wrong for anything published, where it means no
barrier at all. The default stays `'dial'`.

## Charts, and what happens when the library does not load

Charts use **Chart.js**, pinned and fetched from `cdn.jsdelivr.net` with an
integrity hash. Everything else — every number, every tax figure, the whole
simulation — is computed locally and needs no network.

If that one script does not load (offline, a blocked CDN, a corporate proxy, an
SRI mismatch), the app draws the charts itself with a built-in SVG renderer and
says so under the panel. The fallback is plainer — no tooltips, no animation,
and secondary-axis series are omitted rather than drawn against the wrong scale
— but the shape of the forecast, the axes, the legend and the retirement and
depletion markers are all there.

**To make it fully offline**, put the library in `vendor/` and rebuild:

```
curl -O https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js
mv chart.umd.js vendor/
node build.js          # inlines it and drops the CDN tag
```

### Why this exists

`new Chart` threw a `ReferenceError` when the script was missing, and because
every panel was rendered in one statement the throw took out the chart *and
everything after it*: the live controls, the year ticks, the inspector and the
character bay. One blocked script blanked most of the HUD, and the only visible
symptom was "no chart".

Two changes fix it, and both are pinned by tests:

- **Render steps are isolated.** `renderAll()` loops over named steps and wraps
  each one, reporting a failure once instead of every frame. A broken panel
  cannot take its neighbours with it.
- **The config is built once and handed to whichever renderer is available.**
  `svg-chart.js` consumes the *same* Chart.js config object, so there is no
  second copy of the per-view logic to drift out of step. It lives in its own
  file so it can be tested directly against a config from every view.

`test-svg-chart.js` covers stacked bars, stacked areas, dashed ghost lines,
transparent borders, negative values, a secondary axis, seven kinds of
degenerate input, and label escaping. `test-render.js` boots the whole app with
Chart.js deliberately absent and asserts every other panel still renders.

## Diagnostics

Settings → **Diagnostics** reports whether Chart.js loaded and from where, which
renderer is drawing, the chart area's measured size, whether any pixels were
actually painted, which render steps failed, and the state of the simulation and
audio. **Copy diagnostics** puts a plain-text report on the clipboard — or shows
it in a text box when the clipboard is blocked, which browsers do on `file://`.

If something looks wrong, that report is the thing to send.

## Auto-optimise — hidden behind a cheat code

The optimiser hands you the answer, and turning the dials yourself is the point
of the tool. So it is not on the screen. There is no button, no hint, and the
`O` key does nothing until it is unlocked. **Two ways in:**

```
  UP  RIGHT  DOWN  LEFT      (twice)
  M   A   X
```

Two full clockwise sweeps of a D-pad — echoing the ring lock on the way in —
then asking for the maximum. Or **click the operator in the top-right corner
seven times**, which is how people actually explore this kind of UI.

Amber diamonds appear beside the key hints from the first move, so a
half-entered code is visible rather than silent, and a pause of about three and
a half seconds resets it. Once accepted it persists, and `O` and the amber
button appear for good.

Notes on the keys: the first arrow press also nudges whatever control is
focused, which is expected — the detector only starts swallowing keys two moves
in, once the sequence is clearly deliberate. At that point it also takes focus
out of any field you were typing in, so the remaining arrows do not edit a
number on the way past.

**If you forget it:** Settings → Diagnostics → Auto-optimise → *Show me how*.
That is two clicks into a page a casual visitor has no reason to open, which is
hidden enough, and it means the person who owns the repo can always find their
own cheat code.

### Why it is wired to the capture phase

The keyboard handler returns early whenever focus is in an `input`, `select` or
`textarea` — sensible, so typing in a field does not trigger hotkeys. But
character creation now hands off to Settings, which is wall-to-wall number
fields. One click in a field and every keystroke was swallowed before the
detector saw it: the combination silently did not work, and nothing on screen
explained why. The detector now listens on `window` in the **capture phase**,
ahead of that guard. `test-sequence.js` enters the whole sequence with every
keystroke arriving as if from a focused number input, because testing only the
easy case passed while the feature was unusable.

Give it a target age and it searches the settings that are
genuinely your choice, then reports **what it changed and what each change was
individually worth** — measured by reverting that one move and re-running.

What it may **never** change: spending, salary, age, state, filing status, or
your balances. Those are facts, not choices. The constraint matters more than
the search: left free, "maximise net worth" answers *spend nothing and buy only
equities*. There is a test proving the constraint is load-bearing — starving
spending scores higher than the optimised plan, so it would be chosen if it
could be.

Two more guards, both deliberate:

- **Equity weight is bounded** and the winner must clear a Monte Carlo success
  floor. Raising equities lifts the average by fattening the bad tail; the
  search runs on fixed returns, so the winner is re-checked properly and the
  risk lever walked back if it fails.
- **The cash buffer is floored at 3 months.** Left free the optimiser drives it
  to 1, because the model sees the drag of idle cash and never sees a job loss.

A move worth nothing on its own is labelled **neutral** rather than listed as a
win, and on a genuinely unsalvageable plan it reports no gain instead of
manufacturing one.

## Character presets

Three choices — role, place, stage — fill in sixty inputs. Every value is badged
by provenance, and **the badge never fades**:

| Badge | Meaning |
|---|---|
| `measured` | Published for this occupation — BLS OEWS median wage. |
| `derived` | Inferred from age and income band. Nobody publishes balances by occupation. |
| `statute` | Fixed in law — state tax, SSA life tables. |

**The saver percentile is an explicit choice, not a hidden assumption.** Median
401(k) is roughly $40k at 35–44 and $68k at 45–54, and over half of US
households report no retirement savings at all. A genuinely median saver mostly
does not retire early, and the presets say so:

| Role | Median saver | Strong saver |
|---|---|---|
| Surgeon | runs dry at 88 | $53.1M |
| Software engineer | $490,009 | $30.3M |
| Registered nurse | $343,579 | $20.8M |
| Teacher | $2,926,058 | $16.8M |

The teacher beating the software engineer on median is the pension earning its
keep — which is why that preset exists.

**Presentation affects the avatar and one number: life expectancy** (SSA period
tables). It does not touch salary. Using sex-specific wage medians would bake a
population statistic into a personal forecast and hand women a worse default,
which is wrong at the individual level — pay tracks role, market and tenure.
There is a test asserting salary, balances, spending and contributions are
identical across presentations.

## Audio

Synthesised live from oscillators — squelch on open, servo clunk on commit, low
horn on a warning, double beep on confirm, plus an optional music bed whose
intensity follows plan health. Nothing is sampled, because a two-minute loop as
base64 would be several megabytes and this has to stay one file. **Off by
default**; `M` mutes from anywhere.

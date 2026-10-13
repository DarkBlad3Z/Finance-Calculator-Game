/* ===================================================================
 * avatar.js — ARMOURED OPERATOR PORTRAITS
 * -------------------------------------------------------------------
 * Full-body figures as inline SVG. No image files: the app ships as one
 * self-contained page, and sprites would bloat it. SVG also stays sharp
 * at both sizes used — ~210px on the creation stage, 68px in the bay.
 *
 * DESIGN REGISTER
 * Heavy industrial-military: broad pauldrons, plated torso, visor,
 * backpack unit, gauntlets, greaves, a glowing power core and a rim
 * light. Each role keeps its identity through PLATE COLOUR, EMBLEM and
 * a shoulder-mounted TOOL rather than through soft clothing.
 *
 * These are original designs in a shared genre vocabulary — not any
 * existing game's unit art. The medical role uses an ECG glyph rather
 * than a cross, since the red cross is a protected emblem.
 *
 * Animation is CSS classes only (b-brth, b-shift, b-cuff, b-eye,
 * b-core) so one `prefers-reduced-motion` rule stops all of it.
 * `pose` drives click reactions: 'idle' | 'salute' | 'flex' | 'annoyed'.
 * =================================================================== */

'use strict';

const AVATAR_SKIN = ['#f5d7bd', '#e8b48a', '#d9a077', '#c17f57', '#9c6640', '#6f452a', '#4a2c1a'];
const AVATAR_HAIR = ['#2f2b38', '#5a3b2e', '#8b5a2b', '#c49a3a', '#9ca3af', '#6d28d9', '#141418'];

/* plate  = main armour        trim  = panel lines and edges
 * accent = emblem + core glow  visor = faceplate tint
 * tool   = shoulder rig        emblem= chest glyph                  */
const ATTIRE = {
  scrubs: { label: 'Trauma rig', plate: '#2f7f9e', trim: '#1b5570', accent: '#5ee9d0',
    visor: '#7ff0e0', tool: 'ampoule', emblem: 'ecg' },
  coat: { label: 'Field medic', plate: '#d8e2e8', trim: '#9aa9b4', accent: '#4ade80',
    visor: '#b6f5cb', tool: 'scanner', emblem: 'ecg' },
  suit: { label: 'Counsel plate', plate: '#20293a', trim: '#0e1420', accent: '#f04848',
    visor: '#ff8f8f', tool: 'codex', emblem: 'scales' },
  blazer: { label: 'Broker harness', plate: '#2b3a55', trim: '#16203a', accent: '#ffc24a',
    visor: '#ffd98a', tool: 'antenna', emblem: 'arrow' },
  hoodie: { label: 'Cipher shell', plate: '#5b4cd6', trim: '#33298f', accent: '#5ec8ff',
    visor: '#8fdcff', tool: 'drone', emblem: 'brackets' },
  rolledSleeves: { label: 'Draft frame', plate: '#c9d0d7', trim: '#8c96a1', accent: '#ffa62b',
    visor: '#ffd08a', tool: 'tube', emblem: 'compass' },
  shirt: { label: 'Analyst plate', plate: '#6f93bd', trim: '#3f5f87', accent: '#5ec8ff',
    visor: '#9fdcff', tool: 'slate', emblem: 'sigma' },
  cardigan: { label: 'Mentor plate', plate: '#a85440', trim: '#743325', accent: '#ffd166',
    visor: '#ffe3a3', tool: 'codex', emblem: 'book' },
  hardHat: { label: 'Grid rig', plate: '#c98a2b', trim: '#8c5a12', accent: '#ffe066',
    visor: '#ffeaa0', tool: 'arc', emblem: 'bolt' },
};

const BUILDS = {
  slim: { w: 30, pauldron: 11, scale: 0.94 },
  average: { w: 35, pauldron: 14, scale: 1.00 },
  broad: { w: 41, pauldron: 17, scale: 1.06 },
};

/* ---------- chest emblems ---------- */
function emblem(kind, c) {
  const g = (inner) => `<g transform="translate(70 96)">${inner}</g>`;
  switch (kind) {
    case 'ecg': return g(`<path d="M-11 0h4l2-5 3 10 3-5h4" stroke="${c}" stroke-width="2"
      fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    case 'scales': return g(`<path d="M0-7v13M-8-7h16M-8-7l-3 6h6zM8-7l3 6h-6z" stroke="${c}"
      stroke-width="1.7" fill="none" stroke-linecap="round"/>`);
    case 'arrow': return g(`<path d="M-9 5l6-7 4 4 8-9M5-7h5v5" stroke="${c}" stroke-width="2"
      fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    case 'brackets': return g(`<path d="M-5-6l-5 6 5 6M5-6l5 6-5 6M2-8l-4 16" stroke="${c}"
      stroke-width="1.9" fill="none" stroke-linecap="round"/>`);
    case 'compass': return g(`<circle r="7.5" stroke="${c}" stroke-width="1.7" fill="none"/>
      <path d="M-3 4l3-9 3 9-3-2z" fill="${c}"/>`);
    case 'sigma': return g(`<path d="M5-7H-6l6 7-6 7h11" stroke="${c}" stroke-width="2"
      fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    case 'book': return g(`<path d="M-8-6h7v13h-7zM1-6h7v13H1z" stroke="${c}" stroke-width="1.6"
      fill="none"/><path d="M0-7v15" stroke="${c}" stroke-width="1.6"/>`);
    case 'bolt': return g(`<path d="M2-8l-7 9h5l-2 7 8-10h-5z" fill="${c}"/>`);
    default: return '';
  }
}

/* ---------- shoulder-mounted tool ---------- */
function tool(kind, a) {
  switch (kind) {
    case 'ampoule': return `<g transform="translate(104 72)">
      <rect x="-3" y="-13" width="6" height="20" rx="3" fill="#123" stroke="${a.trim}"/>
      <rect x="-1.6" y="-4" width="3.2" height="9" rx="1.6" fill="${a.accent}"/></g>`;
    case 'scanner': return `<g transform="translate(104 70)">
      <rect x="-5" y="-10" width="10" height="14" rx="2" fill="#18202b" stroke="${a.trim}"/>
      <rect x="-3" y="-8" width="6" height="6" rx="1" fill="${a.accent}" opacity=".85"/></g>`;
    case 'codex': return `<g transform="translate(105 76) rotate(9)">
      <rect x="-6" y="-11" width="12" height="17" rx="1.5" fill="#1b2230" stroke="${a.trim}"/>
      <path d="M-3-6h6M-3-2h6M-3 2h4" stroke="${a.accent}" stroke-width="1.2" opacity=".85"/></g>`;
    case 'antenna': return `<g transform="translate(104 66)">
      <path d="M0 8V-16" stroke="${a.trim}" stroke-width="2.4"/>
      <circle cy="-18" r="3" fill="${a.accent}"/>
      <path d="M-5-10h10" stroke="${a.trim}" stroke-width="1.8"/></g>`;
    case 'drone': return `<g transform="translate(108 58)">
      <ellipse rx="7" ry="4" fill="#1b2230" stroke="${a.trim}"/>
      <circle r="2" fill="${a.accent}"/>
      <path d="M-9-1h-3M9-1h3" stroke="${a.trim}" stroke-width="1.6"/></g>`;
    case 'tube': return `<g transform="translate(106 78) rotate(15)">
      <rect x="-3.5" y="-15" width="7" height="26" rx="3.5" fill="#e9eef3" stroke="${a.trim}"/>
      <path d="M-3.5-8h7" stroke="${a.trim}" stroke-width="1.2"/></g>`;
    case 'slate': return `<g transform="translate(105 76)">
      <rect x="-7" y="-9" width="14" height="14" rx="1.5" fill="#101823" stroke="${a.trim}"/>
      <path d="M-4-5h8M-4-1h8M-4 3h5" stroke="${a.accent}" stroke-width="1.1" opacity=".8"/></g>`;
    case 'arc': return `<g transform="translate(104 70)">
      <path d="M0 8V-12" stroke="${a.trim}" stroke-width="3"/>
      <path d="M-6-12q6-7 12 0" stroke="${a.accent}" stroke-width="2" fill="none"/>
      <circle cy="-14" r="2.4" fill="${a.accent}"/></g>`;
    default: return '';
  }
}

/* ---------- one articulated arm ----------
 * dir: -1 left, +1 right. sx: shoulder x. Upper arm hangs from the
 * shoulder; the forearm group rotates about the elbow inside it.
 */
function arm(dir, sx, shoulder, elbow, a, skin, uid) {
  const UP = 30;                 // upper-arm length
  const ex = sx + dir * 5;       // elbow x
  const ey = 84 + UP;            // elbow y
  /* A darker, heavier outline than the rest of the rig: the arm sits
   * directly against a torso of the same plate colour, and without it
   * the limb dissolves into the chest. */
  const o = `stroke="#0b1016" stroke-width="1.6" stroke-opacity=".55"`;
  /* Every offset is computed as a number before it reaches the path
   * string. Writing `-${dir * 13}` produced "--13" on the left arm —
   * invalid path data, so the browser dropped the rest of the path and
   * the arm silently vanished. Numbers carry their own sign. */
  const n = (v) => (v < 0 ? String(v) : '+' + v);
  return `<g transform="rotate(${shoulder} ${sx} 84)">
    <path d="M${sx - dir * 8} 80
             q${n(dir * 15)} 2 ${n(dir * 13)} ${UP - 4}
             l${n(-dir * 13)} 3 q${n(-dir * 4)} -14 ${n(-dir * 2)} ${-(UP - 7)}z"
          fill="url(#${uid}p)" ${o}/>
    <circle cx="${ex}" cy="${ey - 3}" r="6.5" fill="${a.plate}" ${o}/>
    <g transform="rotate(${elbow} ${ex} ${ey - 3})">
      <path d="M${ex - 6} ${ey - 5} h12 q2 16 0 26 h-12 q-2 -10 0 -26z"
            fill="${a.plate}" ${o}/>
      <path d="M${ex - 5} ${ey + 8} h10" stroke="${a.accent}" stroke-width="1.6"
            opacity=".8"/>
      <rect x="${ex - 7}" y="${ey + 20}" width="14" height="9" rx="2.5"
            fill="#161d27" ${o}/>
      <circle cx="${ex}" cy="${ey + 34}" r="5.5" fill="${skin}"/>
    </g>
  </g>`;
}

/* ---------- poses for click reactions ---------- */
/* Each arm is two segments, so a pose sets the shoulder AND the elbow.
 * Without the elbow, "flex" came out as a scarecrow — both arms straight
 * out sideways. A flex is shoulder out, elbow folded back up. */
const POSES = {
  idle:    { armR:   4, armL:  -4, elbowR:   6, elbowL:  -6, lean:    0, headTilt: 0 },
  salute:  { armR: -64, armL:  -4, elbowR: -78, elbowL:  -6, lean:    0, headTilt: -4 },
  flex:    { armR: -78, armL:  78, elbowR:-104, elbowL: 104, lean:    0, headTilt: 0 },
  annoyed: { armR:  30, armL: -30, elbowR:  62, elbowL: -62, lean:    2, headTilt: 6 },
};

/* -------------------------------------------------------------------
 * buildAvatar — returns an SVG string.
 * ----------------------------------------------------------------- */
function buildAvatar(o = {}) {
  const a = ATTIRE[o.attire] ?? ATTIRE.shirt;
  const skin = AVATAR_SKIN[Math.max(0, Math.min(6, o.skinTone ?? 2))];
  const hair = AVATAR_HAIR[Math.max(0, Math.min(6, o.hairColour ?? 0))];
  const b = BUILDS[o.build] ?? BUILDS.average;
  const p = POSES[o.pose] ?? POSES.idle;
  const anim = o.animated !== false;
  const cls = (c) => (anim ? ` class="${c}"` : '');
  const uid = 'a' + Math.random().toString(36).slice(2, 8);

  const W = b.w, PD = b.pauldron;
  const L = 70 - W, R = 70 + W;           // torso edges
  const bust = o.crop === 'bust';
  const view = bust ? '26 14 88 92' : '8 8 124 196';
  const h = o.size ?? 170;
  const w = Math.round(h * (bust ? 88 / 92 : 124 / 196));

  return `<svg viewBox="${view}" width="${w}" height="${h}" role="img"
     aria-label="Operator portrait" style="display:block;overflow:visible">
  <defs>
    <linearGradient id="${uid}p" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a.plate}"/>
      <stop offset="1" stop-color="${a.trim}"/>
    </linearGradient>
    <linearGradient id="${uid}r" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="#ffd08a" stop-opacity=".5"/>
      <stop offset=".5" stop-color="#ffd08a" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="${uid}c">
      <stop offset="0" stop-color="${a.accent}" stop-opacity=".95"/>
      <stop offset="1" stop-color="${a.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  ${bust ? '' : `<ellipse cx="70" cy="192" rx="${W + 4}" ry="4.5" fill="${a.accent}" opacity=".18"/>`}

  <g${cls('b-shift')} transform="rotate(${p.lean} 70 180)">

    ${bust ? '' : `
    <!-- greaves and boots, stance slightly apart -->
    <!-- thigh plates, then greaves, then boots. Thin sticks made the
         figure bottom-light against a wide plated torso. -->
    <path d="M${70 - W + 4} 128h19q-1 22-2 24h-16q-1-8-1-24z" fill="${a.plate}"/>
    <path d="M${70 + W - 23} 128h19q0 16-1 24h-16q-1-2-2-24z" fill="${a.plate}"/>
    <path d="M${70 - W + 5} 150h17l-2 24h-14z" fill="${a.trim}"/>
    <path d="M${70 + W - 22} 150h17l-1 24h-14z" fill="${a.trim}"/>
    <path d="M${70 - W + 5} 156h17v4h-17zM${70 + W - 22} 156h17v4h-17z"
          fill="${a.accent}" opacity=".45"/>
    <path d="M${70 - W + 2} 172h21v10h-21z" fill="#12171f"/>
    <path d="M${70 + W - 24} 172h21v10h-21z" fill="#12171f"/>
    <path d="M${70 - W + 2} 179h21v3h-21zM${70 + W - 24} 179h21v3h-21z"
          fill="${a.accent}" opacity=".5"/>`}

    <g${cls('b-brth')}>
      <!-- backpack unit behind the shoulders -->
      <path d="M${L + 5} 66h${W * 2 - 10}v20H${L + 5}z" fill="#161d27"/>
      <path d="M${L + 2} 60l-9 12 5 4 8-9zM${R - 2} 60l9 12-5 4-8-9z" fill="#1c242f"/>
      <circle cx="${L + 12}" cy="76" r="2.4" fill="${a.accent}" opacity=".8"/>
      <circle cx="${R - 12}" cy="76" r="2.4" fill="${a.accent}" opacity=".8"/>

      <!-- torso: plated, tapered -->
      <path d="M${L} 130V86c0-13 6-20 ${W} -20s${W} 7 ${W} 20v44z" fill="url(#${uid}p)"/>
      <path d="M${L} 106h${W * 2}" stroke="${a.trim}" stroke-width="1.6" opacity=".9"/>
      <path d="M${L + 4} 118h${W * 2 - 8}" stroke="${a.trim}" stroke-width="1.2" opacity=".6"/>
      <path d="M70 68v64" stroke="${a.trim}" stroke-width="1" opacity=".45"/>
      <!-- abdominal segments -->
      <path d="M${L + 7} 122h${W * 2 - 14}v4H${L + 7}zM${L + 9} 128h${W * 2 - 18}v4H${L + 9}z"
            fill="#0f141c" opacity=".55"/>

      <!-- power core -->
      <circle cx="70" cy="96" r="13" fill="url(#${uid}c)"${cls('b-core')}/>
      ${emblem(a.emblem, a.accent)}

      <!-- pauldrons -->
      <path d="M${L - PD} 84q0-20 ${PD + 4} -22l6 16-8 14z" fill="${a.plate}"/>
      <path d="M${R + PD} 84q0-20 -${PD + 4} -22l-6 16 8 14z" fill="${a.plate}"/>
      <path d="M${L - PD} 84q0-20 ${PD + 4} -22" stroke="${a.trim}" stroke-width="2" fill="none"/>
      <path d="M${R + PD} 84q0-20 -${PD + 4} -22" stroke="${a.trim}" stroke-width="2" fill="none"/>
      <path d="M${L - PD + 2} 80h${PD}" stroke="${a.accent}" stroke-width="1.8" opacity=".75"/>
      <path d="M${R + PD - 2} 80h-${PD}" stroke="${a.accent}" stroke-width="1.8" opacity=".75"/>

      <!-- arms: shoulder -> elbow -> gauntlet, thick enough to read at
           68px. The first cut drew them as thin dark slivers over a dark
           torso and they simply vanished; they are plated now, with an
           outline, and the elbow is a real joint so poses articulate. -->
      ${arm(-1, L - 4, p.armL, p.elbowL, a, skin, uid)}
      <g${cls('b-cuff')} style="transform-origin:${R + 4}px 84px">
        ${arm(1, R + 4, p.armR, p.elbowR, a, skin, uid)}
      </g>

      ${tool(a.tool, a)}

      <!-- Head. The first cut left a pale face above a thin visor with
           hair spiking through the helmet dome — it read as a cartoon
           head in a bucket. Now the shell is closed, the visor does the
           talking, and hair shows only at the nape, where hair colour
           can still be seen without breaking the helmet. -->
      <g transform="rotate(${p.headTilt} 70 66)">
        <!-- neck column -->
        <path d="M62 58h16v12H62z" fill="${skin}"/>
        <path d="M60 64h20v8H60z" fill="#141a23"/>
        <!-- hair at the nape, under the rim -->
        <path d="M52 50q-2 9 2 13l4-2q-2-5-1-11zM88 50q2 9-2 13l-4-2q2-5 1-11z" fill="${hair}"/>
        <!-- closed shell -->
        <path d="M70 22q22 0 22 25v6q0 7-6 9H54q-6-2-6-9v-6q0-25 22-25z"
              fill="url(#${uid}p)"/>
        <path d="M70 22q22 0 22 25" stroke="${a.trim}" stroke-width="2.2" fill="none"/>
        <path d="M70 22q-22 0-22 25" stroke="${a.trim}" stroke-width="2.2" fill="none"
              opacity=".55"/>
        <!-- dorsal ridge -->
        <path d="M70 22v10" stroke="${a.trim}" stroke-width="2.4"/>
        <!-- wraparound visor, the dominant feature -->
        <path d="M52 40q18-6 36 0v11q0 8-18 8t-18-8z" fill="${a.visor}"/>
        <path d="M52 40q18-6 36 0v11q0 8-18 8t-18-8z" fill="none" stroke="${a.trim}"
              stroke-width="1.6"/>
        <path d="M55 43q15-4 30 0" stroke="#fff" stroke-width="2" opacity=".28" fill="none"/>
        <path d="M58 48h10" stroke="#fff" stroke-width="2" opacity=".6"${cls('b-eye')}
              style="transform-origin:70px 49px"/>
        <!-- jaw guard and breather -->
        <path d="M56 58h28v4q0 5-14 5t-14-5z" fill="${a.trim}"/>
        <path d="M63 59h14v4H63z" fill="#0d1218"/>
        <path d="M65 60h10M65 62h10" stroke="${a.accent}" stroke-width=".8" opacity=".55"/>
        <!-- ear pod and comms boom -->
        <circle cx="89" cy="47" r="4.5" fill="${a.plate}" stroke="${a.trim}" stroke-width="1.2"/>
        <circle cx="89" cy="47" r="1.6" fill="${a.accent}"/>
        <path d="M86 51q-4 8-12 9" stroke="${a.trim}" stroke-width="1.6" fill="none"/>
        <circle cx="74" cy="60" r="1.8" fill="${a.accent}" opacity=".9"/>
      </g>

      ${o.rimLight ? `
      <path d="M${L} 130V86c0-13 6-20 ${W} -20s${W} 7 ${W} 20v44z" fill="url(#${uid}r)"/>
      <path d="M91 34a22 22 0 0 1 0 22" stroke="#ffd08a" stroke-width="2.2" fill="none" opacity=".55"/>` : ''}
    </g>
  </g>
</svg>`;
}

/* -------------------------------------------------------------------
 * Click barks. Finance-flavoured, per role, with an escalating tail so
 * repeated clicking gets a reaction — the genre convention, written
 * fresh rather than borrowed.
 * ----------------------------------------------------------------- */
const AVATAR_LINES = {
  scrubs: ['Vitals stable.', 'Ready to operate.', 'Margins look clean.',
    'Scrubbed in.', 'Stop poking the surgeon.'],
  coat: ['Chart me.', 'Diagnosis: underfunded.', 'Second opinion?',
    'Pulse on the portfolio.', 'I have rounds, you know.'],
  suit: ['Objection sustained.', 'Read the fine print.', 'Billable.',
    'Counsel advises caution.', 'This is not advice. Obviously.'],
  blazer: ['Quota’s covered.', 'Always be compounding.', 'Pipeline’s full.',
    'Closing the gap.', 'You are not the decision maker, are you.'],
  hoodie: ['Compiling.', 'Shipped it.', 'Works on my machine.',
    'Refactoring the plan.', 'This loop has no exit condition.'],
  rolledSleeves: ['Drawn to spec.', 'Load-bearing assumption.', 'Measure twice.',
    'Foundation looks solid.', 'You have moved that wall four times.'],
  shirt: ['Reconciled.', 'The numbers tie out.', 'Variance noted.',
    'Running the model.', 'I have already checked. Twice.'],
  cardigan: ['Show your work.', 'Compounding, class.', 'Pension secured.',
    'Marking your plan.', 'See me after the simulation.'],
  hardHat: ['Circuit’s live.', 'Grounded and ready.', 'No degree, no debt.',
    'Wired for growth.', 'Hands off the breaker.'],
};

function avatarLine(attire, clickCount) {
  const pool = AVATAR_LINES[attire] ?? AVATAR_LINES.shirt;
  // The last line is the annoyed one, held back for persistent clicking.
  if (clickCount >= 5) return pool[pool.length - 1];
  return pool[clickCount % (pool.length - 1)];
}
const avatarPose = (clickCount) =>
  clickCount >= 5 ? 'annoyed' : clickCount % 2 === 1 ? 'salute' : 'flex';

const _avatarExports = {
  buildAvatar, AVATAR_SKIN, AVATAR_HAIR, ATTIRE, BUILDS, POSES,
  AVATAR_LINES, avatarLine, avatarPose,
};
if (typeof module !== 'undefined' && module.exports) module.exports = _avatarExports;
else if (typeof self !== 'undefined') Object.assign(self, _avatarExports);

/* gen-sheet.js — contact sheet for eyeballing the avatars. Dev tool. */
const A = require('./avatar.js');
const C = require('./characters.js');
const occ = C.OCCUPATIONS;

const card = (svg, name, sub) => `<div class="c"><div class="f">${svg}</div>
  <div class="n">${name}</div><div class="s">${sub}</div></div>`;

const roster = Object.values(occ).map((o, i) => card(
  A.buildAvatar({ attire: o.attire, skinTone: i % 7, hairColour: (i * 2) % 7,
                  build: ['slim', 'average', 'broad'][i % 3], size: 180, rimLight: true }),
  o.label, A.ATTIRE[o.attire].rig ?? o.attire)).join('');

const poses = Object.keys(A.POSES).map((p, i) => card(
  A.buildAvatar({ attire: 'hoodie', skinTone: 2, hairColour: 1, build: 'average',
                  pose: p, size: 180, rimLight: true }),
  p, A.avatarLine('hoodie', p === 'annoyed' ? 5 : i))).join('');

const builds = ['slim', 'average', 'broad'].map((b) => card(
  A.buildAvatar({ attire: 'blazer', skinTone: 4, hairColour: 3, build: b,
                  size: 180, rimLight: true }), b, 'Broker harness')).join('');

const bust = Object.keys(A.ATTIRE).slice(0, 5).map((at) => card(
  A.buildAvatar({ attire: at, skinTone: 1, hairColour: 0, crop: 'bust', size: 130 }),
  at, 'bust crop')).join('');

require('fs').writeFileSync(__dirname + '/avatar-sheet.html', `<!DOCTYPE html>
<meta charset="utf-8"><title>Avatar sheet</title>
<style>
 body{margin:0;padding:22px;background:#070c11;color:#cfe6ef;
   font:13px/1.4 ui-sans-serif,system-ui,sans-serif}
 h2{font-size:12px;letter-spacing:.24em;color:#2bd6ff;font-weight:700;margin:26px 0 12px}
 h2:first-child{margin-top:0}
 .row{display:flex;flex-wrap:wrap;gap:12px}
 .c{width:190px;background:#0d151d;border:1px solid #1b2836;border-radius:3px;
   padding:10px;text-align:center}
 .f{display:flex;align-items:flex-end;justify-content:center;height:190px}
 .n{font-weight:700;font-size:12.5px;margin-top:8px}
 .s{font:11px ui-monospace,monospace;color:#ffa62b;margin-top:2px}
</style>
<h2>Roster</h2><div class="row">${roster}</div>
<h2>Click reactions</h2><div class="row">${poses}</div>
<h2>Builds</h2><div class="row">${builds}</div>
<h2>Bust crop</h2><div class="row">${bust}</div>
`);
console.log('avatar-sheet.html written');

/* ===================================================================
 * audio.js — SYNTHESISED INTERFACE AUDIO
 * -------------------------------------------------------------------
 * Every sound here is generated from oscillators and noise at runtime.
 * Nothing is sampled, because a two-minute loop as base64 would be
 * 2-4MB and the app has to stay one self-contained file. The upside is
 * that a synthesised bed can respond to state, which a fixed track
 * cannot.
 *
 * Cue sets are the SAME graph with different filter and envelope
 * settings — not three sample packs.
 *
 * ON BY DEFAULT, but it cannot actually sound until the visitor has
 * interacted — browsers block autoplay. Solving the entry lock is that
 * interaction, so the music starts exactly when the app opens rather
 * than needing a second explicit opt-in. Both switches live in
 * Settings, and M mutes everything from anywhere.
 * =================================================================== */

'use strict';

const AudioKit = (() => {
  let ctx = null;
  let master = null, musicGain = null, cueGain = null;
  let started = false, musicOn = false;

  const state = {
    /* ON by default now. Browsers still block audio until a user
     * gesture, so nothing plays until the entry lock is solved — that
     * click is the gesture, and app.js unlocks the context there. */
    enabledCues: true,
    enabledMusic: true,
    cueVolume: 0.40,
    musicVolume: 0.30,
    cueSet: 'industrial',
    intensity: 0.5,          // 0 calm .. 1 tense; follows plan health
  };

  /* Cue sets: filter colour and envelope shape, one graph. */
  const SETS = {
    industrial: { cut: 1500, q: 1.6, drive: 0.55, decay: 1.00, noise: 1.0 },
    clinical:   { cut: 3200, q: 0.8, drive: 0.18, decay: 0.70, noise: 0.35 },
    muted:      { cut: 900,  q: 0.5, drive: 0.10, decay: 0.55, noise: 0.20 },
  };
  const set = () => SETS[state.cueSet] ?? SETS.industrial;

  /** Lazily create the context. Must be called from a user gesture. */
  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch { return false; }
    master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = state.musicVolume; musicGain.connect(master);
    cueGain = ctx.createGain(); cueGain.gain.value = state.cueVolume; cueGain.connect(master);
    started = true;
    return true;
  }

  const now = () => (ctx ? ctx.currentTime : 0);

  /** Short burst of filtered noise — the radio-squelch ingredient. */
  function noiseBurst(dur, cut, q, gain, when = 0) {
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = cut; bp.Q.value = q;
    const g = ctx.createGain();
    const t = now() + when;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(bp).connect(g).connect(cueGain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /** One enveloped oscillator voice. */
  function tone(freq, dur, type, gain, when = 0, glideTo = null) {
    const o = ctx.createOscillator(); o.type = type;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    const s = set();
    f.frequency.value = s.cut * 2; f.Q.value = s.q;
    const g = ctx.createGain();
    const t = now() + when;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur * 0.9);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur * s.decay);
    o.connect(f).connect(g).connect(cueGain);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /* ---------------- the cue vocabulary ---------------- */
  const CUES = {
    /** Panel opening. Radio squelch. */
    open() { const s = set();
      noiseBurst(0.10, 1700, 4.5, 0.30 * s.noise);
      noiseBurst(0.06, 900, 3.0, 0.16 * s.noise, 0.07); },
    /** Committing a change. Mechanical servo. */
    commit() { const s = set();
      tone(150, 0.11, 'square', 0.16, 0, 90);
      noiseBurst(0.05, 500, 2.0, 0.12 * s.noise, 0.02); },
    /** Confirmation. Rising double beep. */
    confirm() {
      tone(660, 0.07, 'triangle', 0.15);
      tone(990, 0.09, 'triangle', 0.15, 0.085); },
    /** Warning. Low detuned horn. */
    warn() {
      tone(150, 0.36, 'sawtooth', 0.13);
      tone(151.6, 0.36, 'sawtooth', 0.11);
      tone(75, 0.40, 'sine', 0.13); },
    /** Crossing a threshold, e.g. depletion appearing. */
    alert() {
      tone(420, 0.14, 'square', 0.12);
      tone(300, 0.20, 'square', 0.12, 0.13);
      noiseBurst(0.09, 1200, 3, 0.10 * set().noise, 0.02); },
    /** Value moved the right way. */
    tickUp() { tone(880, 0.05, 'sine', 0.08); },
    /** Value moved the wrong way. */
    tickDown() { tone(440, 0.05, 'sine', 0.08); },
  };

  function cue(name) {
    if (!state.enabledCues) return;
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    (CUES[name] ?? (() => {}))();
    // Duck the bed briefly so cues stay audible over it.
    if (musicOn && musicGain) {
      const t = now();
      musicGain.gain.cancelScheduledValues(t);
      musicGain.gain.setValueAtTime(musicGain.gain.value, t);
      musicGain.gain.linearRampToValueAtTime(state.musicVolume * 0.35, t + 0.04);
      musicGain.gain.linearRampToValueAtTime(state.musicVolume, t + 0.55);
    }
  }

  /* ================= THE MUSIC ENGINE =================
   * Rewritten: the first version was an ambient pad, which is not
   * "hype". This is a proper step sequencer — kick, snare, hats, a
   * driving filtered-saw bassline and a detuned brass-ish lead over an
   * A-minor progression (Am - F - C - G) at 128bpm.
   *
   * Still entirely synthesised. A two-minute loop as base64 would be
   * several megabytes and this app ships as one file; the payoff is
   * that a generated bed can react to state, which a fixed track
   * cannot. `intensity` opens filters, adds the lead and the ride, and
   * drives the snare backbeat.
   *
   * setInterval rather than a lookahead scheduler: at a 117ms step the
   * jitter is inaudible, and a sample-accurate scheduler would be a
   * lot of machinery for no perceptible gain.
   * =================================================================== */
  const BPM = 128;
  const STEP = 60 / BPM / 4;              // 16th note
  const A1 = 55;
  const semi = (n) => A1 * Math.pow(2, n / 12);
  // Am - F - C - G, one bar each.
  const PROG = [0, -4, 3, -2];
  const PENT = [0, 3, 5, 7, 10, 12];      // A minor pentatonic

  let seqTimer = null, step16 = 0;
  let busBass = null, busDrum = null, busLead = null;

  function perc(kind, t, i) {
    if (kind === 'kick') {
      const o = ctx.createOscillator(); o.type = 'sine';
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g).connect(busDrum); o.start(t); o.stop(t + 0.25);
      // click for punch
      noiseInto(busDrum, t, 0.012, 2200, 1, 0.28);
    } else if (kind === 'snare') {
      noiseInto(busDrum, t, 0.13, 1900, 1.1, 0.42 + 0.2 * i);
      const o = ctx.createOscillator(); o.type = 'triangle';
      const g = ctx.createGain();
      o.frequency.setValueAtTime(190, t);
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(g).connect(busDrum); o.start(t); o.stop(t + 0.1);
    } else if (kind === 'hat') {
      noiseInto(busDrum, t, 0.035, 9000, 2.2, 0.13 + 0.07 * i);
    } else if (kind === 'ride') {
      noiseInto(busDrum, t, 0.09, 6000, 1.4, 0.07 + 0.06 * i);
    }
  }

  /** Noise burst straight into a bus, for drums. */
  function noiseInto(bus, t, dur, cut, q, gain) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = cut; bp.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(bp).connect(g).connect(bus);
    src.start(t); src.stop(t + dur + 0.01);
  }

  function bassNote(freq, t, dur, i) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    o.frequency.value = freq; o2.frequency.value = freq / 2;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(260 + 900 * i, t);
    f.frequency.exponentialRampToValueAtTime(140 + 320 * i, t + dur);
    f.Q.value = 7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.95);
    o.connect(f); o2.connect(f); f.connect(g).connect(busBass);
    o.start(t); o2.start(t); o.stop(t + dur); o2.stop(t + dur);
  }

  function leadNote(freq, t, dur, i) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.20 * (0.5 + i), t + 0.02);
    g.gain.setValueAtTime(0.20 * (0.5 + i), t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.value = 1400 + 2200 * i; f.Q.value = 1.2;
    // three detuned saws for a brass-ish stack
    [-7, 0, 7].forEach((cents) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = freq * Math.pow(2, cents / 1200);
      o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    });
    f.connect(g).connect(busLead);
  }

  function startMusic() {
    if (!ensure() || musicOn) return;
    if (ctx.state === 'suspended') ctx.resume();
    musicOn = true;
    step16 = 0;

    busDrum = ctx.createGain(); busDrum.gain.value = 0.55; busDrum.connect(musicGain);
    busBass = ctx.createGain(); busBass.gain.value = 0.40; busBass.connect(musicGain);
    busLead = ctx.createGain(); busLead.gain.value = 0.26;
    const comp = ctx.createDynamicsCompressor();
    busLead.connect(comp).connect(musicGain);

    seqTimer = setInterval(() => {
      if (!ctx || !musicOn) return;
      const t = ctx.currentTime + 0.02;
      const s = step16 % 16;
      const bar = Math.floor(step16 / 16) % 4;
      const i = state.intensity;                 // 0 calm .. 1 tense
      const root = semi(PROG[bar]) * 2;          // bass octave

      /* --- drums: four on the floor, backbeat snare, driving hats --- */
      if (s % 4 === 0) perc('kick', t, i);
      if (s === 14) perc('kick', t, i);          // pickup
      if (s === 4 || s === 12) perc('snare', t, i);
      if (i > 0.5 && s === 7) perc('snare', t, i * 0.7);
      if (s % 2 === 1) perc('hat', t, i);
      if (i > 0.3 && s % 4 === 2) perc('ride', t, i);

      /* --- bass: syncopated root/fifth --- */
      const BASS = [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0];
      if (BASS[s]) {
        const fifth = (s === 5 || s === 13) ? Math.pow(2, 7 / 12) : 1;
        bassNote(root * fifth, t, STEP * 1.6, i);
      }
      /* --- lead: a motif from bar 2, more present as tension rises --- */
      if (bar >= 1 && s % 4 === 0) {
        const idx = (Math.floor(step16 / 4) + bar) % PENT.length;
        leadNote(semi(PROG[bar] + PENT[idx]) * 4, t, STEP * 3.4, i);
      }
      /* --- a stab on the downbeat of every other bar --- */
      if (s === 0 && bar % 2 === 0) {
        leadNote(semi(PROG[bar]) * 4, t, STEP * 2, i * 0.8 + 0.2);
      }

      step16++;
    }, STEP * 1000);
  }

  function stopMusic() {
    musicOn = false;
    if (seqTimer) { clearInterval(seqTimer); seqTimer = null; }
    [busBass, busDrum, busLead].forEach((b) => { try { b && b.disconnect(); } catch { /* gone */ } });
    busBass = busDrum = busLead = null;
  }

  /* ---------------- public surface ---------------- */
  return {
    state,
    /** Must be called from a click/keypress. Returns false if blocked. */
    unlock() { const ok = ensure(); if (ok && ctx.state === 'suspended') ctx.resume(); return ok; },
    available() { return !!(window.AudioContext || window.webkitAudioContext); },
    cue,
    setCues(on) {
      state.enabledCues = !!on;
      if (on) { ensure(); cue('open'); }
    },
    setMusic(on) {
      state.enabledMusic = !!on;
      if (on) startMusic(); else stopMusic();
    },
    setCueVolume(v) { state.cueVolume = v; if (cueGain) cueGain.gain.value = v; },
    setMusicVolume(v) { state.musicVolume = v; if (musicGain) musicGain.gain.value = v; },
    setCueSet(name) { if (SETS[name]) state.cueSet = name; },
    /** 0 = funded and calm, 1 = failing and tense. */
    setIntensity(v) { state.intensity = Math.max(0, Math.min(1, v)); },
    muteAll() {
      state.enabledCues = false; state.enabledMusic = false; stopMusic();
      if (master) master.gain.value = 0;
    },
    unmuteAll() { if (master) master.gain.value = 1; },
    isMusicOn() { return musicOn; },
    cueNames() { return Object.keys(CUES); },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { AudioKit };
else if (typeof self !== 'undefined') self.AudioKit = AudioKit;

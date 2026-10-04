const CB = (() => {
  'use strict';

  const AC = window.AudioContext || window.webkitAudioContext;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const LN10_10 = Math.LN10 / 10;

  /* ------------------------------------------------------------------ config */
  const FFT_A = 2048;          // tonal bands: good frequency detail
  const FFT_B = 512;           // transients: ~11 ms window for sharp onsets
  const SMOOTH = 0.05;          // analyser smoothing for the tonal analyser
  const AUTO_WIN = 1.2;          // seconds: rolling-RMS window that drives auto-scaling
  const AUTO_SPAN = 48;        // dB mapped onto the chart height, centred on the rolling RMS
  const AUTO_REF_Y = 65;       // where the rolling RMS level sits on the chart (0-100)
  const GATE_DB = -80;         // the reference never drops below this, so silence stays flat
  const MONO_LO = -45, MONO_HI = -28;   // side/mid level ratio (dB): below LO the source is treated as mono
  const MONO_MIN = 1e-7;       // mid power needed before the stereo check is trusted
  const TRANS_FLOOR = 3.5;       // dB: smallest transient reference, keeps noise from being blown up
  const TRANS_MULT = 3.2;      // a hit this many times the rolling RMS reaches the top of the chart
  const FP_MS = 24;            // line graph: one stored point every 24 ms
  const FP_CAP = 16384;        // ... enough for ~6.5 minutes of history
  const LINE_T1 = 0.085, LINE_T2 = 0.07;   // seconds: two cascaded low-passes give the line its flowing motion
  const LINE_K = 24;           // soft limit (0-100 scale) on how far the line may stray from its slow mean
  const TICK_MS = 4;           // sampling cadence (browser minimum)
  const MAXH = 480;
  const TFS = [20, 50, 100, 200, 500];
  const UP = '62,232,165';
  const DOWN = '255,92,122';

  const BANDS = [
    { id: 'sub',      name: 'Sub',            short: 'Sub',      src: 'mid', f: [20, 60],      hue: 262 },
    { id: 'bass',     name: 'Bass',           short: 'Bass',     src: 'mid', f: [60, 250],     hue: 236 },
    { id: 'lowmid',   name: 'Low-mid',        short: 'Low-mid',  src: 'mid', f: [250, 500],    hue: 208 },
    { id: 'vocal',    name: 'Vocal',          short: 'Vocal',    src: 'mid', f: [500, 2500],   hue: 176 },
    { id: 'guitar',   name: 'Guitar / Synth', short: 'Synth',    src: 'side', f: [2500, 5000],  hue: 142 },
    { id: 'presence', name: 'Presence',       short: 'Presence', src: 'full', f: [5000, 9000],  hue: 96 },
    { id: 'air',      name: 'Air / Hats',     short: 'Air',      src: 'full', f: [9000, 16000], hue: 48 },
    { id: 'drums',    name: 'Drums',          short: 'Drums',    f: null, kind: 'flux', hue: 18 },
    { id: 'master',   name: 'Master',         short: 'Master',   f: null, kind: 'rms',  hue: 330 }
  ];
  // Rolling window of (power, duration) pairs: its time-weighted mean is the 2 s rolling RMS power.
  function makeWin() {
    const cap = 4096, pv = new Float64Array(cap), dv = new Float64Array(cap);
    let head = 0, n = 0, sp = 0, sd = 0;
    const pop = () => { sp -= pv[head] * dv[head]; sd -= dv[head]; head = (head + 1) % cap; n--; };
    return {
      push(p, dt) {
        if (n === cap) pop();
        const i = (head + n) % cap;
        pv[i] = p; dv[i] = dt; n++; sp += p * dt; sd += dt;
        while (sd > AUTO_WIN && n > 1) pop();
      },
      mean() { return sd > 0.05 ? Math.max(sp, 0) / sd : -1; },   // -1 until there is enough history
      clear() { head = 0; n = 0; sp = 0; sd = 0; }
    };
  }
  const channels = BANDS.map((b) => Object.assign({
    hist: [], acc: null, last: 0, total: 0, win: makeWin(),
    // line-graph state: smoothed value chain, energy follower, ring buffer of points, ripple timestamps
    f1: 50, f2: 50, fm: 50, fo: 50, en: 0, fb: new Float32Array(FP_CAP), fi: 0, fn: 0, facc: 0, rings: [], lastRing: 0
  }, b));

  const svg = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const ICONS = {
    sub: svg('<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="5.8"/><circle cx="12" cy="12" r="9.5"/>'),
    bass: svg('<path d="M2 12c3.5-9 5.5-9 9 0s5.5 9 9 0"/>'),
    lowmid: svg('<path d="M2 12c1.7-8 3.3-8 5 0s3.3 8 5 0 3.3-8 5 0 3.3 8 5 0"/>'),
    vocal: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
    guitar: svg('<path d="M3 17 9 7v10l6-10v10l6-10"/>'),
    presence: svg('<path d="M3 16h4V8h5v8h5V8h4"/>'),
    air: svg('<path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5"/>'),
    drums: svg('<path d="M2 13h5l2.5-9 3 16 2.2-7H22"/>'),
    master: svg('<path d="M5 20v-8M10 20V4M15 20V9M20 20v-6"/>'),
    mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
    system: svg('<rect x="3" y="4.5" width="18" height="12" rx="1.6"/><path d="M8.5 20h7M12 16.5V20"/>'),
    demo: svg('<path d="M8 5.5v13l11-6.5z"/>'),
    stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="1.8"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    minus: svg('<path d="M5 12h14"/>')
  };

  /* ------------------------------------------------------------------- state */
  let src = 'ambient';                 // 'ambient' (idle preview) | 'wait' (permission pending) | 'live'
  let tf = 50;
  let boundary = performance.now();    // start of the candle currently forming
  let lastT = boundary;
  let aud = null;
  let session = 0;
  const listeners = { state: [], error: [], zoom: [] };
  const on = (k, fn) => { listeners[k].push(fn); };
  const emit = (k, ...a) => listeners[k].forEach((fn) => { try { fn(...a); } catch (e) { /* ignore */ } });

  function resetBlank(keepWin) {
    for (const c of channels) { c.hist = []; c.acc = null; c.last = 0; c.total = 0; if (!keepWin) { c.win.clear(); lineReset(c); } }
    boundary = performance.now();
  }

  /* ------------------------------------------------------------ line engine */
  // The line is the same band level as the candles, but calmer: two low-passes make it flow, and a soft limiter
  // around a slow mean stops spikes from dominating. Energy and onset followers drive the live effects.
  function lineReset(c) {
    c.f1 = c.f2 = c.fm = c.fo = 50; c.en = 0; c.fi = 0; c.fn = 0; c.facc = 0; c.rings = []; c.lastRing = 0;
  }
  function lineStep(dt, now) {
    const a1 = 1 - Math.exp(-dt / LINE_T1), a2 = 1 - Math.exp(-dt / LINE_T2);
    const am = 1 - Math.exp(-dt / 1.6), ae = 1 - Math.exp(-dt / 0.12);
    for (const c of channels) {
      const raw = c.last;
      const jump = raw - c.f1;
      c.f1 += (raw - c.f1) * a1;
      c.f2 += (c.f1 - c.f2) * a2;
      c.fm += (c.f2 - c.fm) * am;
      c.fo = clamp(c.fm + LINE_K * Math.tanh((c.f2 - c.fm) / LINE_K), 3, 97);
      c.en += (clamp(Math.abs(raw - c.fm) / 30, 0, 1) - c.en) * ae;
      if (jump > 16 && now - c.lastRing > 140) { c.rings.push(now); c.lastRing = now; if (c.rings.length > 6) c.rings.shift(); }
      c.facc += dt * 1000;
      while (c.facc >= FP_MS) {
        c.facc -= FP_MS;
        c.fb[c.fi] = c.fo; c.fi = (c.fi + 1) % FP_CAP; if (c.fn < FP_CAP) c.fn++;
      }
    }
  }
  function lineFill() {
    const now = performance.now(), n = 6000, dt = FP_MS / 1000;
    const a1 = 1 - Math.exp(-dt / LINE_T1), a2 = 1 - Math.exp(-dt / LINE_T2), am = 1 - Math.exp(-dt / 1.6);
    channels.forEach((c, k) => {
      lineReset(c);
      for (let j = n; j >= 1; j--) {
        const raw = ambientY(k, (now - j * FP_MS) / 1000);
        c.f1 += (raw - c.f1) * a1; c.f2 += (c.f1 - c.f2) * a2; c.fm += (c.f2 - c.fm) * am;
        c.fo = clamp(c.fm + LINE_K * Math.tanh((c.f2 - c.fm) / LINE_K), 3, 97);
        c.fb[c.fi] = c.fo; c.fi = (c.fi + 1) % FP_CAP; c.fn++;
      }
      c.last = ambientY(k, now / 1000);
    });
  }

  /* --------------------------------------------------- idle ambient preview */
  function ambientY(k, t) {
    const p = k * 1.7;
    let v = 44 + 19 * Math.sin(t * 0.9 + p) + 11 * Math.sin(t * 2.3 + p * 2.1) + 6 * Math.sin(t * 5.1 + p * 3.3);
    v += 20 * Math.pow(0.5 + 0.5 * Math.sin(6.2832 * (t * 1.1 + k * 0.17)), 8);
    return clamp(v, 2, 98);
  }
  function prefill() {
    const now = performance.now();
    boundary = now;
    const N = 240;
    channels.forEach((c, k) => {
      c.hist = []; c.acc = null; c.total = N;
      for (let i = N; i >= 1; i--) {
        const t0 = now - i * tf;
        let o = 0, h = -1, l = 101, cl = 0;
        for (let s = 0; s <= 5; s++) {
          const y = ambientY(k, (t0 + (s * tf) / 5) / 1000);
          if (s === 0) o = y;
          if (y > h) h = y;
          if (y < l) l = y;
          cl = y;
        }
        c.hist.push({ o, h, l, c: cl });
      }
      c.last = c.hist[c.hist.length - 1].c;
    });
    lineFill();
  }
  function goAmbient() { src = 'ambient'; prefill(); }

  /* ----------------------------------------------------------- candle engine */
  function sample(c, y) {
    c.last = y;
    const a = c.acc;
    if (!a) c.acc = { o: y, h: y, l: y, c: y };
    else { if (y > a.h) a.h = y; if (y < a.l) a.l = y; a.c = y; }
  }

  // Candles sit on a fixed time grid. Each one opens exactly where the previous one closed,
  // so the series is continuous, with High and Low taken from every sample inside the window.
  function commit(now) {
    let guard = 0;
    while (now - boundary >= tf && guard++ < 8) {
      boundary += tf;
      for (const c of channels) {
        const a = c.acc || { o: c.last, h: c.last, l: c.last, c: c.last };
        c.hist.push({ o: a.o, h: a.h, l: a.l, c: a.c });
        if (c.hist.length > MAXH) c.hist.splice(0, MAXH >> 2);
        c.total++;
        c.acc = { o: a.c, h: a.c, l: a.c, c: a.c };
      }
    }
    if (now - boundary >= tf) boundary = now;
  }

  function tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (src === 'wait') return;
    if (src === 'live') {
      if (!aud || aud.ctx.state !== 'running') return;
      aud.analyse(dt);
    } else {
      const t = now / 1000;
      for (let k = 0; k < channels.length; k++) sample(channels[k], ambientY(k, t));
    }
    lineStep(dt, now);
    commit(now);
  }

  function makeTicker(fn, ms) {
    let stopFn = null;
    const fallback = () => { const id = setInterval(fn, ms); stopFn = () => clearInterval(id); };
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},' + ms + ')'], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = fn;
      w.onerror = () => { try { w.terminate(); } catch (e) { /* ignore */ } fallback(); };
      stopFn = () => { w.terminate(); URL.revokeObjectURL(url); };
    } catch (e) { fallback(); }
    return () => { if (stopFn) stopFn(); };
  }

  /* ------------------------------------------------------------- demo signal */
  function makeDemo(ctx, out) {
    const bpm = 124, spb = 60 / bpm / 4;
    let t = ctx.currentTime + 0.08, i = 0;
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let k = 0; k < nd.length; k++) nd[k] = Math.random() * 2 - 1;
    const env = (g, t0, a, peak, d) => {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    };
    const mkPan = (v, dest) => {
      if (!ctx.createStereoPanner) return dest;
      const pn = ctx.createStereoPanner(); pn.pan.value = v; pn.connect(dest); return pn;
    };
    const noise = (t0, type, f, q, peak, d, pan) => {
      const s = ctx.createBufferSource(); s.buffer = nb;
      const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
      const g = ctx.createGain(); env(g, t0, 0.002, peak, d);
      s.connect(flt); flt.connect(g); g.connect(pan ? mkPan(pan, out) : out);
      s.start(t0, Math.random() * 0.5); s.stop(t0 + d + 0.05);
    };
    const tone = (t0, type, f, peak, a, d, lp, pan) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ctx.createGain(); env(g, t0, a, peak, d);
      let n = o;
      if (lp) { const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = lp; o.connect(flt); n = flt; }
      n.connect(g); g.connect(pan ? mkPan(pan, out) : out);
      o.start(t0); o.stop(t0 + a + d + 0.05);
    };
    const kick = (t0) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(165, t0);
      o.frequency.exponentialRampToValueAtTime(42, t0 + 0.13);
      const g = ctx.createGain(); env(g, t0, 0.003, 1, 0.34);
      o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.42);
    };
    // sustained bed so no band ever falls completely silent: a slow pad chord and a sub drone
    const bed = ctx.createGain(); bed.gain.value = 0.16; bed.connect(out);
    // the pad is spread wide: alternate chord notes go left and right
    const padLps = [-0.8, 0.8].map((pv) => {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; f.connect(mkPan(pv, bed)); return f;
    });
    [110, 164.8, 220, 277.2].forEach((f, n) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (n - 1.5) * 7;
      const g = ctx.createGain(); g.gain.value = 0.3; o.connect(g); g.connect(padLps[n & 1]); o.start();
    });
    const drone = ctx.createOscillator(); drone.type = 'sine'; drone.frequency.value = 55;
    const dg = ctx.createGain(); dg.gain.value = 0.35; drone.connect(dg); dg.connect(out); drone.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.15;
    const lg = ctx.createGain(); lg.gain.value = 500; lfo.connect(lg); padLps.forEach((f) => lg.connect(f.frequency)); lfo.start();
    const bassN = [55, 55, 65.4, 49];
    const arp =[1760, 2093, 2349, 2637, 3136, 2637, 2349, 2093];
    const voc = [392, 440, 523, 494, 392, 330];
    return {
      step() {
        while (t < ctx.currentTime + 0.12) {
          const s = i % 16, bar = (i >> 4) % 4;
          if (s % 4 === 0) kick(t);
          if (s === 4 || s === 12) { noise(t, 'bandpass', 1900, 0.8, 0.7, 0.18); tone(t, 'triangle', 190, 0.35, 0.002, 0.1); }
          if (s % 2 === 0) noise(t, 'highpass', 9000, 0.7, 0.2, s === 14 ? 0.16 : 0.04, Math.random() - 0.5);
          if (s % 4 === 2) tone(t, 'sawtooth', bassN[bar], 0.55, 0.005, spb * 2.2, 260);
          if (s % 2 === 1) tone(t, 'square', arp[(i >> 1) % 8], 0.07, 0.003, spb * 1.4, 4200, (i & 2) ? 0.8 : -0.8);
          if (s === 0 || s === 6 || s === 10) tone(t, 'sawtooth', voc[(i >> 2) % 6], 0.16, 0.03, spb * 3, 1100);
          if (Math.random() < 0.07) noise(t, 'bandpass', 2400, 1, 0.4, 0.07, (Math.random() - 0.5) * 1.6);
          t += spb; i++;
        }
      }
    };
  }

  /* --------------------------------------------------------- session control */
  async function dispose(r) {
    if (r.stream) r.stream.getTracks().forEach((t) => { t.onended = null; try { t.stop(); } catch (e) { /* ignore */ } });
    r.nodes.forEach((n) => { try { n.disconnect(); } catch (e) { /* ignore */ } });
    try { await r.ctx.close(); } catch (e) { /* ignore */ }
  }

  async function start(mode) {
    const my = ++session;                      // any start still waiting on a permission prompt becomes stale
    const old = aud; aud = null;
    src = 'wait';
    resetBlank();                              // fresh, blank state, nothing carried over
    const disposing = old ? dispose(old) : Promise.resolve();
    emit('state', 'connecting', mode);

    let ctx = null, stream = null;
    const bail = async (err) => {
      if (stream) stream.getTracks().forEach((t) => { t.onended = null; try { t.stop(); } catch (e) { /* ignore */ } });
      if (ctx) { try { await ctx.close(); } catch (e) { /* ignore */ } }
      if (my === session) {
        goAmbient();
        emit('state', 'idle');
        if (err) { console.warn('[bearbullbeats]', err); emit('error', mode, err); }
      }
    };

    try {
      if (!AC) throw new Error('Web Audio is not available');
      ctx = new AC({ latencyHint: 'interactive' });
      if (mode === 'mic') {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('getUserMedia is not available here');
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else if (mode === 'system') {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error('getDisplayMedia is not available here');
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      }
      await disposing;
      if (my !== session) { await bail(); return; }
      if (stream && !stream.getAudioTracks().length) { await bail(new Error('The share carried no audio track')); return; }
      if (ctx.state !== 'running') await ctx.resume();

      const A = ctx.createAnalyser();            // full mix: Presence, Air, Master
      A.fftSize = FFT_A; A.smoothingTimeConstant = SMOOTH;
      const B = ctx.createAnalyser();            // full mix, ~11 ms window: transients
      B.fftSize = FFT_B; B.smoothingTimeConstant = 0;

      // Mid/Side matrix built from a ChannelSplitterNode:  Mid = (L + R) / 2,  Side = (L - R) / 2
      const split = ctx.createChannelSplitter(2);       // a mono source is up-mixed, so L = R
      const mL = ctx.createGain(), mR = ctx.createGain(), sL = ctx.createGain(), sR = ctx.createGain();
      mL.gain.value = 0.5; mR.gain.value = 0.5; sL.gain.value = 0.5; sR.gain.value = -0.5;
      const midBus = ctx.createGain(), sideBus = ctx.createGain();
      split.connect(mL, 0); split.connect(sL, 0);       // left channel
      split.connect(mR, 1); split.connect(sR, 1);       // right channel (inverted into Side)
      mL.connect(midBus); mR.connect(midBus); sL.connect(sideBus); sR.connect(sideBus);
      const AM = ctx.createAnalyser(); AM.fftSize = FFT_A; AM.smoothingTimeConstant = SMOOTH;   // Mid  -> Sub, Bass, Low-mid, Vocal
      const AS = ctx.createAnalyser(); AS.fftSize = FFT_A; AS.smoothingTimeConstant = SMOOTH;   // Side -> Guitar / Synth
      midBus.connect(AM); sideBus.connect(AS);

      const mute = ctx.createGain(); mute.gain.value = 0;
      const nodes = [A, B, AM, AS, split, mL, mR, sL, sR, midBus, sideBus, mute];
      const feed = (n) => { n.connect(A); n.connect(B); n.connect(split); };
      let demo = null;

      if (stream) {
        const s = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
        feed(s);
        nodes.push(s);
        stream.getTracks().forEach((t) => { t.onended = () => { if (my === session) stop(); }; });
      } else {
        const out = ctx.createGain(); out.gain.value = 0.9;
        const mon = ctx.createGain(); mon.gain.value = 0.35;
        feed(out); out.connect(mon); mon.connect(ctx.destination);
        demo = makeDemo(ctx, out);
        nodes.push(out, mon);
      }
      A.connect(mute); B.connect(mute); AM.connect(mute); AS.connect(mute); mute.connect(ctx.destination);   // silent pull keeps the graph running, no feedback

      const nA = A.frequencyBinCount, nB = B.frequencyBinCount;
      const fa = new Float32Array(nA), fm = new Float32Array(nA), fsd = new Float32Array(nA), fb = new Float32Array(nB);
      const pa = new Float32Array(nA), pm = new Float32Array(nA), ps = new Float32Array(nA), pb = new Float32Array(nB);
      const td = new Float32Array(B.fftSize);
      const hzA = ctx.sampleRate / FFT_A, hzB = ctx.sampleRate / FFT_B;
      const maxBin = Math.min(nA - 1, Math.ceil(16500 / hzA));

      // Band energy: linear power summed over the band, with fractional weight on the edge bins.
      const tables = channels.map((c) => {
        if (!c.f) return null;
        const out = [];
        for (let i = 1; i < nA; i++) {
          const lo = (i - 0.5) * hzA, hi = (i + 0.5) * hzA;
          const w = Math.min(c.f[1], hi) - Math.max(c.f[0], lo);
          if (w > 0) out.push([i, w / hzA]);
        }
        return out;
      });
      // Transient weights: kick body and the snare/hat region count more.
      const wB = new Float32Array(nB);
      let wsum = 0;
      for (let i = 1; i < nB; i++) {
        const f = i * hzB;
        wB[i] = (f >= 40 && f <= 220) ? 3 : (f >= 3500 && f <= 9000) ? 2 : f <= 16000 ? 1 : 0;
        wsum += wB[i];
      }
      let primed = false, lastFlux = 0;
      let slowDb = null;       // slow energy envelope (dB) that sustained sound sits on; a hit jumps above it
      let wSide = 0;           // 0 = mono source (Side is silent), 1 = real stereo

      // Auto-scale: place this instant's level relative to the 2 s rolling RMS of the same band.
      const autoY = (c, p, dt) => {
        c.win.push(p, dt);
        const m = c.win.mean();
        const refDb = Math.max(10 * Math.log10((m < 0 ? p : m) + 1e-14), GATE_DB);
        return clamp(AUTO_REF_Y + ((10 * Math.log10(p + 1e-14) - refDb) / AUTO_SPAN) * 100, 0, 100);
      };

      const analyse = (dt) => {
        if (demo) demo.step();
        A.getFloatFrequencyData(fa);
        AM.getFloatFrequencyData(fm);
        AS.getFloatFrequencyData(fsd);
        B.getFloatFrequencyData(fb);
        B.getFloatTimeDomainData(td);

        let total = 0;
        for (let i = 1; i < nA; i++) {
          let d = fa[i];
          if (!(d > -120)) d = -120;
          const p = Math.exp(d * LN10_10);
          pa[i] = p; total += p;
        }
        let totM = 0, totS = 0;
        for (let i = 1; i <= maxBin; i++) {
          let dm = fm[i], ds = fsd[i];
          if (!(dm > -120)) dm = -120;
          if (!(ds > -120)) ds = -120;
          const a = Math.exp(dm * LN10_10), b = Math.exp(ds * LN10_10);
          pm[i] = a; ps[i] = b; totM += a; totS += b;
        }

        // How stereo is the source? Mono input (mic, mono file) leaves Side empty, so Guitar/Synth falls back to Mid.
        if (totM > MONO_MIN) {
          const r = 10 * Math.log10((totS + 1e-14) / totM);
          const x = clamp((r - MONO_LO) / (MONO_HI - MONO_LO), 0, 1);
          wSide += (x * x * (3 - 2 * x) - wSide) * (1 - Math.exp(-dt / 0.4));
        }

        // Transients, two detectors blended:
        // 1) time-domain: energy of the last ~11 ms against a slow envelope. Sustained bass sits on the
        //    envelope (delta ~ 0); a drum hit leaps over it. The envelope falls fast so the next hit is seen.
        let e = 0;
        for (let i = 0; i < td.length; i++) e += td[i] * td[i];
        const dbNow = 10 * Math.log10(e / td.length + 1e-12);
        if (slowDb === null) slowDb = dbNow;
        const delta = dbNow > -75 ? Math.max(0, dbNow - slowDb - 1.5) : 0;
        slowDb += (dbNow - slowDb) * (1 - Math.exp(-dt / (dbNow > slowDb ? 0.12 : 0.03)));
        // 2) frequency-domain: weighted positive spectral flux (kick body and snare/hat region count more)
        let fl = 0, changed = false;
        for (let i = 1; i < nB; i++) {
          let d = fb[i];
          if (!(d > -120)) d = -120;
          if (!primed) { pb[i] = d; continue; }
          if (d !== pb[i]) changed = true;
          const r = d - pb[i] - 1.5;
          if (r > 0) fl += wB[i] * r;
          pb[i] = d;
        }
        if (!primed) primed = true;
        else if (changed) lastFlux = fl / wsum;
        const tv = 0.5 * (delta + lastFlux);

        for (let k = 0; k < channels.length; k++) {
          const c = channels[k];
          let y;
          if (c.kind === 'flux') {
            c.win.push(tv * tv, dt);
            const m = c.win.mean();
            const ref = Math.max(Math.sqrt(m < 0 ? tv * tv : m), TRANS_FLOOR);   // 2 s rolling RMS of the transient signal
            y = Math.pow(clamp(tv / (TRANS_MULT * ref), 0, 1), 0.8) * 100;
          } else if (c.kind === 'rms') {
            y = autoY(c, total, dt);
          } else {
            const tb = tables[k];
            let sm = 0, ss = 0, sf = 0;
            if (c.src === 'full') for (let j = 0; j < tb.length; j++) sf += tb[j][1] * pa[tb[j][0]];
            else for (let j = 0; j < tb.length; j++) { const w = tb[j][1], ix = tb[j][0]; sm += w * pm[ix]; ss += w * ps[ix]; }
            const pw = c.src === 'full' ? sf : c.src === 'side' ? wSide * ss + (1 - wSide) * sm : sm;
            y = autoY(c, pw, dt);
          }
          sample(c, y);
        }
      };

      aud = { ctx, stream, nodes, analyse };
      src = 'live';
      resetBlank();
      lastT = performance.now();
      emit('state', 'live', mode);
    } catch (e) {
      await bail(e);
    }
  }

  async function stop() {
    session++;
    const old = aud; aud = null;
    goAmbient();
    emit('state', 'idle');
    if (old) await dispose(old);
  }

  function setTf(ms) {
    if (ms === tf) return;
    tf = ms;
    if (src === 'ambient') prefill();
    else if (src === 'live') {
      resetBlank(true);                    // new candle size, but the 2 s loudness history carries on
    }
  }

  /* ---------------------------------------------------------------- renderer */
  const frac = () => clamp((performance.now() - boundary) / tf, 0, 1);

  function render(g, w, h, dpr, ch, o) {
    o = o || {};
    const nVis = o.nVis || 100;
    const glow = o.glow == null ? 1 : o.glow;
    const alpha = src === 'live' ? 1 : src === 'ambient' ? 0.42 : 0.2;
    const hue = ch.hue;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);

    const R = w - Math.round(w * 0.045);
    const step = R / nVis;
    const f = frac();
    const padT = h * 0.1, padB = h * 0.08, ph = h - padT - padB;
    const Y = (v) => padT + (1 - v / 100) * ph;

    // grid: horizontal guides, plus vertical guides that travel with the candles
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.beginPath();
    for (let q = 0; q <= 4; q++) { const y = Math.round(Y(q * 25)) + 0.5; g.moveTo(0, y); g.lineTo(R, y); }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.035)';
    g.beginPath();
    for (let k = 0; k <= nVis + 1; k++) {
      const n = ch.total - k;
      if (n < 0) break;
      if (n % 10 === 0) { const x = Math.round(R - step / 2 - (k + f) * step) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
    }
    g.stroke();

    // candles to draw, newest first (k = 0 is the one still forming)
    const items = [];
    if (ch.acc) items.push({ k: 0, c: ch.acc });
    for (let k = 1; k <= nVis + 1; k++) {
      const c = ch.hist[ch.hist.length - k];
      if (!c) break;
      items.push({ k, c });
    }
    if (!items.length) return;
    items.reverse();
    let prevUp = true;
    for (const it of items) {
      it.up = it.c.c > it.c.o ? true : it.c.c < it.c.o ? false : prevUp;
      prevUp = it.up;
      it.x = R - step / 2 - (it.k + f) * step;
    }

    g.globalAlpha = alpha;

    // soft close-price ribbon under the candles
    const first = items[0], last = items[items.length - 1];
    g.beginPath();
    g.moveTo(first.x, h);
    g.lineTo(first.x, Y(first.c.c));
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1], b = items[i];
      g.quadraticCurveTo(a.x, Y(a.c.c), (a.x + b.x) / 2, (Y(a.c.c) + Y(b.c.c)) / 2);
    }
    g.lineTo(last.x, Y(last.c.c));
    const ribbon = g.createLinearGradient(0, padT, 0, h);
    ribbon.addColorStop(0, 'hsla(' + hue + ',80%,62%,0.20)');
    ribbon.addColorStop(1, 'hsla(' + hue + ',80%,62%,0)');
    g.lineTo(last.x, h);
    g.closePath();
    g.fillStyle = ribbon; g.fill();
    g.beginPath();
    g.moveTo(first.x, Y(first.c.c));
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1], b = items[i];
      g.quadraticCurveTo(a.x, Y(a.c.c), (a.x + b.x) / 2, (Y(a.c.c) + Y(b.c.c)) / 2);
    }
    g.lineTo(last.x, Y(last.c.c));
    g.strokeStyle = 'hsla(' + hue + ',85%,72%,0.42)';
    g.lineWidth = 1.4;
    g.stroke();

    // candles, one batched wick path and one batched body path per colour
    const bw = Math.max(2, step * 0.56);
    const rr = bw > 5 ? Math.min(4, bw * 0.18) : 0;
    for (const up of [true, false]) {
      const rgb = up ? UP : DOWN;
      g.shadowColor = 'rgba(' + rgb + ',0.9)';
      g.shadowBlur = 11 * glow * dpr;
      g.strokeStyle = 'rgba(' + rgb + ',0.95)';
      g.lineWidth = Math.min(3, Math.max(1, step * 0.1));
      g.beginPath();
      for (const it of items) {
        if (it.up !== up) continue;
        const x = Math.round(it.x) + 0.5;
        g.moveTo(x, Y(it.c.h)); g.lineTo(x, Y(it.c.l));
      }
      g.stroke();
      g.fillStyle = 'rgba(' + rgb + ',0.92)';
      g.beginPath();
      for (const it of items) {
        if (it.up !== up) continue;
        const top = Y(Math.max(it.c.o, it.c.c));
        const bh = Math.max(1.5, Y(Math.min(it.c.o, it.c.c)) - top);
        if (rr && g.roundRect) g.roundRect(it.x - bw / 2, top, bw, bh, rr);
        else g.rect(it.x - bw / 2, top, bw, bh);
      }
      g.fill();
      g.shadowBlur = 0;
    }

    // price line and a glowing dot on the live candle
    const live = items[items.length - 1];
    if (live.k === 0) {
      const ly = Y(live.c.c);
      g.setLineDash([2, 6]);
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, Math.round(ly) + 0.5); g.lineTo(R, Math.round(ly) + 0.5); g.stroke();
      g.setLineDash([]);
      const col = live.up ? UP : DOWN;
      const halo = g.createRadialGradient(live.x, ly, 0, live.x, ly, 16);
      halo.addColorStop(0, 'rgba(' + col + ',0.55)');
      halo.addColorStop(1, 'rgba(' + col + ',0)');
      g.fillStyle = halo;
      g.fillRect(live.x - 16, ly - 16, 32, 32);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath(); g.arc(live.x, ly, 2.2, 0, 6.2832); g.fill();
    }
    g.globalAlpha = 1;

    // fade the oldest candles out on the left
    const fade = g.createLinearGradient(0, 0, w * 0.16, 0);
    fade.addColorStop(0, '#000');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, w * 0.16, h);
  }

  function renderLine(g, w, h, dpr, ch, o) {
    o = o || {};
    const nVis = o.nVis || 100;
    const glow = o.glow == null ? 1 : o.glow;
    const alpha = src === 'live' ? 1 : src === 'ambient' ? 0.55 : 0.25;
    const hue = ch.hue, en = ch.en;
    const now = performance.now();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);

    const R = w - Math.round(w * 0.045);
    const T = Math.max(200, nVis * tf);                 // milliseconds of history across the chart
    const padT = h * 0.1, padB = h * 0.08, ph = h - padT - padB;
    const Y = (v) => padT + (1 - v / 100) * ph;
    const hy = Y(ch.fo);

    // the whole chart breathes with the sound: a soft glow behind the live point
    g.globalAlpha = alpha;
    const bg = g.createRadialGradient(R, hy, 0, R, hy, Math.max(w, h) * (0.35 + 0.45 * en));
    bg.addColorStop(0, 'hsla(' + hue + ',85%,55%,' + (0.05 + 0.2 * en).toFixed(3) + ')');
    bg.addColorStop(1, 'hsla(' + hue + ',85%,55%,0)');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    // grid: horizontal guides, plus vertical guides that drift left with time
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.beginPath();
    for (let q = 0; q <= 4; q++) { const y = Math.round(Y(q * 25)) + 0.5; g.moveTo(0, y); g.lineTo(R, y); }
    g.stroke();
    const sp = R / 10, off = ((now % (T / 10)) / (T / 10)) * sp;
    g.strokeStyle = 'rgba(255,255,255,0.035)';
    g.beginPath();
    for (let k = 0; k <= 11; k++) { const x = Math.round(R - off - k * sp) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
    g.stroke();

    // points, oldest to newest, box-averaged so a long span never gets noisy
    const span = T / FP_MS;
    const avail = ch.fn - 1;
    const maxPts = Math.max(40, Math.round(R / 2.5));
    const stride = Math.max(1, Math.ceil(Math.min(avail, span + 2) / maxPts));
    const xs = [], ys = [];
    for (let j = 0; j + stride <= avail; j += stride) {
      const age = ch.facc + (j + (stride - 1) / 2) * FP_MS;
      const x = R - (age / T) * R;
      if (x < -12) break;
      let sum = 0;
      for (let q = 0; q < stride; q++) sum += ch.fb[(ch.fi - 1 - (j + q) + FP_CAP * 2) % FP_CAP];
      xs.push(x); ys.push(Y(sum / stride));
    }
    xs.reverse(); ys.reverse();
    xs.push(R); ys.push(hy);                                // the live head
    const n = xs.length;
    const trace = (dx) => {
      g.moveTo(xs[0] + dx, ys[0]);
      for (let i = 1; i < n; i++) g.quadraticCurveTo(xs[i - 1] + dx, ys[i - 1], (xs[i - 1] + xs[i]) / 2 + dx, (ys[i - 1] + ys[i]) / 2);
      g.lineTo(xs[n - 1] + dx, ys[n - 1]);
    };

    if (n > 2) {
      g.lineJoin = 'round'; g.lineCap = 'round';

      // soft fill under the line
      g.beginPath(); trace(0);
      g.lineTo(xs[n - 1], h); g.lineTo(xs[0], h); g.closePath();
      const fill = g.createLinearGradient(0, padT, 0, h);
      fill.addColorStop(0, 'hsla(' + hue + ',80%,60%,' + (0.12 + 0.24 * en).toFixed(3) + ')');
      fill.addColorStop(1, 'hsla(' + hue + ',80%,60%,0)');
      g.fillStyle = fill; g.fill();

      // main line: thickness and glow follow the energy; a thin bright core keeps it crisp
      g.beginPath(); trace(0);
      g.shadowColor = 'hsla(' + hue + ',95%,62%,0.9)';
      g.shadowBlur = (6 + 16 * en) * glow * dpr;
      g.strokeStyle = 'hsla(' + hue + ',90%,70%,0.95)';
      g.lineWidth = 1.5 + 1.8 * en;
      g.stroke();
      g.shadowBlur = 0;
      g.beginPath(); trace(0);
      g.strokeStyle = 'hsla(' + hue + ',100%,93%,0.8)';
      g.lineWidth = 0.8;
      g.stroke();
    }

    // live point: dashed level line, halo that swells with energy, ripples on every onset
    g.setLineDash([2, 6]);
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, Math.round(hy) + 0.5); g.lineTo(R, Math.round(hy) + 0.5); g.stroke();
    g.setLineDash([]);
    const hr = 12 + 20 * en;
    const halo = g.createRadialGradient(R, hy, 0, R, hy, hr);
    halo.addColorStop(0, 'hsla(' + hue + ',95%,68%,' + (0.5 + 0.3 * en).toFixed(3) + ')');
    halo.addColorStop(1, 'hsla(' + hue + ',95%,68%,0)');
    g.fillStyle = halo;
    g.fillRect(R - hr, hy - hr, hr * 2, hr * 2);
    for (let i = ch.rings.length - 1; i >= 0; i--) {
      const age = now - ch.rings[i];
      if (age > 900) { ch.rings.splice(i, 1); continue; }
      const u = age / 900;
      g.strokeStyle = 'hsla(' + hue + ',95%,72%,' + (Math.pow(1 - u, 1.6) * 0.6).toFixed(3) + ')';
      g.lineWidth = 1.6 * (1 - u) + 0.4;
      g.beginPath(); g.arc(R, hy, 4 + u * (26 + 22 * glow), 0, 6.2832); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.arc(R, hy, 2.2 + 1.2 * en, 0, 6.2832); g.fill();
    g.globalAlpha = 1;

    // fade the oldest part out on the left
    const fade = g.createLinearGradient(0, 0, w * 0.16, 0);
    fade.addColorStop(0, '#000');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, w * 0.16, h);
  }

  /* ----------------------------------------------------------------- zoom */
  const ZOOMS = [1, 1.5, 2, 3, 4, 6];
  let zoomIdx = 0;
  const getZoom = () => ZOOMS[zoomIdx];
  function zoomIn() { if (zoomIdx < ZOOMS.length - 1) { zoomIdx++; emit('zoom'); } }
  function zoomOut() { if (zoomIdx > 0) { zoomIdx--; emit('zoom'); } }
  function bindZoomInput(el) {
    let lastWheel = 0;
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheel < 140) return;
      lastWheel = now;
      if (e.deltaY < 0) zoomIn(); else if (e.deltaY > 0) zoomOut();
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') zoomIn();
      else if (e.key === '-' || e.key === '_') zoomOut();
    });
  }

  /* ---------------------------------------------------------- shared controls */
  function mountControls(inputsEl, tfEl, zoomEl) {
    const mk = (cls, label, html) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = cls; b.setAttribute('aria-label', label); b.innerHTML = html;
      return b;
    };
    const lb = (t) => '<span class="lb">' + t + '</span>';
    const btns = {};
    [['mic', 'Mic', 'microphone'], ['system', 'System', 'system or browser audio'], ['demo', 'Demo', 'demo beat']].forEach(([m, name, aria]) => {
      const b = mk('ib', aria, ICONS[m] + lb(name));
      b.addEventListener('click', () => start(m));
      inputsEl.appendChild(b);
      btns[m] = b;
    });
    const sb = mk('ib stop', 'stop', ICONS.stop + lb('Stop'));
    sb.disabled = true;
    sb.addEventListener('click', () => stop());
    inputsEl.appendChild(sb);
    inputsEl.dataset.st = 'idle';

    on('state', (st, mode) => {
      inputsEl.dataset.st = st;
      for (const m of Object.keys(btns)) btns[m].dataset.on = String(st !== 'idle' && m === mode);
      sb.disabled = st === 'idle';
    });
    on('error', (mode) => {
      const b = btns[mode];
      if (!b) return;
      b.classList.remove('err'); void b.offsetWidth; b.classList.add('err');
    });

    const tbs = TFS.map((ms) => {
      const b = mk('tb', ms + ' millisecond candles', ms + '<small>ms</small>');
      b.addEventListener('click', () => { setTf(ms); paint(); });
      tfEl.appendChild(b);
      return [ms, b];
    });
    const paint = () => tbs.forEach(([ms, b]) => b.setAttribute('aria-pressed', String(ms === tf)));
    paint();

    if (zoomEl) {
      const zo = mk('zb', 'zoom out, more candles', ICONS.minus + lb('Zoom out'));
      const zi = mk('zb', 'zoom in, fewer and broader candles', ICONS.plus + lb('Zoom in'));
      const zv = document.createElement('span');
      zv.className = 'zv';
      zo.addEventListener('click', zoomOut);
      zi.addEventListener('click', zoomIn);
      zoomEl.append(zo, zv, zi);
      const paintZ = () => {
        zv.textContent = getZoom() + '×';
        zo.disabled = zoomIdx === 0;
        zi.disabled = zoomIdx === ZOOMS.length - 1;
      };
      on('zoom', paintZ);
      paintZ();
    }
  }

  function watchSize(canvas, cb) {
    const ro = new ResizeObserver((es) => {
      const r = es[0].contentRect;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(r.width), h = Math.floor(r.height);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      cb(w, h, dpr);
    });
    ro.observe(canvas);
  }

  function toggleFullscreen(el) {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen();
    } catch (e) { /* ignore */ }
  }

  prefill();
  makeTicker(tick, TICK_MS);

  return { BANDS, channels, ICONS, getTf: () => tf, setTf, getZoom, zoomIn, zoomOut, bindZoomInput, start, stop, on, render, renderLine, mountControls, watchSize, toggleFullscreen };
})();

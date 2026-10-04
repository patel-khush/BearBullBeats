(() => {
  const stage = document.getElementById('stage');
  const view = document.getElementById('view');
  const dock = document.getElementById('dock');
  const chipsEl = document.getElementById('chips');
  const N = CB.channels.length;
  const CW = 54, CH = 44, DOCK_H = 52;
  const WN = N * CW + (N - 1) * 2 + 17;        // natural width of the icon group when it sits inline in the control row
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const win = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
  const smooth = (t) => t * t * (3 - 2 * t);
  const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const eoc = (t) => 1 - Math.pow(1 - t, 3);
  const bounce = (t) => {                      // gravity drop that lands and rebounds
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
    if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
    t -= 2.625 / d; return n * t * t + 0.984375;
  };

  /* Two independent axes give four modes:
       L  layout  0 = nine charts, 1 = one big chart with the icons docked in the bar
       S  style   0 = candlesticks, 1 = line graphs
     Each axis has a progress value that eases toward its target (or follows a dragged knob). */
  const mkAxis = (dur, tau, btn, names, keyName) => ({ p: 0, v: 0, target: 0, dur: REDUCED ? 0.4 : dur, tau, btn, names, keyName, dragging: false, moved: false, sm: 0, kP: -1, kG: -1, kS: -1, busy: false });
  const L = mkAxis(2.1, 0.11, document.getElementById('mode'), ['Grid view', 'Single view'], 'V');
  const S = mkAxis(1.2, 0.08, document.getElementById('style'), ['Candlesticks', 'Line graph'], 'L');

  let sel = 1;           // band shown big in single view
  let narrow = false;

  function setTarget(ax, t) {
    ax.target = t;
    ax.btn.setAttribute('aria-checked', String(!!t));
    ax.btn.dataset.tip = ax.names[t ? 1 : 0] + ' \u00b7 click, drag or press ' + ax.keyName;
  }

  /* ----------------------------------------------------------------- build */
  const mkLayer = (cls) => {
    const cv = document.createElement('canvas');
    if (cls) cv.className = cls;
    return { cv, g: cv.getContext('2d', { alpha: false }), cw: 0, chh: 0, d: 0 };
  };
  const cells = CB.channels.map((ch, i) => {
    const el = document.createElement('div');
    el.className = 'cell';
    el.style.setProperty('--h', ch.hue);
    const candle = mkLayer(), line = mkLayer('ln');
    const veil = document.createElement('div'); veil.className = 'veil';
    const tag = document.createElement('div'); tag.className = 'tag';
    const ti = document.createElement('span'); ti.className = 'ti'; ti.innerHTML = CB.ICONS[ch.id];
    const tn = document.createElement('span'); tn.className = 'tn'; tn.textContent = ch.name;
    tag.append(ti, tn);
    el.append(candle.cv, line.cv, veil, tag);
    view.appendChild(el);
    const open = () => { if (L.p > 0 || L.target !== 0) return; sel = i; setTarget(L, 1); };
    ti.addEventListener('click', open); tn.addEventListener('click', open);
    ti.title = tn.title = 'Open ' + ch.name + ' full view';
    return { ch, el, candle, line, veil, ti, tn, live: '', vis: false, lnShow: false, mask: '' };
  });

  const slots = CB.BANDS.map(() => { const s = document.createElement('div'); s.className = 'slot'; dock.appendChild(s); return s; });
  const dsep = document.createElement('span'); dsep.className = 'sep'; dock.appendChild(dsep);

  const chips = CB.BANDS.map((b, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'bb chip';
    el.style.setProperty('--h', b.hue);
    el.setAttribute('aria-label', b.name);
    el.innerHTML = '<span class="tail u"></span><span class="tail d"></span>' + CB.ICONS[b.id] + '<span class="lb">' + b.short + '</span>';
    el.addEventListener('click', () => { if (L.p >= 1 && L.target === 1) select(i); });
    chipsEl.appendChild(el);
    return { el, tu: el.children[0], td: el.children[1], vis: false, prevY: null, vy: 0, pe: '' };
  });

  function select(i) { if (i !== sel) sel = i; }

  /* --------------------------------------------------------------- controls */
  const tfsEl = document.getElementById('tfs'), zoomEl = document.getElementById('zoom'), inputsEl = document.getElementById('inputs');
  CB.mountControls(inputsEl, tfsEl, zoomEl);
  CB.bindZoomInput(view);

  // One row when everything fits (icons inline with the controls, as in the single-chart layout); otherwise the icons take a row of their own.
  let dockKey = '';
  function layoutMode() {
    const need = 140 + tfsEl.offsetWidth + zoomEl.offsetWidth + inputsEl.offsetWidth + 3 * 17 + WN + 24;
    narrow = window.innerWidth < need;
    stage.classList.toggle('narrow', narrow);
    const sw = narrow ? Math.max(30, Math.min(CW, Math.floor((window.innerWidth - 40) / N))) : CW;
    dock.style.setProperty('--sw', sw + 'px');
    dockKey = '';
  }
  layoutMode();
  window.addEventListener('resize', layoutMode);

  /* ------------------------------------------------- the two tiny sliders */
  // Click toggles, arrow keys move, and dragging the knob scrubs the transition itself.
  function bindSlider(ax) {
    const btn = ax.btn;
    let dragX = 0, dragPP = 0, dragVel = 0, dragT = 0, suppress = false;
    const ppFromEvent = (e) => clamp((e.clientX - btn.getBoundingClientRect().left - 14) / 18, 0, 1);
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      ax.dragging = true; ax.moved = false; dragX = e.clientX; dragVel = 0; dragT = performance.now(); dragPP = ax.p;
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    btn.addEventListener('pointermove', (e) => {
      if (!ax.dragging) return;
      if (!ax.moved && Math.abs(e.clientX - dragX) > 3) { ax.moved = true; btn.classList.add('drag'); }
      if (!ax.moved) return;
      const pp = ppFromEvent(e), now = performance.now();
      const inst = (pp - dragPP) / Math.max(8, now - dragT) * 1000;
      dragVel += (inst - dragVel) * 0.4;
      dragPP = pp; dragT = now;
      ax.p = pp; ax.v = 0;
      setTarget(ax, ax.p > 0.5 ? 1 : 0);
    });
    const end = () => {
      if (!ax.dragging) return;
      ax.dragging = false; btn.classList.remove('drag');
      if (ax.moved) {
        setTarget(ax, Math.abs(dragVel) > 1.2 ? (dragVel > 0 ? 1 : 0) : (ax.p > 0.5 ? 1 : 0));
        suppress = true; setTimeout(() => { suppress = false; }, 0);
        ax.v = 0;
      }
      ax.moved = false;
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('click', () => { if (suppress) return; setTarget(ax, ax.target ? 0 : 1); });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setTarget(ax, 0); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setTarget(ax, 1); }
    });
  }
  bindSlider(L); bindSlider(S);

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k >= '1' && k <= '9') {
      const i = Number(k) - 1;
      if (L.p <= 0 && L.target === 0) { sel = i; setTarget(L, 1); }
      else if (L.p >= 1 && L.target === 1) select(i);
    } else if (k === 'v' || k === 'V') setTarget(L, L.target ? 0 : 1);
    else if (k === 'l' || k === 'L') setTarget(S, S.target ? 0 : 1);
    else if (k === 'f' || k === 'F') CB.toggleFullscreen(document.documentElement);
  });
  view.addEventListener('dblclick', () => CB.toggleFullscreen(document.documentElement));

  /* ----------------------------------------------------------------- frame */
  const ov = new Array(N).fill(0);        // per-cell fade, used only while settled in single view (band switching)
  let last = performance.now();

  function fit(l, w, h, d) {
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    if (l.cw !== W || l.chh !== H || l.d !== d) {
      l.cv.width = Math.round(W * d); l.cv.height = Math.round(H * d);
      l.cv.style.width = W + 'px'; l.cv.style.height = H + 'px';
      l.cw = W; l.chh = H; l.d = d;
    }
  }

  // eased progress: velocity ramps toward the wanted speed, so starts, stops and reversals are all smooth
  function stepAxis(ax, dt) {
    ax.prev = ax.p;
    if (!(ax.dragging && ax.moved)) {
      ax.v += ((ax.target ? 1 : -1) / ax.dur - ax.v) * (1 - Math.exp(-dt / ax.tau));
      ax.p = clamp(ax.p + ax.v * dt, 0, 1);
      if ((ax.p <= 0 && ax.v < 0) || (ax.p >= 1 && ax.v > 0)) ax.v = 0;
    }
  }
  // slider knob follows the real progress, stretching a little with speed
  function paintKnob(ax, dt) {
    ax.sm += ((ax.p - ax.prev) / dt - ax.sm) * 0.35;
    const g = Math.min(1, Math.sin(Math.PI * ax.p) * 1.15), st = 1 + Math.min(0.45, Math.abs(ax.sm) * (0.7 * ax.dur / 2.1));
    const b = ax.btn;
    if (Math.abs(ax.p - ax.kP) > 0.0004) { b.style.setProperty('--p', ax.p.toFixed(4)); ax.kP = ax.p; }
    if (Math.abs(g - ax.kG) > 0.01) { b.style.setProperty('--g', g.toFixed(3)); ax.kG = g; }
    if (Math.abs(st - ax.kS) > 0.005) { b.style.setProperty('--st', st.toFixed(3)); ax.kS = st; }
    const busy = ax.p > 0 && ax.p < 1;
    if (busy !== ax.busy) { ax.busy = busy; b.classList.toggle('busy', busy); }
  }

  function frame(now) {
    const dt = Math.max(0.001, Math.min(0.05, (now - last) / 1000));
    last = now;
    stepAxis(L, dt); stepAxis(S, dt);
    paintKnob(L, dt); paintKnob(S, dt);
    const p = L.p, target = L.target;
    const s1 = p >= 1, s0 = p <= 0;
    const mm = eio(S.p);                       // graph-style morph, 0 = candles, 1 = lines
    const showC = mm < 0.999, showL = mm > 0.001;

    // the icon group opens up in the control row (or as its own row on narrow screens) as icons start to fall
    const prog = eio(win(p, 0.12, 0.42));
    const key = narrow ? 'n' + (p > 0 ? DOCK_H * prog : -1).toFixed(1) : 'w' + (WN * prog).toFixed(1);
    if (key !== dockKey) {
      dockKey = key;
      if (narrow) { dock.style.display = p > 0 ? 'flex' : 'none'; dock.style.width = ''; dock.style.height = (DOCK_H * prog).toFixed(2) + 'px'; }
      else { dock.style.display = ''; dock.style.height = ''; dock.style.width = (WN * prog).toFixed(2) + 'px'; }
      dsep.style.opacity = prog.toFixed(3);
    }

    // reads
    const vr = view.getBoundingClientRect();
    const W = vr.width, H = vr.height;
    const sr = p > 0 ? slots.map((s) => s.getBoundingClientRect()) : null;
    if (W < 4 || H < 4) { requestAnimationFrame(frame); return; }

    const gw = (W - 2) / 3, gh = (H - 2) / 3;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const zoom = CB.getZoom();
    const selCol = sel % 3, selRow = Math.floor(sel / 3);
    const selGeom = { x: 0, y: 0, L: 12, T: 10, ico: 14 };

    // soft-edged wipe that sweeps the line layer in (or out) across each chart
    const edge = mm * 112;
    const maskCss = mm >= 0.999 ? 'none' : 'linear-gradient(90deg,#000 ' + (edge - 12).toFixed(2) + '%,transparent ' + edge.toFixed(2) + '%)';

    for (let i = 0; i < N; i++) {
      const c = cells[i];
      const gx = (i % 3) * (gw + 1), gy = Math.floor(i / 3) * (gh + 1);
      const sti = clamp(Math.hypot((i % 3) - selCol, Math.floor(i / 3) - selRow) / 2.83, 0, 1);
      let x, y, w, h, e = 0, a = 0, op = 1, vis = true, cvW = gw, cvH = gh, rad = 0;

      if (s1) {
        const tg = i === sel ? 1 : 0;
        ov[i] += (tg - ov[i]) * (1 - Math.exp(-dt * 16));
        if (Math.abs(ov[i] - tg) < 0.004) ov[i] = tg;
        x = 0; y = 0; w = W; h = H; e = 1; op = ov[i]; cvW = W; cvH = H; vis = op > 0.003;
      } else {
        ov[i] = i === sel ? 1 : 0;
        if (i === sel) {
          e = eio(win(p, 0.30, 0.92));
          x = gx * (1 - e); y = gy * (1 - e); w = lerp(gw, W, e); h = lerp(gh, H, e);
          cvW = w; cvH = h;
        } else {
          a = eio(win(p, 0.08 * sti, 0.22 + 0.08 * sti));
          w = lerp(gw, CW, a); h = lerp(gh, CH, a);
          x = gx + gw / 2 - w / 2; y = gy + gh / 2 - h / 2;
          rad = 8 * a; vis = a < 0.995;
        }
      }

      // tag (icon + name): small in the grid, label-sized when expanded, icon-only when collapsed
      let Lx, T, ico, gap, fs, tnOp;
      if (s1 || i === sel) { Lx = lerp(12, 18, e); T = lerp(10, 14, e); ico = lerp(14, 17, e); gap = lerp(7, 9, e); fs = lerp(10, 12, e); tnOp = lerp(0.85, 0.9, e); }
      else { Lx = lerp(12, (CW - 17) / 2, a); T = lerp(10, 6.5, a); ico = lerp(14, 17, a); gap = 7; fs = 10; tnOp = Math.max(0, 1 - a * 3) * 0.85; }
      if (i === sel) { selGeom.x = x; selGeom.y = y; selGeom.L = Lx; selGeom.T = T; selGeom.ico = ico; }

      const live = s0 && target === 0 ? '1' : '0';
      if (c.live !== live) { c.el.dataset.live = live; c.live = live; }

      if (!vis) { if (c.vis) { c.el.style.visibility = 'hidden'; c.vis = false; } continue; }
      if (!c.vis) { c.el.style.visibility = 'visible'; c.vis = true; }

      const es = c.el.style;
      es.left = x.toFixed(2) + 'px'; es.top = y.toFixed(2) + 'px';
      es.width = w.toFixed(2) + 'px'; es.height = h.toFixed(2) + 'px';
      es.borderRadius = rad.toFixed(2) + 'px';
      es.opacity = op.toFixed(3);
      es.zIndex = i === sel ? 3 : (s1 ? 2 : 1);
      es.boxShadow = '0 0 0 1px rgba(22,22,22,' + (1 - a).toFixed(3) + ')';
      c.veil.style.opacity = a.toFixed(3);

      c.ti.style.cssText = 'left:' + Lx.toFixed(2) + 'px;top:' + T.toFixed(2) + 'px;width:' + ico.toFixed(2) + 'px;height:' + ico.toFixed(2) + 'px';
      c.tn.style.cssText = 'left:' + (Lx + ico + gap).toFixed(2) + 'px;top:' + T.toFixed(2) + 'px;line-height:' + ico.toFixed(2) + 'px;font-size:' + fs.toFixed(2) + 'px;letter-spacing:' + lerp(0.14, 0.16, e).toFixed(3) + 'em;opacity:' + tnOp.toFixed(3);

      const cvOp = 1 - clamp(a * 1.8, 0, 1);
      c.candle.cv.style.opacity = cvOp.toFixed(3);
      c.line.cv.style.opacity = cvOp.toFixed(3);
      if (cvOp < 0.01) continue;

      const base = lerp(Math.max(44, Math.min(120, cvW / 7)), Math.max(70, Math.min(220, cvW / 9)), e);
      const opts = { nVis: Math.max(8, base / zoom), glow: lerp(0.8, 1.15, e) };

      c.candle.cv.style.display = showC ? 'block' : 'none';
      if (showC) {
        fit(c.candle, cvW, cvH, dpr);
        c.candle.cv.style.left = ((w - c.candle.cw) / 2).toFixed(2) + 'px';
        c.candle.cv.style.top = ((h - c.candle.chh) / 2).toFixed(2) + 'px';
        CB.render(c.candle.g, c.candle.cw, c.candle.chh, c.candle.d, c.ch, opts);
      }
      if (showL !== c.lnShow) { c.line.cv.style.display = showL ? 'block' : 'none'; c.lnShow = showL; }
      if (showL) {
        fit(c.line, cvW, cvH, dpr);
        c.line.cv.style.left = ((w - c.line.cw) / 2).toFixed(2) + 'px';
        c.line.cv.style.top = ((h - c.line.chh) / 2).toFixed(2) + 'px';
        if (c.mask !== maskCss) { c.line.cv.style.webkitMaskImage = maskCss; c.line.cv.style.maskImage = maskCss; c.mask = maskCss; }
        CB.renderLine(c.line.g, c.line.cw, c.line.chh, c.line.d, c.ch, opts);
      }
    }

    /* --------------------------------------------------- flying band icons */
    for (let i = 0; i < N; i++) {
      const c = chips[i], el = c.el;
      if (!sr) {
        if (c.vis) { el.style.visibility = 'hidden'; c.vis = false; }
        c.prevY = null; continue;
      }
      const r = sr[i];
      const ex = r.left + r.width / 2, ey = r.top + r.height / 2, sEnd = r.width / CW;
      let cx = ex, cy = ey, scale = sEnd, rot = 0, k = 1, lb = 1, show = true, opacity = 1, fsn = 1;

      if (!s1) {
        const gx = (i % 3) * (gw + 1), gy = Math.floor(i / 3) * (gh + 1);
        const sti = clamp(Math.hypot((i % 3) - selCol, Math.floor(i / 3) - selRow) / 2.83, 0, 1);
        let sx, sy, s0s;
        if (i === sel) {
          fsn = win(p, 0.10, 0.52);
          sx = vr.left + selGeom.x + selGeom.L + selGeom.ico / 2;
          sy = vr.top + selGeom.y + selGeom.T + selGeom.ico / 2;
          s0s = 0.4; opacity = smooth(win(p, 0, 0.07)); show = p > 0.003;
        } else {
          fsn = win(p, 0.24 + 0.14 * sti, 0.66 + 0.14 * sti);
          sx = vr.left + gx + gw / 2; sy = vr.top + gy + gh / 2; s0s = 1;
          show = eio(win(p, 0.08 * sti, 0.22 + 0.08 * sti)) >= 0.995;
        }
        cx = lerp(sx, ex, eio(win(fsn, 0, 0.75)));
        cy = lerp(sy, ey, bounce(fsn));
        scale = lerp(s0s, sEnd, eoc(win(fsn, 0, 0.6)));
        k = smooth(win(fsn, 0.8, 1));
        lb = smooth(win(fsn, 0.55, 1));
        rot = (ex >= sx ? 1 : -1) * 12 * Math.sin(Math.PI * fsn) * (1 - fsn);
      }

      if (show !== c.vis) { el.style.visibility = show ? 'visible' : 'hidden'; c.vis = show; }
      if (!show) { c.prevY = null; continue; }

      const vy = c.prevY == null ? 0 : cy - c.prevY;
      c.prevY = cy;
      c.vy += (vy - c.vy) * 0.45;
      const tl = s1 ? 0 : Math.min(80, Math.abs(c.vy) * 2.2);
      c.tu.style.height = (c.vy > 0 ? tl : 0).toFixed(1) + 'px';
      c.td.style.height = (c.vy < 0 ? tl : 0).toFixed(1) + 'px';

      el.style.transform = 'translate(' + (cx - CW / 2).toFixed(2) + 'px,' + (cy - CH / 2).toFixed(2) + 'px) rotate(' + rot.toFixed(2) + 'deg) scale(' + scale.toFixed(3) + ')';
      el.style.opacity = opacity.toFixed(3);
      el.style.setProperty('--k', k.toFixed(3));
      el.style.setProperty('--lb', lb.toFixed(3));
      el.setAttribute('aria-pressed', String(i === sel && s1));
      const pe = s1 && target === 1 ? 'auto' : 'none';
      if (c.pe !== pe) { el.style.pointerEvents = pe; c.pe = pe; }
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

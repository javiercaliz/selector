/* Minijuego: Carrera de vallas.
   Personitas corren por andariveles con vallas; algunas tropiezan, se caen, se levantan…
   y otras quedan en el camino. Quien cruza primero la meta presenta.
   Justicia: el ganador se sortea ANTES de largar (azar criptográfico, uniforme). Después se
   generan guiones de carrera al azar para todos y se usa uno en el que ese ganador llega primero. */
(() => {
  'use strict';
  const { Store, Sound, Confetti, Games, util } = window.Selector;

  /* ---------- Guion de la carrera (en unidades de distancia, 0 → META) ---------- */
  const META = 1000;
  const VALLAS = [180, 310, 440, 570, 700, 830];
  const SALTO = 56;            // distancia que cubre un salto (28 antes y 28 después de la valla)
  const COUNTDOWN = 2.4;       // segundos de "3, 2, 1"

  const rnd = (a, b) => a + Math.random() * (b - a);

  /** Genera la carrera de una persona como una lista de tramos {type, t0, t1, x0, x1}. */
  function makeScript() {
    const segs = [];
    let t = rnd(0.08, 0.35), x = 0;
    segs.push({ type: 'ready', t0: 0, t1: t, x0: 0, x1: 0 });
    const base = rnd(100, 122);
    let out = false;
    const knocks = [];
    for (let k = 0; k <= VALLAS.length; k++) {
      const target = k < VALLAS.length ? VALLAS[k] - SALTO / 2 : META;
      const v = base * rnd(0.88, 1.12);
      const d = (target - x) / v;
      segs.push({ type: 'run', t0: t, t1: t + d, x0: x, x1: target });
      t += d; x = target;
      if (k === VALLAS.length) break;

      const r = Math.random();
      if (r < 0.72) {                              // salta limpio
        const d2 = SALTO / v;
        segs.push({ type: 'jump', t0: t, t1: t + d2, x0: x, x1: x + SALTO });
        t += d2; x += SALTO;
      } else if (r < 0.87) {                       // la toca, tropieza y la tira
        const d2 = SALTO / (v * 0.55);
        knocks.push({ k, t: t + d2 * 0.4 });
        segs.push({ type: 'stumble', t0: t, t1: t + d2, x0: x, x1: x + SALTO });
        t += d2; x += SALTO;
      } else {                                     // se cae
        knocks.push({ k, t: t + 0.12 });
        segs.push({ type: 'fall', t0: t, t1: t + 0.38, x0: x, x1: x + 40 });
        t += 0.38; x += 40;
        if (Math.random() < 0.22) {                // …y queda en el camino
          segs.push({ type: 'out', t0: t, t1: Infinity, x0: x, x1: x });
          out = true;
          break;
        }
        const down = rnd(0.7, 2.0);
        segs.push({ type: 'down', t0: t, t1: t + down, x0: x, x1: x });
        t += down;
        segs.push({ type: 'getup', t0: t, t1: t + 0.45, x0: x, x1: x });
        t += 0.45;
      }
    }
    const finish = out ? Infinity : t;
    if (!out) {
      segs.push({ type: 'cooldown', t0: t, t1: t + 0.9, x0: META, x1: META + 45 });
      segs.push({ type: 'celebrate', t0: t + 0.9, t1: Infinity, x0: META + 45, x1: META + 45 });
    }
    return { segs, finish, knocks, out };
  }

  /** Arma la carrera de todos de modo que `winnerIdx` llegue primero (con final reñido si se puede). */
  function makeRace(n, winnerIdx) {
    let best = null, bestScore = Infinity, accepted = 0;
    for (let tries = 0; tries < 6000 && accepted < 25; tries++) {
      const scripts = Array.from({ length: n }, makeScript);
      const w = scripts[winnerIdx];
      if (w.out) continue;
      let second = Infinity, ok = true;
      for (let i = 0; i < n; i++) {
        if (i === winnerIdx) continue;
        if (scripts[i].finish <= w.finish) { ok = false; break; }
        second = Math.min(second, scripts[i].finish);
      }
      if (!ok) continue;
      accepted++;
      const margin = second - w.finish;                // ideal: ~0.3 s de diferencia
      const score = n === 1 ? 0 : Math.abs(margin - 0.3);
      if (score < bestScore) { best = scripts; bestScore = score; }
    }
    if (!best) {                                       // salvaguarda (prácticamente imposible)
      best = Array.from({ length: n }, makeScript);
      const order = best.map((s, i) => [s.finish, i]).sort((a, b) => a[0] - b[0]);
      [best[winnerIdx], best[order[0][1]]] = [best[order[0][1]], best[winnerIdx]];
    }
    return best;
  }

  function segAt(script, t) {
    const s = script.segs;
    for (let i = 0; i < s.length; i++) if (t < s[i].t1) return { seg: s[i], i, p: Math.max(0, Math.min(1, (t - s[i].t0) / (s[i].t1 - s[i].t0))) };
    const last = s[s.length - 1];
    return { seg: last, i: s.length - 1, p: 1 };
  }

  /* ---------- Personita ---------- */
  const SKINS = ['#f6d3b3', '#e8b68f', '#c98e62', '#a8693f', '#7a4a2a', '#f1c6a4'];
  const HAIRS = ['#2b1a12', '#4a2c17', '#8a5a2b', '#d9a441', '#1b1b1b', '#b5462e', '#6b6b6b'];

  function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  /** Ángulos de extremidades medidos desde "hacia abajo"; positivo = hacia adelante (derecha). */
  function poseFor(type, phase, time) {
    switch (type) {
      case 'ready':
        return { lean: 0.55, legs: [[0.75, -0.35], [-0.15, -0.9]], arms: [[-0.35, 0.1], [0.3, 0.6]] };
      case 'jump':
        return { lean: 0.35, legs: [[1.45, 1.5], [-0.65, -1.9]], arms: [[1.5, 1.7], [-0.8, -0.3]] };
      case 'celebrate': {
        const w = Math.sin(time * 9) * 0.25;
        return { lean: 0, legs: [[0.12, 0.05], [-0.12, -0.05]], arms: [[2.6 + w, 2.9 + w], [-2.6 - w, -2.9 - w]] };
      }
      case 'down': case 'out': case 'fall': case 'getup':
        return { lean: 0, legs: [[0.15, 0.1], [-0.1, -0.35]], arms: [[1.2, 1.6], [-0.5, 0.2]] };
      default: { // run, stumble, cooldown
        const leg = ph => { const a = 0.8 * Math.sin(ph); return [a, a - 0.25 - 0.9 * Math.max(0, -Math.cos(ph))]; };
        const arm = ph => { const a = -0.8 * Math.sin(ph); return [a, a + 1.5]; };
        return { lean: type === 'cooldown' ? 0.08 : 0.2, legs: [leg(phase), leg(phase + Math.PI)], arms: [arm(phase), arm(phase + Math.PI)] };
      }
    }
  }

  function drawRunner(c, x, groundY, s, o) {
    const lw = Math.max(1.6, s * 0.08);
    const P = poseFor(o.type, o.phase, o.time);
    c.save();
    c.globalAlpha = o.alpha ?? 1;

    // sombra
    const lying = Math.abs(o.tilt) > 0.3;
    c.fillStyle = 'rgba(0,0,0,.25)';
    c.beginPath();
    c.ellipse(x + (lying ? s * 0.4 * Math.sin(o.tilt) : 0), groundY, s * (lying ? 0.45 : 0.2) * (1 - Math.min(0.5, o.lift / s)), s * 0.05, 0, 0, Math.PI * 2);
    c.fill();

    // posición de las piezas, con la cadera en (0,0)
    const L1 = s * 0.22, L2 = s * 0.22, A1 = s * 0.15, A2 = s * 0.14;
    const end = (ox, oy, a, l) => [ox + Math.sin(a) * l, oy + Math.cos(a) * l];
    const legPts = P.legs.map(([a, b]) => { const k = end(0, 0, a, L1); return [k, end(k[0], k[1], b, L2)]; });
    const lowest = Math.max(...legPts.map(([k, f]) => Math.max(k[1], f[1])));

    if (lying) { c.translate(x, groundY - lw * 1.1); c.rotate(o.tilt); c.translate(0, -lowest); }
    else { c.translate(x, groundY - o.lift - lowest); if (o.tilt) c.rotate(o.tilt); }

    const sh = [Math.sin(P.lean) * s * 0.3, -Math.cos(P.lean) * s * 0.3];
    const head = [sh[0] + Math.sin(P.lean) * s * 0.17, sh[1] - Math.cos(P.lean) * s * 0.17];
    c.lineCap = 'round'; c.lineJoin = 'round';

    const line = (pts, color, w) => { c.strokeStyle = color; c.lineWidth = w; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) c.lineTo(p[0], p[1]); c.stroke(); };
    const armPts = P.arms.map(([a, b]) => { const e = end(sh[0], sh[1], a, A1); return [sh, e, end(e[0], e[1], b, A2)]; });

    // pierna y brazo de atrás (más oscuros)
    line([[0, 0], ...legPts[1]], shade(o.skin, -0.25), lw);
    line(armPts[1], shade(o.skin, -0.25), lw * 0.9);
    // torso (remera) y short
    line([[0, 0], sh], o.color, lw * 2.1);
    c.fillStyle = '#2a2140';
    c.beginPath(); c.arc(0, 0, lw * 1.05, 0, Math.PI * 2); c.fill();
    // pierna de adelante
    line([[0, 0], ...legPts[0]], o.skin, lw);
    // cabeza
    const hr = s * 0.11;
    c.fillStyle = o.skin;
    c.beginPath(); c.arc(head[0], head[1], hr, 0, Math.PI * 2); c.fill();
    c.fillStyle = o.hair;
    c.beginPath(); c.arc(head[0] - hr * 0.15, head[1] - hr * 0.15, hr * 0.95, Math.PI * 0.95, Math.PI * 2.05); c.fill();
    c.fillStyle = '#1a1020';
    c.beginPath(); c.arc(head[0] + hr * 0.5, head[1] - hr * 0.05, Math.max(0.8, hr * 0.13), 0, Math.PI * 2); c.fill();
    // brazo de adelante
    line(armPts[0], o.skin, lw * 0.9);
    c.restore();

    // estrellitas de mareo
    if (o.type === 'down' || o.type === 'out') {
      const hx = x + s * 0.8, hy = groundY - s * 0.2;
      for (let i = 0; i < 3; i++) {
        const a = o.time * 4 + i * 2.1;
        star(c, hx + Math.cos(a) * s * 0.2, hy - s * 0.12 + Math.sin(a) * s * 0.06, Math.max(2, s * 0.06), '#ffd34d');
      }
    }
  }

  function star(c, x, y, r, color) {
    c.fillStyle = color;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.closePath(); c.fill();
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.round(Math.max(0, Math.min(255, v + v * k)));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function ellipsize(c, text, max) {
    if (c.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && c.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = util.rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* ---------- Juego ---------- */
  const TPL = `
  <div class="race">
    <div class="race-board">
      <canvas></canvas>
      <div class="race-msg" hidden></div>
    </div>
    <div class="game-ui">
      <button class="btn-main" type="button"></button>
      <p class="hint"></p>
    </div>
  </div>`;

  const REVEAL_TPL = `
    <div class="reveal-rays"></div>
    <div class="reveal-stage">
      <div class="reveal-card">
        <div class="kicker">🏅 Ganó la carrera y presenta la próxima weekly</div>
        <div class="winner"></div>
        <div class="reveal-actions">
          <button class="btn btn-ghost" type="button" data-act="again">🏁 Otra carrera</button>
          <button class="btn btn-primary" type="button" data-act="done">¡Listo!</button>
        </div>
        <button class="undo" type="button" data-act="undo">No está hoy · deshacer</button>
      </div>
    </div>`;

  class Carrera {
    constructor(root) {
      root.innerHTML = TPL;
      const q = s => root.querySelector(s);
      this.el = { board: q('.race-board'), canvas: q('canvas'), msg: q('.race-msg'), main: q('.btn-main'), hint: q('.hint') };
      this.ctx = this.el.canvas.getContext('2d');

      this.reveal = document.createElement('div');
      this.reveal.className = 'reveal';
      this.reveal.setAttribute('aria-hidden', 'true');
      this.reveal.innerHTML = REVEAL_TPL;
      document.body.appendChild(this.reveal);

      this.state = 'ready';
      this.lanes = [];          // [{id, name, color, skin, hair}]
      this.scripts = null;
      this.t = 0; this.time = 0; this.cd = 0;
      this.winner = null; this.winnerCrossed = false;
      this.lastSeg = []; this.timers = [];
      this.crowd = [];

      this.setupLanes();
      this.resize();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.el.board);
      this.unsub = Store.subscribe(() => { if (this.state === 'ready') this.syncLanes(); this.updateUI(); });
      this.bind();
      this.updateUI();

      this.last = performance.now();
      const loop = t => { this.frame(t); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      this.ro.disconnect();
      this.unsub();
      this.timers.forEach(clearTimeout);
      document.removeEventListener('keydown', this.onKey);
      this.reveal.remove();
    }
    later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }

    /* ---------- Andariveles ---------- */
    runnerFor(p) {
      const h = hash(p.id + p.name);
      return { id: p.id, name: p.name, color: p.color, skin: SKINS[h % SKINS.length], hair: HAIRS[(h >>> 8) % HAIRS.length] };
    }
    setupLanes() {
      this.lanes = shuffle(Store.pool().map(p => this.runnerFor(p)));
      this.scripts = null;
    }
    syncLanes() {
      const pool = Store.pool(), ids = new Set(pool.map(p => p.id));
      const lanes = this.lanes.filter(l => ids.has(l.id));
      for (const p of pool) if (!lanes.some(l => l.id === p.id)) lanes.splice(util.rand(lanes.length + 1), 0, this.runnerFor(p));
      this.lanes = lanes.map(l => this.runnerFor(Store.get(l.id)));
    }

    /* ---------- Eventos ---------- */
    bind() {
      const { main, board, msg } = this.el;
      main.addEventListener('click', () => this.start());
      board.addEventListener('click', e => { if (!e.target.closest('.race-msg')) this.start(); });
      msg.addEventListener('click', e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'reset') { Store.resetRound(); util.toast('¡Nueva ronda! Todos vuelven a la pista'); }
        if (b.dataset.act === 'panel') dispatchEvent(new CustomEvent('selector:open-panel'));
      });
      this.reveal.addEventListener('click', e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'undo') { Store.undoLast(); util.toast('Listo, no cuenta. ¡Probá de nuevo!'); this.closeReveal(); }
        else this.closeReveal(b.dataset.act === 'again');
      });
      this.onKey = e => {
        if (e.repeat || e.target.closest('input, textarea, select, [contenteditable]')) return;
        if (this.reveal.classList.contains('show')) { if (e.key === 'Escape') this.closeReveal(); return; }
        if ((e.code === 'Space' || e.key === 'Enter') && e.target === document.body) { e.preventDefault(); this.start(); }
      };
      document.addEventListener('keydown', this.onKey);
    }

    /* ---------- Flujo ---------- */
    start() {
      if (this.state !== 'ready' || !this.lanes.length) return;
      const idx = util.rand(this.lanes.length);
      this.winner = this.lanes[idx];
      this.scripts = makeRace(this.lanes.length, idx);
      this.lastSeg = this.lanes.map(() => -1);
      this.t = 0; this.cd = 0; this.winnerCrossed = false;
      this.state = 'countdown';
      this.beeps = 0;
      this.updateUI();
    }

    onWinnerCross() {
      this.winnerCrossed = true;
      Sound.cheer(2.4, 0.16);
      const r = this.el.canvas.getBoundingClientRect();
      Confetti.burst(r.left + this.finishX, r.top + this.trackTop, { count: 90, power: 9, angle: Math.PI / 2, spread: 2.4, colors: [this.winner.color, '#fff', '#ffd34d'] });
      this.later(() => { this.state = 'finished'; this.updateUI(); }, 10);
      this.later(() => this.showReveal(), 1700);
    }

    showReveal() {
      this.state = 'reveal';
      this.updateUI();
      const r = this.reveal, color = this.winner.color;
      r.style.setProperty('--c', color);
      r.querySelector('.winner').textContent = this.winner.name;
      r.classList.add('show', 'opened');
      r.setAttribute('aria-hidden', 'false');
      Store.recordWin(this.winner.id, 'Carrera');
      Sound.pop(); Sound.fanfare();
      const cols = [color, '#ffffff', '#ffc23d', '#ff4d8d', '#22c3ee', '#10d9a0'];
      Confetti.burst(innerWidth / 2, innerHeight * 0.42, { count: 220, colors: cols, power: 16 });
      this.later(() => Confetti.rain({ colors: cols }), 300);
      this.later(() => r.querySelector('[data-act="done"]').focus({ preventScroll: true }), 600);
    }

    closeReveal(again = false) {
      const r = this.reveal;
      r.classList.remove('show', 'opened');
      r.setAttribute('aria-hidden', 'true');
      this.winner = null;
      this.state = 'ready';
      this.setupLanes();
      this.updateUI();
      if (again) this.later(() => this.start(), 450);
    }

    updateUI() {
      const { main, hint, msg } = this.el;
      const pool = Store.pool();
      if (this.state === 'ready' && !pool.length) {
        const anyActive = Store.state.people.some(p => p.active);
        const html = anyActive
          ? '<div>🎉 ¡Ya pasaron todos!</div><button class="pill-btn" type="button" data-act="reset">↺ Empezar nueva ronda</button>'
          : '<div>No hay nadie en la pista</div><button class="pill-btn" type="button" data-act="panel">＋ Agregar nombres</button>';
        if (msg.innerHTML !== html) msg.innerHTML = html;
        msg.hidden = false;
        main.textContent = anyActive ? '🎉  Ronda completa' : 'Sin participantes';
        main.disabled = true;
        hint.textContent = anyActive ? 'Empezá una nueva ronda para volver a sortear' : 'Cargá nombres en el panel de participantes';
        return;
      }
      msg.hidden = true;
      const cfg = {
        ready: ['🏁  ¡Largar la carrera!', `${pool.length} corredores en la pista · ¡cuidado con las vallas!`],
        countdown: ['En sus marcas…', 'Listos…'],
        racing: ['¡Corriendo!', '¿Quién llega primero?'],
        finished: ['¡Llegó!', ''],
        reveal: ['¡Llegó!', ''],
      }[this.state];
      main.textContent = cfg[0];
      main.disabled = this.state !== 'ready';
      hint.textContent = cfg[1];
      this.el.board.classList.toggle('can-start', this.state === 'ready');
    }

    /* ---------- Medidas ---------- */
    resize() {
      const rect = this.el.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.el.canvas.width = Math.round(rect.width * this.dpr);
      this.el.canvas.height = Math.round(rect.height * this.dpr);
      this.W = rect.width; this.H = rect.height;
      this.standsH = Math.max(40, Math.min(110, this.H * 0.16));
      this.trackTop = this.standsH + 8;
      this.trackBot = this.H - 14;
      this.labelW = Math.max(78, Math.min(150, this.W * 0.16));
      this.startX = this.labelW + 22;
      this.finishX = this.W - 70;
      // tribuna
      this.crowd = [];
      const rows = 4, rh = (this.standsH - 18) / rows;
      for (let r = 0; r < rows; r++) {
        for (let x = 8 + (r % 2) * 7; x < this.W - 4; x += 14) {
          this.crowd.push({ x: x + Math.random() * 4, y: 14 + r * rh + rh * 0.6, c: util.rand(9), s: SKINS[util.rand(SKINS.length)], ph: Math.random() * 6.28 });
        }
      }
      this.draw();
    }
    xFor(d) { return this.startX + (d / META) * (this.finishX - this.startX); }

    /* ---------- Bucle ---------- */
    frame(t) {
      const dt = Math.max(0, Math.min(0.05, (t - this.last) / 1000));
      this.last = t; this.time += dt;

      if (this.state === 'countdown') {
        this.cd += dt;
        const n = Math.floor(this.cd / 0.8);
        if (n >= this.beeps && this.beeps < 3) { this.beeps++; Sound.tone(660, 0.18, { type: 'square', vol: 0.06 }); }
        if (this.cd >= COUNTDOWN) { this.state = 'racing'; this.t = 0; Sound.bang(); Sound.cheer(9, 0.06); this.updateUI(); }
      } else if (this.state === 'racing' || this.state === 'finished' || this.state === 'reveal') {
        if (this.state !== 'reveal') this.cd += dt;
        this.t += dt;
        this.raceSounds();
        const wi = this.lanes.indexOf(this.winner);
        if (this.state === 'racing' && !this.winnerCrossed && wi >= 0 && this.t >= this.scripts[wi].finish) this.onWinnerCross();
      }
      this.draw();
    }

    raceSounds() {
      this.scripts.forEach((s, i) => {
        const { seg, i: si } = segAt(s, this.t);
        if (si === this.lastSeg[i]) return;
        this.lastSeg[i] = si;
        if (seg.type === 'fall') { Sound.clack(0.8); this.later(() => Sound.thud(), 250); }
        else if (seg.type === 'stumble') Sound.clack(0.6);
        else if (seg.type === 'jump') Sound.tone(520 + i * 7, 0.06, { type: 'triangle', vol: 0.025, slide: 780 });
      });
    }

    /* ---------- Dibujo ---------- */
    draw() {
      if (!this.W) return;
      const c = this.ctx, W = this.W, H = this.H;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const n = Math.max(1, this.lanes.length);
      const laneH = (this.trackBot - this.trackTop) / n;
      const excited = this.state === 'racing' || this.state === 'finished' ? 1 : 0.15;

      // tribuna
      const sg = c.createLinearGradient(0, 0, 0, this.standsH);
      sg.addColorStop(0, '#2a1650'); sg.addColorStop(1, '#3a1d63');
      c.fillStyle = sg; c.fillRect(0, 0, W, this.standsH);
      const shirts = ['#ff4d8d', '#ffb020', '#3d8bff', '#8b5cf6', '#10d9a0', '#ff6b35', '#22c3ee', '#f472b6', '#ffffff'];
      for (const p of this.crowd) {
        const b = Math.sin(this.time * 11 + p.ph) * 2.2 * excited;
        c.fillStyle = shirts[p.c];
        c.beginPath(); c.arc(p.x, p.y + 6 - b, 5.5, Math.PI, 0); c.fill();
        c.fillStyle = p.s;
        c.beginPath(); c.arc(p.x, p.y - b, 3.6, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = '#1b0e38'; c.fillRect(0, this.standsH - 6, W, 6);
      // pasto
      c.fillStyle = '#2f9a57'; c.fillRect(0, this.standsH, W, 8);
      c.fillStyle = '#2f9a57'; c.fillRect(0, this.trackBot, W, H - this.trackBot);

      // pista
      const tg = c.createLinearGradient(0, this.trackTop, 0, this.trackBot);
      tg.addColorStop(0, '#c4553a'); tg.addColorStop(1, '#a84430');
      c.fillStyle = tg; c.fillRect(0, this.trackTop, W, this.trackBot - this.trackTop);

      // andariveles
      for (let i = 0; i < n; i++) {
        const y0 = this.trackTop + i * laneH;
        const lane = this.lanes[i];
        if (lane) { c.fillStyle = hexA(lane.color, 0.1); c.fillRect(this.startX, y0, this.finishX - this.startX, laneH); }
        c.fillStyle = 'rgba(255,255,255,.55)';
        c.fillRect(0, y0, W, 1.5);
      }
      c.fillRect(0, this.trackBot - 1.5, W, 1.5);

      // zona de nombres
      c.fillStyle = 'rgba(20,8,40,.55)';
      c.fillRect(0, this.trackTop, this.labelW, this.trackBot - this.trackTop);
      // largada
      c.fillStyle = 'rgba(255,255,255,.9)';
      c.fillRect(this.startX - 2, this.trackTop, 3, this.trackBot - this.trackTop);
      // meta a cuadros
      const sq = Math.max(4, Math.min(7, laneH / 3));
      for (let y = this.trackTop, r = 0; y < this.trackBot; y += sq, r++) {
        for (let k = 0; k < 2; k++) {
          c.fillStyle = (r + k) % 2 ? '#111' : '#fff';
          c.fillRect(this.finishX + k * sq - sq, y, sq, Math.min(sq, this.trackBot - y));
        }
      }
      // cartel de META
      c.font = `700 ${Math.max(11, Math.min(16, this.standsH * 0.2))}px Fredoka, Nunito, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const bw = 58, bh = Math.max(18, this.standsH * 0.26);
      c.fillStyle = '#ffd34d';
      c.beginPath(); c.roundRect ? c.roundRect(this.finishX - bw / 2, this.standsH - bh - 4, bw, bh, 6) : c.rect(this.finishX - bw / 2, this.standsH - bh - 4, bw, bh); c.fill();
      c.fillStyle = '#3b0820'; c.fillText('META', this.finishX, this.standsH - bh / 2 - 4);

      if (!this.lanes.length) return;
      const s = Math.min(64, laneH * 0.8);
      const t = this.state === 'ready' || this.state === 'countdown' ? 0 : this.t;

      // ranking de llegada
      let ranks = new Map();
      if (this.scripts) {
        this.scripts.map((sc, i) => [sc.finish, i]).filter(([f]) => f <= t).sort((a, b) => a[0] - b[0]).forEach(([, i], k) => ranks.set(i, k + 1));
      }

      for (let i = 0; i < this.lanes.length; i++) {
        const lane = this.lanes[i], y0 = this.trackTop + i * laneH, ground = y0 + laneH * 0.86;
        const sc = this.scripts && this.scripts[i];

        // vallas
        for (let k = 0; k < VALLAS.length; k++) {
          const knock = sc && sc.knocks.find(q => q.k === k);
          const kp = knock ? Math.max(0, Math.min(1, (t - knock.t) / 0.25)) : 0;
          this.drawHurdle(c, this.xFor(VALLAS[k]), ground, s, kp);
        }

        // nombre
        const fs = Math.max(10, Math.min(16, laneH * 0.42));
        c.font = `800 ${fs}px Nunito, sans-serif`;
        c.textAlign = 'left'; c.textBaseline = 'middle';
        const rank = ranks.get(i), outNow = sc && sc.out && segAt(sc, t).seg.type === 'out';
        const prefix = rank ? (rank === 1 ? '🥇 ' : `${rank}° `) : outNow ? '✖ ' : '';
        c.fillStyle = lane.color;
        c.beginPath(); c.arc(10, y0 + laneH / 2, Math.max(3, fs * 0.3), 0, Math.PI * 2); c.fill();
        c.fillStyle = outNow ? 'rgba(255,255,255,.45)' : '#fff';
        c.fillText(ellipsize(c, prefix + lane.name, this.labelW - 24), 20, y0 + laneH / 2 + 1);

        // corredor
        let type = 'ready', d = 0, tilt = 0, lift = 0, phase = 0, alpha = 1;
        if (sc && t > 0) {
          const { seg, p } = segAt(sc, t);
          type = seg.type;
          d = seg.x0 + (seg.x1 - seg.x0) * p;
          phase = d * 0.0785 + i;
          if (type === 'jump') lift = Math.sin(Math.PI * p) * s * 0.42;
          if (type === 'stumble') { tilt = Math.sin(p * Math.PI * 3) * 0.25; type = 'run'; }
          if (type === 'fall') tilt = Math.min(1, p * 1.15) * Math.PI / 2;
          if (type === 'down' || type === 'out') tilt = Math.PI / 2;
          if (type === 'getup') tilt = (1 - p) * Math.PI / 2;
          if (type === 'out') alpha = 0.7;
          if (type === 'celebrate') lift = Math.abs(Math.sin(this.time * 8)) * s * 0.12;
        }
        drawRunner(c, this.xFor(d), ground, s, { type, phase, tilt, lift, alpha, time: this.time, color: lane.color, skin: lane.skin, hair: lane.hair });
      }

      // cuenta regresiva
      if (this.state === 'countdown' || (this.state === 'racing' && this.t < 0.6)) {
        const k = this.state === 'countdown' ? Math.floor(this.cd / 0.8) : 3;
        const txt = ['3', '2', '1', '¡YA!'][Math.min(3, k)];
        const local = this.state === 'countdown' ? (this.cd % 0.8) / 0.8 : this.t / 0.6;
        const sz = Math.min(W, H) * 0.22 * (1.25 - 0.35 * Math.min(1, local * 2));
        c.save();
        c.globalAlpha = 1 - Math.max(0, local - 0.6) / 0.4;
        c.font = `700 ${sz}px Fredoka, Nunito, sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = sz * 0.08; c.strokeStyle = 'rgba(30,8,50,.8)';
        c.strokeText(txt, W / 2, (this.trackTop + this.trackBot) / 2);
        c.fillStyle = k >= 3 ? '#ffd34d' : '#fff';
        c.fillText(txt, W / 2, (this.trackTop + this.trackBot) / 2);
        c.restore();
      }
    }

    drawHurdle(c, x, ground, s, knocked) {
      const h = s * 0.4, w = Math.max(3, s * 0.08);
      c.save();
      c.translate(x, ground);
      if (knocked) c.rotate(knocked * 1.35);
      c.strokeStyle = '#e9e4f5'; c.lineWidth = Math.max(1.2, s * 0.035); c.lineCap = 'round';
      c.beginPath(); c.moveTo(-w * 0.4, 0); c.lineTo(-w * 0.4, -h); c.moveTo(w * 0.4, 0); c.lineTo(w * 0.4, -h); c.stroke();
      // barra a rayas
      const bh = Math.max(3, s * 0.09);
      c.fillStyle = '#ffffff'; c.fillRect(-w, -h - bh / 2, w * 2, bh);
      c.fillStyle = '#ff3d5f'; c.fillRect(-w * 0.33, -h - bh / 2, w * 0.66, bh);
      c.restore();
    }
  }

  let inst = null;
  Games.register({
    id: 'carrera',
    title: 'Carrera',
    icon: '<span class="tab-emoji" aria-hidden="true">🏃</span>',
    mount(el) { inst = new Carrera(el); },
    unmount() { if (inst) inst.destroy(); inst = null; },
  });

  window.Selector.raceSim = { makeScript, makeRace };
})();

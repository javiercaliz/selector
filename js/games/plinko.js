/* Minijuego: Plinko.
   Una bola cae rebotando entre clavos hasta un casillero con el nombre de alguien.
   Justicia: el ganador se sortea ANTES de soltar la bola (azar criptográfico, uniforme).
   Después se buscan, con la misma física, las condiciones iniciales (posición, velocidad,
   rebotes) que llevan la bola a ese casillero, y se reproduce esa caída exacta. */
(() => {
  'use strict';
  const { Store, Sound, Confetti, Games, util } = window.Selector;

  /* ---------- Tablero en unidades lógicas (independiente del tamaño de pantalla) ---------- */
  const W = 600, H = 800;
  const WALL = 6, DROP_Y = 58, PEG_TOP = 128, ROW_H = 38, ROWS = 12, PEG_R = 5, PEG_GAP = 48;
  const DIV_TOP = 612, FLOOR = 786, DIV_HALF = 2;
  const G = 1500, DT = 1 / 120, BOUNCE = 0.5, MAX_V = 900;
  const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1567.98, 1760, 2093];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** PRNG determinístico (misma semilla → mismos rebotes). */
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildLayout(n) {
    const rows = [];
    let idx = 0;
    for (let i = 0; i < ROWS; i++) {
      const y = PEG_TOP + i * ROW_H, row = [];
      for (let x = 24 + (i % 2 ? PEG_GAP / 2 : 0); x <= W - 24; x += PEG_GAP) row.push({ x, y, i: idx++ });
      rows.push(row);
    }
    const slotW = (W - WALL * 2) / Math.max(1, n);
    const divs = [];
    for (let i = 1; i < n; i++) divs.push(WALL + i * slotW);
    const r = clamp(Math.min(12, (slotW - DIV_HALF * 2) / 2 - 1.2), 4, 12);
    return { n, rows, pegs: rows.flat(), slotW, divs, r };
  }

  /** Simula una caída completa. Pura y determinística. */
  function simulate(L, x0, vx0, seed, record, steerX = 0, steerK = 0) {
    const rng = mulberry32(seed);
    const r = L.r;
    let x = x0, y = DROP_Y, vx = vx0, vy = 0, still = 0, s = 0;
    const path = record ? [] : null, hits = record ? [] : null;

    for (; s < 2400; s++) {
      vy += G * DT;
      if (steerK && y > PEG_TOP - 20 && y < DIV_TOP) vx += Math.sign(steerX - x) * steerK * DT;
      const sp = Math.hypot(vx, vy);
      if (sp > MAX_V) { vx *= MAX_V / sp; vy *= MAX_V / sp; }
      x += vx * DT; y += vy * DT;

      // clavos (solo las filas cercanas)
      const rf = (y - PEG_TOP) / ROW_H;
      const r0 = Math.max(0, Math.floor(rf) - 1), r1 = Math.min(ROWS - 1, Math.ceil(rf) + 1);
      const md = r + PEG_R;
      for (let ri = r0; ri <= r1; ri++) {
        for (const p of L.rows[ri]) {
          const dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
          if (d2 >= md * md) continue;
          const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d;
          x = p.x + nx * md; y = p.y + ny * md;
          const vn = vx * nx + vy * ny;
          if (vn < 0) {
            vx -= (1 + BOUNCE) * vn * nx; vy -= (1 + BOUNCE) * vn * ny;
            vx += (rng() - 0.5) * 70;
            if (record && -vn > 50) hits.push([s, p.i, -vn]);
          }
        }
      }

      // separadores de casilleros (segmentos verticales con punta redonda)
      if (y + r > DIV_TOP && L.divs.length) {
        const k = Math.round((x - WALL) / L.slotW);
        for (let j = k - 2; j <= k; j++) {
          const dxw = L.divs[j]; if (dxw === undefined) continue;
          const py = clamp(y, DIV_TOP, FLOOR);
          const dx = x - dxw, dy = y - py, mdd = r + DIV_HALF, d2 = dx * dx + dy * dy;
          if (d2 >= mdd * mdd) continue;
          const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d;
          x = dxw + nx * mdd; y = py + ny * mdd;
          const vn = vx * nx + vy * ny;
          if (vn < 0) {
            vx -= (1 + BOUNCE) * vn * nx; vy -= (1 + BOUNCE) * vn * ny;
            vx += (rng() - 0.5) * 30;
            if (record && -vn > 60) hits.push([s, -1, -vn]);
          }
        }
      }

      // paredes y piso
      if (x < WALL + r) { x = WALL + r; if (vx < 0) vx = -vx * BOUNCE; }
      if (x > W - WALL - r) { x = W - WALL - r; if (vx > 0) vx = -vx * BOUNCE; }
      let onFloor = false;
      if (y > FLOOR - r) {
        y = FLOOR - r;
        if (vy > 0) { if (record && vy > 120) hits.push([s, -2, vy]); vy = -vy * 0.35; }
        vx *= 0.96; onFloor = true;
      }
      if (record) path.push(x, y);

      const speed = Math.abs(vx) + Math.abs(vy);
      still = speed < 25 ? still + 1 : 0;
      if (still > 45 && y < DIV_TOP) { vx += (x < W / 2 ? 1 : -1) * 140; vy -= 80; still = 0; } // destrabar
      if (onFloor && speed < 30 && s > 10) break;
    }
    const slot = clamp(Math.floor((x - WALL) / L.slotW), 0, L.n - 1);
    return { slot, path, hits, steps: s };
  }

  /** Busca una caída natural que termine en `target`, saliendo cerca de donde apuntó el jugador. */
  function findRun(L, aimX, target) {
    const tx = WALL + (target + 0.5) * L.slotW;
    const lo = WALL + L.r + 1, hi = W - WALL - L.r - 1;
    for (const k of [0, 0, 0, 0, 30, 60, 90, 130, 180, 250, 350, 500]) {
      for (let a = 0; a < 150; a++) {
        const x0 = clamp(aimX + (Math.random() - 0.5) * 14, lo, hi);
        const vx0 = (Math.random() - 0.5) * 80;
        const seed = (Math.random() * 2147483647) | 0;
        if (simulate(L, x0, vx0, seed, false, tx, k).slot === target) {
          return simulate(L, x0, vx0, seed, true, tx, k);
        }
      }
    }
    return simulate(L, clamp(aimX, lo, hi), 0, 1, true, tx, 900);
  }

  /* ---------- Juego ---------- */
  const TPL = `
  <div class="plinko">
    <div class="pk-board" title="Mové el mouse para apuntar · clic para soltar">
      <canvas></canvas>
      <div class="pk-msg" hidden></div>
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
        <div class="kicker">🎤 Presenta la próxima weekly</div>
        <div class="winner"></div>
        <div class="reveal-actions">
          <button class="btn btn-ghost" type="button" data-act="again">🟡 Otra bola</button>
          <button class="btn btn-primary" type="button" data-act="done">¡Listo!</button>
        </div>
        <button class="undo" type="button" data-act="undo">No está hoy · deshacer</button>
      </div>
    </div>`;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = util.rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  class Plinko {
    constructor(root) {
      root.innerHTML = TPL;
      const q = s => root.querySelector(s);
      this.el = { board: q('.pk-board'), canvas: q('canvas'), msg: q('.pk-msg'), main: q('.btn-main'), hint: q('.hint') };
      this.ctx = this.el.canvas.getContext('2d');
      this.cache = document.createElement('canvas');

      this.reveal = document.createElement('div');
      this.reveal.className = 'reveal';
      this.reveal.setAttribute('aria-hidden', 'true');
      this.reveal.innerHTML = REVEAL_TPL;
      document.body.appendChild(this.reveal);

      this.state = 'aim';
      this.order = [];       // ids de personas, en el orden de los casilleros
      this.people = new Map();
      this.L = null;
      this.aimX = W / 2; this.manualUntil = 0; this.time = 0;
      this.run = null; this.play = 0; this.hitIdx = 0;
      this.glow = new Map(); this.trail = [];
      this.winner = null; this.winSlot = -1;
      this.timers = []; this.lastNote = 0;

      this.shuffleSlots();
      this.resize();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.el.board);
      this.unsub = Store.subscribe(() => { if (this.state === 'aim') this.syncSlots(); this.updateUI(); });
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

    /* ---------- Casilleros ---------- */
    shuffleSlots() {
      this.order = shuffle(Store.pool().map(p => p.id));
      this.relayout();
    }
    syncSlots() {
      const ids = new Set(Store.pool().map(p => p.id));
      const order = this.order.filter(id => ids.has(id));
      for (const id of ids) if (!order.includes(id)) order.splice(util.rand(order.length + 1), 0, id);
      const changed = order.length !== this.order.length || order.some((id, i) => id !== this.order[i]);
      this.order = order;
      if (changed) this.relayout(); else this.refreshPeople();
    }
    refreshPeople() {
      this.people = new Map(Store.state.people.map(p => [p.id, p]));
      this.renderStatic();
    }
    relayout() {
      this.L = buildLayout(this.order.length);
      this.refreshPeople();
    }

    /* ---------- Eventos ---------- */
    bind() {
      const { board, main, msg } = this.el;
      main.addEventListener('click', () => this.drop());
      board.addEventListener('pointermove', e => {
        if (this.state !== 'aim') return;
        this.aimX = this.toLogical(e).x;
        this.manualUntil = performance.now() + 2500;
      });
      board.addEventListener('click', e => {
        if (e.target.closest('.pk-msg')) return;
        if (this.state === 'aim') { this.aimX = this.toLogical(e).x; this.drop(); }
      });
      msg.addEventListener('click', e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'reset') { Store.resetRound(); util.toast('¡Nueva ronda! Todos vuelven al tablero'); }
        if (b.dataset.act === 'panel') dispatchEvent(new CustomEvent('selector:open-panel'));
      });
      this.reveal.addEventListener('click', e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'undo') { Store.undoLast(); util.toast('Listo, no cuenta. ¡Probá de nuevo!'); this.closeReveal(); }
        else this.closeReveal(b.dataset.act === 'again');
      });
      this.onKey = e => {
        if (e.repeat && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (e.target.closest('input, textarea, select, [contenteditable]')) return;
        const revealOpen = this.reveal.classList.contains('show');
        if (revealOpen) { if (e.key === 'Escape') this.closeReveal(); return; }
        if (this.state === 'aim' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          this.aimX = clamp(this.aimX + (e.key === 'ArrowLeft' ? -18 : 18), 20, W - 20);
          this.manualUntil = performance.now() + 2500;
        }
        if ((e.code === 'Space' || e.key === 'Enter') && e.target === document.body) { e.preventDefault(); this.drop(); }
      };
      document.addEventListener('keydown', this.onKey);
    }

    toLogical(e) {
      const r = this.el.canvas.getBoundingClientRect();
      return { x: clamp((e.clientX - r.left) / r.width * W, 20, W - 20), y: (e.clientY - r.top) / r.height * H };
    }

    /* ---------- Flujo ---------- */
    drop() {
      if (this.state !== 'aim' || !this.order.length) return;
      const pool = Store.pool().filter(p => this.order.includes(p.id));
      if (!pool.length) return;
      this.winner = pool[util.rand(pool.length)];
      const target = this.order.indexOf(this.winner.id);
      this.run = findRun(this.L, this.aimX, target);
      if (this.run.slot !== target) this.winner = this.people.get(this.order[this.run.slot]); // salvaguarda
      this.winSlot = this.run.slot;
      this.play = 0; this.hitIdx = 0; this.trail = [];
      this.state = 'falling';
      Sound.tone(880, 0.12, { type: 'triangle', vol: 0.12, slide: 440 });
      this.updateUI();
    }

    land() {
      this.state = 'landed';
      this.updateUI();
      Sound.thud();
      this.later(() => this.showReveal(), 1000);
    }

    showReveal() {
      this.state = 'reveal';
      this.updateUI();
      const r = this.reveal, color = this.winner.color;
      r.style.setProperty('--c', color);
      r.querySelector('.winner').textContent = this.winner.name;
      r.classList.add('show', 'opened');
      r.setAttribute('aria-hidden', 'false');
      Store.recordWin(this.winner.id, 'Plinko');
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
      this.winner = null; this.winSlot = -1; this.run = null; this.trail = [];
      this.state = 'aim';
      this.shuffleSlots();
      this.updateUI();
      if (again) this.later(() => this.drop(), 450);
    }

    updateUI() {
      const { main, hint, msg } = this.el;
      const pool = Store.pool();
      const empty = this.state === 'aim' && !pool.length;
      if (empty) {
        const anyActive = Store.state.people.some(p => p.active);
        const html = anyActive
          ? '<div>🎉 ¡Ya pasaron todos!</div><button class="pill-btn" type="button" data-act="reset">↺ Empezar nueva ronda</button>'
          : '<div>No hay nadie en el tablero</div><button class="pill-btn" type="button" data-act="panel">＋ Agregar nombres</button>';
        if (msg.innerHTML !== html) msg.innerHTML = html;
        msg.hidden = false;
        main.textContent = anyActive ? '🎉  Ronda completa' : 'Sin participantes';
        main.disabled = true;
        hint.textContent = anyActive ? 'Empezá una nueva ronda para volver a sortear' : 'Cargá nombres en el panel de participantes';
        return;
      }
      msg.hidden = true;
      const cfg = {
        aim: ['🟡  Soltar la bola', 'Apuntá con el mouse (o ← →) y soltá · clic en el tablero también sirve'],
        falling: ['¡Rebotando!', '¿Dónde va a caer…?'],
        landed: ['¡Cayó!', ''],
        reveal: ['¡Cayó!', ''],
      }[this.state];
      main.textContent = cfg[0];
      main.disabled = this.state !== 'aim';
      hint.textContent = cfg[1];
      this.el.board.classList.toggle('aiming', this.state === 'aim');
    }

    /* ---------- Render ---------- */
    resize() {
      const rect = this.el.board.getBoundingClientRect();
      if (!rect.width) return;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.k = rect.width / W;
      const pw = Math.round(rect.width * this.dpr), ph = Math.round(rect.height * this.dpr);
      this.el.canvas.width = pw; this.el.canvas.height = ph;
      this.cache.width = pw; this.cache.height = ph;
      this.renderStatic();
      this.draw();
    }

    renderStatic() {
      if (!this.k || !this.L) return;
      const c = this.cache.getContext('2d'), L = this.L;
      c.setTransform(this.k * this.dpr, 0, 0, this.k * this.dpr, 0, 0);
      c.clearRect(0, 0, W, H);

      const bg = c.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#24124f'); bg.addColorStop(0.55, '#170b38'); bg.addColorStop(1, '#0d0624');
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      const glow = c.createRadialGradient(W / 2, H * 0.42, 20, W / 2, H * 0.42, W * 0.7);
      glow.addColorStop(0, 'rgba(139,92,246,.22)'); glow.addColorStop(1, 'rgba(139,92,246,0)');
      c.fillStyle = glow; c.fillRect(0, 0, W, H);

      // riel del dispensador
      c.fillStyle = 'rgba(255,255,255,.08)';
      c.fillRect(WALL + 10, 33, W - WALL * 2 - 20, 4);

      // casilleros
      for (let i = 0; i < L.n; i++) {
        const p = this.people.get(this.order[i]);
        const color = p ? p.color : '#888';
        const x0 = WALL + i * L.slotW;
        const g = c.createLinearGradient(0, DIV_TOP, 0, FLOOR);
        g.addColorStop(0, hexA(color, 0));
        g.addColorStop(1, hexA(color, 0.42));
        c.fillStyle = g;
        c.fillRect(x0, DIV_TOP - 10, L.slotW, FLOOR - DIV_TOP + 10);
        c.fillStyle = color;
        c.fillRect(x0 + 2, FLOOR - 4, L.slotW - 4, 4);
        if (p) this.drawLabel(c, p.name, x0, L.slotW);
      }
      // piso
      c.fillStyle = 'rgba(255,255,255,.18)';
      c.fillRect(WALL, FLOOR, W - WALL * 2, H - FLOOR);
      // separadores
      for (const x of L.divs) {
        const g = c.createLinearGradient(x - DIV_HALF, 0, x + DIV_HALF, 0);
        g.addColorStop(0, '#8d86ad'); g.addColorStop(0.5, '#f4f2ff'); g.addColorStop(1, '#7a7399');
        c.fillStyle = g;
        roundRect(c, x - DIV_HALF, DIV_TOP - DIV_HALF, DIV_HALF * 2, FLOOR - DIV_TOP + DIV_HALF, DIV_HALF);
        c.fill();
      }
      // clavos
      for (const p of L.pegs) {
        c.beginPath(); c.arc(p.x, p.y + 1.5, PEG_R, 0, Math.PI * 2);
        c.fillStyle = 'rgba(0,0,0,.35)'; c.fill();
        const g = c.createRadialGradient(p.x - 1.6, p.y - 1.6, 0.5, p.x, p.y, PEG_R);
        g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#a9a2cc');
        c.beginPath(); c.arc(p.x, p.y, PEG_R, 0, Math.PI * 2);
        c.fillStyle = g; c.fill();
      }
      // paredes
      c.fillStyle = 'rgba(255,255,255,.1)';
      c.fillRect(0, 0, WALL, H); c.fillRect(W - WALL, 0, WALL, H);
    }

    drawLabel(c, name, x0, sw) {
      c.save();
      c.fillStyle = '#fff';
      c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 6;
      c.textBaseline = 'middle';
      const cx = x0 + sw / 2;
      if (sw >= 84) {
        let fs = Math.min(20, sw * 0.24);
        c.font = `700 ${fs}px Fredoka, Nunito, sans-serif`;
        c.textAlign = 'center';
        c.fillText(ellipsize(c, name, sw - 12), cx, FLOOR - 30);
      } else {
        const fs = clamp(sw * 0.5, 9, 19);
        c.font = `700 ${fs}px Fredoka, Nunito, sans-serif`;
        c.translate(cx, FLOOR - 14);
        c.rotate(-Math.PI / 2);
        c.textAlign = 'left';
        c.fillText(ellipsize(c, name, FLOOR - DIV_TOP - 30), 0, 1);
      }
      c.restore();
    }

    frame(t) {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t; this.time += dt;
      if (!this.k || !this.L) return;

      if (this.state === 'aim' && t > this.manualUntil) {
        const target = W / 2 + Math.sin(this.time * 1.1) * (W / 2 - 70);
        this.aimX += (target - this.aimX) * Math.min(1, dt * 3);
      }

      if (this.state === 'falling' && this.run) {
        const total = this.run.path.length / 2;
        this.play = Math.min(total - 1, this.play + dt / DT);
        const step = Math.floor(this.play);
        const hits = this.run.hits;
        while (this.hitIdx < hits.length && hits[this.hitIdx][0] <= step) {
          const [, peg, v] = hits[this.hitIdx++];
          if (peg >= 0) {
            this.glow.set(peg, 1);
            if (t - this.lastNote > 35) {
              this.lastNote = t;
              const p = this.L.pegs[peg];
              const note = NOTES[clamp(Math.floor(p.x / W * NOTES.length), 0, NOTES.length - 1)];
              Sound.tone(note, 0.18, { type: 'triangle', vol: clamp(v / 2500, 0.03, 0.14) });
            }
          } else if (t - this.lastNote > 50) {
            this.lastNote = t;
            Sound.clack(clamp(v / 600, 0.2, 0.8));
          }
        }
        const [bx, by] = this.ballAt(this.play);
        this.trail.push(bx, by);
        if (this.trail.length > 28) this.trail.splice(0, 2);
        if (this.play >= total - 1) this.land();
      } else if (this.trail.length) {
        this.trail.splice(0, 2);
      }
      for (const [k, v] of this.glow) { const nv = v - dt * 1.6; if (nv <= 0) this.glow.delete(k); else this.glow.set(k, nv); }

      this.draw();
    }

    ballAt(f) {
      const p = this.run.path, i = Math.floor(f), a = f - i, j = Math.min(p.length / 2 - 1, i + 1);
      return [p[i * 2] + (p[j * 2] - p[i * 2]) * a, p[i * 2 + 1] + (p[j * 2 + 1] - p[i * 2 + 1]) * a];
    }

    draw() {
      if (!this.k || !this.L) return;
      const c = this.ctx, L = this.L;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.el.canvas.width, this.el.canvas.height);
      c.drawImage(this.cache, 0, 0);
      c.setTransform(this.k * this.dpr, 0, 0, this.k * this.dpr, 0, 0);

      // luces de marquesina
      const nb = 22, fast = this.state === 'falling' ? 9 : 2.5;
      for (let i = 0; i < nb; i++) {
        const x = 18 + i * (W - 36) / (nb - 1);
        const on = (Math.floor(this.time * fast) + i) % 3 === 0;
        c.beginPath(); c.arc(x, 14, 3.4, 0, Math.PI * 2);
        c.fillStyle = on ? '#ffd34d' : 'rgba(255,211,77,.22)';
        c.shadowColor = '#ffc23d'; c.shadowBlur = on ? 10 : 0;
        c.fill();
      }
      c.shadowBlur = 0;

      // clavos encendidos
      for (const [i, v] of this.glow) {
        const p = L.pegs[i];
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, 18);
        g.addColorStop(0, `rgba(255,220,120,${0.85 * v})`);
        g.addColorStop(1, 'rgba(255,200,80,0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(p.x, p.y, 18, 0, Math.PI * 2); c.fill();
        c.fillStyle = `rgba(255,250,220,${v})`;
        c.beginPath(); c.arc(p.x, p.y, PEG_R, 0, Math.PI * 2); c.fill();
      }

      // casillero ganador
      if ((this.state === 'landed' || this.state === 'reveal') && this.winSlot >= 0) {
        const p = this.people.get(this.order[this.winSlot]);
        const x0 = WALL + this.winSlot * L.slotW, pulse = 0.55 + 0.45 * Math.sin(this.time * 10);
        c.save();
        c.shadowColor = p ? p.color : '#fff'; c.shadowBlur = 30;
        c.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * pulse})`; c.lineWidth = 3;
        roundRect(c, x0 + 2, DIV_TOP - 6, L.slotW - 4, FLOOR - DIV_TOP + 4, 8); c.stroke();
        c.fillStyle = hexA(p ? p.color : '#ffffff', 0.25 * pulse);
        c.fill();
        c.restore();
      }

      // estela
      const tr = this.trail;
      for (let i = 0; i < tr.length; i += 2) {
        const a = (i / tr.length);
        c.beginPath(); c.arc(tr[i], tr[i + 1], L.r * (0.35 + 0.6 * a), 0, Math.PI * 2);
        c.fillStyle = `rgba(255,211,77,${0.35 * a})`; c.fill();
      }

      // dispensador + bola
      const dx = this.state === 'aim' ? this.aimX : (this.run ? this.run.path[0] : this.aimX);
      c.fillStyle = '#e8264f';
      roundRect(c, dx - 20, 26, 40, 18, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.3)';
      roundRect(c, dx - 16, 28, 32, 4, 2); c.fill();
      c.beginPath(); c.moveTo(dx - 9, 44); c.lineTo(dx + 9, 44); c.lineTo(dx + 5, 50); c.lineTo(dx - 5, 50); c.closePath();
      c.fillStyle = '#a30f35'; c.fill();

      if (this.state === 'aim') {
        c.setLineDash([4, 8]);
        c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(dx, DROP_Y + L.r + 4); c.lineTo(dx, PEG_TOP - 16); c.stroke();
        c.setLineDash([]);
        this.drawBall(c, dx, DROP_Y + Math.sin(this.time * 5) * 1.5, L.r);
      } else if (this.run) {
        const [bx, by] = this.ballAt(this.play);
        this.drawBall(c, bx, by, L.r);
      }
    }

    drawBall(c, x, y, r) {
      c.save();
      c.shadowColor = 'rgba(255,200,60,.8)'; c.shadowBlur = 14;
      const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, '#fffbe6'); g.addColorStop(0.35, '#ffd34d'); g.addColorStop(1, '#d98a00');
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
      c.fillStyle = g; c.fill();
      c.restore();
    }
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function ellipsize(c, text, max) {
    if (c.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && c.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }

  let inst = null;
  Games.register({
    id: 'plinko',
    title: 'Plinko',
    icon: '<span class="ico-plinko" aria-hidden="true"></span>',
    mount(el) { inst = new Plinko(el); },
    unmount() { if (inst) inst.destroy(); inst = null; },
  });

  // expuesto para pruebas desde la consola
  window.Selector.plinkoSim = { buildLayout, simulate, findRun };
})();

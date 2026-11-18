/* Minijuego: máquina de Gachapón.
   Flujo: insertar moneda → girar la manija → sale una cápsula → abrirla y ver el nombre. */
(() => {
  'use strict';
  const { Store, Sound, Confetti, Games, util, COLORS } = window.Selector;
  // Las cápsulas NO llevan el color ni las iniciales de la persona: así no se adivina quién sale.
  const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

  const TPL = `
  <div class="gacha">
    <div class="machine" data-state="idle">
      <div class="m-knob"></div>
      <div class="m-cap"></div>
      <div class="m-dome" title="Tocá para revolver">
        <canvas></canvas>
        <div class="m-dome-shine"></div>
        <div class="m-dome-msg" hidden></div>
      </div>
      <div class="m-collar"></div>
      <div class="m-body">
        <div class="m-plate">GACHA · WEEKLY</div>
        <button class="m-coinbox" type="button" aria-label="Insertar moneda">
          <span class="m-slot"></span>
          <span class="m-coinlabel">1 <i class="mini-coin"></i></span>
        </button>
        <button class="m-crank" type="button" aria-label="Girar la manija">
          <svg class="m-crank-hint" viewBox="-8 -8 116 116" aria-hidden="true">
            <path d="M50 4 A46 46 0 1 1 4 50" />
            <path d="M-3 60 L4 48 L13 59" />
          </svg>
          <span class="m-crank-rot"><span class="m-handle"></span><span class="m-hub"></span></span>
        </button>
        <div class="m-door"><span class="m-flap"></span></div>
      </div>
      <div class="m-base"></div>
      <div class="m-coin"></div>
      <div class="m-tray"></div>
    </div>
    <div class="gacha-ui">
      <button class="btn-main" type="button"></button>
      <div class="steps" aria-hidden="true"><span></span><span></span><span></span></div>
      <p class="hint"></p>
    </div>
  </div>`;

  const REVEAL_TPL = `
    <div class="reveal-rays"></div>
    <div class="reveal-stage">
      <button class="big-cap" type="button" aria-label="Abrir la cápsula"><span class="half top"></span><span class="half bot"></span></button>
      <div class="reveal-card">
        <div class="kicker">🎤 Presenta la próxima weekly</div>
        <div class="winner"></div>
        <div class="reveal-actions">
          <button class="btn btn-ghost" type="button" data-act="again">🪙 Otra moneda</button>
          <button class="btn btn-primary" type="button" data-act="done">¡Listo!</button>
        </div>
        <button class="undo" type="button" data-act="undo">No está hoy · deshacer</button>
      </div>
    </div>
    <p class="tap-hint">Tocá la cápsula para abrirla ✨</p>`;

  const easeInOut = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

  class Gacha {
    constructor(root) {
      root.innerHTML = TPL;
      const q = s => root.querySelector(s);
      this.el = {
        machine: q('.machine'), dome: q('.m-dome'), canvas: q('canvas'), msg: q('.m-dome-msg'),
        coinbox: q('.m-coinbox'), crank: q('.m-crank'), crankRot: q('.m-crank-rot'),
        coin: q('.m-coin'), tray: q('.m-tray'), door: q('.m-door'),
        main: q('.btn-main'), hint: q('.hint'), steps: [...root.querySelectorAll('.steps span')],
      };
      // El overlay va en <body> para cubrir toda la pantalla.
      this.reveal = document.createElement('div');
      this.reveal.className = 'reveal';
      this.reveal.setAttribute('aria-hidden', 'true');
      this.reveal.innerHTML = REVEAL_TPL;
      document.body.appendChild(this.reveal);

      this.ctx = this.el.canvas.getContext('2d');
      this.balls = [];
      this.state = 'idle';
      this.shake = 0; this.shakeDecay = false;
      this.crankDeg = 0;
      this.timers = [];
      this.acc = 0; this.impact = 0; this.lastSfx = 0;
      this.winner = null; this.removedId = null; this.ext = null; this.opened = false;
      this.R = 0; this.W = 0; this.cx = 0; this.cy = 0; this.dpr = 1;

      this.resize();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.el.dome);
      this.sync(true);
      this.unsub = Store.subscribe(() => { this.sync(false); this.updateUI(); });
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
      clearInterval(this.tickInt);
      document.removeEventListener('keydown', this.onKey);
      this.reveal.remove();
    }

    later(fn, ms) { const id = setTimeout(fn, ms); this.timers.push(id); return id; }

    /* ---------------- Eventos ---------------- */
    bind() {
      const { main, coinbox, crank, tray, dome, msg } = this.el;
      main.addEventListener('click', () => this.primary());
      coinbox.addEventListener('click', () => {
        if (this.state === 'idle') this.insertCoin();
        else if (this.state === 'ready') this.nudgeHint();
      });
      crank.addEventListener('click', () => {
        if (this.state === 'ready') this.turn();
        else if (this.state === 'idle') this.nudgeHint();
      });
      tray.addEventListener('click', e => { if (e.target.closest('.out-cap')) this.openReveal(); });
      dome.addEventListener('pointerdown', e => { if (!e.target.closest('.m-dome-msg')) this.poke(e); });
      msg.addEventListener('click', e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'reset') { Store.resetRound(); util.toast('¡Nueva ronda! Todos vuelven a la máquina'); }
        if (b.dataset.act === 'panel') dispatchEvent(new CustomEvent('selector:open-panel'));
      });

      this.reveal.querySelector('.big-cap').addEventListener('click', () => this.openCapsule());
      this.reveal.addEventListener('click', e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act;
        if (act === 'undo') { Store.undoLast(); util.toast('Listo, no cuenta. ¡Probá de nuevo!'); this.closeReveal(); }
        else this.closeReveal(act === 'again');
      });

      this.onKey = e => {
        if (e.repeat || e.target.closest('input, textarea, select, [contenteditable]')) return;
        const revealOpen = this.reveal.classList.contains('show');
        if (e.key === 'Escape' && revealOpen && this.opened) { this.closeReveal(); return; }
        if ((e.code === 'Space' || e.key === 'Enter') && (e.target === document.body || revealOpen)) {
          if (revealOpen && e.target.closest('button')) return; // el botón ya maneja la tecla
          e.preventDefault();
          if (revealOpen) { if (!this.opened) this.openCapsule(); }
          else this.primary();
        }
      };
      document.addEventListener('keydown', this.onKey);
    }

    primary() {
      if (this.state === 'idle') this.insertCoin();
      else if (this.state === 'ready') this.turn();
      else if (this.state === 'out') this.openReveal();
    }

    nudgeHint() {
      const h = this.el.hint;
      h.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
        { duration: 300 });
    }

    /* ---------------- Flujo del juego ---------------- */
    insertCoin() {
      if (this.state !== 'idle' || !Store.pool().length) return;
      this.state = 'coin';
      this.updateUI();
      Sound.coin();
      const c = this.el.coin;
      c.classList.remove('insert'); void c.offsetWidth; c.classList.add('insert');
      this.later(() => { Sound.clink(); this.el.coinbox.classList.add('lit'); }, 620);
      this.later(() => { c.classList.remove('insert'); this.state = 'ready'; this.updateUI(); }, 820);
    }

    turn() {
      if (this.state !== 'ready') return;
      const pool = Store.pool().filter(p => this.balls.some(b => b.id === p.id));
      if (!pool.length) { this.state = 'idle'; this.updateUI(); return; }
      this.winner = pool[util.rand(pool.length)];
      this.state = 'spinning';
      this.updateUI();
      this.el.coinbox.classList.remove('lit');

      this.crankDeg += 360;
      this.el.crankRot.style.transform = `rotate(${this.crankDeg}deg)`;
      this.shake = 1; this.shakeDecay = false;
      let n = 0;
      clearInterval(this.tickInt);
      this.tickInt = setInterval(() => { Sound.tick(); if (++n >= 14) clearInterval(this.tickInt); }, 110);
      this.later(() => { this.shakeDecay = true; }, 1600);
      this.later(() => this.extract(), 2300);
    }

    extract() {
      this.state = 'dispensing';
      this.updateUI();
      const b = this.balls.find(x => x.id === this.winner.id);
      this.capColor = b ? b.color : randomColor();
      if (!b) { this.removedId = this.winner.id; this.onExtracted(); return; }
      b.kin = true;
      this.ext = { ball: b, phase: 1, t: 0, sx: b.x, sy: b.y, vy: 0 };
      Sound.whoosh();
    }

    onExtracted() {
      const { door, tray } = this.el;
      door.classList.remove('swing'); void door.offsetWidth; door.classList.add('swing');
      tray.innerHTML = `<button class="out-cap" type="button" style="--c:${this.capColor}" aria-label="Abrir la cápsula"><span class="oc-top"></span><span class="oc-bot"></span></button>`;
      this.later(() => Sound.thud(), 330);
      this.later(() => { this.state = 'out'; this.updateUI(); }, 780);
    }

    openReveal() {
      if (this.state !== 'out') return;
      this.state = 'reveal';
      this.updateUI();
      const r = this.reveal;
      r.style.setProperty('--c', this.capColor);
      r.querySelector('.winner').textContent = this.winner.name;
      r.querySelector('.big-cap').classList.remove('shaking');
      r.classList.remove('opened');
      r.classList.add('show');
      r.setAttribute('aria-hidden', 'false');
      this.el.tray.innerHTML = '';
      this.opened = false;
      Sound.whoosh();
      this.later(() => r.querySelector('.big-cap').focus({ preventScroll: true }), 50);
    }

    openCapsule() {
      if (this.opened || !this.winner) return;
      this.opened = true;
      const r = this.reveal, cap = r.querySelector('.big-cap');
      cap.classList.add('shaking');
      for (let i = 0; i < 6; i++) this.later(() => Sound.rattle(1), i * 95);
      this.later(() => {
        cap.classList.remove('shaking');
        r.classList.add('opened');
        Sound.pop(); Sound.fanfare();
        Store.recordWin(this.winner.id, 'Gachapón');
        const rect = cap.getBoundingClientRect();
        const cols = [this.capColor, '#ffffff', '#ffc23d', '#ff4d8d', '#22c3ee', '#10d9a0'];
        Confetti.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, { count: 220, colors: cols, power: 16 });
        this.later(() => Confetti.rain({ colors: cols }), 300);
        this.later(() => r.querySelector('[data-act="done"]').focus({ preventScroll: true }), 700);
      }, 650);
    }

    closeReveal(again = false) {
      const r = this.reveal;
      r.classList.remove('show');
      r.setAttribute('aria-hidden', 'true');
      this.later(() => r.classList.remove('opened'), 350);
      this.winner = null; this.removedId = null; this.opened = false;
      this.state = 'idle';
      this.sync(false);
      this.updateUI();
      if (again) this.later(() => this.insertCoin(), 400);
    }

    /* ---------------- UI ---------------- */
    updateUI() {
      const s = this.state, pool = Store.pool();
      const { machine, main, hint, steps, msg } = this.el;
      const empty = !pool.length && (s === 'idle' || s === 'coin' || s === 'ready');
      if (empty && s !== 'idle') this.state = 'idle';
      machine.dataset.state = this.state;
      if (empty) {
        const anyActive = Store.state.people.some(p => p.active);
        const html = anyActive
          ? '<div>🎉 ¡Ya pasaron todos!</div><button class="pill-btn" type="button" data-act="reset">↺ Empezar nueva ronda</button>'
          : '<div>La máquina está vacía</div><button class="pill-btn" type="button" data-act="panel">＋ Agregar nombres</button>';
        if (msg.innerHTML !== html) msg.innerHTML = html;
        msg.hidden = false;
      } else {
        msg.hidden = true;
      }

      const cfg = {
        idle:       ['🪙  Insertar moneda', `${pool.length} cápsulas adentro · tocá la cúpula para revolver`, 1, false],
        coin:       ['🪙  …', 'Clink!', 1, true],
        ready:      ['🔄  Girar la manija', '¡Ahora girá la manija!', 2, false],
        spinning:   ['Mezclando…', 'Las cápsulas se están mezclando…', 2, true],
        dispensing: ['¡Ahí viene!', '¡Algo está saliendo!', 3, true],
        out:        ['✨  Abrir la cápsula', '¿De quién será? Abrí la cápsula', 3, false],
        reveal:     ['✨  Abrir la cápsula', '', 3, true],
      }[this.state];
      let [label, h, step, disabled] = cfg;
      if (empty) {
        const anyActive = Store.state.people.some(p => p.active);
        label = anyActive ? '🎉  Ronda completa' : 'Sin participantes';
        h = anyActive ? 'Empezá una nueva ronda para volver a sortear' : 'Cargá nombres en el panel de participantes';
        disabled = true;
      }
      main.textContent = label;
      main.disabled = disabled;
      hint.textContent = h;
      steps.forEach((el, i) => el.classList.toggle('on', i < step && !empty));
    }

    /* ---------------- Cápsulas (física) ---------------- */
    radiusFor(n) {
      if (n <= 0) return this.R * 0.15;
      return this.R * Math.min(0.2, Math.max(0.07, Math.sqrt(0.4 / n)));
    }

    makeBall(p, initial, r) {
      const { cx, cy, R } = this;
      let x, y;
      if (initial) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R * 0.7;
        x = cx + Math.cos(a) * d; y = cy + Math.abs(Math.sin(a)) * d * 0.9;
      } else {
        x = cx + (Math.random() - 0.5) * R * 0.5; y = cy - R * 0.72;
      }
      return {
        id: p.id, x, y, vx: (Math.random() - 0.5) * R * 0.5, vy: 0,
        r: initial ? r : r * 0.3, tr: r,
        angle: Math.random() * Math.PI * 2, av: 0,
        color: randomColor(), kin: false,
      };
    }

    /** Sincroniza las cápsulas de la cúpula con la lista de participantes. */
    sync(initial) {
      if (!this.R) return;
      const pool = Store.pool();
      const ids = new Set(pool.filter(p => p.id !== this.removedId).map(p => p.id));
      const extBall = this.ext && this.ext.ball;
      this.balls = this.balls.filter(b => ids.has(b.id) || b === extBall);
      const have = new Set(this.balls.map(b => b.id));
      const r = this.radiusFor(ids.size);
      let k = 0;
      for (const p of pool) {
        if (!ids.has(p.id) || have.has(p.id)) continue;
        const b = this.makeBall(p, initial, r);
        if (!initial) { b.y -= (k++) * r * 0.6; Sound.clack(0.4); }
        this.balls.push(b);
      }
      for (const b of this.balls) if (b !== extBall) b.tr = r;
    }

    resize() {
      const w = this.el.dome.getBoundingClientRect().width;
      if (!w) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.dpr = dpr;
      this.el.canvas.width = Math.round(w * dpr);
      this.el.canvas.height = Math.round(w * dpr);
      const oldR = this.R, ocx = this.cx, ocy = this.cy;
      this.W = w; this.cx = w / 2; this.cy = w / 2;
      this.R = w / 2 - w * 0.012;
      if (oldR) {
        const k = this.R / oldR;
        for (const b of this.balls) {
          b.x = this.cx + (b.x - ocx) * k; b.y = this.cy + (b.y - ocy) * k;
          b.vx *= k; b.vy *= k; b.r *= k; b.tr *= k;
        }
        if (this.ext) { this.ext.sx = this.cx + (this.ext.sx - ocx) * k; this.ext.sy = this.cy + (this.ext.sy - ocy) * k; }
      } else {
        this.sync(true);
      }
      this.draw(); // cambiar el tamaño del canvas lo borra
    }

    poke(e) {
      if (!['idle', 'ready', 'out', 'coin'].includes(this.state)) return;
      const rect = this.el.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      let hit = false;
      for (const b of this.balls) {
        if (b.kin) continue;
        const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy) || 1, reach = Math.max(b.r * 3, this.R * 0.35);
        if (d < reach) {
          const k = 1 - d / reach;
          b.vx += (dx / d) * this.R * 3 * k + (Math.random() - 0.5) * this.R * 0.6;
          b.vy -= this.R * (2.5 + Math.random() * 2) * k;
          b.av += (Math.random() - 0.5) * 24;
          hit = true;
        }
      }
      if (hit) Sound.clack(0.8);
    }

    stepExt(h) {
      const e = this.ext, b = e.ball;
      const px = b.x, py = b.y;
      e.t += h;
      if (e.phase === 1) {
        const k = Math.min(1, e.t / 0.85), s = easeInOut(k);
        const ty = this.cy + this.R - b.r - 1;
        b.x = e.sx + (this.cx - e.sx) * s;
        b.y = e.sy + (ty - e.sy) * s;
        b.angle += 5 * h;
        if (k >= 1) { e.phase = 2; e.vy = this.R * 0.6; }
      } else {
        e.vy += this.R * 9 * h;
        b.y += e.vy * h;
        if (b.y - b.r > this.cy + this.R + 2) {
          this.balls = this.balls.filter(x => x !== b);
          this.ext = null;
          this.removedId = b.id;
          this.onExtracted();
          return;
        }
      }
      b.vx = (b.x - px) / h; b.vy = (b.y - py) / h;
    }

    step(h) {
      const { cx, cy, R } = this;
      const G = R * 5, sh = this.shake;
      if (this.ext) this.stepExt(h);
      const balls = this.balls;
      const drag = Math.pow(0.6, h), spinDrag = Math.pow(0.5, h);

      for (const b of balls) {
        b.r += (b.tr - b.r) * Math.min(1, h * 8);
        if (b.kin) continue;
        b.vy += G * h;
        if (sh > 0) {
          const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy) || 1;
          const sw = R * 10 * sh;
          b.vx += (-dy / d) * sw * h; b.vy += (dx / d) * sw * h;
          if (dy > 0 && Math.random() < 0.06 * sh) {
            b.vy -= R * (3 + Math.random() * 3) * sh;
            b.vx += (Math.random() - 0.5) * R * 3 * sh;
          }
        }
        b.vx *= drag; b.vy *= drag;
        b.x += b.vx * h; b.y += b.vy * h;
        b.angle += b.av * h; b.av *= spinDrag;
      }

      const e = 0.35;
      for (let it = 0; it < 3; it++) {
        for (let i = 0; i < balls.length; i++) {
          const a = balls[i];
          for (let j = i + 1; j < balls.length; j++) {
            const b = balls[j];
            const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            const d = Math.sqrt(d2);
            const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
            const ia = a.kin ? 0 : 1, ib = b.kin ? 0 : 1, sum = ia + ib;
            if (!sum) continue;
            const ov = (min - d) / sum;
            a.x -= nx * ov * ia; a.y -= ny * ov * ia;
            b.x += nx * ov * ib; b.y += ny * ov * ib;
            if (it === 0) {
              const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
              if (vn < 0) {
                const jj = -(1 + e) * vn / sum;
                a.vx -= jj * nx * ia; a.vy -= jj * ny * ia;
                b.vx += jj * nx * ib; b.vy += jj * ny * ib;
                if (-vn > R * 1.5) this.impact = Math.max(this.impact, -vn / (R * 5));
                const vt = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
                if (ia) a.av -= vt / a.r * 0.3;
                if (ib) b.av += vt / b.r * 0.3;
              }
            }
          }
        }
        for (const b of balls) {
          if (b.kin) continue;
          const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy), lim = R - b.r;
          if (d > lim && d > 0) {
            const nx = dx / d, ny = dy / d;
            b.x = cx + nx * lim; b.y = cy + ny * lim;
            const vn = b.vx * nx + b.vy * ny;
            if (vn > 0) {
              b.vx -= 1.4 * vn * nx; b.vy -= 1.4 * vn * ny;
              if (vn > R * 1.5) this.impact = Math.max(this.impact, vn / (R * 5));
            }
            const tx = -ny, ty = nx, vt = b.vx * tx + b.vy * ty;
            b.vx -= tx * vt * 0.01; b.vy -= ty * vt * 0.01;
            b.av = b.av * 0.8 + (-vt / b.r) * 0.2; // rueda contra el vidrio
          }
        }
      }
    }

    frame(t) {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      if (!this.R) return;
      if (this.shakeDecay) {
        this.shake = Math.max(0, this.shake - dt * 1.4);
        if (!this.shake) this.shakeDecay = false;
      }
      const h = 1 / 120;
      this.acc += dt;
      let n = 0;
      while (this.acc >= h && n < 8) { this.step(h); this.acc -= h; n++; }
      if (n >= 8) this.acc = 0;

      if (this.shake > 0.15 && t - this.lastSfx > 40) { this.lastSfx = t; Sound.rattle(this.shake); }
      else if (this.impact > 0 && t - this.lastSfx > 70) { this.lastSfx = t; Sound.clack(Math.min(1, this.impact)); }
      this.impact = 0;

      this.draw();
    }

    /* ---------------- Dibujo ---------------- */
    draw() {
      const c = this.ctx;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.W, this.W);
      const ext = this.ext && this.ext.ball;
      for (const b of this.balls) if (b !== ext) this.drawBall(c, b);
      if (ext) this.drawBall(c, ext);
    }

    drawBall(c, b) {
      const { x, y, r } = b;
      if (r < 1) return;
      c.save();
      c.translate(x, y);
      c.rotate(b.angle);
      c.beginPath(); c.arc(0, 0, r, 0, Math.PI); c.closePath();
      c.fillStyle = '#f3f5ff'; c.fill();
      c.beginPath(); c.arc(0, 0, r, Math.PI, Math.PI * 2); c.closePath();
      c.fillStyle = b.color; c.fill();
      c.fillStyle = 'rgba(0,0,0,.16)';
      c.fillRect(-r * 0.98, -r * 0.05, r * 1.96, r * 0.1);
      c.restore();

      const g = c.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r * 1.02);
      g.addColorStop(0, 'rgba(255,255,255,.75)');
      g.addColorStop(0.25, 'rgba(255,255,255,.12)');
      g.addColorStop(0.6, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(20,0,40,.32)');
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
      c.fillStyle = g; c.fill();
      c.lineWidth = 1; c.strokeStyle = 'rgba(40,10,60,.25)'; c.stroke();
    }
  }

  let inst = null;
  Games.register({
    id: 'gachapon',
    title: 'Gachapón',
    icon: '<span class="ico-capsule" aria-hidden="true"></span>',
    mount(el) { inst = new Gacha(el); },
    unmount() { if (inst) inst.destroy(); inst = null; },
  });
})();

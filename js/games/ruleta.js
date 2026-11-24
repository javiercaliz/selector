/* Minijuego: Ruleta con sorpresa.
   La ruleta gira y frena en una porción con un nombre… pero esa porción es una puertita:
   se abre ahí mismo, en la rueda, y detrás aparece el nombre de quien presenta de verdad,
   que puede o no coincidir con el de adelante.
   Justicia: el ganador se sortea primero (azar criptográfico, uniforme). La porción donde
   frena la ruleta es solo teatro: 1 de cada 3 veces es la del ganador, si no, otra al azar. */
(() => {
  'use strict';
  const { Store, Sound, Confetti, Games, util } = window.Selector;

  const S = 600, C = S / 2, R = 262;          // canvas lógico, centro y radio de la rueda
  const POINTER = -Math.PI / 2;               // la flecha está arriba
  const TAU = Math.PI * 2;
  const MATCH_ODDS = 3;                       // 1 en 3: la porción coincide con el ganador
  const OPEN_DUR = 0.9;                       // segundos que tardan en abrirse las puertitas
  const OPEN_MAX = 1.38;                      // ángulo final de cada hoja (rad, "hacia la pantalla")

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mod = (a, n) => ((a % n) + n) % n;
  const easeOut = t => 1 - Math.pow(1 - t, 4);
  const easeBack = t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

  const TPL = `
  <div class="ruleta">
    <div class="rl-wheel" title="Clic para girar">
      <canvas></canvas>
      <div class="rl-msg" hidden></div>
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
        <div class="rl-note"></div>
        <div class="winner"></div>
        <div class="reveal-actions">
          <button class="btn btn-ghost" type="button" data-act="again">🎡 Girar otra vez</button>
          <button class="btn btn-primary" type="button" data-act="done">¡Listo!</button>
        </div>
        <button class="undo" type="button" data-act="undo">No está hoy · deshacer</button>
      </div>
    </div>`;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = util.rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  class Ruleta {
    constructor(root) {
      root.innerHTML = TPL;
      const q = s => root.querySelector(s);
      this.el = { wheel: q('.rl-wheel'), canvas: q('canvas'), msg: q('.rl-msg'), main: q('.btn-main'), hint: q('.hint') };
      this.ctx = this.el.canvas.getContext('2d');

      this.reveal = document.createElement('div');
      this.reveal.className = 'reveal';
      this.reveal.setAttribute('aria-hidden', 'true');
      this.reveal.innerHTML = REVEAL_TPL;
      document.body.appendChild(this.reveal);

      this.state = 'idle';
      this.order = []; this.people = new Map();
      this.rot = Math.random() * TAU; this.time = 0;
      this.spin = null; this.flap = 0; this.flapV = 0;
      this.landed = -1; this.winner = null; this.cover = null;
      this.doorU = 0; this.doorWob = 0; this.openStart = null; this.glowU = 0;
      this.timers = [];

      this.shuffleSlices();
      this.resize();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.el.wheel);
      this.unsub = Store.subscribe(() => { if (this.state === 'idle') this.syncSlices(); this.updateUI(); });
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

    /* ---------- Porciones ---------- */
    shuffleSlices() {
      this.order = shuffle(Store.pool().map(p => p.id));
      this.refreshPeople();
    }
    syncSlices() {
      const ids = new Set(Store.pool().map(p => p.id));
      const order = this.order.filter(id => ids.has(id));
      for (const id of ids) if (!order.includes(id)) order.splice(util.rand(order.length + 1), 0, id);
      this.order = order;
      this.refreshPeople();
    }
    refreshPeople() { this.people = new Map(Store.state.people.map(p => [p.id, p])); }
    get seg() { return TAU / Math.max(1, this.order.length); }
    sliceAt(rot) { return Math.floor(mod(POINTER - rot, TAU) / this.seg) % this.order.length; }

    /* ---------- Eventos ---------- */
    bind() {
      const { wheel, main, msg } = this.el;
      main.addEventListener('click', () => this.go());
      wheel.addEventListener('click', e => {
        if (e.target.closest('.rl-msg')) return;
        if (this.state === 'door') this.openDoor(); else this.go();
      });
      msg.addEventListener('click', e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'reset') { Store.resetRound(); util.toast('¡Nueva ronda! Todos vuelven a la ruleta'); }
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
        if ((e.code === 'Space' || e.key === 'Enter') && e.target === document.body) {
          e.preventDefault();
          if (this.state === 'door') this.openDoor(); else this.go();
        }
      };
      document.addEventListener('keydown', this.onKey);
    }

    /* ---------- Flujo ---------- */
    go() {
      if (this.state !== 'idle' || !this.order.length) return;
      const pool = Store.pool().filter(p => this.order.includes(p.id));
      if (!pool.length) return;
      const n = this.order.length;

      // 1) quién presenta de verdad (uniforme)
      this.winner = pool[util.rand(pool.length)];
      const own = this.order.indexOf(this.winner.id);
      // 2) en qué porción frena la ruleta (pura escenografía)
      let slice = own;
      if (n > 1 && util.rand(MATCH_ODDS) !== 0) {
        slice = util.rand(n - 1);
        if (slice >= own) slice++;
      }
      this.landed = slice;
      this.cover = this.people.get(this.order[slice]);

      // ángulo final: la flecha cae dentro de la porción, lejos de los bordes
      const f = 0.2 + Math.random() * 0.6;
      const want = POINTER - (slice + f) * this.seg;
      const turns = 5 + util.rand(3);
      const end = this.rot + turns * TAU + mod(want - this.rot, TAU);
      this.spin = { from: this.rot, to: end, t: 0, dur: 5.2 + Math.random() * 1.3, lastSlice: this.sliceAt(this.rot) };
      this.state = 'spinning';
      Sound.whoosh();
      this.updateUI();
    }

    stop() {
      this.state = 'stopped';
      this.updateUI();
      Sound.thud();
      this.later(() => this.startDoor(), 1000);
    }

    /** La porción empieza a temblar: algo hay detrás. */
    startDoor() {
      this.state = 'door';
      this.updateUI();
      let k = 0;
      const roll = () => {
        if (this.state !== 'door') return;
        Sound.rattle(0.4 + k / 22);
        if (++k < 24) this.later(roll, Math.max(26, 110 - k * 4));
      };
      roll();
      this.later(() => this.openDoor(), 1900);
    }

    /** Se abren las dos hojas de la porción y aparece el nombre de atrás. */
    openDoor() {
      if (this.state !== 'door') return;
      this.state = 'opening';
      this.openStart = null;
      this.updateUI();
      Sound.pop();
      this.later(() => this.opened(), OPEN_DUR * 1000);
    }

    opened() {
      this.state = 'opened';
      this.updateUI();
      const match = this.winner.id === this.cover.id;
      Sound.bang();
      if (match) Sound.coin(); else Sound.tone(220, 0.5, { type: 'triangle', vol: 0.12, slide: 660 });
      const p = this.slicePoint(0.6);
      Confetti.burst(p.x, p.y, { count: 90, colors: [this.winner.color, '#ffffff', '#ffc23d'], power: 10 });
      this.later(() => this.showReveal(), 2200);
    }

    /** Punto en pantalla en el medio de la porción ganadora, a fracción `fr` del radio. */
    slicePoint(fr) {
      const box = this.el.wheel.getBoundingClientRect(), k = box.width / S;
      const a = this.rot + (this.landed + 0.5) * this.seg;
      return { x: box.left + (C + Math.cos(a) * R * fr) * k, y: box.top + (C + Math.sin(a) * R * fr) * k };
    }

    showReveal() {
      this.state = 'reveal';
      this.updateUI();
      const r = this.reveal, w = this.winner, match = w.id === this.cover.id;
      r.style.setProperty('--c', w.color);
      r.querySelector('.winner').textContent = w.name;
      r.querySelector('.rl-note').textContent = match
        ? `🎯 ¡Coincidió! Detrás de ${this.cover.name} estaba ${w.name}`
        : `🙃 La ruleta dijo ${this.cover.name}… pero detrás estaba`;
      r.classList.toggle('rl-twist', !match);
      r.classList.add('show', 'opened');
      r.setAttribute('aria-hidden', 'false');
      Store.recordWin(w.id, 'Ruleta');
      Sound.fanfare();
      const cols = [w.color, '#ffffff', '#ffc23d', '#ff4d8d', '#22c3ee', '#10d9a0'];
      Confetti.burst(innerWidth / 2, innerHeight * 0.42, { count: 220, colors: cols, power: 16 });
      this.later(() => Confetti.rain({ colors: cols }), 300);
      this.later(() => r.querySelector('[data-act="done"]').focus({ preventScroll: true }), 600);
    }

    closeReveal(again = false) {
      const r = this.reveal;
      r.classList.remove('show', 'opened');
      r.setAttribute('aria-hidden', 'true');
      this.winner = null; this.cover = null; this.landed = -1; this.spin = null;
      this.doorU = 0; this.doorWob = 0; this.glowU = 0;
      this.state = 'idle';
      this.shuffleSlices();
      this.updateUI();
      if (again) this.later(() => this.go(), 450);
    }

    updateUI() {
      const { main, hint, msg, wheel } = this.el;
      const pool = Store.pool();
      if (this.state === 'idle' && !pool.length) {
        const anyActive = Store.state.people.some(p => p.active);
        const html = anyActive
          ? '<div>🎉 ¡Ya pasaron todos!</div><button class="pill-btn" type="button" data-act="reset">↺ Empezar nueva ronda</button>'
          : '<div>No hay nadie en la ruleta</div><button class="pill-btn" type="button" data-act="panel">＋ Agregar nombres</button>';
        if (msg.innerHTML !== html) msg.innerHTML = html;
        msg.hidden = false;
        main.textContent = anyActive ? '🎉  Ronda completa' : 'Sin participantes';
        main.disabled = true;
        hint.textContent = anyActive ? 'Empezá una nueva ronda para volver a girar' : 'Cargá nombres en el panel de participantes';
        return;
      }
      msg.hidden = true;
      const cn = this.cover ? this.cover.name : '';
      const wn = this.winner ? this.winner.name : '';
      const match = this.cover && this.winner && this.cover.id === this.winner.id;
      const cfg = {
        idle: ['🎡  Girar la ruleta', 'Ojo: cada porción esconde un nombre detrás… ¿coincidirá?'],
        spinning: ['¡Girando!', '¿Dónde va a frenar…?'],
        stopped: [`¡${cn}!`, '¿Seguro…?'],
        door: [`¿Será ${cn}?`, 'Algo se mueve detrás de la porción…'],
        opening: [`¿Será ${cn}?`, '¡Se abre!'],
        opened: [match ? '🎯 ¡Coincidió!' : '🙃 ¡Sorpresa!', match ? `Detrás de ${cn} estaba… ¡${wn}!` : `Detrás de ${cn} estaba ${wn}`],
        reveal: [match ? '🎯 ¡Coincidió!' : '🙃 ¡Sorpresa!', ''],
      }[this.state];
      main.textContent = cfg[0];
      main.disabled = this.state !== 'idle';
      hint.textContent = cfg[1];
      hint.classList.toggle('rl-hint-twist', this.state === 'opened' && !match);
      hint.classList.toggle('rl-hint-match', this.state === 'opened' && !!match);
      wheel.classList.toggle('can-spin', this.state === 'idle' || this.state === 'door');
    }

    /* ---------- Render ---------- */
    resize() {
      const rect = this.el.wheel.getBoundingClientRect();
      if (!rect.width) return;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.k = rect.width / S;
      this.el.canvas.width = Math.round(rect.width * this.dpr);
      this.el.canvas.height = Math.round(rect.height * this.dpr);
      this.draw();
    }

    frame(t) {
      const dt = Math.max(0, Math.min(0.05, (t - this.last) / 1000));
      this.last = t; this.time += dt;

      if (this.state === 'idle') {
        this.rot += dt * 0.25;
      } else if (this.state === 'spinning' && this.spin) {
        const s = this.spin;
        s.start ??= t;
        s.t = Math.min(s.dur, (t - s.start) / 1000);   // reloj real: si el navegador se traba, no se estira
        this.rot = s.from + (s.to - s.from) * easeOut(s.t / s.dur);
        const cur = this.sliceAt(this.rot);
        if (cur !== s.lastSlice) {
          s.lastSlice = cur;
          Sound.tick();
          this.flapV -= 9;  // la flecha se engancha en el clavito
        }
        if (s.t >= s.dur) { this.rot = s.to; this.stop(); }
      }

      // puertitas
      if (this.state === 'door') {
        this.doorWob = 0.05 + 0.13 * Math.abs(Math.sin(this.time * 26));
      } else if (this.state === 'opening') {
        this.openStart ??= t;
        const u = clamp((t - this.openStart) / 1000 / OPEN_DUR, 0, 1);
        this.doorU = easeBack(u); this.doorWob = 0; this.glowU = u;
      } else if (this.state === 'opened' || this.state === 'reveal') {
        this.doorU = 1; this.doorWob = 0; this.glowU = 1;
      } else {
        this.doorWob = 0;
      }

      // flecha con resorte
      this.flapV += (-this.flap * 260 - this.flapV * 16) * dt;
      this.flap = clamp(this.flap + this.flapV * dt, -0.55, 0.2);

      this.draw();
    }

    draw() {
      if (!this.k) return;
      const c = this.ctx, n = this.order.length, seg = this.seg;
      const doorOn = this.landed >= 0 && ['door', 'opening', 'opened', 'reveal'].includes(this.state);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.el.canvas.width, this.el.canvas.height);
      c.setTransform(this.k * this.dpr, 0, 0, this.k * this.dpr, 0, 0);

      // aro exterior
      c.save();
      c.shadowColor = 'rgba(139,92,246,.5)'; c.shadowBlur = 40;
      c.beginPath(); c.arc(C, C, R + 22, 0, TAU);
      const rim = c.createLinearGradient(0, C - R, 0, C + R);
      rim.addColorStop(0, '#3a1d7a'); rim.addColorStop(1, '#1d0d45');
      c.fillStyle = rim; c.fill();
      c.restore();
      c.beginPath(); c.arc(C, C, R + 22, 0, TAU);
      c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = 2; c.stroke();

      // luces del aro
      const nb = 24, fast = this.state === 'idle' ? 2.5 : 10;
      for (let i = 0; i < nb; i++) {
        const a = i / nb * TAU;
        const on = (Math.floor(this.time * fast) + i) % 3 === 0;
        c.beginPath(); c.arc(C + Math.cos(a) * (R + 11), C + Math.sin(a) * (R + 11), 3.6, 0, TAU);
        c.fillStyle = on ? '#ffd34d' : 'rgba(255,211,77,.22)';
        c.shadowColor = '#ffc23d'; c.shadowBlur = on ? 10 : 0;
        c.fill();
      }
      c.shadowBlur = 0;

      if (!n) {
        c.beginPath(); c.arc(C, C, R, 0, TAU);
        c.fillStyle = '#170b38'; c.fill();
      }

      // porciones (la ganadora se dibuja aparte, como puertita)
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 10);
      for (let i = 0; i < n; i++) {
        if (doorOn && i === this.landed) continue;
        const p = this.people.get(this.order[i]);
        const color = p ? p.color : '#888';
        const a0 = this.rot + i * seg, a1 = a0 + seg;
        wedge(c, a0, a1);
        const g = c.createRadialGradient(C, C, R * 0.15, C, C, R);
        g.addColorStop(0, shade(color, -0.25)); g.addColorStop(0.7, color); g.addColorStop(1, shade(color, 0.12));
        c.fillStyle = g; c.fill();
        if (i % 2) { c.fillStyle = 'rgba(0,0,0,.08)'; c.fill(); }
        if (doorOn) { c.fillStyle = `rgba(8,4,20,${0.3 + 0.35 * this.glowU})`; c.fill(); }  // el resto se apaga
        if (i === this.landed && this.state === 'stopped') {
          c.fillStyle = `rgba(255,255,255,${0.15 + 0.3 * pulse})`; c.fill();
        }
        if (p) drawName(c, p.name, (a0 + a1) / 2, seg);
      }

      // borde de la porción ganadora
      if (this.landed >= 0 && this.state === 'stopped') {
        const a0 = this.rot + this.landed * seg;
        c.save();
        wedge(c, a0, a0 + seg);
        c.shadowColor = '#fff'; c.shadowBlur = 24;
        c.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * pulse})`; c.lineWidth = 4; c.stroke();
        c.restore();
      }

      // separadores y clavitos
      if (n > 1) {
        for (let i = 0; i < n; i++) {
          const a = this.rot + i * seg;
          c.beginPath(); c.moveTo(C, C); c.lineTo(C + Math.cos(a) * R, C + Math.sin(a) * R);
          c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 2; c.stroke();
          const px = C + Math.cos(a) * (R - 8), py = C + Math.sin(a) * (R - 8);
          c.beginPath(); c.arc(px, py, 4.5, 0, TAU);
          const pg = c.createRadialGradient(px - 1.5, py - 1.5, 0.5, px, py, 4.5);
          pg.addColorStop(0, '#fff'); pg.addColorStop(1, '#a9a2cc');
          c.fillStyle = pg; c.fill();
        }
      }

      if (doorOn) this.drawDoor(c, this.rot + this.landed * seg, seg);

      // centro
      c.save();
      c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 14;
      c.beginPath(); c.arc(C, C, 46, 0, TAU);
      const hub = c.createRadialGradient(C - 14, C - 16, 4, C, C, 46);
      hub.addColorStop(0, '#fff'); hub.addColorStop(0.5, '#ffd34d'); hub.addColorStop(1, '#d98a00');
      c.fillStyle = hub; c.fill();
      c.restore();
      c.fillStyle = '#5a2a00';
      c.font = '700 44px Fredoka, Nunito, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(this.glowU >= 1 ? '!' : '?', C, C + 2);

      // flecha (arriba)
      c.save();
      c.translate(C, C - R - 26);
      c.rotate(this.flap);
      c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 10; c.shadowOffsetY = 3;
      c.beginPath();
      c.moveTo(-17, -6); c.lineTo(17, -6); c.lineTo(0, 44); c.closePath();
      c.fillStyle = '#e8264f'; c.fill();
      c.shadowColor = 'transparent';
      c.beginPath(); c.moveTo(-9, -2); c.lineTo(0, 30); c.lineTo(0, -2); c.closePath();
      c.fillStyle = 'rgba(255,255,255,.3)'; c.fill();
      c.beginPath(); c.arc(0, -4, 8, 0, TAU);
      c.fillStyle = '#ffd34d'; c.fill();
      c.restore();
    }

    /** La porción ganadora: atrás el nombre real, adelante dos hojas con bisagras en los bordes. */
    drawDoor(c, a0, seg) {
      const a1 = a0 + seg, mid = a0 + seg / 2, half = seg / 2;
      const w = this.winner, cv = this.cover, g = this.glowU;

      // fondo (lo que había detrás)
      c.save();
      wedge(c, a0, a1);
      c.fillStyle = '#0d0624'; c.fill();
      c.clip();
      const bg = c.createRadialGradient(C + Math.cos(mid) * R * 0.62, C + Math.sin(mid) * R * 0.62, 4,
        C + Math.cos(mid) * R * 0.62, C + Math.sin(mid) * R * 0.62, R * 0.7);
      bg.addColorStop(0, hexA(w.color, 0.85 * g)); bg.addColorStop(1, hexA(w.color, 0));
      c.fillStyle = bg; c.fillRect(0, 0, S, S);
      c.restore();
      if (g > 0) {
        c.save();
        c.globalAlpha = clamp(g * 1.4 - 0.2, 0, 1);
        drawName(c, w.name, mid, seg, { glow: w.color, scale: 1.15 });
        c.restore();
        // marco brillante
        c.save();
        wedge(c, a0, a1);
        c.shadowColor = w.color; c.shadowBlur = 30 * g;
        c.strokeStyle = `rgba(255,255,255,${0.4 + 0.5 * g * (0.6 + 0.4 * Math.sin(this.time * 8))})`;
        c.lineWidth = 4; c.stroke();
        c.restore();
      }

      // hojas: cada una gira sobre su borde exterior; vista de frente se "achica" con cos(θ)
      const th = clamp(this.doorWob + this.doorU * OPEN_MAX, 0, 1.55);
      const k = Math.cos(th);
      const leafA = this.state === 'opened' || this.state === 'reveal' ? 0.6 : 1;
      const leaves = [[a0, a0 + half * k, 1], [a1 - half * k, a1, -1]];
      for (const [b0, b1, side] of leaves) {
        if (b1 - b0 < 0.002) continue;
        c.save();
        c.globalAlpha = leafA;
        // la hoja se despega un poco hacia afuera al abrirse
        const lift = Math.sin(th) * 10, la = side > 0 ? b0 : b1;
        c.translate(Math.cos(la + side * Math.PI / 2) * lift * 0.4, Math.sin(la + side * Math.PI / 2) * lift * 0.4);
        wedge(c, b0, b1);
        const gr = c.createRadialGradient(C, C, R * 0.15, C, C, R);
        gr.addColorStop(0, shade(cv.color, -0.25)); gr.addColorStop(0.7, cv.color); gr.addColorStop(1, shade(cv.color, 0.12));
        c.fillStyle = gr; c.fill();
        c.fillStyle = `rgba(0,0,0,${0.55 * (1 - k)})`; c.fill();          // se oscurece al girar
        c.save(); c.clip();
        if (th < 0.6) {                                                    // nombre de adelante
          c.globalAlpha = leafA * clamp(1 - th * 1.8, 0, 1);
          drawName(c, cv.name, mid, seg);
        }
        c.restore();
        // canto libre de la hoja (brillo) y manija
        const free = side > 0 ? b1 : b0;
        c.beginPath(); c.moveTo(C + Math.cos(free) * 50, C + Math.sin(free) * 50);
        c.lineTo(C + Math.cos(free) * R, C + Math.sin(free) * R);
        c.strokeStyle = `rgba(255,255,255,${0.35 + 0.4 * (1 - k)})`; c.lineWidth = 2.5; c.stroke();
        const ha = free - side * Math.min(0.06, (b1 - b0) * 0.35);
        c.beginPath(); c.arc(C + Math.cos(ha) * R * 0.48, C + Math.sin(ha) * R * 0.48, 4.5, 0, TAU);
        c.fillStyle = 'rgba(255,255,255,.75)'; c.fill();
        c.restore();
      }
    }
  }

  function wedge(c, a0, a1) {
    c.beginPath(); c.moveTo(C, C); c.arc(C, C, R, a0, a1); c.closePath();
  }

  function drawName(c, name, mid, seg, o = {}) {
    c.save();
    c.translate(C, C);
    c.rotate(mid);
    c.fillStyle = '#fff';
    c.shadowColor = o.glow || 'rgba(0,0,0,.55)'; c.shadowBlur = o.glow ? 16 : 5;
    c.textAlign = 'right'; c.textBaseline = 'middle';
    const arc = seg * R * 0.72;                     // alto disponible cerca del borde
    const fs = clamp(arc * 0.5, 11, 30) * (o.scale || 1);
    c.font = `700 ${fs}px Fredoka, Nunito, sans-serif`;
    c.fillText(ellipsize(c, name, R - 64), R - 22, 1);
    if (o.glow) c.fillText(ellipsize(c, name, R - 64), R - 22, 1);
    c.restore();
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
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

  let inst = null;
  Games.register({
    id: 'ruleta',
    title: 'Ruleta',
    icon: '<span class="tab-emoji" aria-hidden="true">🎡</span>',
    mount(el) { inst = new Ruleta(el); },
    unmount() { if (inst) inst.destroy(); inst = null; },
  });
})();

/* Núcleo compartido por todos los minijuegos: estado, sonidos, confetti y registro de juegos. */
(() => {
  'use strict';

  const COLORS = ['#ff4d8d', '#ffb020', '#3d8bff', '#8b5cf6', '#10d9a0', '#ff6b35', '#22c3ee',
    '#f472b6', '#84cc16', '#ef4444', '#14b8a6', '#eab308', '#a855f7', '#fb7185'];
  const KEY = 'selector.state.v1';
  const DEMO = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Facu', 'Gabi', 'Hugo'];

  const uid = () => Math.random().toString(36).slice(2, 10);

  /** Entero aleatorio uniforme en [0, n) usando crypto (sin sesgo de módulo). */
  function rand(n) {
    if (n <= 1) return 0;
    const max = Math.floor(0x100000000 / n) * n;
    const a = new Uint32Array(1);
    do { crypto.getRandomValues(a); } while (a[0] >= max);
    return a[0] % n;
  }

  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function initials(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (Array.from(parts[0])[0] + Array.from(parts[1])[0]).toUpperCase();
    const ch = Array.from(parts[0] || '?');
    return ch[0].toUpperCase() + (ch[1] || '').toLowerCase();
  }

  function parseNames(text) {
    return text.split(/[\n,;\t]+/)
      .map(s => s.replace(/^\s*(?:[-*•·]|\d+[.)-])\s+/, '').trim())
      .filter(Boolean)
      .map(s => s.slice(0, 40));
  }

  /* ---------------- Estado (persistido en localStorage) ---------------- */
  const Store = {
    state: null,
    subs: new Set(),

    load() {
      let s = null;
      try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* sin storage */ }
      if (!s || !Array.isArray(s.people)) {
        s = { people: [], noRepeat: true, history: [], muted: false, colorIdx: 0 };
        DEMO.forEach(n => this._add(s, n));
      }
      s.history = s.history || [];
      if (typeof s.colorIdx !== 'number') s.colorIdx = s.people.length;
      this.state = s;
    },
    _add(s, name) {
      if (s.people.some(p => p.name.toLowerCase() === name.toLowerCase())) return false;
      s.people.push({ id: uid(), name, color: COLORS[(s.colorIdx++) % COLORS.length], active: true, drawn: false });
      return true;
    },
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { /* ignore */ } },
    emit() {
      this.save();
      this.subs.forEach(f => { try { f(this.state); } catch (e) { console.error(e); } });
    },
    subscribe(f) { this.subs.add(f); return () => this.subs.delete(f); },
    get(id) { return this.state.people.find(p => p.id === id); },

    addNames(text) {
      let added = 0, dup = 0;
      for (const n of parseNames(text)) this._add(this.state, n) ? added++ : dup++;
      if (added) this.emit();
      return { added, dup };
    },
    replaceNames(names) {
      this.state.people = [];
      this.state.colorIdx = 0;
      names.forEach(n => this._add(this.state, n));
      this.emit();
    },
    remove(id) { this.state.people = this.state.people.filter(p => p.id !== id); this.emit(); },
    toggleActive(id) { const p = this.get(id); if (p) { p.active = !p.active; this.emit(); } },
    clear() { this.state.people = []; this.state.colorIdx = 0; this.emit(); },
    setNoRepeat(v) { this.state.noRepeat = !!v; this.emit(); },
    setMuted(v) { this.state.muted = !!v; this.emit(); },
    resetRound() { this.state.people.forEach(p => { p.drawn = false; }); this.emit(); },
    clearHistory() { this.state.history = []; this.emit(); },

    /** Quiénes pueden salir ahora mismo. */
    pool() {
      const s = this.state;
      return s.people.filter(p => p.active && !(s.noRepeat && p.drawn));
    },
    recordWin(id, game) {
      const p = this.get(id);
      if (!p) return;
      p.drawn = true;
      this.state.history.unshift({ id, name: p.name, color: p.color, game, at: Date.now() });
      this.state.history = this.state.history.slice(0, 50);
      this.emit();
    },
    undoLast() {
      const h = this.state.history.shift();
      if (h) { const p = this.get(h.id); if (p) p.drawn = false; }
      this.emit();
    },
  };

  /* ---------------- Sonidos sintetizados (WebAudio, sin archivos) ---------------- */
  const Sound = {
    ac: null, master: null, noiseBuf: null, unlocked: false,

    ctx() {
      if (!this.unlocked || (Store.state && Store.state.muted)) return null;
      if (!this.ac) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        this.ac = new C();
        this.master = this.ac.createGain();
        this.master.gain.value = 0.7;
        this.master.connect(this.ac.destination);
        const len = Math.floor(this.ac.sampleRate * 0.6);
        this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ac.state === 'suspended') this.ac.resume();
      return this.ac;
    },
    tone(freq, dur, o = {}) {
      const ac = this.ctx(); if (!ac) return;
      const t = ac.currentTime + (o.when || 0);
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
      const v = o.vol ?? 0.2;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.008));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.05);
    },
    noise(dur, o = {}) {
      const ac = this.ctx(); if (!ac) return;
      const t = ac.currentTime + (o.when || 0);
      const src = ac.createBufferSource(); src.buffer = this.noiseBuf;
      const f = ac.createBiquadFilter(); f.type = o.ftype || 'bandpass';
      f.frequency.value = o.freq || 2000; f.Q.value = o.q || 1;
      const g = ac.createGain(); const v = o.vol ?? 0.2;
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.02);
    },
    coin() { this.tone(1318, 0.09, { type: 'square', vol: 0.05 }); this.tone(1976, 0.4, { type: 'square', vol: 0.05, when: 0.08 }); },
    clink() { this.noise(0.06, { freq: 4200, q: 8, vol: 0.3 }); this.tone(2637, 0.14, { type: 'triangle', vol: 0.07 }); this.noise(0.05, { freq: 3000, q: 6, vol: 0.18, when: 0.07 }); },
    tick() { this.noise(0.025, { freq: 1600, q: 3, vol: 0.35 }); this.tone(180, 0.03, { type: 'square', vol: 0.04 }); },
    rattle(k = 1) { this.noise(0.03, { freq: 2500 + Math.random() * 2500, q: 7, vol: 0.06 + 0.12 * k * Math.random() }); },
    clack(v = 0.5) { this.noise(0.025, { freq: 3000 + Math.random() * 1500, q: 9, vol: 0.04 + 0.14 * v }); },
    whoosh() { this.noise(0.35, { ftype: 'lowpass', freq: 900, q: 0.7, vol: 0.18 }); },
    thud() { this.tone(170, 0.22, { vol: 0.35, slide: 55 }); this.noise(0.07, { freq: 500, q: 1, vol: 0.15 }); },
    pop() { this.tone(420, 0.18, { type: 'triangle', vol: 0.25, slide: 1400 }); this.noise(0.12, { freq: 1800, q: 0.8, vol: 0.22 }); },
    fanfare() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.14, when: 0.05 + i * 0.09 }));
      this.tone(1046.5, 0.9, { type: 'triangle', vol: 0.12, when: 0.42 });
      this.tone(1318.5, 0.9, { type: 'sine', vol: 0.08, when: 0.42 });
      this.tone(1568, 0.9, { type: 'sine', vol: 0.06, when: 0.42 });
    },
  };
  const unlock = () => { Sound.unlocked = true; };
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });

  /* ---------------- Confetti ---------------- */
  const Confetti = (() => {
    let cv, cx, parts = [], raf = 0, last = 0, dpr = 1;
    function size() {
      dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    }
    function ensure() {
      if (cv) return;
      cv = document.createElement('canvas');
      cv.className = 'confetti-layer';
      document.body.appendChild(cv);
      cx = cv.getContext('2d');
      size();
      addEventListener('resize', size);
    }
    function burst(x, y, o = {}) {
      ensure();
      const n = o.count || 150, cols = o.colors || COLORS;
      const ang = o.angle ?? -Math.PI / 2, spread = o.spread ?? Math.PI * 2, pw = o.power || 13;
      for (let i = 0; i < n; i++) {
        const a = ang + (Math.random() - 0.5) * spread, v = pw * (0.35 + Math.random() * 0.65);
        parts.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.lift ?? 3),
          w: 5 + Math.random() * 7, h: 7 + Math.random() * 9,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.35,
          tilt: Math.random() * 6.28, vt: 0.05 + Math.random() * 0.12,
          color: cols[(Math.random() * cols.length) | 0],
          life: 1, decay: 0.004 + Math.random() * 0.006, round: Math.random() < 0.25,
        });
      }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    }
    function rain(o = {}) {
      const k = 8;
      for (let i = 0; i < k; i++) {
        burst(innerWidth * (i + 0.5) / k, -20, { count: o.count || 22, angle: Math.PI / 2, spread: 1.2, power: 5, lift: 0, colors: o.colors });
      }
    }
    function tick(t) {
      const f = Math.min(3, (t - last) / 16.67); last = t;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter(p => p.life > 0 && p.y < innerHeight + 40);
      for (const p of parts) {
        p.vy += 0.32 * f;
        p.vx *= Math.pow(0.985, f); p.vy *= Math.pow(0.985, f);
        p.x += p.vx * f; p.y += p.vy * f;
        p.rot += p.vr * f; p.tilt += p.vt * f; p.life -= p.decay * f;
        cx.save();
        cx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
        cx.translate(p.x, p.y); cx.rotate(p.rot); cx.scale(1, Math.cos(p.tilt));
        cx.fillStyle = p.color;
        if (p.round) { cx.beginPath(); cx.arc(0, 0, p.w / 2, 0, 6.283); cx.fill(); }
        else cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        cx.restore();
      }
      if (parts.length) raf = requestAnimationFrame(tick);
      else { raf = 0; cx.clearRect(0, 0, innerWidth, innerHeight); }
    }
    return { burst, rain };
  })();

  /* ---------------- Registro de juegos ----------------
     Cada juego se registra con: { id, title, icon, mount(el), unmount() } */
  const Games = { list: [], register(g) { this.list.push(g); } };

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  window.Selector = { COLORS, Store, Sound, Confetti, Games, util: { rand, esc, initials, parseNames, toast } };
})();

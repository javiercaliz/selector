/* UI general: navegación entre juegos y panel de participantes. */
(() => {
  'use strict';
  const { Store, Games, util } = window.Selector;
  const $ = s => document.querySelector(s);

  const SOON = [
    { emoji: '🎡', title: 'Ruleta' },
    { emoji: '🎰', title: 'Tragamonedas' },
    { emoji: '🦾', title: 'Garra' },
  ];

  let current = null;
  const seen = new Set();
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

  function ago(ts) {
    const diff = ts - Date.now();
    const days = Math.round(diff / 86400000);
    if (Math.abs(diff) < 3600000) return 'recién';
    if (days === 0) return rtf.format(Math.round(diff / 3600000), 'hour');
    if (Math.abs(days) < 30) return rtf.format(days, 'day');
    return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  }

  /* ---------- Navegación ---------- */
  function renderTabs() {
    $('#tabs').innerHTML =
      Games.list.map(g => `<a class="tab${current === g ? ' active' : ''}" href="#/${g.id}">${g.icon || ''}<span>${g.title}</span></a>`).join('') +
      SOON.map(s => `<span class="tab soon" title="Próximamente"><span class="tab-emoji">${s.emoji}</span><span>${s.title}</span><em>pronto</em></span>`).join('');
  }

  function route() {
    const id = location.hash.replace(/^#\/?/, '');
    const g = Games.list.find(x => x.id === id) || Games.list[0];
    if (!g || current === g) return;
    if (current) current.unmount();
    current = g;
    const stage = $('#stage');
    stage.innerHTML = '';
    g.mount(stage);
    renderTabs();
  }

  /* ---------- Panel ---------- */
  function renderPanel() {
    const s = Store.state, pool = Store.pool();
    const hasSeen = seen.size > 0;

    $('#chips').innerHTML = s.people.map(p => {
      const cls = ['chip'];
      if (!p.active) cls.push('off');
      if (p.drawn && s.noRepeat) cls.push('done');
      if (hasSeen && !seen.has(p.id)) cls.push('new');
      const title = p.active ? 'Tocá para marcar ausente' : 'Ausente · tocá para sumarlo de nuevo';
      return `<li class="${cls.join(' ')}" style="--c:${p.color}" data-id="${p.id}">
        <button class="chip-main" type="button" title="${title}"><span class="dot"></span><span class="nm">${util.esc(p.name)}</span></button>
        <button class="chip-x" type="button" aria-label="Quitar a ${util.esc(p.name)}">✕</button>
      </li>`;
    }).join('');
    s.people.forEach(p => seen.add(p.id));

    $('#emptyList').hidden = s.people.length > 0;
    $('#poolInfo').textContent = `${pool.length} en juego`;
    $('#peopleCount').textContent = pool.length;
    $('#noRepeat').checked = s.noRepeat;

    const active = s.people.filter(p => p.active);
    const done = active.filter(p => p.drawn).length;
    const info = $('#roundInfo');
    if (s.noRepeat) {
      info.innerHTML = active.length
        ? `<span><b>${done}</b> de <b>${active.length}</b> ya pasaron</span>${done ? '<button class="link-btn" id="resetRound" type="button">↺ Nueva ronda</button>' : ''}`
        : '<span>No hay nadie activo.</span>';
      $('#roundProgress').hidden = false;
      $('#roundBar').style.width = active.length ? `${(done / active.length) * 100}%` : '0';
    } else {
      info.innerHTML = '<span>Cualquiera puede volver a salir.</span>';
      $('#roundProgress').hidden = true;
    }

    $('#historyList').innerHTML = s.history.length
      ? s.history.slice(0, 8).map(h => `<li style="--c:${h.color}"><span class="dot"></span><b>${util.esc(h.name)}</b><span class="when">${ago(h.at)}</span></li>`).join('')
      : '<li class="muted">Todavía no salió nadie.</li>';
    $('#clearHistory').hidden = !s.history.length;
    $('#historyLast').textContent = s.history.length ? `· último: ${s.history[0].name}` : '';

    const mb = $('#muteBtn');
    mb.textContent = s.muted ? '🔇' : '🔊';
    mb.title = s.muted ? 'Activar sonido' : 'Silenciar';
  }

  function openPanel() {
    $('#panel').classList.add('open');
    $('#scrim').classList.add('show');
    setTimeout(() => $('#namesInput').focus(), 250);
  }
  function closePanel() {
    $('#panel').classList.remove('open');
    $('#scrim').classList.remove('show');
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight + 2, 260) + 'px';
  }

  function bind() {
    const input = $('#namesInput');

    $('#addForm').addEventListener('submit', e => {
      e.preventDefault();
      const { added, dup } = Store.addNames(input.value);
      if (added || dup) { input.value = ''; autoGrow(input); }
      if (added && dup) util.toast(`Sumaste ${added} · ${dup} ya estaba${dup > 1 ? 'n' : ''}`);
      else if (added > 1) util.toast(`¡Sumaste ${added} personas!`);
      else if (dup) util.toast(dup > 1 ? 'Ya estaban todos en la lista' : 'Ya está en la lista');
      input.focus();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#addForm').requestSubmit(); }
    });
    input.addEventListener('input', () => autoGrow(input));

    $('#chips').addEventListener('click', e => {
      const li = e.target.closest('.chip'); if (!li) return;
      if (e.target.closest('.chip-x')) Store.remove(li.dataset.id);
      else if (e.target.closest('.chip-main')) Store.toggleActive(li.dataset.id);
    });

    $('#roundInfo').addEventListener('click', e => {
      if (e.target.closest('#resetRound')) { Store.resetRound(); util.toast('¡Nueva ronda! Todos vuelven a la máquina'); }
    });
    $('#noRepeat').addEventListener('change', e => Store.setNoRepeat(e.target.checked));

    $('#shareBtn').addEventListener('click', async () => {
      const names = Store.state.people.map(p => p.name);
      if (!names.length) return util.toast('Primero agregá participantes');
      const url = `${location.href.split(/[?#]/)[0]}?n=${encodeURIComponent(names.join('|'))}`;
      try { await navigator.clipboard.writeText(url); util.toast('Link copiado 📋 Compartilo con tu equipo'); }
      catch (err) { prompt('Copiá este link:', url); }
    });
    $('#clearBtn').addEventListener('click', () => {
      if (!Store.state.people.length) return;
      if (confirm('¿Vaciar la lista de participantes?')) Store.clear();
    });
    $('#clearHistory').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); Store.clearHistory(); });

    $('#muteBtn').addEventListener('click', () => Store.setMuted(!Store.state.muted));
    $('#peopleBtn').addEventListener('click', openPanel);
    $('#closePanel').addEventListener('click', closePanel);
    $('#scrim').addEventListener('click', closePanel);
    addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

    addEventListener('selector:open-panel', () => {
      if (matchMedia('(max-width: 900px)').matches) openPanel();
      else { input.focus(); input.classList.add('flash'); setTimeout(() => input.classList.remove('flash'), 900); }
    });
  }

  /** Lista compartida por link: ?n=Ana|Bruno|... */
  function importFromUrl() {
    const raw = new URLSearchParams(location.search).get('n');
    if (!raw) return;
    const names = raw.split('|').map(s => s.trim()).filter(Boolean);
    const cur = Store.state.people.map(p => p.name).join('|');
    if (names.length && cur !== names.join('|') &&
        confirm(`Este link trae ${names.length} participantes:\n${names.join(', ')}\n\n¿Reemplazar tu lista actual?`)) {
      Store.replaceNames(names);
    }
    history.replaceState(null, '', location.pathname + location.hash);
  }

  Store.load();
  importFromUrl();
  bind();
  renderPanel();
  Store.subscribe(renderPanel);
  route();
  addEventListener('hashchange', route);
})();

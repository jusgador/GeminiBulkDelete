// ==UserScript==
// @name         Gemini Bulk Delete
// @namespace    https://github.com/jusgador/GeminiBulkDelete
// @version      1.0.0
// @description  Exclusão em massa de conversas do Gemini: caixas de seleção, selecionar todas, selecionar dos últimos X dias.
// @author       Ricardo Campos
// @homepageURL  https://github.com/jusgador/GeminiBulkDelete
// @supportURL   https://github.com/jusgador/GeminiBulkDelete/issues
// @updateURL    https://raw.githubusercontent.com/jusgador/GeminiBulkDelete/main/gemini-bulk-delete.user.js
// @downloadURL  https://raw.githubusercontent.com/jusgador/GeminiBulkDelete/main/gemini-bulk-delete.user.js
// @match        https://gemini.google.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Seletores (Gemini web, set/2026) ----------
  const SEL = {
    list: 'conversations-list',
    item: 'gem-nav-list-item[data-test-id="conversation"]',
    link: 'a[href^="/app/"]',
    title: '.title-text',
    moreBtn: '.hovered-trailing-content button, .gem-conversation-actions-menu button',
    menuDelete: '.mat-mdc-menu-panel [data-test-id="delete-button"]',
    menuPanel: '.mat-mdc-menu-panel',
    dialog: 'mat-dialog-container',
    scroller: 'infinite-scroller',
  };

  const PREFIX = 'gbd';
  const state = {
    active: false,
    selected: new Set(),          // ids de conversas selecionadas
    dates: new Map(),             // id -> timestamp (ms) vindo da API
    datesLoaded: false,
    running: false,
    stop: false,
  };

  // ---------- Utilidades ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  async function waitFor(fn, timeout = 4000, step = 60) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  function idOf(item) {
    const a = $(SEL.link, item);
    if (!a) return null;
    const m = a.getAttribute('href').match(/\/app\/([a-z0-9]+)/i);
    return m ? m[1] : null;
  }

  function titleOf(item) {
    const t = $(SEL.title, item);
    return t ? t.textContent.trim() : (item.textContent || '').trim();
  }

  function items() {
    return $$(SEL.item).filter((it) => idOf(it));
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  // ---------- Datas via API interna (MaZiqc) ----------
  function wiz() {
    const W = window.WIZ_global_data || {};
    return { at: W.SNlM0e, sid: W.FdrFJe, bl: W.cfb2h };
  }

  async function rpc(rpcid, args) {
    const { at, sid, bl } = wiz();
    if (!at) throw new Error('WIZ_global_data indisponível');
    const url = `/_/BardChatUi/data/batchexecute?rpcids=${rpcid}&source-path=%2Fapp&f.sid=${sid}&bl=${bl}&hl=${document.documentElement.lang || 'en'}&_reqid=${Math.floor(Math.random() * 1e6)}&rt=c`;
    const body = 'f.req=' + encodeURIComponent(JSON.stringify([[[rpcid, JSON.stringify(args), null, 'generic']]])) + '&at=' + encodeURIComponent(at);
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body });
    const text = await r.text();
    for (const line of text.split('\n')) {
      if (line.startsWith('[[')) {
        try {
          const arr = JSON.parse(line);
          const inner = arr[0] && arr[0][2];
          return inner ? JSON.parse(inner) : null;
        } catch (e) { /* tenta próxima linha */ }
      }
    }
    return null;
  }

  async function loadDates() {
    let token = null;
    let pages = 0;
    do {
      const p = await rpc('MaZiqc', token ? [50, token] : [50]);
      pages++;
      if (!p) break;
      for (const c of (p[2] || [])) {
        const id = String(c[0] || '').replace(/^c_/, '');
        const ts = c[5] && c[5][0];
        if (id && ts) state.dates.set(id, ts * 1000);
      }
      token = p[1] || null;
    } while (token && pages < 40);
    state.datesLoaded = true;
  }

  // Data efetiva de um item: da API, ou inferida pela ordem da lista
  // (a lista é ordenada por recência; um item sem data é pelo menos tão
  // recente quanto o próximo item datado abaixo dele).
  function effectiveDates() {
    const list = items();
    const res = new Map();
    let nextKnown = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const id = idOf(list[i]);
      const known = state.dates.get(id);
      if (known) { nextKnown = known; res.set(id, { ts: known, inferred: false }); }
      else if (nextKnown) res.set(id, { ts: nextKnown, inferred: true });
      else res.set(id, { ts: null, inferred: true });
    }
    return res;
  }

  // ---------- UI: painel ----------
  let panel, countLabel, progress;

  function css() {
    if ($('#' + PREFIX + '-style')) return;
    const st = document.createElement('style');
    st.id = PREFIX + '-style';
    st.textContent = `
      .${PREFIX}-panel{margin:6px 10px;padding:8px;border:1px solid rgba(128,128,128,.35);border-radius:10px;font:12px/1.4 system-ui,sans-serif;color:inherit;display:flex;flex-direction:column;gap:6px}
      .${PREFIX}-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .${PREFIX}-panel button{cursor:pointer;border:1px solid rgba(128,128,128,.5);background:rgba(128,128,128,.15);color:inherit;border-radius:6px;padding:3px 8px;font:inherit}
      .${PREFIX}-panel button:hover{background:rgba(128,128,128,.3)}
      .${PREFIX}-panel button.${PREFIX}-danger{background:#b3261e;border-color:#b3261e;color:#fff}
      .${PREFIX}-panel button:disabled{opacity:.5;cursor:default}
      .${PREFIX}-panel input[type=number]{width:52px;border:1px solid rgba(128,128,128,.5);border-radius:6px;background:transparent;color:inherit;padding:2px 4px;font:inherit}
      .${PREFIX}-muted{opacity:.75}
      .${PREFIX}-cb{margin:0 6px 0 0;flex:none;align-self:center;cursor:pointer;width:14px;height:14px}
      .${PREFIX}-date{margin-left:auto;padding:0 22px 0 6px;font-size:10px;opacity:.6;flex:none;align-self:center}
      .${PREFIX}-date.${PREFIX}-inf{opacity:.4;font-style:italic}
      ${SEL.item}.${PREFIX}-sel a{background:rgba(66,133,244,.18)!important}
      ${SEL.item}.${PREFIX}-busy a{opacity:.4}
    `;
    document.head.appendChild(st);
  }

  // Construção via DOM (innerHTML é bloqueado pela política Trusted Types do Gemini)
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else e.setAttribute(k, v);
    }
    (children || []).forEach((c) => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  }
  const btn = (act, text, extra) => el('button', Object.assign({ 'data-act': act, text }, extra || {}));
  const row = (role, children, hidden) => el('div', Object.assign({ class: PREFIX + '-row' }, role ? { 'data-role': role } : {}, hidden ? { style: 'display:none' } : {}), children);

  function buildPanel() {
    panel = el('div', { class: PREFIX + '-panel' }, [
      row(null, [
        btn('toggle', '☑ Seleção em massa'),
        el('span', { class: PREFIX + '-muted', 'data-role': 'count' }),
      ]),
      row('tools', [btn('all', 'Selecionar todas'), btn('none', 'Limpar'), btn('invert', 'Inverter')], true),
      row('tools2', [
        el('span', { text: 'Últimos' }),
        el('input', { type: 'number', min: '0', value: '7', 'data-role': 'days' }),
        el('span', { text: 'dias' }),
        btn('days', 'Selecionar'),
        btn('older', 'Mais antigas', { title: 'Seleciona as conversas MAIS ANTIGAS que X dias' }),
      ], true),
      row('tools3', [
        btn('loadmore', 'Carregar mais', { title: 'Rola a lista para carregar mais conversas' }),
        btn('delete', '🗑 Excluir selecionadas', { class: PREFIX + '-danger' }),
        btn('stop', '■ Parar', { style: 'display:none' }),
      ], true),
      el('div', { class: PREFIX + '-muted', 'data-role': 'progress', style: 'display:none;white-space:pre-wrap' }),
    ]);
    countLabel = $('[data-role="count"]', panel);
    progress = $('[data-role="progress"]', panel);
    panel.addEventListener('click', onPanelClick);
    return panel;
  }

  function setToolsVisible(v) {
    ['tools', 'tools2', 'tools3'].forEach((r) => { $(`[data-role="${r}"]`, panel).style.display = v ? '' : 'none'; });
  }

  function updateCount() {
    const total = items().length;
    const dates = state.datesLoaded ? '' : ' · datas: carregando…';
    countLabel.textContent = state.active ? `${state.selected.size} selecionada(s) de ${total} carregada(s)${dates}` : '';
    const del = $('[data-act="delete"]', panel);
    if (del) del.disabled = state.selected.size === 0 || state.running;
  }

  async function onPanelClick(ev) {
    const b = ev.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'toggle') {
      state.active = !state.active;
      setToolsVisible(state.active);
      if (!state.active) { state.selected.clear(); setProgress(''); }
      if (state.active && !state.datesLoaded) loadDates().catch((e) => console.warn('[GBD] datas', e)).then(decorateAll);
      decorateAll();
    } else if (act === 'all') {
      items().forEach((it) => state.selected.add(idOf(it)));
      decorateAll();
    } else if (act === 'none') {
      state.selected.clear();
      decorateAll();
    } else if (act === 'invert') {
      items().forEach((it) => { const id = idOf(it); if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id); });
      decorateAll();
    } else if (act === 'days' || act === 'older') {
      const days = Number($('[data-role="days"]', panel).value || 0);
      const limit = Date.now() - days * 86400000;
      const eff = effectiveDates();
      let skipped = 0;
      items().forEach((it) => {
        const id = idOf(it);
        const d = eff.get(id);
        if (!d || !d.ts) { skipped++; return; }
        const recent = d.ts >= limit;
        if (act === 'days' ? recent : !recent) state.selected.add(id);
      });
      decorateAll();
      setProgress(skipped ? `${skipped} conversa(s) sem data conhecida foram ignoradas.` : '');
    } else if (act === 'loadmore') {
      await loadMore();
    } else if (act === 'delete') {
      await bulkDelete();
    } else if (act === 'stop') {
      state.stop = true;
      b.disabled = true;
    }
  }

  function setProgress(msg) {
    progress.style.display = msg ? '' : 'none';
    progress.textContent = msg || '';
  }

  // ---------- UI: itens ----------
  function decorateItem(it, eff) {
    const id = idOf(it);
    const a = $(SEL.link, it);
    if (!a) return;
    let cb = $('.' + PREFIX + '-cb', it);
    let dt = $('.' + PREFIX + '-date', it);
    if (!state.active) {
      if (cb) cb.remove();
      if (dt) dt.remove();
      it.classList.remove(PREFIX + '-sel');
      return;
    }
    if (!cb) {
      cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = PREFIX + '-cb';
      const stopNav = (e) => { e.stopPropagation(); };
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cb.checked) state.selected.add(id); else state.selected.delete(id);
        it.classList.toggle(PREFIX + '-sel', cb.checked);
        updateCount();
      });
      cb.addEventListener('mousedown', stopNav);
      cb.addEventListener('pointerdown', stopNav);
      a.insertBefore(cb, a.firstChild);
      // com a seleção ativa, clicar no item alterna a caixa em vez de navegar
      a.addEventListener('click', (e) => {
        if (!state.active || state.running) return;
        if (e.target === cb) return;
        e.preventDefault(); e.stopPropagation();
        cb.click();
      }, true);
    }
    cb.checked = state.selected.has(id);
    it.classList.toggle(PREFIX + '-sel', cb.checked);

    const d = eff && eff.get(id);
    if (d && d.ts) {
      if (!dt) { dt = document.createElement('span'); dt.className = PREFIX + '-date'; a.appendChild(dt); }
      dt.textContent = fmtDate(d.ts);
      dt.title = d.inferred ? 'Data estimada pela posição na lista' : 'Última atividade';
      dt.classList.toggle(PREFIX + '-inf', d.inferred);
    } else if (dt) dt.remove();
  }

  function decorateAll() {
    const eff = state.active ? effectiveDates() : null;
    items().forEach((it) => decorateItem(it, eff));
    updateCount();
  }

  // ---------- Carregar mais (rolagem da lista) ----------
  async function loadMore() {
    const before = items().length;
    const sc = $$(SEL.scroller).find((e) => e.scrollHeight > e.clientHeight) || $(SEL.scroller);
    if (sc) {
      for (let i = 0; i < 4; i++) {
        sc.scrollTop = sc.scrollHeight;
        sc.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(600);
        if (items().length > before) break;
      }
    }
    const after = items().length;
    if (after > before) setProgress(`Carregadas ${after - before} conversa(s) a mais (${after} no total).`);
    else setProgress('Nada novo carregado. Se houver mais conversas, role a barra lateral com o mouse até o fim e tente de novo.');
    decorateAll();
  }

  // ---------- Exclusão ----------
  async function deleteOne(it) {
    const id = idOf(it);
    it.classList.add(PREFIX + '-busy');
    it.scrollIntoView({ block: 'center' });
    await sleep(80);

    const more = $(SEL.moreBtn, it);
    if (!more) throw new Error('botão "Mais opções" não encontrado');
    more.click();

    const del = await waitFor(() => $(SEL.menuDelete));
    if (!del) { document.body.click(); throw new Error('item "Excluir" não apareceu no menu'); }
    del.click();

    const dlg = await waitFor(() => $(SEL.dialog));
    if (!dlg) throw new Error('diálogo de confirmação não apareceu');
    await sleep(120);
    const buttons = $$('button', dlg).filter((b) => b.offsetParent !== null);
    // O botão de confirmação é o último (Cancelar vem primeiro)
    const confirmBtn = buttons[buttons.length - 1];
    if (!confirmBtn || buttons.length < 2) throw new Error('botões do diálogo não reconhecidos');
    confirmBtn.click();

    const gone = await waitFor(() => !document.contains(it) || !items().some((x) => idOf(x) === id), 8000);
    await waitFor(() => !$(SEL.dialog), 3000);
    if (!gone) throw new Error('a conversa não sumiu da lista');
  }

  async function bulkDelete() {
    if (state.running) return;
    const targets = items().filter((it) => state.selected.has(idOf(it)));
    if (!targets.length) return;
    const names = targets.slice(0, 8).map((t) => '• ' + titleOf(t)).join('\n') + (targets.length > 8 ? `\n… e mais ${targets.length - 8}` : '');
    if (!window.confirm(`Excluir ${targets.length} conversa(s)? Esta ação não pode ser desfeita.\n\n${names}`)) return;

    state.running = true; state.stop = false;
    const stopBtn = $('[data-act="stop"]', panel); stopBtn.style.display = ''; stopBtn.disabled = false;
    updateCount();
    let ok = 0, fail = 0;
    const errors = [];
    for (let i = 0; i < targets.length; i++) {
      if (state.stop) break;
      const it = targets[i];
      setProgress(`Excluindo ${i + 1}/${targets.length}: ${titleOf(it)}`);
      try {
        await deleteOne(it);
        state.selected.delete(idOf(it));
        ok++;
      } catch (e) {
        fail++;
        errors.push(`${titleOf(it)}: ${e.message}`);
        it.classList.remove(PREFIX + '-busy');
        // fecha menus/diálogos que possam ter ficado abertos
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(300);
      }
      updateCount();
      await sleep(250);
    }
    state.running = false;
    stopBtn.style.display = 'none';
    setProgress(`Concluído: ${ok} excluída(s), ${fail} falha(s)${state.stop ? ' (interrompido)' : ''}.` + (errors.length ? '\n' + errors.join('\n') : ''));
    decorateAll();
  }

  // ---------- Montagem / observação do DOM ----------
  let scheduled = false;
  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    // setTimeout (e não requestAnimationFrame) para funcionar em abas em segundo plano
    setTimeout(() => { scheduled = false; mount(); if (state.active) decorateAll(); }, 50);
  }

  function mount() {
    const list = $(SEL.list);
    if (!list) return;
    if (!panel) { css(); buildPanel(); }
    if (!panel.isConnected) list.insertBefore(panel, list.firstChild);
    updateCount();
  }

  const mo = new MutationObserver(scheduleDecorate);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  scheduleDecorate();
})();

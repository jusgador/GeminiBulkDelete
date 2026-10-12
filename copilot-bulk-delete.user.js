// ==UserScript==
// @name         Copilot Bulk Delete
// @namespace    https://github.com/jusgador/GeminiBulkDelete
// @version      1.0.0
// @description  Exclusão em massa de chats do Microsoft 365 Copilot: caixas de seleção, selecionar todas, selecionar dos últimos X dias.
// @author       Ricardo Campos
// @homepageURL  https://github.com/jusgador/GeminiBulkDelete
// @supportURL   https://github.com/jusgador/GeminiBulkDelete/issues
// @updateURL    https://raw.githubusercontent.com/jusgador/GeminiBulkDelete/main/copilot-bulk-delete.user.js
// @downloadURL  https://raw.githubusercontent.com/jusgador/GeminiBulkDelete/main/copilot-bulk-delete.user.js
// @match        https://m365.cloud.microsoft/*
// @grant        none
// @inject-into  page
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Seletores (M365 Copilot web, out/2026) ----------
  const SEL = {
    section: '#m365-copilot-chats-section',
    moreBtn: '[data-chat-history-more-button-conversation-id]',
    link: 'a[href*="/chat/conversation/"]',
    menuItem: '[role="menuitem"]',
    dialog: '[role="alertdialog"]',
  };
  const MORE_ATTR = 'data-chat-history-more-button-conversation-id';
  const DELETE_RE = /excluir|delete|eliminar|supprimer|löschen|elimina/i;

  const PREFIX = 'cbd';
  const state = {
    active: false,
    selected: new Set(),          // ids de chats selecionados
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

  // Cada chat da barra lateral é um div.fui-SplitNavItem com o link e os botões Fixar / Mais
  function items() {
    return $$(SEL.moreBtn).map((b) => b.closest('.fui-SplitNavItem') || b.parentElement).filter((it) => it && $(SEL.link, it));
  }

  function idOf(it) {
    const b = $(SEL.moreBtn, it);
    return b ? b.getAttribute(MORE_ATTR) : null;
  }

  function titleOf(it) {
    const a = $(SEL.link, it);
    return a ? (a.getAttribute('aria-label') || a.firstElementChild?.textContent || '').trim() : '';
  }

  function findItem(id) {
    const b = $(`[${MORE_ATTR}="${CSS.escape(id)}"]`);
    return b ? (b.closest('.fui-SplitNavItem') || b.parentElement) : null;
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  // ---------- Datas: vêm das props React do item (chatItem.updateTimeUtc) ----------
  function chatItemOf(it) {
    const a = $(SEL.link, it);
    if (!a) return null;
    const raw = a.wrappedJSObject || a;   // Firefox: atravessa o Xray se o script rodar isolado
    const key = Object.keys(raw).find((k) => k.startsWith('__reactFiber$'));
    let f = key && raw[key];
    for (let i = 0; i < 40 && f; i++) {
      const p = f.memoizedProps;
      if (p && p.chatItem && p.chatItem.conversationId) return p.chatItem;
      f = f.return;
    }
    return null;
  }

  function dateOf(it) {
    const c = chatItemOf(it);
    return c ? (c.updateTimeUtc || c.createTimeUtc || null) : null;
  }

  // ---------- UI: painel ----------
  let panel, countLabel, progress;

  function css() {
    if ($('#' + PREFIX + '-style')) return;
    const st = document.createElement('style');
    st.id = PREFIX + '-style';
    st.textContent = `
      .${PREFIX}-panel{margin:6px 8px;padding:8px;border:1px solid rgba(128,128,128,.35);border-radius:10px;font:12px/1.4 system-ui,sans-serif;color:inherit;display:flex;flex-direction:column;gap:6px}
      .${PREFIX}-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .${PREFIX}-panel button{cursor:pointer;border:1px solid rgba(128,128,128,.5);background:rgba(128,128,128,.15);color:inherit;border-radius:6px;padding:3px 8px;font:inherit}
      .${PREFIX}-panel button:hover{background:rgba(128,128,128,.3)}
      .${PREFIX}-panel button.${PREFIX}-danger{background:#b3261e;border-color:#b3261e;color:#fff}
      .${PREFIX}-panel button:disabled{opacity:.5;cursor:default}
      .${PREFIX}-panel input[type=number]{width:52px;border:1px solid rgba(128,128,128,.5);border-radius:6px;background:transparent;color:inherit;padding:2px 4px;font:inherit}
      .${PREFIX}-muted{opacity:.75}
      .${PREFIX}-cb{margin:0 6px 0 0;flex:none;align-self:center;cursor:pointer;width:14px;height:14px}
      .${PREFIX}-date{margin-left:auto;padding-left:6px;font-size:10px;opacity:.6;flex:none;align-self:center}
      .${PREFIX}-sel > a{background:rgba(66,133,244,.18)!important}
      .${PREFIX}-busy > a{opacity:.4}
    `;
    document.head.appendChild(st);
  }

  // Construção via DOM (sem innerHTML: a página usa Trusted Types)
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
  const btn = (act, text, extra) => el('button', Object.assign({ type: 'button', 'data-act': act, text }, extra || {}));
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
        btn('older', 'Mais antigos', { title: 'Seleciona os chats MAIS ANTIGOS que X dias' }),
      ], true),
      row('tools3', [
        btn('loadmore', 'Carregar todos', { title: 'Rola a lista até o fim para carregar todos os chats' }),
        btn('delete', '🗑 Excluir selecionados', { class: PREFIX + '-danger' }),
        btn('stop', '■ Parar', { style: 'display:none' }),
      ], true),
      el('div', { class: PREFIX + '-muted', 'data-role': 'progress', style: 'display:none;white-space:pre-wrap' }),
    ]);
    countLabel = $('[data-role="count"]', panel);
    progress = $('[data-role="progress"]', panel);
    panel.addEventListener('click', onPanelClick);
    // o Copilot trata teclas e foco na barra lateral (tabster); não deixa vazar do painel
    ['keydown', 'mousedown', 'pointerdown'].forEach((t) => panel.addEventListener(t, (e) => e.stopPropagation()));
    return panel;
  }

  function setToolsVisible(v) {
    ['tools', 'tools2', 'tools3'].forEach((r) => { $(`[data-role="${r}"]`, panel).style.display = v ? '' : 'none'; });
  }

  function updateCount() {
    const total = items().length;
    const txt = state.active ? `${state.selected.size} selecionado(s) de ${total} carregado(s)` : '';
    if (countLabel.textContent !== txt) countLabel.textContent = txt;
    const del = $('[data-act="delete"]', panel);
    if (del) del.disabled = state.selected.size === 0 || state.running;
  }

  async function onPanelClick(ev) {
    const b = ev.target.closest('button');
    if (!b) return;
    ev.preventDefault();
    const act = b.dataset.act;
    if (act === 'toggle') {
      state.active = !state.active;
      setToolsVisible(state.active);
      if (!state.active) { state.selected.clear(); setProgress(''); }
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
      let skipped = 0;
      items().forEach((it) => {
        const ts = dateOf(it);
        if (!ts) { skipped++; return; }
        const recent = ts >= limit;
        if (act === 'days' ? recent : !recent) state.selected.add(idOf(it));
      });
      decorateAll();
      setProgress(skipped ? `${skipped} chat(s) sem data conhecida foram ignorados.` : '');
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
    if (progress.textContent !== (msg || '')) progress.textContent = msg || '';
  }

  // ---------- UI: itens ----------
  function decorateItem(it) {
    const id = idOf(it);
    const a = $(SEL.link, it);
    if (!a || !id) return;
    let cb = $('.' + PREFIX + '-cb', a);
    let dt = $('.' + PREFIX + '-date', a);
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
      cb.tabIndex = -1;
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
      // com a seleção ativa, clicar no item alterna a caixa em vez de abrir o chat
      a.addEventListener('click', (e) => {
        if (!state.active || state.running) return;
        if (e.target === cb) return;
        e.preventDefault(); e.stopPropagation();
        cb.click();
      }, true);
    }
    cb.checked = state.selected.has(id);
    it.classList.toggle(PREFIX + '-sel', cb.checked);

    const ts = dateOf(it);
    if (ts) {
      if (!dt) { dt = document.createElement('span'); dt.className = PREFIX + '-date'; a.appendChild(dt); }
      const txt = fmtDate(ts);
      if (dt.textContent !== txt) dt.textContent = txt;
      dt.title = 'Última atividade: ' + new Date(ts).toLocaleString();
    } else if (dt) dt.remove();
  }

  function decorateAll() {
    items().forEach(decorateItem);
    updateCount();
  }

  // ---------- Carregar mais (rolagem da lista) ----------
  function scroller() {
    let e = $(SEL.section);
    while (e && e !== document.body) {
      const oy = getComputedStyle(e).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight) return e;
      e = e.parentElement;
    }
    return null;
  }

  // O Copilot carrega a lista em páginas quando o fim dela aparece na tela;
  // rola até o fim repetidamente, até a lista parar de crescer.
  async function loadMore() {
    const before = items().length;
    const sc = scroller();
    const btnLoad = $('[data-act="loadmore"]', panel);
    btnLoad.disabled = true;
    if (sc) {
      const top = sc.scrollTop;
      let last = before, idle = 0;
      for (let i = 0; i < 200 && idle < 4; i++) {
        sc.scrollTop = sc.scrollHeight;
        sc.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(700);
        const n = items().length;
        if (n > last) { last = n; idle = 0; setProgress(`Carregando… ${n} chat(s)`); } else idle++;
      }
      sc.scrollTop = top;
    }
    btnLoad.disabled = false;
    const after = items().length;
    if (after > before) setProgress(`Carregados ${after - before} chat(s) a mais (${after} no total).`);
    else setProgress('Nada novo carregado: a lista parece completa. Se houver mais chats, role a barra lateral até o fim e tente de novo.');
    decorateAll();
  }

  // ---------- Exclusão (pelo menu do próprio Copilot: Mais → Excluir → Excluir) ----------
  function closeMenus() {
    const t = document.activeElement || document.body;
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  }

  async function deleteOne(id, title) {
    let it = findItem(id);
    if (!it) throw new Error('o chat não está mais na lista');
    it.classList.add(PREFIX + '-busy');
    it.scrollIntoView({ block: 'center' });
    await sleep(80);

    const more = $(SEL.moreBtn, it);
    if (more.getAttribute('aria-expanded') !== 'true') more.click();

    const menuItems = await waitFor(() => { const m = $$(SEL.menuItem); return m.length ? m : null; });
    if (!menuItems) throw new Error('o menu "Mais" não abriu');
    const del = menuItems.find((m) => DELETE_RE.test(m.getAttribute('aria-label') || m.textContent));
    if (!del) { closeMenus(); throw new Error('item "Excluir" não apareceu no menu'); }
    del.click();

    const dlg = await waitFor(() => $(SEL.dialog));
    if (!dlg) throw new Error('diálogo de confirmação não apareceu');
    await sleep(120);
    // confere que o diálogo é deste chat antes de confirmar
    if (title && !(dlg.textContent || '').includes(title)) {
      closeMenus();
      throw new Error('o diálogo de confirmação não cita este chat; nada foi excluído');
    }
    const buttons = $$('button', dlg).filter((b) => b.offsetParent !== null);
    // O botão de confirmação é o último (Cancelar vem primeiro)
    const confirmBtn = buttons[buttons.length - 1];
    if (!confirmBtn || buttons.length < 2) throw new Error('botões do diálogo não reconhecidos');
    confirmBtn.click();

    const gone = await waitFor(() => !findItem(id), 15000, 100);
    await waitFor(() => !$(SEL.dialog), 3000);
    if (!gone) throw new Error('o chat não sumiu da lista');
  }

  async function bulkDelete() {
    if (state.running) return;
    const targets = items().filter((it) => state.selected.has(idOf(it))).map((it) => ({ id: idOf(it), title: titleOf(it) }));
    if (!targets.length) return;
    const names = targets.slice(0, 8).map((t) => '• ' + t.title).join('\n') + (targets.length > 8 ? `\n… e mais ${targets.length - 8}` : '');
    if (!window.confirm(`Excluir ${targets.length} chat(s)? Esta ação não pode ser desfeita.\n\n${names}`)) return;

    state.running = true; state.stop = false;
    const stopBtn = $('[data-act="stop"]', panel); stopBtn.style.display = ''; stopBtn.disabled = false;
    updateCount();
    let ok = 0, fail = 0;
    const errors = [];
    for (let i = 0; i < targets.length; i++) {
      if (state.stop) break;
      const t = targets[i];
      setProgress(`Excluindo ${i + 1}/${targets.length}: ${t.title}`);
      try {
        await deleteOne(t.id, t.title);
        state.selected.delete(t.id);
        ok++;
      } catch (e) {
        fail++;
        errors.push(`${t.title}: ${e.message}`);
        const it = findItem(t.id);
        if (it) it.classList.remove(PREFIX + '-busy');
        closeMenus();
        await sleep(300);
      }
      updateCount();
      await sleep(250);
    }
    state.running = false;
    stopBtn.style.display = 'none';
    setProgress(`Concluído: ${ok} excluído(s), ${fail} falha(s)${state.stop ? ' (interrompido)' : ''}.` + (errors.length ? '\n' + errors.join('\n') : ''));
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
    const sec = $(SEL.section);
    if (!sec) return;
    if (!panel) { css(); buildPanel(); }
    if (panel.parentElement !== sec) {
      // logo abaixo do cabeçalho "Chats"
      const header = $('[data-nav-scroll-section-header]', sec);
      sec.insertBefore(panel, header && header.parentElement === sec ? header.nextSibling : sec.firstChild);
    }
    updateCount();
  }

  // ignora as mudanças feitas pelo próprio script (painel, caixas e datas)
  const ours = (n) => n.nodeType === 1 && (n.classList.contains(PREFIX + '-cb') || n.classList.contains(PREFIX + '-date'));
  const mo = new MutationObserver((muts) => {
    if (muts.every((m) => (panel && panel.contains(m.target)) || [...m.addedNodes, ...m.removedNodes].every(ours))) return;
    scheduleDecorate();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  scheduleDecorate();
})();

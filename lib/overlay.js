/**
 * In-page picker overlay.
 *
 * Injected twice: as `Page.addScriptToEvaluateOnNewDocument` (so it survives
 * navigation) and immediately via `Runtime.evaluate` for the page already open.
 * It talks back through a CDP `Runtime.addBinding` function, which keeps the
 * channel independent of CORS / mixed content / page CSP.
 */

/** Name of the CDP binding the page calls to report a pick. */
export const BINDING_NAME = '__dshVisualPicker';

/** Runs in the page's main world. Keep it dependency-free and idempotent. */
export const OVERLAY_SCRIPT = String.raw`(() => {
  var W = window;
  if (W.__DSH_VP__ && W.__DSH_VP__.version === 1) { try { W.__DSH_VP__.reattach(); } catch (e) {} return; }

  var HOST_ID = '__dsh-vp-root';
  var BINDING = '${BINDING_NAME}';
  var state = { version: 1, mode: 'off', seq: 0, locked: false, target: null, clicks: 0, moves: 0 };
  var nodes = {};
  var lastFocused = null;
  var hlTimer = 0;

  function send(payload) {
    var fn = W[BINDING];
    if (typeof fn === 'function') {
      try { fn(JSON.stringify(payload)); return true; } catch (e) {}
    }
    var q = W.__DSH_VP_QUEUE__ = W.__DSH_VP_QUEUE__ || [];
    q.push(payload);
    return false;
  }

  function flush() {
    var q = W.__DSH_VP_QUEUE__ = W.__DSH_VP_QUEUE__ || [];
    if (!q.length) return;
    var fn = W[BINDING];
    if (typeof fn !== 'function') return;
    var items = q.splice(0, q.length);
    for (var i = 0; i < items.length; i++) { try { fn(JSON.stringify(items[i])); } catch (e) {} }
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + (W.CSS && CSS.escape ? CSS.escape(el.id) : el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      var part = node.localName;
      if (node.classList && node.classList.length) {
        var cls = [];
        for (var i = 0; i < node.classList.length && cls.length < 2; i++) {
          var c = node.classList[i];
          if (c && c.length < 32) cls.push(W.CSS && CSS.escape ? CSS.escape(c) : c);
        }
        if (cls.length) part += '.' + cls.join('.');
      }
      var parent = node.parentElement;
      if (parent) {
        var same = [];
        for (var j = 0; j < parent.children.length; j++) {
          if (parent.children[j].localName === node.localName) same.push(parent.children[j]);
        }
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      if (parent && parent.id) { parts.unshift('#' + (W.CSS && CSS.escape ? CSS.escape(parent.id) : parent.id)); break; }
      node = parent;
    }
    return parts.join(' > ');
  }

  function describe(el) {
    var rect = el.getBoundingClientRect();
    var text = '';
    try {
      text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
    } catch (e) { text = ''; }
    var classes = [];
    try { for (var i = 0; i < el.classList.length && i < 8; i++) classes.push(el.classList[i]); } catch (e) {}
    var html = '';
    try { html = el.outerHTML.slice(0, 600); } catch (e) {}
    return {
      kind: 'pick',
      selector: cssPath(el),
      tag: el.localName,
      id: el.id || '',
      classes: classes,
      text: text.slice(0, 200),
      html: html,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      pageRect: { x: rect.x + W.scrollX, y: rect.y + W.scrollY, width: rect.width, height: rect.height },
      url: location.href,
      title: document.title,
      dpr: W.devicePixelRatio || 1
    };
  }

  function ensureUI() {
    if (document.getElementById(HOST_ID)) return true;
    if (!document.body) return false;
    var host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-dsh-visual-annotator', '1');
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = [
      '<style>',
      '.box{position:fixed;pointer-events:none;border:2px solid #2f81f7;background:rgba(47,129,247,.16);border-radius:3px;box-sizing:border-box;display:none}',
      '.lbl{position:fixed;pointer-events:none;background:#1f6feb;color:#fff;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 8px;border-radius:4px;max-width:64vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none;box-shadow:0 2px 8px rgba(0,0,0,.25)}',
      '.badge{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);pointer-events:none;background:#111827ee;color:#fff;font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;padding:8px 15px;border-radius:999px;box-shadow:0 6px 22px rgba(0,0,0,.35);display:none;white-space:nowrap}',
      '.card{--vp-bg:#fff;--vp-fg:#111827;--vp-sub:#6b7280;--vp-border:#d0d7de;--vp-btnbg:#f6f8fa;--vp-acc:#1f6feb;position:fixed;pointer-events:auto;width:min(308px,calc(100vw - 16px));background:var(--vp-bg);color:var(--vp-fg);border-radius:10px;box-shadow:0 12px 44px rgba(0,0,0,.35);font:13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:11px;display:none;box-sizing:border-box}',
      '@media (prefers-color-scheme: dark){.card{--vp-bg:#161b22;--vp-fg:#e6edf3;--vp-sub:#8b949e;--vp-border:#30363d;--vp-btnbg:#21262d;--vp-acc:#2f81f7}}',
      '.card.dark{--vp-bg:#161b22;--vp-fg:#e6edf3;--vp-sub:#8b949e;--vp-border:#30363d;--vp-btnbg:#21262d;--vp-acc:#2f81f7}',
      '.card h4{margin:0 0 6px;font-size:13px;color:var(--vp-sub);font-weight:600}',
      '.card .sel{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--vp-acc);word-break:break-all;margin-bottom:8px;max-height:50px;overflow:hidden}',
      '.card textarea{width:100%;height:66px;box-sizing:border-box;border:1px solid var(--vp-border);border-radius:6px;padding:6px 8px;font:13px/1.45 system-ui,sans-serif;resize:vertical;outline:none;display:block;background:var(--vp-bg);color:var(--vp-fg)}',
      '.card textarea:focus{border-color:var(--vp-acc);box-shadow:0 0 0 3px rgba(47,129,247,.18)}',
      '.card .row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}',
      '.card button{font:13px/1 system-ui,sans-serif;padding:8px 13px;border-radius:6px;border:1px solid var(--vp-border);background:var(--vp-btnbg);color:var(--vp-fg);cursor:pointer}',
      '.card button.pri{background:var(--vp-acc);border-color:var(--vp-acc);color:#fff}',
      'html.__dsh-vp-pick, html.__dsh-vp-pick *{cursor:crosshair !important}',
      '</style>',
      '<div class="box"></div>',
      '<div class="lbl"></div>',
      '<div class="badge"></div>',
      '<div class="card" role="dialog" aria-modal="true" aria-label="页面元素标注"><h4>指哪改哪</h4><div class="sel"></div>',
      '<textarea placeholder="说明你想怎么改：字号 / 间距 / 文案 / 颜色 / 布局…"></textarea>',
      '<div class="row"><button class="cancel">取消</button><button class="pri">添加标注</button></div></div>'
    ].join('');
    document.body.appendChild(host);
    nodes.host = host;
    nodes.box = shadow.querySelector('.box');
    nodes.lbl = shadow.querySelector('.lbl');
    nodes.badge = shadow.querySelector('.badge');
    nodes.card = shadow.querySelector('.card');
    nodes.sel = shadow.querySelector('.sel');
    nodes.text = shadow.querySelector('textarea');
    shadow.querySelector('.cancel').addEventListener('click', function (e) { e.preventDefault(); cancel(); });
    shadow.querySelector('.pri').addEventListener('click', function (e) { e.preventDefault(); commit(); });
    nodes.text.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      e.stopPropagation();
    });
    nodes.card.addEventListener('keydown', onCardKey);
    render();
    return true;
  }

  function ready() {
    if (nodes.host) return true;
    return ensureUI();
  }

  function render() {
    if (!nodes.host) return;
    var on = state.mode === 'pick';
    document.documentElement.classList.toggle('__dsh-vp-pick', on);
    if (!on) {
      nodes.box.style.display = 'none';
      nodes.lbl.style.display = 'none';
      nodes.badge.style.display = 'none';
    } else {
      nodes.badge.style.display = 'block';
      nodes.badge.textContent = state.locked
        ? '✎ 写标注中 · Ctrl/⌘+Enter 添加 · Esc 取消'
        : '🎯 标注模式 · 点击元素 · Esc 退出 · 已标注 ' + state.seq + ' 处';
    }
    if (!on) hideCard();
  }

  function closeCard() {
    if (nodes.card) nodes.card.style.display = 'none';
    var restore = lastFocused;
    lastFocused = null;
    if (restore && typeof restore.focus === 'function') { try { restore.focus(); } catch (e) {} }
  }

  function hideCard() {
    state.locked = false;
    state.target = null;
    closeCard();
    render();
  }

  function cancel() { hideCard(); }

  function commit() {
    if (!state.target) return hideCard();
    var payload = state.target;
    payload.comment = (nodes.text && nodes.text.value || '').trim();
    payload.seq = ++state.seq;
    state.locked = false;
    state.target = null;
    nodes.text.value = '';
    nodes.box.style.display = 'none';
    nodes.lbl.style.display = 'none';
    closeCard();
    send(payload);
    render();
  }

  function placeCard(rect) {
    var card = nodes.card;
    // Follow an explicit page theme (html[data-theme]) on top of the media query.
    try { card.classList.toggle('dark', document.documentElement.getAttribute('data-theme') === 'dark'); } catch (e) {}
    lastFocused = document.activeElement;
    card.style.display = 'block';
    var box = card.getBoundingClientRect();
    var vw = W.innerWidth || 1200;
    var vh = W.innerHeight || 800;
    var w = box.width || 308;
    var h = box.height || 190;
    var left = Math.min(Math.max(8, rect.x), Math.max(8, vw - w - 8));
    var top = rect.y + rect.height + 8;
    if (top + h > vh - 8) top = Math.max(8, rect.y - h - 8);
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    nodes.text.focus();
  }

  function cardFocusables() {
    if (!nodes.card) return [];
    var list = [];
    var els = nodes.card.querySelectorAll('textarea, button');
    for (var i = 0; i < els.length; i++) list.push(els[i]);
    return list;
  }

  function onCardKey(e) {
    if (e.key !== 'Tab') return;
    var items = cardFocusables();
    if (!items.length) return;
    var index = items.indexOf(document.activeElement);
    if (index < 0) index = 0;
    var next = e.shiftKey ? (index - 1 + items.length) % items.length : (index + 1) % items.length;
    e.preventDefault();
    items[next].focus();
  }

  function clearHover() {
    if (!nodes.box) return;
    nodes.box.style.display = 'none';
    nodes.lbl.style.display = 'none';
  }

  function highlight(opts) {
    opts = opts || {};
    if (!ready()) return false;
    var rect = null;
    if (opts.selector) {
      var el = null;
      try { el = document.querySelector(String(opts.selector)); } catch (e) { el = null; }
      if (el && el.nodeType === 1) {
        try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
        rect = el.getBoundingClientRect();
      }
    }
    if (!rect && opts.pageRect) {
      var pr = opts.pageRect;
      try { W.scrollTo(pr.x - 120, pr.y - 120); } catch (e) {}
      rect = { x: pr.x - W.scrollX, y: pr.y - W.scrollY, width: pr.width, height: pr.height };
    }
    if (!rect || !rect.width || !rect.height) return false;
    nodes.box.style.display = 'block';
    nodes.box.style.left = rect.x + 'px';
    nodes.box.style.top = rect.y + 'px';
    nodes.box.style.width = rect.width + 'px';
    nodes.box.style.height = rect.height + 'px';
    nodes.lbl.style.display = 'block';
    nodes.lbl.textContent = String(opts.label || '');
    var lblTop = rect.y - 22;
    nodes.lbl.style.left = Math.max(4, rect.x) + 'px';
    nodes.lbl.style.top = (lblTop < 4 ? rect.y + 2 : lblTop) + 'px';
    if (hlTimer) { clearTimeout(hlTimer); hlTimer = 0; }
    hlTimer = setTimeout(function () {
      nodes.box.style.display = 'none';
      nodes.lbl.style.display = 'none';
      hlTimer = 0;
    }, 1800);
    return true;
  }

  function onMove(e) {
    if (state.mode !== 'pick' || state.locked) return;
    if (!ready()) return;
    var el = e.target;
    if (!el || el.nodeType !== 1 || el === nodes.host) return;
    if (el.id === HOST_ID || (el.closest && el.closest('#' + HOST_ID))) return;
    var rect = el.getBoundingClientRect();
    nodes.box.style.display = 'block';
    nodes.box.style.left = rect.x + 'px';
    nodes.box.style.top = rect.y + 'px';
    nodes.box.style.width = rect.width + 'px';
    nodes.box.style.height = rect.height + 'px';
    nodes.lbl.style.display = 'block';
    nodes.lbl.textContent = el.localName + (el.id ? '#' + el.id : '') + ' · ' + Math.round(rect.width) + '×' + Math.round(rect.height);
    var lblTop = rect.y - 22;
    nodes.lbl.style.left = Math.max(4, rect.x) + 'px';
    nodes.lbl.style.top = (lblTop < 4 ? rect.y + 2 : lblTop) + 'px';
  }

  function onClick(e) {
    state.clicks++;
    if (state.mode !== 'pick' || state.locked) return;
    if (!ready()) return;
    var el = e.target;
    if (!el || el.nodeType !== 1 || el.id === HOST_ID) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      state.target = describe(el);
      state.locked = true;
      nodes.sel.textContent = state.target.selector;
      nodes.text.value = '';
      placeCard(state.target.rect);
      render();
    } catch (err) {
      state.locked = false;
      state.target = null;
      W.__DSH_VP_LAST_ERROR__ = String((err && err.stack) || err);
    }
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (state.locked) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    if (state.mode === 'pick') { e.preventDefault(); e.stopPropagation(); setMode('off'); }
  }

  function setMode(mode) {
    state.mode = mode === 'pick' ? 'pick' : 'off';
    if (state.mode === 'pick') ready();
    if (state.mode !== 'pick') hideCard();
    if (nodes.host) {
      nodes.host.style.pointerEvents = 'none';
      clearHover();
    }
    render();
    if (state.mode === 'pick') flush();
  }

  function reattach() {
    if (document.body) ensureUI();
    render();
    flush();
  }

  W.__DSH_VP__ = {
    version: 1,
    setMode: setMode,
    getMode: function () { return state.mode; },
    reattach: reattach,
    flush: flush,
    highlight: highlight,
    flash: function (message) {
      if (!nodes.host) return;
      nodes.badge.style.display = 'block';
      nodes.badge.textContent = String(message || '');
    }
  };

  W.__DSH_VP_DEBUG__ = function () {
    return { mode: state.mode, locked: state.locked, seq: state.seq, clicks: state.clicks, ui: !!nodes.host, error: W.__DSH_VP_LAST_ERROR__ || null };
  };

  W.addEventListener('mousemove', onMove, true);
  W.addEventListener('click', onClick, true);
  W.addEventListener('keydown', onKey, true);

  if (document.body) ensureUI(); else document.addEventListener('DOMContentLoaded', function () { ensureUI(); }, { once: true });
})();`;

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
      '.lbl{position:fixed;pointer-events:none;background:#1f6feb;color:#fff;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;padding:2px 7px;border-radius:4px;max-width:64vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none;box-shadow:0 2px 8px rgba(0,0,0,.25)}',
      '.badge{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);pointer-events:none;background:#111827ee;color:#fff;font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;padding:7px 14px;border-radius:999px;box-shadow:0 6px 22px rgba(0,0,0,.35);display:none;white-space:nowrap}',
      '.card{position:fixed;pointer-events:auto;width:308px;background:#fff;color:#111827;border-radius:10px;box-shadow:0 12px 44px rgba(0,0,0,.35);font:13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:11px;display:none;box-sizing:border-box}',
      '.card h4{margin:0 0 6px;font-size:12px;color:#6b7280;font-weight:600}',
      '.card .sel{font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#1f6feb;word-break:break-all;margin-bottom:8px;max-height:44px;overflow:hidden}',
      '.card textarea{width:100%;height:66px;box-sizing:border-box;border:1px solid #d0d7de;border-radius:6px;padding:6px 8px;font:13px/1.45 system-ui,sans-serif;resize:vertical;outline:none;display:block}',
      '.card textarea:focus{border-color:#2f81f7;box-shadow:0 0 0 3px rgba(47,129,247,.18)}',
      '.card .row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}',
      '.card button{font:12px/1 system-ui,sans-serif;padding:7px 12px;border-radius:6px;border:1px solid #d0d7de;background:#f6f8fa;color:#111827;cursor:pointer}',
      '.card button.pri{background:#1f6feb;border-color:#1f6feb;color:#fff}',
      'html.__dsh-vp-pick, html.__dsh-vp-pick *{cursor:crosshair !important}',
      '</style>',
      '<div class="box"></div>',
      '<div class="lbl"></div>',
      '<div class="badge"></div>',
      '<div class="card"><h4>页面圈点</h4><div class="sel"></div>',
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

  function hideCard() {
    state.locked = false;
    state.target = null;
    if (nodes.card) nodes.card.style.display = 'none';
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
    nodes.card.style.display = 'none';
    nodes.box.style.display = 'none';
    nodes.lbl.style.display = 'none';
    send(payload);
    render();
  }

  function placeCard(rect) {
    var card = nodes.card;
    card.style.display = 'block';
    var vw = W.innerWidth || 1200;
    var vh = W.innerHeight || 800;
    var w = 308;
    var h = card.offsetHeight || 190;
    var left = Math.min(Math.max(8, rect.x), vw - w - 8);
    var top = rect.y + rect.height + 8;
    if (top + h > vh - 8) top = Math.max(8, rect.y - h - 8);
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    nodes.text.focus();
  }

  function clearHover() {
    if (!nodes.box) return;
    nodes.box.style.display = 'none';
    nodes.lbl.style.display = 'none';
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

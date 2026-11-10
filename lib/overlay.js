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
  // Bumped whenever the page-side logic changes: the script is injected twice per
  // document (new-document preload + evaluate on the open page), so a newer build
  // must be able to take over an older instance instead of leaving its listeners
  // in charge for the rest of the page's life.
  var REV = 10;
  var HOST_ID = '__dsh-vp-root';
  if (W.__DSH_VP__ && W.__DSH_VP__.rev === REV) { try { W.__DSH_VP__.reattach(); } catch (e) {} return; }
  if (W.__DSH_VP__) { try { if (W.__DSH_VP__.dispose) W.__DSH_VP__.dispose(); } catch (e) {} }
  var stale = document.getElementById(HOST_ID);
  if (stale && stale.parentNode) { try { stale.parentNode.removeChild(stale); } catch (e) {} }

  var BINDING = '${BINDING_NAME}';
  var state = { version: 3, rev: REV, mode: 'off', seq: 0, count: null, locked: false, target: null, clicks: 0, moves: 0, guarded: 0, restored: 0 };
  var nodes = {};
  // macOS 的 Option 是组合键：按 Option+A 产出的是 å 而非 a，快捷键判定要按物理键
  // code=KeyA，提示文案也要按平台区分（⌥Option+A / Alt+A）。
  var MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  var HOTKEY = MAC ? '⌥ A' : 'Alt A';
  var bound = [];
  var lastFocused = null;
  var hlTimer = 0;
  var focusTimer = 0;
  var noteTimer = 0;

  function on(target, type, fn, capture) {
    target.addEventListener(type, fn, !!capture);
    bound.push([target, type, fn, !!capture]);
  }

  function dispose() {
    for (var i = 0; i < bound.length; i++) {
      try { bound[i][0].removeEventListener(bound[i][1], bound[i][2], bound[i][3]); } catch (e) {}
    }
    bound.length = 0;
    stopFocusKeeper();
    if (hlTimer) { clearTimeout(hlTimer); hlTimer = 0; }
    if (nodes.host && nodes.host.parentNode) { try { nodes.host.parentNode.removeChild(nodes.host); } catch (e) {} }
    nodes = {};
    state.locked = false;
    state.target = null;
    state.mode = 'off';
  }

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
      ':host{--vp-acc:#ff7a45;--vp-acc-warm:#ffb08a;--vp-fg:#f6efe7;--vp-line:rgba(255,196,160,.16);--vp-ease:cubic-bezier(.16,1,.3,1);--vp-sans:ui-sans-serif,-apple-system,"Segoe UI Variable Text","Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;--vp-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}',
      // 拾取高亮：暖朱砂细线 + 柔和填空 + 左上/右下两个裁切标记，像设计工具而不是调试框。
      '.box{position:fixed;pointer-events:none;display:none;box-sizing:border-box;border:1.5px solid var(--vp-acc);border-radius:7px;background:rgba(255,122,69,.09);box-shadow:0 12px 30px -12px rgba(255,122,69,.55)}',
      '.box::before,.box::after{content:"";position:absolute;width:9px;height:9px;border:2px solid var(--vp-acc)}',
      '.box::before{left:-4px;top:-4px;border-right:0;border-bottom:0;border-radius:3px 0 0 0}',
      '.box::after{right:-4px;bottom:-4px;border-left:0;border-top:0;border-radius:0 0 3px 0}',
      // 标注中保持高亮：hover 框会被 render() 清掉，用户打字时就看不见自己点的是哪个元素了。
      '.mark{position:fixed;pointer-events:none;display:none;box-sizing:border-box;border:1.5px solid var(--vp-acc);border-radius:7px;background:rgba(255,122,69,.1);box-shadow:0 0 0 4px rgba(255,122,69,.1)}',
      '.lbl{position:fixed;pointer-events:none;display:none;max-width:64vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 12px/1.35 var(--vp-mono);letter-spacing:.01em;padding:5px 9px;border-radius:8px;color:#ffc9b4;background:#1b1210;border:1px solid rgba(255,122,69,.42);box-shadow:0 8px 20px -8px rgba(0,0,0,.6)}',
      '.hud{position:fixed;right:16px;bottom:16px;display:none;font:13px/1.35 var(--vp-sans);color:var(--vp-fg);-webkit-font-smoothing:antialiased}',
      '.cluster,.pill{pointer-events:auto;white-space:nowrap;border:1px solid var(--vp-line);background:linear-gradient(180deg,rgba(38,29,24,.94),rgba(22,16,14,.96));-webkit-backdrop-filter:blur(18px) saturate(150%);backdrop-filter:blur(18px) saturate(150%);box-shadow:0 20px 48px -18px rgba(0,0,0,.8),0 1px 0 rgba(255,255,255,.06) inset}',
      '.cluster{display:none;align-items:center;gap:9px;padding:7px 7px 7px 14px;border-radius:15px}',
      '.cluster .met{display:flex;align-items:center;gap:7px;font-size:12px;color:#c2b5a8;letter-spacing:.01em}',
      '.cluster .dot{width:7px;height:7px;border-radius:50%;background:var(--vp-acc);box-shadow:0 0 0 3px rgba(255,122,69,.16)}',
      '.cluster .cnt{color:var(--vp-fg);font-weight:650;font-variant-numeric:tabular-nums}',
      '.pill{display:none;align-items:center;gap:9px;padding:9px 13px;border-radius:13px;cursor:pointer;transition:transform .16s var(--vp-ease),border-color .16s var(--vp-ease)}',
      '.pill:hover{transform:translateY(-1px);border-color:rgba(255,122,69,.5)}',
      '.pill .go{font-weight:600;color:var(--vp-fg)}',
      '.pill .go::before{content:"";display:inline-block;width:7px;height:7px;margin-right:8px;border-radius:50%;background:var(--vp-acc);box-shadow:0 0 0 3px rgba(255,122,69,.16);vertical-align:1px}',
      '.pill .c{margin-left:2px;padding-left:11px;border-left:1px solid rgba(255,255,255,.11);color:#8e8378;font-size:11.5px}',
      '.hud .k{font:600 10.5px/1 var(--vp-mono);letter-spacing:.04em;color:#c2b5a8;padding:3px 6px;border-radius:6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14)}',
      '.hud button{font:inherit;font-size:12px;font-weight:550;color:#ede3d9;padding:7px 11px;border-radius:9px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.1);cursor:pointer;transition:background .14s,border-color .14s,transform .14s}',
      '.hud button .k{margin-left:6px;background:rgba(0,0,0,.22);border-color:rgba(255,255,255,.12);color:#ffc9b4}',
      '.hud button:hover:not(:disabled){background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.2)}',
      '.hud button:active:not(:disabled){transform:translateY(1px)}',
      '.hud button.pri{color:#1b1108;font-weight:650;background:var(--vp-acc);border-color:transparent;box-shadow:0 8px 18px -10px rgba(255,122,69,.9)}',
      '.hud button.pri:hover:not(:disabled){background:#ff8f5f}',
      '.hud button.pri .k{background:rgba(0,0,0,.16);border-color:rgba(0,0,0,.14);color:#3a1c0e}',
      '.hud button:disabled{opacity:.4;cursor:default}',
      '.hud button:focus-visible,.pill:focus-visible{outline:2px solid var(--vp-acc-warm);outline-offset:2px}',
      // 标注卡固定一套暖墨切面：跟随页面明暗会在深色站点糊成一片，也让卡片失去自己的身份。
      '.card{position:fixed;pointer-events:auto;display:none;box-sizing:border-box;width:min(364px,calc(100vw - 24px));padding:16px;border-radius:16px;color:var(--vp-fg);font:13.5px/1.55 var(--vp-sans);background:linear-gradient(180deg,#261d18 0%,#191210 100%);border:1px solid var(--vp-line);box-shadow:0 30px 68px -20px rgba(0,0,0,.85),0 2px 10px rgba(0,0,0,.35),0 1px 0 rgba(255,255,255,.07) inset;animation:vpCardIn .18s var(--vp-ease);-webkit-font-smoothing:antialiased}',
      '@keyframes vpCardIn{from{opacity:0;transform:translateY(7px) scale(.985)}to{opacity:1;transform:none}}',
      // 小尖角把卡片和目标元素连起来：卡片可能在元素上方或下方，两种朝向都要能贴边。
      '.card::before{content:"";position:absolute;width:12px;height:12px;transform:rotate(45deg);display:none}',
      '.card.below::before,.card.above::before{display:block}',
      '.card.below::before{top:-6.5px;left:var(--vp-notch,24px);background:#261d18;border-left:1px solid var(--vp-line);border-top:1px solid var(--vp-line)}',
      '.card.above::before{bottom:-6.5px;left:var(--vp-notch,24px);background:#191210;border-right:1px solid var(--vp-line);border-bottom:1px solid var(--vp-line)}',
      '@media (prefers-reduced-motion:reduce){.card{animation:none}.pill,.hud button,.card textarea{transition:none}}',
      '.card .hd{display:flex;align-items:center;gap:8px;margin-bottom:10px}',
      '.card .idx{font:650 11.5px/1 var(--vp-mono);letter-spacing:.06em;font-variant-numeric:tabular-nums;color:#ffc9b4;padding:5px 7px;border-radius:7px;background:rgba(255,122,69,.14);border:1px solid rgba(255,122,69,.32)}',
      '.card .tag{font:600 12px/1 var(--vp-mono);color:var(--vp-fg);padding:5px 8px;border-radius:7px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.card .dim{font:12px/1 var(--vp-mono);font-variant-numeric:tabular-nums;letter-spacing:.02em;color:#a2958a}',
      '.card .copy{margin-left:auto;font:600 12px/1 var(--vp-sans);color:#cbbdae;height:26px;padding:0 10px;border-radius:8px;background:transparent;border:1px solid rgba(255,255,255,.1);cursor:pointer;transition:color .14s,border-color .14s,background .14s}',
      '.card .copy:hover{color:#fff;border-color:rgba(255,122,69,.5);background:rgba(255,122,69,.1)}',
      '.card .sel{font:12px/1.5 var(--vp-mono);color:#c0b2a4;word-break:break-all;max-height:40px;overflow:hidden;margin-bottom:10px;padding:6px 9px;border-radius:8px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06)}',
      '.card .quote{position:relative;display:none;font:13px/1.55 var(--vp-sans);color:#cfc1b3;padding:8px 11px 8px 27px;margin-bottom:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:9px;background:rgba(255,255,255,.04);box-shadow:inset 0 0 0 1px rgba(255,255,255,.045)}',
      '.card .quote::before{content:"\\201C";position:absolute;left:10px;top:4px;font:700 24px/1 Georgia,"Songti SC","Times New Roman",serif;color:rgba(255,122,69,.78)}',
      '.card textarea{display:block;width:100%;min-height:80px;max-height:200px;box-sizing:border-box;padding:10px 12px;border-radius:11px;resize:none;outline:none;font:13.5px/1.6 var(--vp-sans);color:var(--vp-fg);background:rgba(9,6,5,.5);border:1px solid rgba(255,255,255,.1);caret-color:var(--vp-acc);transition:border-color .14s,box-shadow .14s}',
      '.card textarea::placeholder{color:#8b7f73}',
      '.card textarea:focus{border-color:rgba(255,122,69,.55);box-shadow:0 0 0 3px rgba(255,122,69,.15)}',
      '.card .row{display:flex;align-items:center;gap:8px;margin-top:14px}',
      // 取消与添加同高 42px：此前一个 42 一个 45，边缘各差 1.5px，看着像没对齐。
      '.card .row button{height:42px}',
      '.card .hint{display:inline-flex;align-items:center;margin-right:auto;font:12px/1.35 var(--vp-sans);color:#c2b4a6;white-space:nowrap}',
      '.card button{font:inherit;font-size:13px;font-weight:550;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;padding:0 16px;line-height:1;border-radius:10px;color:#ede3d9;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);cursor:pointer;transition:background .14s,border-color .14s,transform .14s}',
      '.card button:active{transform:translateY(1px)}',
      '.card button.cancel{padding:0 14px;color:#c9bcae;background:transparent;border-color:rgba(255,255,255,.09)}',
      '.card button.cancel:hover{color:var(--vp-fg);background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.16)}',
      '.card button.pri{padding:0 15px;color:#1b1108;font-weight:650;background:var(--vp-acc);border-color:transparent;box-shadow:0 10px 22px -12px rgba(255,122,69,.95)}',
      '.card button.pri:hover{background:#ff8f5f}',
      '.card .keys{display:inline-flex;align-items:center;gap:4px;margin-left:9px}',
      '.card button .k{display:inline-flex;align-items:center;height:20px;padding:0 7px;font:650 12px/1 var(--vp-mono);border-radius:6px;background:rgba(0,0,0,.3);border:1px solid rgba(0,0,0,.22);color:#ffeadd}',
      '.card button .k.sym{font:600 13px/1 var(--vp-sans);padding:0 6px;letter-spacing:0}',
      '.card .hint .k{font:600 11px/1 var(--vp-mono);padding:4px 6px;border-radius:6px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#d8cabc}',
      '.card button:focus-visible{outline:2px solid var(--vp-acc-warm);outline-offset:2px}',
      '.note{position:fixed;right:16px;bottom:62px;display:none;max-width:70vw;pointer-events:none;font:12px/1.4 var(--vp-sans);color:var(--vp-fg);padding:7px 12px;border-radius:10px;background:#1b1210;border:1px solid var(--vp-line);box-shadow:0 14px 30px -14px rgba(0,0,0,.8)}',
      'html.__dsh-vp-pick,html.__dsh-vp-pick *{cursor:crosshair !important}',
      '</style>',
      '<div class="box"></div>',
      '<div class="mark"></div>',
      '<div class="lbl"></div>',
      '<div class="hud">',
      '<div class="cluster" role="toolbar" aria-label="标注控制台">',
      '<span class="met"><span class="dot"></span>已标注 <b class="cnt">0</b> 处</span>',
      '<button class="pause" type="button" title="暂停标注（Esc）">暂停<span class="k">Esc</span></button>',
      '<button class="undo" type="button" title="撤销最近一条标注">撤销</button>',
      '<button class="pri done" type="button" title="把全部标注插入 DSH 对话">完成并插入</button>',
      '</div>',
      '<div class="pill" role="button" tabindex="0" aria-label="开启标注模式" title="开启标注模式：点击页面元素即可标注（快捷键 ' + HOTKEY + '）">',
      '<span class="go">开启标注</span>',
      '<span class="k">' + HOTKEY + '</span>',
      '<span class="c">已标注 <b class="pcnt">0</b> 处</span>',
      '</div>',
      '</div>',
      '<div class="note"></div>',
      '<div class="card" role="dialog" aria-label="页面元素标注">',
      '<div class="hd"><span class="idx">01</span><span class="tag"></span><span class="dim"></span><button class="copy" type="button" title="复制选择器">复制</button></div>',
      '<div class="sel"></div>',
      '<div class="quote"></div>',
      '<textarea autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="说明怎么改：字号 / 间距 / 颜色 / 文案 / 布局…"></textarea>',
      '<div class="row"><span class="hint" title="按 Esc 取消这次标注"><span class="k">Esc</span></span><button class="cancel" type="button">取消</button><button class="pri" type="button">添加标注<span class="keys"></span></button></div>',
      '</div>',
    ].join('');
    document.body.appendChild(host);
    nodes.host = host;
    nodes.box = shadow.querySelector('.box');
    nodes.mark = shadow.querySelector('.mark');
    nodes.lbl = shadow.querySelector('.lbl');
    nodes.hud = shadow.querySelector('.hud');
    nodes.cluster = shadow.querySelector('.cluster');
    nodes.cnt = shadow.querySelector('.cnt');
    nodes.pill = shadow.querySelector('.pill');
    nodes.pcnt = shadow.querySelector('.pcnt');
    nodes.pauseBtn = shadow.querySelector('button.pause');
    nodes.undoBtn = shadow.querySelector('button.undo');
    nodes.doneBtn = shadow.querySelector('button.done');
    nodes.note = shadow.querySelector('.note');
    nodes.card = shadow.querySelector('.card');
    nodes.sel = shadow.querySelector('.sel');
    nodes.idx = shadow.querySelector('.idx');
    nodes.tag = shadow.querySelector('.tag');
    nodes.dim = shadow.querySelector('.dim');
    nodes.quote = shadow.querySelector('.quote');
    nodes.copyBtn = shadow.querySelector('button.copy');
    nodes.text = shadow.querySelector('textarea');
    // 卡片里的两个键位提示按平台渲染，避免 macOS 上写成 Ctrl 让人按错。
    // 提交快捷键拆成独立键帽：⌘ 与 ↵ 挤在一个键帽里会糊成一块，看不清是什么键。
    // ↵（U+21B5）在 12px 等宽字体里细得几乎看不出是个键，Mac 用更粗的 ⏎（U+23CE）。
    var keys = MAC ? ['⌘', '⏎'] : ['Ctrl', 'Enter'];
    var keysHTML = keys.map(function (k) { return '<span class="k' + (k.length === 1 ? ' sym' : '') + '">' + k + '</span>'; }).join('');
    shadow.querySelector('.card .keys').innerHTML = keysHTML;
    shadow.querySelector('.card button.pri').title = '提交这张标注（' + (MAC ? '⌘ Enter' : 'Ctrl Enter') + '）';
    on(shadow.querySelector('.cancel'), 'click', function (e) { e.preventDefault(); cancel(); }, false);
    on(nodes.copyBtn, 'click', function (e) { e.preventDefault(); e.stopPropagation(); copySelector(); }, false);
    on(nodes.text, 'input', autosizeText, false);
    // 必须限定 .card：HUD 的完成按钮也带 .pri 且排在卡片按钮之前，
    // 裸的 '.pri' 会把提交事件绑到完成按钮上，「添加标注」就没了反应。
    on(shadow.querySelector('.card button.pri'), 'click', function (e) { e.preventDefault(); commit(); }, false);
    on(nodes.text, 'keydown', onTextKey, false);
    on(nodes.text, 'beforeinput', onBeforeInput, false);
    on(nodes.card, 'keydown', onCardKey, false);
    // Clicks inside the card belong to the card: page-level "click outside" handlers
    // must not close modals or navigate while the user is writing an annotation.
    var keepLocal = function (e) { e.stopPropagation(); };
    on(nodes.card, 'mousedown', keepLocal, false);
    on(nodes.card, 'mouseup', keepLocal, false);
    on(nodes.card, 'click', keepLocal, false);
    // HUD 交互与标注卡同理：点按事件留在控件里，页面自己的弹层/跳转不能被触发。
    // Esc / 暂停 / 折叠胶囊走 setMode（经 binding 上报 host）；撤销与完成直接发消息。
    on(nodes.pauseBtn, 'click', function (e) { e.preventDefault(); e.stopPropagation(); setMode('off'); }, false);
    on(nodes.undoBtn, 'click', function (e) { e.preventDefault(); e.stopPropagation(); send({ kind: 'undo' }); }, false);
    on(nodes.doneBtn, 'click', function (e) { e.preventDefault(); e.stopPropagation(); send({ kind: 'consume' }); }, false);
    on(nodes.pill, 'click', function (e) { e.preventDefault(); e.stopPropagation(); setMode('pick'); }, false);
    on(nodes.pill, 'keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      setMode('pick');
    }, false);
    var keepHud = function (e) { e.stopPropagation(); };
    on(nodes.hud, 'mousedown', keepHud, false);
    on(nodes.hud, 'mouseup', keepHud, false);
    on(nodes.hud, 'click', keepHud, false);
    render();
    return true;
  }

  function ready() {
    if (nodes.host) return true;
    return ensureUI();
  }

  /**
   * True when the event was produced inside our shadow card. Shadow DOM retargets
   * events to the host element as they cross the boundary, so the page sees a plain
   * <div> instead of the textarea it expects.
   */
  function inCard(e) {
    var host = nodes.host;
    if (!host) return false;
    if (typeof e.composedPath === 'function') {
      var path = e.composedPath();
      for (var i = 0; i < path.length; i++) if (path[i] === host) return true;
      return false;
    }
    var node = e.target;
    while (node) {
      if (node === host) return true;
      node = node.parentNode || node.host || null;
    }
    return false;
  }

  /**
   * Page shortcut layers decide "ignore keys while typing in an input" by looking at
   * event.target — which shadow retargeting turns into our host div — so they treat
   * the annotation keystrokes as page shortcuts and may preventDefault() them. The
   * card then shows a caret but swallows every character. This script runs at
   * document start, so its capture listener is normally first: stop the page from
   * seeing keystrokes that belong to the card. Default text insertion is not a
   * propagation effect, so typing still lands in the textarea.
   */
  function guardCardKeys(e) {
    if (!nodes.host || !state.locked || !inCard(e)) return;
    if (e.type === 'keydown') {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopImmediatePropagation(); commit(); return; }
      if (e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); moveCardFocus(e.shiftKey); return; }
    }
    // A page listener registered before this one already cancelled the default
    // action. Swallowing the event here would hide that from the card's own
    // fallback handler, so let it through and let the textarea restore the edit.
    if (e.defaultPrevented) return;
    state.guarded++;
    e.stopImmediatePropagation();
  }

  /** Apply an edit ourselves, for pages that already cancelled the default action. */
  function applyEdit(kind, text) {
    var ta = nodes.text;
    if (!ta) return false;
    var start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    var end = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
    if (kind === 'insert') { ta.setRangeText(String(text), start, end, 'end'); return true; }
    if (kind === 'backspace') {
      if (start !== end) { ta.setRangeText('', start, end, 'end'); return true; }
      if (start > 0) { ta.setRangeText('', start - 1, end, 'end'); return true; }
      return false;
    }
    if (kind === 'delete') {
      if (start !== end) { ta.setRangeText('', start, end, 'end'); return true; }
      if (end < ta.value.length) { ta.setRangeText('', start, end + 1, 'end'); return true; }
      return false;
    }
    return false;
  }

  function onTextKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); return; }
    // A page listener registered before our guard may have cancelled the default
    // action already; restore the edit so no keystroke is silently lost.
    if (e.defaultPrevented && !e.isComposing) {
      state.restored++;
      if (e.key === 'Backspace') { e.preventDefault(); applyEdit('backspace'); return; }
      if (e.key === 'Delete') { e.preventDefault(); applyEdit('delete'); return; }
      if (e.key === 'Enter') { e.preventDefault(); applyEdit('insert', '\n'); return; }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); applyEdit('insert', e.key); return; }
    }
    e.stopPropagation();
  }

  function onBeforeInput(e) {
    if (!e.defaultPrevented || e.isComposing) return;
    state.restored++;
    var type = e.inputType || '';
    if (type === 'insertText') { e.preventDefault(); applyEdit('insert', e.data || ''); return; }
    if (type === 'insertLineBreak' || type === 'insertParagraph') { e.preventDefault(); applyEdit('insert', '\n'); return; }
    if (type === 'deleteContentBackward') { e.preventDefault(); applyEdit('backspace'); return; }
    if (type === 'deleteContentForward') { e.preventDefault(); applyEdit('delete'); }
  }

  /** Keep the caret inside the card even when the page grabs focus on click or timer. */
  function keepCardFocus() {
    if (!state.locked || !nodes.text || !nodes.card) return;
    if (document.hidden) return;
    if (nodes.card.style.display === 'none') return;
    var shadow = nodes.host && nodes.host.shadowRoot;
    var active = shadow ? shadow.activeElement : null;
    if (active === nodes.text) return;
    if (active && nodes.card.contains(active)) return; // the user tabbed to a card button
    try { nodes.text.focus({ preventScroll: true }); } catch (e) { try { nodes.text.focus(); } catch (err) {} }
  }

  function startFocusKeeper() {
    if (focusTimer) return;
    focusTimer = setInterval(keepCardFocus, 200);
  }

  function stopFocusKeeper() {
    if (!focusTimer) return;
    clearInterval(focusTimer);
    focusTimer = 0;
    unlockPageFocus();
  }

  /**
   * While the card is open it behaves like a modal dialog, so page code must not be
   * able to pull the caret away. Several apps focus() their own widget from a click,
   * focusin or timer handler; the annotation then quietly lands in that widget while
   * the card still looks focused. Redirect such calls to the card instead.
   */
  var nativeFocus = null;
  var focusProto = null;

  function lockPageFocus() {
    if (nativeFocus) return;
    var proto = W.HTMLElement && W.HTMLElement.prototype;
    if (!proto || typeof proto.focus !== 'function') return;
    focusProto = proto;
    nativeFocus = proto.focus;
    proto.focus = function (opts) {
      if (state.locked && nodes.text && nodes.card && !nodes.card.contains(this)) {
        try { nodes.text.focus({ preventScroll: true }); return; } catch (e) { try { nodes.text.focus(); return; } catch (err) {} }
      }
      return nativeFocus.call(this, opts);
    };
  }

  function unlockPageFocus() {
    if (!nativeFocus || !focusProto) return;
    try { focusProto.focus = nativeFocus; } catch (e) {}
    nativeFocus = null;
    focusProto = null;
  }

  /** 批注序号补零：卡片左上角的 01/02 是给人看的顺序，不是内部 id。 */
  function pad2(n) {
    var s = String(n);
    return s.length < 2 ? '0' + s : s;
  }

  /** 评论框随内容长高（上限 190px），长批注不用在小窗里来回滚。 */
  function autosizeText() {
    var ta = nodes.text;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(190, Math.max(74, ta.scrollHeight)) + 'px';
    // 卡片高度变了，向上翻转时可能压到目标元素，重新摆一次位；正在输入的焦点不受影响。
    followTarget();
  }

  /** 复制选择器：剪贴板被页面策略拒绝时明确说出来，而不是静默失败。 */
  function copySelector() {
    var value = nodes.sel ? nodes.sel.textContent : '';
    if (!value) return;
    var done = function () { if (W.__DSH_VP__) W.__DSH_VP__.flash('已复制选择器'); };
    var fail = function () { if (W.__DSH_VP__) W.__DSH_VP__.flash('复制失败：浏览器未授权剪贴板'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(done, fail);
        return;
      }
    } catch (e) {}
    fail();
  }

  function render() {
    if (!nodes.host) return;
    var on = state.mode === 'pick';
    document.documentElement.classList.toggle('__dsh-vp-pick', on);
    // Host 是计数真相源：sync() 推来的 count 优先，还没同步过才退回本地 seq。
    var n = state.count !== null ? state.count : state.seq;
    nodes.box.style.display = 'none';
    nodes.lbl.style.display = 'none';
    // 容器在 CSS 里是隐藏的初始态（避免首帧闪一下），真正可见由这里决定：
    // off 模式显示折叠胶囊，pick 模式显示控制台，两者都由 render() 切换。
    if (nodes.hud) nodes.hud.style.display = 'block';
    nodes.cluster.style.display = on ? 'flex' : 'none';
    nodes.pill.style.display = on ? 'none' : 'flex';
    nodes.cnt.textContent = String(n);
    nodes.pcnt.textContent = String(n);
    nodes.undoBtn.disabled = nodes.doneBtn.disabled = n === 0;
    if (!on) hideCard();
  }

  /** 选中后一直亮着：用户写批注时不至于忘了自己指的是哪个元素。 */
  function showMark(rect) {
    if (!nodes.mark || !rect) return;
    nodes.mark.style.display = 'block';
    nodes.mark.style.left = rect.x + 'px';
    nodes.mark.style.top = rect.y + 'px';
    nodes.mark.style.width = rect.width + 'px';
    nodes.mark.style.height = rect.height + 'px';
  }

  function hideMark() {
    if (nodes.mark) nodes.mark.style.display = 'none';
  }

  /**
   * 页面滚动或改窗口大小时，高亮框和卡片要跟着目标元素走：
   * 卡片是 fixed 定位的，不跟就会停在已经无关的位置上。
   */
  function followTarget() {
    if (!state.target || !state.targetEl || !state.targetEl.isConnected) return;
    var rect = state.targetEl.getBoundingClientRect();
    state.target.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    showMark(state.target.rect);
    if (nodes.card && nodes.card.style.display !== 'none') positionCard(state.target.rect);
  }

  function closeCard() {
    stopFocusKeeper();
    hideMark();
    if (nodes.card) nodes.card.style.display = 'none';
    var restore = lastFocused;
    lastFocused = null;
    if (restore && typeof restore.focus === 'function') { try { restore.focus(); } catch (e) {} }
  }

  function hideCard() {
    state.locked = false;
    state.target = null;
    state.targetEl = null;
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
    state.targetEl = null;
    nodes.text.value = '';
    nodes.text.style.height = '';
    nodes.box.style.display = 'none';
    nodes.lbl.style.display = 'none';
    closeCard();
    send(payload);
    render();
  }

  function placeCard(rect) {
    lastFocused = document.activeElement;
    nodes.card.style.display = 'block';
    positionCard(rect);
    lockPageFocus();
    try { nodes.text.focus({ preventScroll: true }); } catch (e) { nodes.text.focus(); }
    startFocusKeeper();
  }

  /** 只算几何：滚动、改窗口、批注变长时复用，避免重复聚焦和重播入场动画。 */
  function positionCard(rect) {
    var card = nodes.card;
    if (!card || !rect) return;
    var box = card.getBoundingClientRect();
    var vw = W.innerWidth || 1200;
    var vh = W.innerHeight || 800;
    var w = box.width || 308;
    var h = box.height || 190;
    var left = Math.min(Math.max(8, rect.x), Math.max(8, vw - w - 8));
    var top = rect.y + rect.height + 8;
    var below = top + h <= vh - 8;
    if (!below) top = Math.max(8, rect.y - h - 8);
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    // 尖角对准元素的水平中心，但夹在卡片圆角之内，免得跑到边框外面。
    var notch = Math.max(18, Math.min(w - 30, rect.x + rect.width / 2 - left - 6));
    card.style.setProperty('--vp-notch', notch + 'px');
    card.classList.toggle('below', below);
    card.classList.toggle('above', !below);
  }

  function cardFocusables() {
    if (!nodes.card) return [];
    var list = [];
    var els = nodes.card.querySelectorAll('textarea, button');
    for (var i = 0; i < els.length; i++) list.push(els[i]);
    return list;
  }

  function moveCardFocus(back) {
    var items = cardFocusables();
    if (!items.length) return;
    var shadow = nodes.host && nodes.host.shadowRoot;
    var active = shadow ? shadow.activeElement : null;
    var index = -1;
    for (var i = 0; i < items.length; i++) if (items[i] === active) index = i;
    if (index < 0) index = back ? 0 : items.length - 1;
    var next = back ? (index - 1 + items.length) % items.length : (index + 1) % items.length;
    try { items[next].focus(); } catch (e) {}
  }

  function onCardKey(e) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    moveCardFocus(e.shiftKey);
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
      state.targetEl = el;
      state.locked = true;
      nodes.sel.textContent = state.target.selector;
      showMark(state.target.rect);
      nodes.idx.textContent = pad2((state.count !== null ? state.count : state.seq) + 1);
      nodes.tag.textContent = state.target.tag || 'node';
      nodes.dim.textContent =
        Math.round(state.target.rect.width) + '×' + Math.round(state.target.rect.height);
      // 把点中的元素文字摘一句贴在卡上：确认「点的是不是这个」比读选择器快得多。
      var snippet = String(state.target.text || '').replace(/\s+/g, ' ').trim().slice(0, 90);
      nodes.quote.textContent = snippet;
      nodes.quote.style.display = snippet ? 'block' : 'none';
      nodes.text.value = '';
      nodes.text.style.height = '';
      placeCard(state.target.rect);
      render();
    } catch (err) {
      state.locked = false;
      state.target = null;
      W.__DSH_VP_LAST_ERROR__ = String((err && err.stack) || err);
    }
  }

  function onKey(e) {
    // 页面里直接 Alt+A 切换标注模式：经 binding 上报 host，面板与其它标签页同步。
    // macOS 的 Option+A 会把 e.key 组合成 å，必须按物理键 e.code === 'KeyA' 判定。
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyA' || e.key === 'a' || e.key === 'A')) {
      if (state.locked) return;
      e.preventDefault();
      e.stopPropagation();
      setMode(state.mode === 'pick' ? 'off' : 'pick');
      return;
    }
    if (e.key !== 'Escape') return;
    if (state.locked) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    if (state.mode === 'pick') { e.preventDefault(); e.stopPropagation(); setMode('off'); }
  }

  function setMode(mode, fromHost) {
    mode = mode === 'pick' ? 'pick' : 'off';
    var changed = state.mode !== mode;
    state.mode = mode;
    // 用户来源（Esc / HUD 按钮 / 折叠胶囊）必须上报 host，让面板与其它标签页同步；
    // host 下发的变更带 fromHost=true，否则两边会对同一个模式互相回显、打乒乓。
    if (!fromHost && changed) send({ kind: 'mode', mode: mode });
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
    version: 3,
    rev: REV,
    setMode: setMode,
    dispose: dispose,
    getMode: function () { return state.mode; },
    reattach: reattach,
    flush: flush,
    highlight: highlight,
    // Host -> page 的唯一同步口：mode 归 host 管，已标注数也由 host 推送，
    // 页面只做展示，不再维护第二份会漂移的计数。
    sync: function (info) {
      info = info || {};
      if (typeof info.count === 'number') state.count = info.count;
      if (info.mode === 'pick' || info.mode === 'off') setMode(info.mode, true);
      else if (nodes.host) render();
    },
    flash: function (message) {
      if (!nodes.note) return;
      nodes.note.textContent = String(message || '');
      nodes.note.style.display = 'block';
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(function () { nodes.note.style.display = 'none'; }, 2000);
    }
  };

  W.__DSH_VP_DEBUG__ = function () {
    return {
      rev: REV,
      mode: state.mode,
      locked: state.locked,
      seq: state.seq,
      count: state.count,
      clicks: state.clicks,
      guarded: state.guarded,
      restored: state.restored,
      ui: !!nodes.host,
      error: W.__DSH_VP_LAST_ERROR__ || null
    };
  };

  on(W, 'mousemove', onMove, true);
  on(W, 'click', onClick, true);
  on(W, 'keydown', onKey, true);
  // capture 的 scroll 才能收到内层滚动容器的滚动事件。
  on(W, 'scroll', followTarget, true);
  on(W, 'resize', followTarget, false);
  // Registered here, at document start, so these capture listeners run before the
  // page's own shortcut layers and can shield the card's keystrokes from them.
  on(W, 'keydown', guardCardKeys, true);
  on(W, 'keypress', guardCardKeys, true);
  on(W, 'beforeinput', guardCardKeys, true);
  on(W, 'compositionstart', guardCardKeys, true);
  on(W, 'compositionupdate', guardCardKeys, true);
  on(W, 'compositionend', guardCardKeys, true);
  on(W, 'focusin', function () { if (state.locked) keepCardFocus(); }, true);

  if (document.body) ensureUI(); else document.addEventListener('DOMContentLoaded', function () { ensureUI(); }, { once: true });
})();`;

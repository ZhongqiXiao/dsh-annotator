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

// HUD 位置的钳制与解析是纯函数：单元测试直接 import 它们，页面载荷则在这里把
// 同一份源码字符串嵌进去。写两遍的话，页面里那份和测试里那份迟早不是一回事。
import { clampHudPosition, parseHudPosition } from './shared/hud-position.js';

/** Runs in the page's main world. Keep it dependency-free and idempotent. */
export const OVERLAY_SCRIPT = String.raw`(() => {
  var W = window;
  // Bumped whenever the page-side logic changes: the script is injected twice per
  // document (new-document preload + evaluate on the open page), so a newer build
  // must be able to take over an older instance instead of leaving its listeners
  // in charge for the rest of the page's life.
  var REV = 22;
  // 与 lib/shared/hud-position.js 同源：拖拽时钳进视口，读回时拒绝坏数据。
  var clampHudPosition = ${clampHudPosition.toString()};
  var parseHudPosition = ${parseHudPosition.toString()};
  var HOST_ID = '__dsh-vp-root';
  if (W.__DSH_VP__ && W.__DSH_VP__.rev === REV) { try { W.__DSH_VP__.reattach(); } catch (e) {} return; }
  if (W.__DSH_VP__) { try { if (W.__DSH_VP__.dispose) W.__DSH_VP__.dispose(); } catch (e) {} }
  var stale = document.getElementById(HOST_ID);
  if (stale && stale.parentNode) { try { stale.parentNode.removeChild(stale); } catch (e) {} }

  var BINDING = '${BINDING_NAME}';
  // role/refLabel/specs 由 host 推送。role 现在是「落点」——下一处标注会进哪一栏——
  // 而不是页面身份：同一页既可以是改动对象，也可以是参照来源，所以 HUD 只按落点换口径，
  // 否则用户在参照落点上说「怎么改」，agent 会去改只读的那一页。
  var state = { version: 4, rev: REV, mode: 'off', seq: 0, count: null, locked: false, target: null, anchor: null, clicks: 0, moves: 0, guarded: 0, restored: 0, role: 'target', landing: '', refLabel: '', specs: [], spec: [], hinted: false, targetCount: 0, referenceCount: 0, prompt: '', pickCount: 0, hudPos: null, textEdit: false };
  var nodes = {};
  // macOS 的 Option 是组合键：按 Option+A 产出的是 å 而非 a，快捷键判定要按物理键
  // code=KeyA，提示文案也要按平台区分（⌥Option+A / Alt+A）。
  var MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  var HOTKEY = MAC ? '⌥ A' : 'Alt+A';
  // 落点开关的键位：⌥A 管「标不标」，⌥R 管「这一处进哪一栏」——两个动作分开按，
  // 不用回面板再点一次按钮。
  var HOTKEY_R = MAC ? '⌥ R' : 'Alt+R';
  // 复制提示词：把整份「改动↔参照」提示词放进剪贴板，粘到别的 agent 里就能用。
  var HOTKEY_C = MAC ? '⌥ C' : 'Alt+C';
  var bound = [];
  var lastFocused = null;
  var hlTimer = 0;
  var focusTimer = 0;
  var noteTimer = 0;
  // 元素文字的采集上限：点中一张卡片或一段正文很常见，几千字是该给的；
  // 但点中 <body> 这种容器时 innerText 是整页文字，会撑爆 payload 与提示词。
  var TEXT_CAP = 4000;
  // 「改文案」预填的要求：用户点一下就能提交，也可以在这句上改。
  var TEXT_EDIT_HINT = '优化这段文案：保持原意与信息量，读起来更自然准确；只替换元素里的文字，结构和样式都不动。';

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

  /**
   * 页面上只要有一个祖先带了 transform / filter / will-change / contain，
   * 我们那些 fixed 定位的子元素就不再以视口为参照，而是以那个祖先为参照：
   * host 自己的矩形会跟着偏（滚动后 host.top 变成 -scrollY 之类），
   * 高亮框、卡片于是整体错位，甚至跑到视口外只剩左上角一点。
   * 统一用 host 的矩形原点做换算，把「相对包含块」的坐标还原成「相对视口」。
   */
  function hostOrigin() {
    var host = nodes.host;
    if (!host || !host.getBoundingClientRect) return { x: 0, y: 0 };
    var r = host.getBoundingClientRect();
    return { x: r.left || 0, y: r.top || 0 };
  }

  /** 按视口坐标摆放一个 fixed 元素；祖先建了包含块时先减掉 host 原点。 */
  function place(node, left, top) {
    if (!node) return;
    var o = hostOrigin();
    node.style.left = (left - o.x) + 'px';
    node.style.top = (top - o.y) + 'px';
  }

  function describe(el) {
    var rect = el.getBoundingClientRect();
    var text = '';
    try {
      // 不 trim 内部空白：输入框的保留换行、按钮里的空格都是原文的一部分，
      // 复制与改写要的是「页面上那段字」，压平了再交回去就换不回来了。
      text = String(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '');
    } catch (e) { text = ''; }
    text = text.replace(/\r\n/g, '\n').trim();
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
      // 采集上限不是「够用就好」：整段正文点上来就是几千字，但也要拦住
      // 点中 <body> 那种把整页文字都塞进 payload 的情况。真实字数与截断标记
      // 一起上交，下游才不会把前 4000 字当成全文去整段替换。
      text: text.slice(0, TEXT_CAP),
      textLength: text.length,
      textTruncated: text.length > TEXT_CAP,
      html: html,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      pageRect: { x: rect.x + W.scrollX, y: rect.y + W.scrollY, width: rect.width, height: rect.height },
      url: location.href,
      title: document.title,
      dpr: W.devicePixelRatio || 1
    };
  }

  // HUD 位置存在本页 origin 的 localStorage：同一站点的每个页面都沿用用户拖到的位置。
  // 读失败（隐私模式、被策略禁用）就退回默认右下角，绝不因此让 HUD 消失。
  var HUD_POS_KEY = '__dsh_vp_hud_pos';
  var hudDrag = null;

  function readHudPos() {
    try { return parseHudPosition(W.localStorage.getItem(HUD_POS_KEY)); } catch (e) { return null; }
  }

  function writeHudPos(pos) {
    try {
      if (pos) W.localStorage.setItem(HUD_POS_KEY, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }));
      else W.localStorage.removeItem(HUD_POS_KEY);
    } catch (e) {}
  }

  /** 把保存的位置套到 HUD 上；传 null 表示回到默认的右下角。 */
  function applyHudPos(pos) {
    if (!nodes.hud) return;
    if (!pos) {
      nodes.hud.style.left = '';
      nodes.hud.style.top = '';
      nodes.hud.style.right = '';
      nodes.hud.style.bottom = '';
      state.hudPos = null;
      return;
    }
    var rect = nodes.hud.getBoundingClientRect();
    var next = clampHudPosition(
      { x: pos.x, y: pos.y, width: rect.width, height: rect.height },
      { viewportWidth: W.innerWidth, viewportHeight: W.innerHeight, margin: 8 },
    );
    nodes.hud.style.left = Math.round(next.x) + 'px';
    nodes.hud.style.top = Math.round(next.y) + 'px';
    nodes.hud.style.right = 'auto';
    nodes.hud.style.bottom = 'auto';
    state.hudPos = { x: next.x, y: next.y };
  }

  function ensureUI() {
    if (document.getElementById(HOST_ID)) return true;
    if (!document.body) return false;
    var host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-dsh-visual-annotator', '1');
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    var shadow = host.attachShadow({ mode: 'open' });
    // 展开的控制台与折叠的胶囊各要一份落点开关：两边语义完全一致（同一组 data-slot、
    // 同一个 title），复制两份迟早漏改一边，合成一段标记两次复用。
    var segMarkup =
      '<span class="seg" role="group" aria-label="下一处标注进哪一栏（' + HOTKEY_R + ' 切换）">' +
      '<button class="seg-b t" type="button" data-slot="target" title="下一处标进「改动」栏（' + HOTKEY_R + ' 切换）">改动</button>' +
      '<button class="seg-b r" type="button" data-slot="reference" title="下一处标进「参照」栏（' + HOTKEY_R + ' 切换）">参照</button>' +
      // 键帽跟着开关走：暂停一直写着 Esc，换栏却只在悬停提示里，用户根本不知道有 ⌥R。
      // 平台文案复用 HOTKEY_R（macOS ⌥ R / Windows·Linux Alt+R），不在标记里写死。
      '<span class="seg-k" aria-hidden="true" title="按 ' + HOTKEY_R + ' 在「改动 / 参照」之间切换">' + HOTKEY_R + '</span>' +
      '</span>';
    // 拖动把手：只在把手上按下才拖，HUD 里的按钮照常点。双击（或聚焦后按 Home）复位。
    // 图形用内联 SVG 画两列六点，不再用 CSS 的盲文码点（U+2807）：那种写法要在 content 里
    // 拼一段反斜杠转义，而它住在注入脚本的字符串里，页面端 JS 会先把反斜杠 + 2 当成八进制
    // 转义吃掉，CSS 只剩一个控制符加字面量 807——用户看到的就是莫名其妙的「807」。
    // SVG 不吃转义，也不挑字体。
    var GRIP_HTML =
      '<span class="grip" role="button" tabindex="0" aria-label="拖动 HUD 调整位置" title="拖动调整 HUD 位置 · 双击复位">' +
      '<svg class="grip-dots" viewBox="0 0 8 16" width="8" height="16" aria-hidden="true" focusable="false">' +
      '<g fill="currentColor"><circle cx="1.6" cy="2" r="1.35"/><circle cx="6.4" cy="2" r="1.35"/>' +
      '<circle cx="1.6" cy="8" r="1.35"/><circle cx="6.4" cy="8" r="1.35"/>' +
      '<circle cx="1.6" cy="14" r="1.35"/><circle cx="6.4" cy="14" r="1.35"/></g>' +
      '</svg></span>';
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
		'.hud{position:fixed;right:16px;bottom:16px;display:none;font:12px/1.4 var(--vp-sans);color:var(--vp-fg);-webkit-font-smoothing:antialiased}',
		// 拖动把手：HUD 常挡住页面右下角的内容（右下角有悬浮按钮的站点尤其明显）。
		// 与其猜一个「永不出错」的坐标，不如让用户挪到顺手的位置并记住它。
		'.grip{display:inline-flex;align-items:center;justify-content:center;flex:none;box-sizing:border-box;width:13px;height:28px;color:#8c8074;border-radius:6px;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}',
		'.grip .grip-dots{display:block;width:8px;height:16px;flex:none}',
		'.grip:hover,.grip:focus-visible{color:#e7dcd2;background:rgba(255,255,255,.08)}',
		'.grip:focus-visible{outline:2px solid var(--vp-acc-warm);outline-offset:1px}',
		'.pill .grip{height:30px}',
		'.hud.dragging .grip{cursor:grabbing}',
		'.hud.dragging,.hud.dragging .pill-main{cursor:grabbing}',
		'.cluster,.pill{pointer-events:auto;white-space:nowrap;border:1px solid var(--vp-line);background:linear-gradient(180deg,rgba(38,29,24,.94),rgba(22,16,14,.96));-webkit-backdrop-filter:blur(18px) saturate(150%);backdrop-filter:blur(18px) saturate(150%);box-shadow:0 20px 48px -18px rgba(0,0,0,.8),0 1px 0 rgba(255,255,255,.06) inset}',
		// 一排控件共用同一套几何：高 28、圆角 8、左右内距 11。此前 seg 23.5、按钮 29、胶囊件 25~33
		// 三种高度混排，中线对齐后上下各差 2~4px，看起来就是「没对齐」；左内距 14 配右内距 7 也不对称。
		'.cluster{display:none;align-items:center;gap:6px;box-sizing:border-box;height:40px;padding:0 8px 0 6px;border-radius:14px}',
		'.cluster .sep,.pill .sep{flex:none;width:1px;height:16px;margin:0 2px;background:rgba(255,255,255,.1)}',
		// 计数整段当一个基线组：「已标注 / 0 / 处」原来是三个 flex 项，gap 把「0」和「处」拆开，读着像两句话。
		'.cluster .met{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 2px;font-size:12px;color:#b3a698;letter-spacing:.01em;cursor:default}',
		'.cluster .met .mbody{display:inline-flex;align-items:baseline;gap:4px}',
		'.cluster .dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--vp-acc);box-shadow:0 0 0 3px rgba(255,122,69,.16)}',
		'.cluster .cnt{color:var(--vp-fg);font-size:12.5px;font-weight:650;font-variant-numeric:tabular-nums}',
		// 落点开关：HUD 里唯一能改变「下一处进哪一栏」的控件。两段式而不是下拉——
		// 只有两个值，一个键位就能翻，多一层菜单只会多一次点击。
		'.seg{display:inline-flex;align-items:center;gap:2px;box-sizing:border-box;height:28px;padding:2px;border-radius:8px;background:rgba(0,0,0,.34);border:1px solid rgba(255,255,255,.1)}',
		'.seg-b{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:22px;padding:0 9px;font:650 11.5px/1 var(--vp-sans);color:#a99c90;border-radius:6px;background:transparent;border:0;cursor:pointer;transition:background .14s,color .14s}',
		'.seg-b:hover{color:#ede3d9;background:rgba(255,255,255,.08)}',
		'.seg-b.on{color:#1b1108;background:var(--vp-acc)}',
		'.seg-b.on.r{color:#08152b;background:var(--vp-ref)}',
		// 换栏键帽：和两段开关同处一个底槽，读作「这个开关由 ⌥R 驱动」，不另外占一栏。
		// 比按钮更暗更小、且用等宽字体——它是指示，不是可点的第三段。
		'.seg-k{display:inline-flex;align-items:center;justify-content:center;height:20px;margin-left:3px;padding:0 5px;font:650 9.5px/1 var(--vp-mono);letter-spacing:.02em;color:#9a8d81;border-radius:5px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.09);cursor:default;-webkit-user-select:none;user-select:none}',
		'.pill .seg-k{height:18px;margin-left:2px;padding:0 4px;font-size:9px}',
		'.pill{display:none;align-items:center;gap:8px;box-sizing:border-box;height:42px;padding:0 8px 0 6px;border-radius:14px;cursor:default;transition:border-color .16s var(--vp-ease)}',
		// 悬停只提亮描边：整条胶囊跟着上浮时，鼠标停在复制按钮上也像在拖整块 HUD。
		'.pill:hover{border-color:rgba(255,122,69,.38)}',
		'.pill-main{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 8px 0 6px;border-radius:8px;cursor:pointer;transition:background .14s}',
		'.pill-main:hover{background:rgba(255,255,255,.05)}',
		'.pill .go{font-size:12.5px;font-weight:600;color:var(--vp-fg)}',
		'.pill .go::before{content:"";display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:var(--vp-acc);box-shadow:0 0 0 3px rgba(255,122,69,.16);vertical-align:1px}',
		'.pill .c{color:#a99c90;font-size:11.5px;line-height:1;font-variant-numeric:tabular-nums}',
		// 复制提示词：整份「改动 + 参照 + 对照关系」进剪贴板，可以粘到别的 Agent 里执行。
		// 折叠胶囊里也放一个——普通模式下用户不展开 HUD，也要能把已有标注直接拿走。
		'.pill .cp{height:26px;padding:0 9px;font-size:11.5px}',
		// 折叠胶囊也要能换落点：普通模式下不展开 HUD 时，这里就是唯一的开关。
		'.pill .seg{height:26px;padding:2px;border-radius:7px}',
		'.pill .seg-b{height:20px;padding:0 8px;font-size:11px;border-radius:5px}',
		'.hud .k{display:inline-flex;align-items:center;height:18px;padding:0 5px;font:650 10.5px/1 var(--vp-mono);letter-spacing:.04em;color:#c9bcae;border-radius:5px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14)}',
		'.hud .cluster>button,.hud .pill>button{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:28px;padding:0 11px;font:inherit;font-size:12px;font-weight:550;color:#ede3d9;border-radius:8px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.1);cursor:pointer;transition:background .14s,border-color .14s,transform .14s}',
		'.hud .cluster>button .k,.hud .pill>button .k{margin-left:6px;background:rgba(0,0,0,.22);border-color:rgba(255,255,255,.12);color:#ffc9b4}',
		'.hud .cluster>button:hover:not(:disabled),.hud .pill>button:hover:not(:disabled){background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.2)}',
		'.hud .cluster>button:active:not(:disabled),.hud .pill>button:active:not(:disabled){transform:translateY(1px)}',
		// 次级动作（复制提示词）用透明底：同排只有一个主色，导出入口要能找到但不抢「完成并插入」。
		'.hud .cluster>button.cp,.hud .pill>button.cp{background:transparent;border-color:rgba(255,255,255,.09);color:#c9bcae}',
		'.hud .cluster>button.cp:hover:not(:disabled),.hud .pill>button.cp:hover:not(:disabled){background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.17);color:#f3ebe3}',
		// 零标注时「复制提示词」是禁用的：压暗到一个看得见但明显不可点的程度，光标也不变成手。
		'.hud button.cp:disabled{opacity:.42;cursor:default}',
		'.hud .cluster>button.pri{padding:0 13px;color:#1b1108;font-weight:650;background:var(--vp-acc);border-color:transparent;box-shadow:0 8px 18px -10px rgba(255,122,69,.9)}',
		'.hud .cluster>button.pri:hover:not(:disabled){background:#ff8f5f}',
		'.hud .cluster>button.pri .k{background:rgba(0,0,0,.16);border-color:rgba(0,0,0,.14);color:#3a1c0e}',
		'.hud .cluster>button:disabled,.hud .pill>button:disabled{opacity:1;cursor:default;color:#8a7f74;background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.06)}',
		// 主按钮禁用时不能靠整体降透明度：橙底乘 0.4 会变成一团发褐的脏色，深色字压在上面也读不出来。
		'.hud .cluster>button.pri:disabled{color:#f0b193;background:rgba(255,122,69,.2);border-color:rgba(255,122,69,.34);box-shadow:none}',
		'.hud .cluster>button:focus-visible,.hud .pill>button:focus-visible,.pill-main:focus-visible,.seg-b:focus-visible{outline:2px solid var(--vp-acc-warm);outline-offset:2px}',
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
      // 文案动作行：和 quote 同一块暖墨底，但比主按钮矮一档——它们是附着在文字上的快捷动作，
      // 不该和「添加标注」抢视线。默认不占位，点中带文字的元素才出现。
      '.card .qacts{display:none;align-items:center;gap:6px;margin:-4px 0 10px}',
      '.card .qacts button{height:26px;padding:0 10px;font:600 12px/1 var(--vp-sans);color:#cbbdae;background:transparent;border:1px solid rgba(255,255,255,.1);border-radius:8px;cursor:pointer;transition:color .14s,border-color .14s,background .14s}',
      '.card .qacts button:hover{color:#fff;border-color:rgba(255,122,69,.5);background:rgba(255,122,69,.1)}',
      '.card .qacts button[aria-pressed="true"]{color:#ffeadd;border-color:rgba(255,122,69,.6);background:rgba(255,122,69,.16)}',
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
      // 参考模式：同一套几何、另一套语义色。蓝色不是装饰——它一眼告诉用户
      // 「这块不会被我改」，和暖橙色的目标标注区分开。
      ':host{--vp-ref:#4b8cf7;--vp-ref-fg:#e8f1ff}',
      '.pill .go.ref::before{background:var(--vp-ref);box-shadow:0 0 0 3px rgba(75,140,247,.18)}',
      '.pill.ref:hover{border-color:rgba(75,140,247,.5)}',
      '.card.ref .idx{color:#cfe1ff;background:rgba(75,140,247,.16);border-color:rgba(75,140,247,.36)}',
      '.card.ref .quote::before{color:rgba(75,140,247,.78)}',
      '.card.ref textarea:focus{border-color:rgba(75,140,247,.55);box-shadow:0 0 0 3px rgba(75,140,247,.15)}',
      '.card.ref button.pri{background:var(--vp-ref);color:#08152b;box-shadow:0 10px 22px -12px rgba(75,140,247,.95)}',
      '.card.ref button.pri:hover{background:#6aa0f9}',
      '.card .dims{display:none;flex-wrap:wrap;gap:6px;margin:0 0 10px}',
      '.card .dims.on{display:flex}',
      '.card .dim-chip{font:12px/1 var(--vp-sans);color:#bccbd8;padding:6px 9px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);cursor:pointer;transition:background .14s,color .14s,border-color .14s}',
      '.card .dim-chip:hover{background:rgba(255,255,255,.1)}',
      '.card .dim-chip[aria-pressed="true"]{color:#eaf2ff;background:rgba(75,140,247,.22);border-color:rgba(75,140,247,.5)}',
      '.card .keys{display:inline-flex;align-items:center;gap:4px;margin-left:9px}',
      '.card button .k{display:inline-flex;align-items:center;height:20px;padding:0 7px;font:650 12px/1 var(--vp-mono);border-radius:6px;background:rgba(0,0,0,.3);border:1px solid rgba(0,0,0,.22);color:#ffeadd}',
      '.card button .k.sym{font:600 13px/1 var(--vp-sans);padding:0 6px;letter-spacing:0}',
      '.card .hint .k{font:600 11px/1 var(--vp-mono);padding:4px 6px;border-radius:6px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#d8cabc}',
      '.card button:focus-visible{outline:2px solid var(--vp-acc-warm);outline-offset:2px}',
      // 提示条挂在 HUD 里（absolute 相对 HUD），HUD 被拖走后提示还在原地就等于没提示。
		'.note{position:absolute;right:0;bottom:calc(100% + 8px);display:none;width:max-content;max-width:min(70vw,380px);text-align:right;pointer-events:none;font:12px/1.4 var(--vp-sans);color:var(--vp-fg);padding:7px 12px;border-radius:10px;background:#1b1210;border:1px solid var(--vp-line);box-shadow:0 14px 30px -14px rgba(0,0,0,.8)}',
      'html.__dsh-vp-pick,html.__dsh-vp-pick *{cursor:crosshair !important}',
      '</style>',
      '<div class="box"></div>',
      '<div class="mark"></div>',
      '<div class="lbl"></div>',
      '<div class="hud">',
			'<div class="cluster" role="toolbar" aria-label="标注控制台">',
			GRIP_HTML,
			segMarkup,
			'<span class="met"><span class="dot"></span><span class="mbody"><span class="mtxt">本页标注</span> <b class="cnt">0</b> 处</span></span>',
			'<span class="sep" aria-hidden="true"></span>',
			'<button class="undo" type="button" title="撤销最近一条标注">撤销</button>',
			'<button class="cp" type="button" title="复制全部标注的提示词（' + HOTKEY_C + '），可粘贴到其它 Agent">复制提示词</button>',
			'<span class="sep" aria-hidden="true"></span>',
			'<button class="pause" type="button" title="暂停标注（Esc）">暂停<span class="k">Esc</span></button>',
			'<button class="pri done" type="button" title="把全部标注插入 DSH 对话">完成并插入</button>',
			'</div>',
			// 折叠胶囊不再是单个按钮：里面既有「开启标注」，也有「复制提示词」——
			// 普通模式下用户不展开 HUD 时，这两件事都得能直接做。
			'<div class="pill">',
			GRIP_HTML,
			'<span class="pill-main" role="button" tabindex="0" aria-label="开启标注模式" title="开启标注模式：点击页面元素即可标注（快捷键 ' + HOTKEY + '）">',
			'<span class="go">开启标注</span>',
			'<span class="k">' + HOTKEY + '</span>',
			'<span class="c"><span class="ctxt">本页标注</span> <b class="pcnt">0</b> 处</span>',
			'</span>',
			'<span class="sep" aria-hidden="true"></span>',
			segMarkup,
			'<button class="cp" type="button" title="复制全部标注的提示词（' + HOTKEY_C + '），可粘贴到其它 Agent">复制提示词</button>',
			'</div>',
			// 提示条放进 HUD 里：HUD 被拖到别处后，固定在下方的提示会出现在毫不相干的位置。
			'<div class="note" role="status" aria-live="polite"></div>',
      '</div>',
      '<div class="card" role="dialog" aria-label="页面元素标注">',
      '<div class="hd"><span class="idx">01</span><span class="tag"></span><span class="dim"></span><button class="copy" type="button" title="复制选择器">复制</button></div>',
      '<div class="sel"></div>',
      '<div class="quote"></div>',
      // 文案动作单独一行：quote 是单行省略的展示块，把按钮塞进去会挤掉文字本身。
      '<div class="qacts"><button class="qcopy" type="button" title="复制这个元素的完整原文（粘贴到别处改）">复制文字</button><button class="qedit" type="button" title="按默认要求优化这段文字，只换文字不动结构">改文案</button></div>',
      '<div class="dims" role="group" aria-label="参考维度"></div>',
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
    nodes.met = shadow.querySelector('.cluster .met');
    nodes.mtxt = shadow.querySelector('.mtxt');
    nodes.ctxt = shadow.querySelector('.ctxt');
    nodes.dims = shadow.querySelector('.dims');
    nodes.segB = shadow.querySelectorAll('.seg-b');
    nodes.pillMain = shadow.querySelector('.pill-main');
    nodes.cpBtns = shadow.querySelectorAll('button.cp');
    nodes.pillGo = shadow.querySelector('.pill .go');
    nodes.dot = shadow.querySelector('.cluster .dot');
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
    nodes.qacts = shadow.querySelector('.qacts');
    nodes.qcopy = shadow.querySelector('button.qcopy');
    nodes.qedit = shadow.querySelector('button.qedit');
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
    on(nodes.qcopy, 'click', function (e) { e.preventDefault(); e.stopPropagation(); copyText(); }, false);
    on(nodes.qedit, 'click', function (e) { e.preventDefault(); e.stopPropagation(); markTextEdit(); }, false);
    // 维度 chip 用事件委托：renderCard() 每次重建 innerHTML，逐个绑定会漏。
    on(nodes.dims, 'click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.dim-chip') : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      toggleSpec(btn.getAttribute('data-dim') || '');
    }, false);
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
    // 落点开关用事件委托：两个按钮，重建时也不用逐个绑。
    on(nodes.hud, 'click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.seg-b') : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      setLanding(btn.getAttribute('data-slot') || '');
    }, false);
    on(nodes.pillMain, 'click', function (e) { e.preventDefault(); e.stopPropagation(); setMode('pick'); }, false);
    on(nodes.pillMain, 'keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      setMode('pick');
    }, false);
    for (var ci = 0; ci < nodes.cpBtns.length; ci++) {
      on(nodes.cpBtns[ci], 'click', function (e) { e.preventDefault(); e.stopPropagation(); copyPrompt(); }, false);
    }
    var keepHud = function (e) { e.stopPropagation(); };
    on(nodes.hud, 'mousedown', keepHud, false);
    on(nodes.hud, 'mouseup', keepHud, false);
    on(nodes.hud, 'click', keepHud, false);
    // 拖动只认把手：HUD 里全是按钮，整块可拖会把点击吞掉。指针事件 + 捕获，
    // 鼠标移出窗口也还能继续拖；键盘用方向键微调、Home 复位，不只照顾鼠标用户。
    on(nodes.hud, 'pointerdown', function (e) {
      var grip = e.target && e.target.closest ? e.target.closest('.grip') : null;
      if (!grip || e.button !== 0) return;
      var rect = nodes.hud.getBoundingClientRect();
      hudDrag = {
        id: e.pointerId,
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        moved: false,
      };
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      nodes.hud.classList.add('dragging');
      e.preventDefault();
      e.stopPropagation();
    }, false);
    on(nodes.hud, 'pointermove', function (e) {
      if (!hudDrag || hudDrag.id !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      var next = clampHudPosition(
        { x: e.clientX - hudDrag.dx, y: e.clientY - hudDrag.dy, width: hudDrag.width, height: hudDrag.height },
        { viewportWidth: W.innerWidth, viewportHeight: W.innerHeight, margin: 8 },
      );
      hudDrag.moved = true;
      state.hudPos = { x: next.x, y: next.y };
      nodes.hud.style.left = Math.round(next.x) + 'px';
      nodes.hud.style.top = Math.round(next.y) + 'px';
      nodes.hud.style.right = 'auto';
      nodes.hud.style.bottom = 'auto';
    }, false);
    var endHudDrag = function (e) {
      if (!hudDrag || hudDrag.id !== e.pointerId) return;
      var moved = hudDrag.moved;
      hudDrag = null;
      if (nodes.hud) nodes.hud.classList.remove('dragging');
      if (moved) writeHudPos(state.hudPos);
      e.stopPropagation();
    };
    on(nodes.hud, 'pointerup', endHudDrag, false);
    on(nodes.hud, 'pointercancel', endHudDrag, false);
    on(nodes.hud, 'dblclick', function (e) {
      var grip = e.target && e.target.closest ? e.target.closest('.grip') : null;
      if (!grip) return;
      e.preventDefault();
      e.stopPropagation();
      writeHudPos(null);
      applyHudPos(null);
      flash('HUD 已回到右下角');
    }, false);
    on(nodes.hud, 'keydown', function (e) {
      var grip = e.target && e.target.closest ? e.target.closest('.grip') : null;
      if (!grip) return;
      if (e.key === 'Home') {
        e.preventDefault();
        e.stopPropagation();
        writeHudPos(null);
        applyHudPos(null);
        flash('HUD 已回到右下角');
        return;
      }
      var step = e.shiftKey ? 1 : 12;
      var rect = nodes.hud.getBoundingClientRect();
      var x = rect.left;
      var y = rect.top;
      if (e.key === 'ArrowLeft') x -= step;
      else if (e.key === 'ArrowRight') x += step;
      else if (e.key === 'ArrowUp') y -= step;
      else if (e.key === 'ArrowDown') y += step;
      else return;
      e.preventDefault();
      e.stopPropagation();
      applyHudPos({ x: x, y: y });
      writeHudPos(state.hudPos);
    }, false);
    // 位置是上次存下来的：先读出来，render() 里按当前尺寸再钳一次。
    state.hudPos = readHudPos();
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

  /** 复制元素文字：选择器负责定位、文字负责改写，两条路用户都要能一次拿走。 */
  function copyText() {
    var target = state.target;
    var text = target ? String(target.text || '') : '';
    if (!text) { flash('这个元素没有文字可复制'); return; }
    var cut = Boolean(target && target.textTruncated);
    var done = function () {
      flash(cut ? '已复制前 ' + TEXT_CAP + ' 字（原文共 ' + (target.textLength || text.length) + ' 字）' : '已复制元素文字');
    };
    var fail = function () { if (legacyCopy(text)) done(); else flash('复制失败：浏览器未授权剪贴板'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fail);
        return;
      }
    } catch (e) {}
    if (legacyCopy(text)) done(); else flash('复制失败：浏览器未授权剪贴板');
  }

  /**
   * 一键标成「文案改写」：预填一句改写要求（用户可改可删），并把标记跟着标注交上去。
   * 只有「改动」落点可用——参考侧是只读规范，在这里说「改文案」会带着 agent 去改参考页。
   */
  function markTextEdit() {
    var target = state.target;
    if (!target || !String(target.text || '')) { flash('这个元素没有文字可改'); return; }
    if (isReference()) { flash('参考模式只取规范，不改文案：切到「改动」落点再标'); return; }
    state.textEdit = true;
    if (nodes.qedit) {
      nodes.qedit.setAttribute('aria-pressed', 'true');
      nodes.qedit.textContent = '改文案 ✓';
    }
    if (nodes.text) {
      // 已经自己写过要求的别覆盖：那是用户的原话，比预填的模板重要。
      if (!nodes.text.value.trim()) nodes.text.value = TEXT_EDIT_HINT;
      try { nodes.text.focus({ preventScroll: true }); } catch (e) { try { nodes.text.focus(); } catch (err) {} }
      try { nodes.text.setSelectionRange(nodes.text.value.length, nodes.text.value.length); } catch (e) {}
      autosizeText();
    }
    flash('已标为改文案：上面这句要求可以改，也能直接提交');
  }

  /**
   * 复制整份提示词：与面板「复制 Markdown」、agent 工具输出同一份 markdown
   * （host 通过 sync 下发），所以粘到别的 Agent 里也带着「参照：」对照关系。
   */
  function copyPrompt() {
    // 零标注时 host 仍会给一份空态 markdown（「（当前还没有页面元素标注）」），
    // 复制它毫无意义，所以禁用判据看标注条数，不看 prompt 是否为空。
    if (!state.pickCount) { flash('还没有标注：先点一个元素，再复制提示词'); return; }
    var text = state.prompt || '';
    if (!text) { flash('还没有标注：先点一个元素，再复制提示词'); return; }
    var done = function () { flash('提示词已复制，可直接粘贴给任意 Agent'); };
    var fail = function () { flash('复制失败：浏览器未授权剪贴板'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { if (legacyCopy(text)) done(); else fail(); });
        return;
      }
    } catch (e) {}
    if (legacyCopy(text)) done();
    else fail();
  }

  /** http 页面上 navigator.clipboard 不可用：退回选中隐藏 textarea + execCommand。 */
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  /** 页面内提示条（复制成功、换了落点…）：唯一实现，对外 API 也委托它。 */
  function flash(message) {
    if (!nodes.note) return;
    nodes.note.textContent = String(message || '');
    nodes.note.style.display = 'block';
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { nodes.note.style.display = 'none'; }, 2000);
  }

  function isReference() { return state.role === 'reference'; }

  /**
   * 参考模式的措辞与配色。同一套控件必须换一套话：如果参考页的 HUD 仍写
   * 「想怎么改」，用户会顺手写下「改成 X」，agent 就会去改参考页——这正好是
   * 这个功能要杜绝的错。
   */
  function renderRole() {
    var ref = isReference();
    // 计数不再随落点换词（原先写成「参考已标 / 已标注」两套）：落点已经由 seg 的
    // 选中态和圆点颜色说清，同一行再换一次措辞只会让人读成「这里统计的是别的东西」。
    var tip =
      '本页已标 ' + state.targetCount + ' 处改动、' + state.referenceCount + ' 处参照；当前落点：' + (ref ? '参照' : '改动');
    if (nodes.met) nodes.met.title = tip;
    if (nodes.pillGo) {
      nodes.pillGo.textContent = ref ? '标注参考' : '开启标注';
      nodes.pillGo.classList.toggle('ref', ref);
    }
    if (nodes.dot) nodes.dot.classList.toggle('ref', ref);
    if (nodes.doneBtn) nodes.doneBtn.textContent = ref ? '完成·加入参考' : '完成并插入';
    if (nodes.text)
      nodes.text.placeholder = ref
        ? '要参考这里的什么？例如：间距 16px、卡片圆角、按钮配色…'
        : '说明怎么改：字号 / 间距 / 颜色 / 文案 / 布局…';
    if (nodes.card) nodes.card.classList.toggle('ref', ref);
    // 落点开关跟着亮：这是 HUD 上唯一能改「下一处进哪一栏」的地方，按钮自己必须
    // 说清现在是哪一栏，而不是让用户从颜色去猜。
    var slot = state.landing === 'reference' ? 'reference' : 'target';
    for (var s = 0; nodes.segB && s < nodes.segB.length; s++) {
      var on = nodes.segB[s].getAttribute('data-slot') === slot;
      nodes.segB[s].classList.toggle('on', on);
      nodes.segB[s].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function renderDims() {
    if (!nodes.dims) return;
    var ref = isReference();
    nodes.dims.classList.toggle('on', ref);
    if (!ref) {
      nodes.dims.innerHTML = '';
      return;
    }
    var html = '';
    for (var i = 0; i < state.specs.length; i++) {
      var dim = String(state.specs[i]);
      html +=
        '<button type="button" class="dim-chip" data-dim="' +
        dim +
        '" aria-pressed="' +
        (state.spec.indexOf(dim) >= 0) +
        '">' +
        dim +
        '</button>';
    }
    nodes.dims.innerHTML = html;
  }

  /** 维度是「这一处参考什么」的快捷标注，最终随 pick 一起交给 agent。 */
  function toggleSpec(dim) {
    if (!dim) return;
    var index = state.spec.indexOf(dim);
    if (index >= 0) state.spec.splice(index, 1);
    else state.spec.push(dim);
    renderDims();
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
    if (nodes.hud) {
      nodes.hud.style.display = 'block';
      // 上次拖到的位置：先显示再套，套的时候 HUD 才有真实尺寸可钳。
      if (state.hudPos) applyHudPos(state.hudPos);
    }
    nodes.cluster.style.display = on ? 'flex' : 'none';
    nodes.pill.style.display = on ? 'none' : 'flex';
    nodes.cnt.textContent = String(n);
    nodes.pcnt.textContent = String(n);
    nodes.undoBtn.disabled = nodes.doneBtn.disabled = n === 0;
    // 一条标注都没有时「复制提示词」没有内容可复制：直接禁用，别让用户点了才发现。
    var canCopy = state.pickCount > 0;
    for (var pi = 0; pi < nodes.cpBtns.length; pi++) {
      nodes.cpBtns[pi].disabled = !canCopy;
      nodes.cpBtns[pi].setAttribute('aria-disabled', canCopy ? 'false' : 'true');
      nodes.cpBtns[pi].title = canCopy
        ? '复制全部标注的提示词（' + HOTKEY_C + '），可粘贴到其它 Agent'
        : '还没有标注：先在页面上点一处元素，再复制提示词';
    }
    renderRole();
    if (!on) hideCard();
  }

  /** 选中后一直亮着：用户写批注时不至于忘了自己指的是哪个元素。 */
  function showMark(rect) {
    if (!nodes.mark || !rect) return;
    nodes.mark.style.display = 'block';
    place(nodes.mark, rect.x, rect.y);
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
    if (nodes.card && nodes.card.style.display !== 'none') positionCard(state.target.rect, state.anchor);
  }

  function closeCard() {
    stopFocusKeeper();
    hideMark();
    if (nodes.card) nodes.card.style.display = 'none';
    var restore = lastFocused;
    lastFocused = null;
    // restore.focus() 默认会把目标元素滚进视口：Windows 上点按钮会先给它焦点，
    // 提交后这一下 focus 就可能把页面滚走一点，看起来像「插完标注浏览器抖一下」。
    if (restore && typeof restore.focus === 'function') {
      try { restore.focus({ preventScroll: true }); } catch (e) { try { restore.focus(); } catch (err) {} }
    }
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
    // 「改文案」标记只对改动生效：参考侧不写这一位，免得 agent 把只读页的文案也换掉。
    if (!isReference() && state.textEdit && String(state.target.text || '')) payload.textEdit = true;
    // 参考页的维度跟着标注一起上交：缺了它 agent 只能猜「参考哪里」。
    if (isReference() && state.spec.length) payload.spec = state.spec.slice();
    payload.seq = ++state.seq;
    state.spec = [];
    state.textEdit = false;
    state.locked = false;
    state.target = null;
    state.targetEl = null;
    // 先把卡片藏起来再清内容：反过来的话，多行备注会让卡片先缩回单行高度、下一帧才消失，
    // 用户看到的就是提交瞬间「闪/抖」一下。隐藏后再改 textarea，页面只渲染最终态。
    closeCard();
    nodes.text.value = '';
    nodes.text.style.height = '';
    nodes.box.style.display = 'none';
    nodes.lbl.style.display = 'none';
    send(payload);
    render();
  }

  function placeCard(rect, anchor) {
    lastFocused = document.activeElement;
    state.anchor = anchor || null;
    nodes.card.style.display = 'block';
    positionCard(rect, state.anchor);
    lockPageFocus();
    try { nodes.text.focus({ preventScroll: true }); } catch (e) { nodes.text.focus(); }
    startFocusKeeper();
  }

  /**
   * 只算几何：滚动、改窗口、批注变长时复用，避免重复聚焦和重播入场动画。
   *
   * 早先只有「下方 / 上方」两种摆法，下方放不下时取 top = max(8, rect.y - h - 8)：
   * 目标贴着视口顶部、或者目标本身就是一大块（页面里选个大容器很常见）时，
   * top 会落到 8 —— 卡片直接跳到视口左上角，正好盖住刚点中的元素，
   * 看起来就是「标注框跳到左上角、形状被遮挡」。现在先把卡片夹进视口再摆，
   * 只是贴着目标，不会再整张跑到角落里去。
   */
  function positionCard(rect, anchor) {
    var card = nodes.card;
    if (!card || !rect) return;
    var vw = W.innerWidth || 1200;
    var vh = W.innerHeight || 800;
    // 用 offsetWidth/offsetHeight 而不是 getBoundingClientRect()：入场动画期间卡片
    // 带着 scale(.985)，rect 量出来是缩小后的尺寸，定位会差几个像素。
    var w = card.offsetWidth || 308;
    var h = card.offsetHeight || 190;
    var gap = 8;
    var maxLeft = Math.max(gap, vw - w - gap);
    var maxTop = Math.max(gap, vh - h - gap);
    var clampLeft = function (x) { return Math.min(Math.max(gap, x), maxLeft); };
    var clampTop = function (y) { return Math.min(Math.max(gap, y), maxTop); };
    // 下方优先；下方放不下就看上方；上下都放不下（目标很高）时选空间更大的一侧，
    // 再夹进视口——于是最坏情况只是压住目标的一条边，而不是跳到左上角。
    var roomBelow = vh - gap - (rect.y + rect.height + gap);
    var roomAbove = rect.y - gap - gap;
    var below;
    if (roomBelow >= h) below = true;
    else if (roomAbove >= h) below = false;
    else if (anchor && anchor.y >= 0) {
      // 上下都放不下（目标几乎占满视口，或者比视口还高）：往鼠标点的反方向放。
      // 用户点在上半屏就把卡片压到视口底部，别正好盖住他正在看的那一块。
      below = anchor.y < vh / 2;
    } else below = roomBelow >= roomAbove;
    var left = clampLeft(rect.x + rect.width / 2 - w / 2);
    var top = clampTop(below ? rect.y + rect.height + gap : rect.y - h - gap);
    place(card, left, top);
    // 尖角对准元素的水平中心，但夹在卡片圆角之内，免得跑到边框外面。
    var notch = Math.max(18, Math.min(w - 30, rect.x + rect.width / 2 - left - 6));
    card.style.setProperty('--vp-notch', notch + 'px');
    // 尖角朝向按实际几何决定：卡片整体在目标下方才朝上指，在上方才朝下指；
    // 两者都不成立（夹回来之后和目标的边重叠）就不画尖角，免得指向不相干的方向。
    var intersectsX = left + w > rect.x && left < rect.x + rect.width;
    card.classList.toggle('below', intersectsX && top >= rect.y + rect.height - 1);
    card.classList.toggle('above', intersectsX && top + h <= rect.y + 1);
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
    place(nodes.box, rect.x, rect.y);
    nodes.box.style.width = rect.width + 'px';
    nodes.box.style.height = rect.height + 'px';
    nodes.lbl.style.display = 'block';
    nodes.lbl.textContent = String(opts.label || '');
    var lblTop = rect.y - 22;
    place(nodes.lbl, Math.max(4, rect.x), lblTop < 4 ? rect.y + 2 : lblTop);
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
    place(nodes.box, rect.x, rect.y);
    nodes.box.style.width = rect.width + 'px';
    nodes.box.style.height = rect.height + 'px';
    nodes.lbl.style.display = 'block';
    nodes.lbl.textContent = el.localName + (el.id ? '#' + el.id : '') + ' · ' + Math.round(rect.width) + '×' + Math.round(rect.height);
    var lblTop = rect.y - 22;
    place(nodes.lbl, Math.max(4, rect.x), lblTop < 4 ? rect.y + 2 : lblTop);
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
      // 卡片只展示开头 90 字（再多会挤掉输入框），完整原文走「复制文字」与提示词。
      var flat = String(state.target.text || '').replace(/\s+/g, ' ').trim();
      // 卡片只展示开头 90 字（再多会挤掉输入框），完整原文走「复制文字」与提示词。
      var snippet = flat.length > 90 ? flat.slice(0, 90) + '…' : flat;
      nodes.quote.textContent = snippet;
      nodes.quote.style.display = snippet ? 'block' : 'none';
      // 文案动作只在「点到的元素真有文字」时出现：图片、图标、空容器上留两个点不动的按钮只是噪音。
      var hasText = Boolean(flat);
      if (nodes.qacts) {
        nodes.qacts.style.display = hasText ? 'flex' : 'none';
        nodes.qcopy.style.display = hasText ? '' : 'none';
        // 参考侧没有「改文案」：那一栏是只读规范。
        nodes.qedit.style.display = hasText && !isReference() ? '' : 'none';
        nodes.qedit.setAttribute('aria-pressed', 'false');
        nodes.qedit.textContent = '改文案';
      }
      state.textEdit = false;
      nodes.text.value = '';
      nodes.text.style.height = '';
      state.spec = [];
      renderDims();
      // 参考模式的第一次拾取明确说一句「这里不会改」：蓝色徽标不够，用户第一次
      // 用还不知道蓝色是什么意思。
      if (isReference() && !state.hinted) {
        state.hinted = true;
        W.__DSH_VP__.flash('参考模式：这里只取规范，不会修改此页');
      }
      // 记下点击位置：目标很大时靠它决定卡片往哪边躲。
      placeCard(state.target.rect, { x: e.clientX, y: e.clientY });
      render();
    } catch (err) {
      state.locked = false;
      state.target = null;
      W.__DSH_VP_LAST_ERROR__ = String((err && err.stack) || err);
    }
  }

  function onKey(e) {
    // 输入法组合中（Windows 的 Alt 组合、中文输入法的 Alt 键位）不抢键：
    // 此时 e.key 不是用户想按的字母，抢下来会打断上屏。
    if (e.isComposing || e.keyCode === 229) return;
    // 页面里直接 Alt+A 切换标注模式：经 binding 上报 host，面板与其它标签页同步。
    // macOS 的 Option+A 会把 e.key 组合成 å（Alt+R 同理是 ®），所以两处都按物理键
    // e.code 判定——Windows 的 Alt+A / Alt+R 也走同一条分支，键位不用分平台维护。
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyA' || e.key === 'a' || e.key === 'A')) {
      if (state.locked) return;
      e.preventDefault();
      e.stopPropagation();
      setMode(state.mode === 'pick' ? 'off' : 'pick');
      return;
    }
    // ⌥R 一键换落点：正在写批注时（locked）让位给输入，别把字吃掉。
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyR' || e.key === 'r' || e.key === 'R')) {
      if (state.locked) return;
      e.preventDefault();
      e.stopPropagation();
      var next = state.landing === 'reference' ? 'target' : 'reference';
      var wasOff = state.mode !== 'pick';
      // 落点没变（例如本来就是参照）时 setLanding 不发消息，但「从关闭态一键进参照」
      // 仍要 host 收到落点，所以这里补一条。重复下发是幂等的。
      if (wasOff) send({ kind: 'landing', slot: next });
      setLanding(next);
      if (wasOff) setMode('pick');
      return;
    }
    // ⌥C 复制整份提示词：不展开 HUD 也能把已有标注拿去别的 Agent 用。
    // 正在写批注时让位给输入，和 ⌥R 同一条规矩。
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyC' || e.key === 'c' || e.key === 'C')) {
      if (state.locked) return;
      e.preventDefault();
      e.stopPropagation();
      copyPrompt();
      return;
    }
    if (e.key !== 'Escape') return;
    if (state.locked) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    if (state.mode === 'pick') { e.preventDefault(); e.stopPropagation(); setMode('off'); }
  }

  /**
   * 换落点：下一处标注进「改动」还是「参照」。与面板上的「＋ 新增改动 / ＋ 添加参照」
   * 是同一条契约（binding kind=landing），面板会通过 /state 看到并跟着切到参照模式。
   */
  function setLanding(slot) {
    slot = slot === 'reference' ? 'reference' : 'target';
    var changed = state.landing !== slot;
    // 乐观置位：HUD 必须在这一帧就换颜色，等 host 回推会有一段可见的延迟。
    state.landing = slot;
    state.role = slot;
    renderRole();
    if (changed) {
      send({ kind: 'landing', slot: slot });
      flash(slot === 'reference' ? '下一处标注进「参照」栏' : '下一处标注进「改动」栏');
    }
    if (state.mode === 'pick') flush();
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
    version: 4,
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
      // role 由 host 按「落点」判定（没有落点就是改动）：切按钮后 HUD 必须立刻换口径。
      if (info.role === 'reference' || info.role === 'target') {
        if (info.role !== state.role) state.hinted = false;
        state.role = info.role;
      }
      if (info.landing === 'reference' || info.landing === 'target') state.landing = info.landing;
      else state.landing = '';
      if (typeof info.targetCount === 'number') state.targetCount = info.targetCount;
      if (typeof info.referenceCount === 'number') state.referenceCount = info.referenceCount;
      if (typeof info.refLabel === 'string') state.refLabel = info.refLabel;
      if (Array.isArray(info.specs)) state.specs = info.specs.map(function (item) { return String(item); });
      // 提示词由 host 生成（与面板复制、工具输出同一份）：页面不自己拼，避免第三份会漂移的实现。
      if (typeof info.prompt === 'string') state.prompt = info.prompt;
      // 全任务标注条数（不是本页条数）：复制提示词复制的就是全部页面，禁用判据也该看它。
      if (typeof info.pickCount === 'number') state.pickCount = info.pickCount;
      if (info.mode === 'pick' || info.mode === 'off') setMode(info.mode, true);
      else if (nodes.host) render();
    },
    flash: flash
  };

  W.__DSH_VP_DEBUG__ = function () {
    return {
      rev: REV,
      mode: state.mode,
      locked: state.locked,
      seq: state.seq,
      count: state.count,
      landing: state.landing,
      role: state.role,
      prompt: state.prompt ? state.prompt.length : 0,
      pickCount: state.pickCount,
      hudPos: state.hudPos,
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
  // 窗口变小后，拖到屏幕外的 HUD 得被拉回来，否则用户再也找不到它。
  on(W, 'resize', function () { if (state.hudPos) applyHudPos(state.hudPos); }, false);
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

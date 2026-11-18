/**
 * dsh-annotator — Web (client) half.
 *
 * One native right-sidebar tab: a control deck for the visible Chrome/Edge
 * window the host half drives.
 *
 * Layout (v10): status header -> connect strip -> annotation switch -> cards ->
 * single primary action. Everything global and destructive lives behind the
 * overflow menu; the panel is a container query so it survives a narrow rail.
 */

window.__ModuleLoader__.load({
	id: 'dsh-annotator',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		var React = require('react');
		var h = React.createElement;
		var useState = React.useState;
		var useEffect = React.useEffect;
		var useMemo = React.useMemo;
		var useRef = React.useRef;

		var inject = ['slots', 'sidebarRight', 'sidebarRightTabs'];
		var TAB_ID = 'dsh-annotator';
		var TAB_KIND = 'visual-annotator';
		var API = '/api/visual-annotator';
		/** Bumped together with HOST_REV (lib/index.js); a mismatch means panel and host came from different builds. */
		var PANEL_BUILD = 'v63';
		/**
		 * 与 lib/shared/annotation-markdown.js 的 TASK_REFERENCE / TASK_PLAIN 逐字一致：插入到
		 * 输入框的草稿开头、复制出去的提示词开头必须是同一句任务。两处各写一份就会漂——
		 * 用户会同时看到「按标注改」与「任务：按「改动」标注…」两套说法。
		 * test/panel-target-visual.test.mjs 逐字比对这两个字面量，改一处漏一处会红。
		 */
		var TASK_REFERENCE =
			'任务：按「改动」标注修改对应元素；「参照」只提供样式与结构，别改它指向的元素，也别改它的代码。改动与参照按编号逐行对应：一处改动可以参照多条；一条参照也可以被多处改动共用，重复出现即指同一处参照。';
		var TASK_PLAIN = '任务：按下列标注修改对应元素。';
		var POLL_VISIBLE_MS = 1500;
		// macOS 的 Option 是组合键：快捷键提示按平台显示 ⌥Option+A / Alt+A。
		var HOTKEY = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '') ? '⌥Option+A' : 'Alt+A';
		var POLL_HIDDEN_MS = 15000;

		var CSS = [
			/* ---- tokens ------------------------------------------------------ */
			'.vp-root{--vp-border:var(--dsw-alias-border-l2,rgba(127,127,127,.24));' +
				'--vp-muted:var(--dsw-alias-text-secondary,rgba(105,110,120,.95));' +
				'--vp-accent:#1f6feb;--vp-accent-fg:#fff;--vp-accent-weak:rgba(31,111,235,.10);' +
				'--vp-danger:#cf222e;--vp-danger-weak:rgba(207,34,46,.10);' +
				'--vp-ok:#1a7f37;--vp-warn:#9a6700;' +
				// 「改动」一栏的专属色（暖橙）：与参照的蓝分家，卡片边框、序号、归属 chip 都用它，
				// 用户扫一眼就能把「这条改动」和「它照的几处蓝标」连起来。
				'--vp-target:#b45309;--vp-target-fg:#fff;--vp-target-weak:rgba(180,83,9,.12);' +
				'--vp-target-soft:rgba(180,83,9,.10);--vp-ref:#2f6fd0;--vp-ref-soft:rgba(47,111,208,.10);' +
				'--vp-surface:rgba(127,127,127,.06);--vp-surface-2:rgba(127,127,127,.12);' +
				'position:relative;display:flex;flex-direction:column;height:100%;min-height:0;' +
				'font:13px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit;container-type:inline-size}',
			'@media (prefers-color-scheme:dark){.vp-root{--vp-accent:#79b8ff;--vp-accent-fg:#0b1c33;' +
				'--vp-accent-weak:rgba(121,184,255,.16);--vp-danger:#ff7b72;--vp-ok:#3fb950;--vp-warn:#d29922;' +
				'--vp-target:#e8b473;--vp-target-fg:#2a1a06;--vp-target-weak:rgba(232,180,115,.18);' +
				'--vp-target-soft:rgba(232,180,115,.16);--vp-ref:#9cc2ff;--vp-ref-soft:rgba(75,140,247,.18)}}',
			'html[data-theme="dark"] .vp-root,.dark .vp-root{--vp-accent:#79b8ff;--vp-accent-fg:#0b1c33;' +
				'--vp-accent-weak:rgba(121,184,255,.16);--vp-danger:#ff7b72;--vp-ok:#3fb950;--vp-warn:#d29922;' +
				'--vp-target:#e8b473;--vp-target-fg:#2a1a06;--vp-target-weak:rgba(232,180,115,.18);' +
				'--vp-target-soft:rgba(232,180,115,.16);--vp-ref:#9cc2ff;--vp-ref-soft:rgba(75,140,247,.18)}',
			'.vp-root :focus-visible{outline:2px solid var(--vp-accent);outline-offset:2px;border-radius:4px}',
			'.vp-root button{font:inherit}',

			/* ---- header ------------------------------------------------------ */
			'.vp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--vp-border);flex:none}',
			'.vp-title{font-weight:600;font-size:13px;flex:none;letter-spacing:.2px}',
			'.vp-pill{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;padding:2px 8px;' +
				'border-radius:999px;background:var(--vp-surface);border:1px solid var(--vp-border);font-size:12px;color:var(--vp-muted);white-space:nowrap}',
			'.vp-pill .dot{width:6px;height:6px;border-radius:50%;background:var(--vp-muted);flex:none}',
			'.vp-pill[data-state="ready"] .dot{background:var(--vp-ok)}',
			'.vp-pill[data-state="pick"]{background:var(--vp-accent-weak);border-color:transparent;color:var(--vp-accent)}',
			'.vp-pill[data-state="pick"] .dot{background:var(--vp-accent);box-shadow:0 0 0 3px var(--vp-accent-weak)}',
			'.vp-pill[data-state="starting"] .dot{background:var(--vp-warn)}',
			'.vp-pill[data-state="error"] .dot{background:var(--vp-danger)}',
			'.vp-pill span{overflow:hidden;text-overflow:ellipsis}',
			'.vp-spacer{flex:1}',
			'.vp-headmode{display:flex;align-items:center;gap:6px;flex:none}',
			'.vp-switch-label{font-size:12px;color:var(--vp-muted);flex:none;user-select:none}',
			'.vp-switch-label.on{color:var(--vp-accent)}',
			'.vp-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;' +
				'border:1px solid transparent;border-radius:6px;background:transparent;color:var(--vp-muted);cursor:pointer}',
			'.vp-icon-btn:hover{background:var(--vp-surface-2);color:inherit}',
			// 菜单开着只换图标颜色，不再铺底色：底色 hover 同款，看着像一直被按下。
			'.vp-icon-btn.on{background:transparent;color:inherit}',

			/* ---- overflow menu ---------------------------------------------- */
			'.vp-menu{position:absolute;right:10px;top:46px;z-index:20;min-width:168px;padding:4px;border-radius:8px;' +
				'background:var(--dsw-specific-menu-bg,Canvas);color:inherit;border:1px solid var(--vp-border);' +
				'box-shadow:0 10px 30px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:2px}',
			'.vp-menu button{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 9px;border:none;' +
				'border-radius:5px;background:transparent;color:inherit;font-size:13px;text-align:left;cursor:pointer}',
			'.vp-menu button:hover{background:var(--vp-surface-2)}',
			'.vp-menu button.danger{color:var(--vp-danger)}',
			'.vp-menu .kbd{font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--vp-muted)}',

			/* ---- banners ----------------------------------------------------- */
			'.vp-banner{display:flex;align-items:flex-start;gap:8px;margin:8px 12px 0;padding:8px 10px;border-radius:8px;font-size:12px;flex:none}',
			'.vp-banner.error{background:var(--vp-danger-weak);color:var(--vp-danger)}',
			'.vp-banner.warn{background:rgba(154,103,0,.12);color:var(--vp-warn)}',
			'.vp-banner span{flex:1;min-width:0;word-break:break-word}',
			'.vp-banner .vp-btn{flex:none}',

			/* ---- connect ----------------------------------------------------- */
			'.vp-connect{display:flex;gap:6px;padding:10px 12px 8px;flex:none}',
			'.vp-input{flex:1;min-width:0;height:32px;padding:0 9px;border-radius:6px;border:1px solid var(--vp-border);' +
				'background:var(--dsw-specific-input-major,transparent);color:inherit;' +
				'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;outline:none}',
			'.vp-input::placeholder{color:var(--vp-muted)}',
			'.vp-input:focus{border-color:var(--vp-accent)}',
			'.vp-select{flex:none;height:32px;max-width:112px;padding:0 6px;border-radius:6px;border:1px solid var(--vp-border);' +
				'background:var(--vp-surface);color:inherit;font:12px/1 system-ui,sans-serif;cursor:pointer;outline:none}',
			'.vp-select:focus{border-color:var(--vp-accent)}',
			'.vp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 12px;' +
				'border-radius:6px;border:1px solid var(--vp-border);background:transparent;color:inherit;' +
				'font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s ease-out,border-color .15s ease-out}',
			'.vp-btn:hover:not(:disabled){background:var(--vp-surface-2)}',
			'.vp-btn:disabled{opacity:.45;cursor:default}',
			'.vp-btn.pri{background:var(--vp-accent);border-color:var(--vp-accent);color:var(--vp-accent-fg);font-weight:600}',
			'.vp-btn.pri:hover:not(:disabled){filter:brightness(.94)}',
			'.vp-btn.block{width:100%;min-height:36px;font-size:13px}',
			'.vp-btn.sm{min-height:28px;padding:0 9px;font-size:12px}',
			'.vp-btn.danger{color:var(--vp-danger);border-color:color-mix(in srgb,var(--vp-danger) 40%,transparent)}',

			/* ---- tabs -------------------------------------------------------- */
			'.vp-spaces{display:flex;align-items:center;gap:6px;padding:0 12px 8px;flex:none;min-width:0}',
			'.vp-spaces .vp-label{flex:none;font-size:12px;color:var(--vp-muted)}',
			'.vp-spaces .vp-select{flex:1;max-width:none}',
			'.vp-tabs{position:relative;display:flex;flex-direction:column;gap:6px;padding:0 12px 8px;flex:none;min-width:0}',
			'.vp-tabs-head{display:flex;align-items:center;gap:6px;min-width:0}',
			'.vp-tabs .cap{font-size:12px;color:var(--vp-muted);flex:none}',
			'.vp-tabs .hint{font-size:11px;color:var(--vp-muted);flex:none;opacity:.85}',
			'.vp-tabs-head .vp-btn.on{background:var(--vp-accent-weak);border-color:transparent;color:var(--vp-accent)}',
			/* 平铺：放不下就换行，不再横向滚动。 */
			'.vp-tablist{display:flex;flex-wrap:wrap;gap:4px;min-width:0}',
			'.vp-tabmore{position:absolute;left:12px;right:12px;top:100%;z-index:25;max-height:216px;overflow-y:auto;' +
				'padding:6px;border-radius:8px;border:1px solid var(--vp-border);background:var(--vp-surface);' +
				'box-shadow:0 12px 28px rgba(0,0,0,.32);display:flex;flex-direction:column;gap:4px}',
			'.vp-tab.wide{max-width:none;width:100%;justify-content:flex-start}',
			'.vp-tab{display:inline-flex;align-items:center;gap:5px;max-width:150px;padding:0 8px;height:26px;flex:none;' +
				'border:1px solid var(--vp-border);border-radius:999px;background:transparent;color:inherit;font-size:12px;cursor:pointer}',
			'.vp-tab:hover{background:var(--vp-surface-2)}',
			'.vp-tab.on{background:var(--vp-accent-weak);border-color:transparent;color:var(--vp-accent);font-weight:600}',
			'.vp-tab b{font-size:11px;opacity:.7;font-weight:600}',
			'.vp-tab .vp-tab-warn{display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;' +
				'font-size:10px;font-weight:700;border-radius:50%;color:#191210;background:#f0a05a;opacity:1}',
			'.vp-tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

			/* ---- 模式开关：一枚胶囊，普通 / 参考 ------------------------------ */
			'.vp-mode{display:inline-flex;align-self:flex-start;gap:1px;margin:0 12px 8px;padding:2px;' +
				'border-radius:999px;background:var(--vp-surface-2);flex:none;box-shadow:inset 0 0 0 1px var(--vp-border)}',
			'.vp-mode button{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 12px;border:0;border-radius:999px;' +
				'background:transparent;color:var(--vp-muted);font:600 12px/1 system-ui,sans-serif;cursor:pointer;white-space:nowrap}',
			'.vp-mode button .dot{width:7px;height:7px;border-radius:50%;background:var(--vp-muted);opacity:.55}',
			'.vp-mode button.on{background:var(--vp-accent);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.22)}',
			'.vp-mode button.on .dot{background:#fff;opacity:1}',
			'.vp-mode button.ref .dot{background:#4b8cf7;opacity:1}',
			'.vp-mode button.on.ref{background:#2f6fd0}',
			'.vp-mode .n{font-size:10.5px;opacity:.75;margin-left:2px}',

			/* ---- 参照模式的两个页面槽：改动 / 参照 ----------------------------- */
			'.vp-slot{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
			'.vp-slot .cap{font-size:11px;color:var(--vp-muted);letter-spacing:.02em}',
			'.vp-slot-btn{display:flex;align-items:center;gap:5px;width:100%;height:30px;padding:0 8px;border-radius:8px;' +
				'border:1px dashed var(--vp-border);background:transparent;color:inherit;font:12px/1 system-ui,sans-serif;' +
				'cursor:pointer;text-align:left;min-width:0}',
			'.vp-slot-btn:hover{background:var(--vp-surface-2)}',
			'.vp-slot-btn .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}',
			'.vp-slot-btn .r{flex:none;font:600 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 5px;' +
				'border-radius:4px;background:var(--vp-surface-2);color:var(--vp-muted)}',
			'.vp-slot[data-role="target"] .vp-slot-btn{border-style:solid;' +
				'border-color:color-mix(in srgb,var(--vp-accent) 45%,var(--vp-border))}',
			'.vp-slot[data-role="target"] .r{background:var(--vp-accent-weak);color:var(--vp-accent)}',
			'.vp-slot[data-role="reference"] .vp-slot-btn{border-style:solid;border-color:rgba(75,140,247,.5)}',
			'.vp-slot[data-role="reference"] .r{background:rgba(75,140,247,.16);color:#2f6fd0}',
			'html[data-theme="dark"] .vp-slot[data-role="reference"] .r,.dark .vp-slot[data-role="reference"] .r{color:#9cc2ff}',
			'.vp-slotmenu{position:absolute;left:0;right:0;top:100%;margin-top:4px;z-index:30;padding:4px;border-radius:8px;' +
				'border:1px solid var(--vp-border);background:var(--dsw-specific-menu-bg,Canvas);' +
				'box-shadow:0 10px 26px rgba(0,0,0,.28);display:flex;flex-direction:column;gap:2px;max-height:224px;overflow:auto}',
			'.vp-slotmenu button{display:flex;align-items:center;gap:6px;padding:6px 8px;border:none;border-radius:5px;' +
				'background:transparent;color:inherit;font-size:12px;text-align:left;cursor:pointer;min-width:0}',
			'.vp-slotmenu button:hover{background:var(--vp-surface-2)}',
			'.vp-slotmenu button.on{color:var(--vp-accent);font-weight:600}',
			'.vp-slotmenu .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
			'.vp-slotmenu .why{margin-left:auto;font-size:11px;color:var(--vp-muted);flex:none}',

			/* ---- 一行一对：左=要改的，右=要参照的 ----------------------------- */
			'.vp-slot .more{flex:none;font-size:10.5px;font-weight:600;padding:1px 4px;border-radius:999px;' +
				'background:rgba(75,140,247,.16);color:#2f6fd0}',
			'html[data-theme="dark"] .vp-slot .more,.dark .vp-slot .more{color:#9cc2ff}',
			'.vp-closed{flex:none;font-size:10px;line-height:1;padding:2px 4px;border-radius:3px;' +
				'background:color-mix(in srgb,var(--vp-warn, #b7791f) 18%,transparent);color:#8a5a10;white-space:nowrap}',
			'html[data-theme="dark"] .vp-closed,.dark .vp-closed{color:#e5c07b}',
			'.vp-plain{display:flex;flex-direction:column;gap:8px}',
			'.vp-refnote{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border-radius:7px;' +
				'border:1px solid rgba(75,140,247,.32);background:rgba(75,140,247,.07);color:inherit;' +
				'font:12px/1.4 system-ui,sans-serif;text-align:left;cursor:pointer}',
			'.vp-refnote:hover{background:rgba(75,140,247,.13)}',
			'.vp-refnote .r{flex:none;font:600 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:2px 4px;' +
				'border-radius:3px;background:rgba(75,140,247,.18);color:#2f6fd0}',
			'html[data-theme="dark"] .vp-refnote .r,.dark .vp-refnote .r{color:#9cc2ff}',
			'.vp-refnote .n{margin-left:auto;font-size:11px;color:var(--vp-muted);white-space:nowrap}',
			'.vp-refnote .go{flex:none;font-size:11.5px;color:var(--vp-accent);white-space:nowrap}',
			'.vp-pairs{display:flex;flex-direction:column;gap:10px}',
			/* 两栏表头：左「改动」右「参照」。两栏之间靠一条竖线分开——以前只留 8px 空档，
			   左卡又是 3px 左边框、右卡是 1px 四边，两栏文字起点差 2px，看起来就是「没隔开也没对齐」。 */
			'.vp-colhead{display:grid;grid-template-columns:1fr 1fr;gap:0;align-items:stretch;' +
				'border-bottom:1px solid var(--vp-border)}',
			'.vp-colhead .col{min-width:0;display:flex;flex-direction:column;gap:2px;' +
				'padding:0 12px 7px 0;box-sizing:border-box}',
			'.vp-colhead .col+.col{padding:0 0 7px 12px;border-left:1px solid var(--vp-border)}',
			'.vp-chead{display:flex;align-items:center;gap:4px;min-width:0}',
			'.vp-chead .k{flex:none;font:600 10.5px/1 system-ui,sans-serif;padding:2px 5px;border-radius:4px;' +
				'background:var(--vp-target-weak);color:var(--vp-target)}',
			'.vp-chead .k.ref{background:rgba(75,140,247,.16);color:#2f6fd0}',
			'.vp-chead .num{flex:none;font:600 10px/1 system-ui,sans-serif;padding:2px 5px;border-radius:999px;' +
				'background:var(--vp-surface-2);color:var(--vp-muted)}',
			'html[data-theme="dark"] .vp-chead .k.ref,.dark .vp-chead .k.ref{color:#9cc2ff}',
			/* 栏头右侧「清空」：只清这一栏。空栏禁用——点了也没东西可清，别让按钮骗人。 */
			'.vp-chead-clear{flex:none;margin-left:auto;padding:2px 6px;border:0;border-radius:4px;background:transparent;' +
				'color:var(--vp-muted);font:500 10.5px/1 system-ui,sans-serif;cursor:pointer}',
			'.vp-chead-clear:hover:not(:disabled){background:var(--vp-target-weak);color:var(--vp-target)}',
			'.vp-chead-clear:disabled{opacity:.35;cursor:default}',
			/* 底部「批量操作」开关的激活态：高亮底色让人看出勾选框为何出现。 */
			'.vp-btn.on{background:var(--vp-target-weak);color:var(--vp-target)}',
			/* 勾选清空：方框在卡片序号左边，选中条横跨两栏挂在栏头下方。 */
			'.vp-check{flex:none;width:15px;height:15px;margin:0 3px 0 0;padding:0;border-radius:4px;position:relative;' +
				'border:1.5px solid color-mix(in srgb,var(--vp-muted) 55%,transparent);background:transparent;cursor:pointer}',
			'.vp-check:hover{border-color:var(--vp-target)}',
			'.vp-check.on{background:var(--vp-target);border-color:var(--vp-target)}',
			'.vp-check.on::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;' +
				'border:solid var(--vp-target-fg);border-width:0 1.5px 1.5px 0;transform:rotate(42deg)}',
			'.vp-cell.picked{background:var(--vp-target-soft)}',
			'.vp-selbar{grid-column:1/-1;display:flex;align-items:center;gap:8px;margin-top:6px;padding:5px 8px;' +
				'border-radius:6px;background:var(--vp-target-weak);font:500 11px/1.3 system-ui,sans-serif}',
			'.vp-selbar .sp{flex:1}',
			'.vp-selbar button{padding:2px 6px;border:0;border-radius:4px;background:transparent;color:var(--vp-muted);' +
				'font:inherit;cursor:pointer}',
			'.vp-selbar button:hover{background:rgba(127,127,127,.16);color:inherit}',
			'.vp-selbar button.danger{color:var(--vp-target);font-weight:700}',
			/* 左右两栏：左栏改动（每条改动一张卡，卡下挂它参照的标注），右栏参照平铺。
			   竖线与表头同一条线：两栏的栅格线只在 gap 是 0 时才重合，所以分隔靠每列的内距 + 第二列边框。 */
			'.vp-cols{display:grid;grid-template-columns:1fr 1fr;gap:0;align-items:stretch}',
			'.vp-col{display:flex;flex-direction:column;gap:8px;min-width:0;' + 'padding:0 12px 0 0;box-sizing:border-box}',
			'.vp-col+.vp-col{padding:0 0 0 12px;border-left:1px solid var(--vp-border)}',
			'.vp-col>*{min-width:0}',
			'.vp-grpwrap{display:flex;flex-direction:column;gap:6px}',
			/* position:relative 给「选择参照」浮层当定位父级（见 .vp-refmenu）。 */
			'.vp-tcell{position:relative;display:flex;flex-direction:column;gap:6px;min-width:0}',
			// 卡下那条关系行（左=配了哪些参照，右=归属谁）：两栏都得有、且同高，否则逐行必错位
			'.vp-relrow{display:flex;align-items:center;gap:6px;height:26px;min-width:0;flex:none;overflow:hidden}',
			'.vp-relrow .vp-cell-badge{margin-left:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.vp-tcell.drop .vp-cell{border-color:var(--vp-accent);box-shadow:inset 0 0 0 1px var(--vp-accent-weak)}',
			'.vp-empty-hint{padding:9px 10px;border-radius:8px;border:1px dashed var(--vp-border);' +
				'font-size:11.5px;line-height:1.5;color:var(--vp-muted)}',
			/* 普通模式只列改动：有参照时给一条入口，别让「标了却看不见」变成悬案。 */
			'.vp-refs-note{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;' +
				'border:1px solid rgba(75,140,247,.32);background:rgba(75,140,247,.08);' +
				'font-size:11.5px;line-height:1.4;color:var(--vp-muted)}',
			'.vp-refs-note b{color:#2f6fd0;font-variant-numeric:tabular-nums}',
			'.vp-refs-note button{flex:none;margin-left:auto;padding:3px 8px;border-radius:6px;cursor:pointer;' +
				'font-size:11.5px;color:#2f6fd0;background:transparent;border:1px solid rgba(75,140,247,.4)}',
			'.vp-refs-note button:hover{background:rgba(75,140,247,.12)}',
			'.vp-cell-badge{flex:none;display:inline-flex;align-items:center;margin-left:auto;height:17px;' +
				'font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:0 6px;' +
				'border-radius:999px;background:rgba(75,140,247,.14);color:#2f6fd0;white-space:nowrap}',
			/* 参照卡上的归属 chip 用改动色：它指向的是左栏哪一条改动。 */
			'.vp-cell-badge.owner{background:var(--vp-target-weak);color:var(--vp-target);font-weight:700;' +
				'border:1px solid color-mix(in srgb,var(--vp-target) 40%,transparent)}',
			'html[data-theme="dark"] .vp-cell-badge,.dark .vp-cell-badge{color:#9cc2ff}',
			'.vp-addref{display:flex;align-items:center;justify-content:center;margin-top:auto;height:34px;padding:0 8px;' +
				'border-radius:8px;border:1px dashed rgba(75,140,247,.5);background:transparent;color:#2f6fd0;' +
				'font:11.5px/1.3 system-ui,sans-serif;cursor:pointer;text-align:center;box-sizing:border-box}',
			'html[data-theme="dark"] .vp-addref,.dark .vp-addref{color:#9cc2ff}',
			'.vp-addref:hover{background:rgba(75,140,247,.1)}',
			'.vp-addref.arm{border-style:solid;border-color:#4b8cf7;background:rgba(75,140,247,.14);font-weight:600}',
			'.vp-dimchip.arm{border-color:rgba(75,140,247,.6);background:rgba(75,140,247,.14);color:#2f6fd0}',
			'.vp-dimchip.on{border-color:rgba(75,140,247,.6);background:rgba(75,140,247,.14);color:#2f6fd0;font-weight:600}',
			'.vp-cell.drop{border-color:var(--vp-accent);box-shadow:inset 0 0 0 1px var(--vp-accent-weak)}',
			'.vp-cell[draggable="true"]{cursor:grab}',
			// 参考维度并到说明那一行的右端：另起一行会让参照卡比改动卡高一行。
			'.vp-cell-spec{flex:none;max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
				'font-size:10.5px;line-height:1.6;padding:0 6px;border-radius:999px;background:rgba(75,140,247,.14);' +
				'color:#2f6fd0}',
			'html[data-theme="dark"] .vp-cell-spec,.dark .vp-cell-spec{background:rgba(75,140,247,.2);color:#9cc2ff}',
			'.vp-reflist{display:flex;flex-wrap:wrap;align-items:center;gap:4px;row-gap:6px}',
			'.vp-reflist.vp-relrow{flex-wrap:nowrap;height:26px;overflow:hidden}',
			'.vp-reflist .cap{font-size:11px;color:var(--vp-muted)}',
			'.vp-refchip{display:inline-flex;align-items:center;gap:2px;height:22px;padding:0 2px 0 6px;border-radius:999px;' +
				'background:rgba(75,140,247,.14);color:#2f6fd0;font:600 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace}',
			'html[data-theme="dark"] .vp-refchip,.dark .vp-refchip{color:#9cc2ff}',
			'.vp-refchip button{width:16px;height:16px;border:0;border-radius:50%;background:transparent;color:inherit;' +
				'font-size:12px;line-height:1;cursor:pointer}',
			'.vp-refchip button:hover{background:rgba(75,140,247,.24)}',
			/* 目标卡下的「选择参照」下拉：列出已标注、未挂到这条改动的参照，点一下就配对。
			   必须是浮层（绝对定位）：留在文档流里会把左栏撑高，展开的下拉还长得像右栏卡片的复制品，
			   用户看到的就是「左边区域和右边区域重叠」。 */
			'.vp-refmenu{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:30;' +
				'padding:4px;border-radius:8px;border:1px solid var(--vp-border);' +
				'background:var(--dsw-specific-menu-bg,Canvas);box-shadow:0 12px 28px -12px rgba(0,0,0,.45);' +
				'display:flex;flex-direction:column;gap:2px;max-height:240px;overflow:auto}',
			'.vp-refmenu button{display:flex;align-items:center;gap:6px;padding:5px 7px;border:0;border-radius:5px;' +
				'background:transparent;color:inherit;font-size:12px;text-align:left;cursor:pointer}',
			'.vp-refmenu button:hover{background:var(--vp-surface-2)}',
			'.vp-refmenu button .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.vp-refmenu .hint{padding:5px 7px;font-size:11.5px;color:var(--vp-muted)}',
			// 一颗标注 = 定高的一格：两栏卡片同高，右栏「＋ 添加参照」才和左栏「＋ 新增改动」落在同一条线上。
			'.vp-cell{display:flex;flex-direction:column;gap:4px;min-width:0;height:56px;box-sizing:border-box;' +
				'padding:6px 8px;border-radius:8px;overflow:hidden;' +
				'border:1px solid var(--vp-border);background:var(--vp-surface);cursor:pointer;text-align:left;' +
				'color:inherit;font:inherit}',
			'.vp-cell:hover{background:var(--vp-surface-2)}',
			/* 一处改动 = 一张带框的卡：左侧暖橙竖线 + 同色描边，右栏参照保持蓝色，
			   两栏在视觉上不再靠「一条细边框」区分。多出的 2px 左边框用 padding-left 补回去，
			   否则左栏文字比右栏往右缩 2px，两栏一起看就是歪的。 */
			'.vp-cell.t{border-left:3px solid var(--vp-target);padding-left:6px;' +
				'border-color:color-mix(in srgb,var(--vp-target) 32%,var(--vp-border))}',
			'.vp-cell.sel{border-color:color-mix(in srgb,var(--vp-accent) 55%,var(--vp-border));' +
				'box-shadow:inset 0 0 0 1px var(--vp-accent-weak)}',
			'.vp-cell.ref{border-color:rgba(75,140,247,.38);background:rgba(75,140,247,.06)}',
			'.vp-armbar{display:flex;align-items:center;gap:8px;margin:6px 12px 0;padding:7px 9px;border-radius:8px;' +
				'border:1px solid color-mix(in srgb,var(--vp-accent) 45%,var(--vp-border));background:var(--vp-accent-weak);' +
				'font-size:12px;line-height:1.45;flex:none}',
			'.vp-armbar span{flex:1;min-width:0;word-break:break-word;color:var(--vp-accent)}',
			'.vp-armbar button{flex:none;height:22px;padding:0 8px;border-radius:999px;' +
				'border:1px solid var(--vp-border);background:transparent;color:inherit;font-size:11.5px;cursor:pointer}',
			'.vp-sec{display:flex;align-items:baseline;gap:6px;margin:9px 0 6px;font-size:11.5px;color:var(--vp-muted)}',
			'.vp-sub{border:0;background:none;padding:0;color:var(--vp-accent);font:11.5px/1.4 system-ui,sans-serif;' +
				'cursor:pointer;text-align:left}',
			'.vp-cell-main{display:flex;align-items:center;gap:10px;min-width:0}',
			'.vp-cell-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
			// 缩略图缩到 54×36 并加一圈内描边：原来 64×40 顶满卡片内容区、灰底直接贴住文字，
			// 看着像一块图和一行字叠在一起；留出 10px 间距 + 细边，图与字之间才有过渡。
			'.vp-cell-shot{width:54px;height:36px;border-radius:6px;overflow:hidden;background:var(--vp-surface-2);' +
				'flex:none;box-shadow:inset 0 0 0 1px var(--vp-border)}',
			'.vp-cell-shot img{width:100%;height:100%;object-fit:cover;object-position:top left;display:block}',
			'.vp-cell-head{display:flex;align-items:center;gap:7px;min-width:0;height:18px}',
			/* 序号是「第几处」的索引，不是主角：改成浅色底 + 同色字的低调徽标。原来实心色块
			   比正文还重，跟旁边的选择器一起抢视线；角色已经由左栏竖线与描边表达了。 */
			'.vp-cell-head .n{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:18px;' +
				'height:18px;padding:0 5px;border-radius:5px;background:var(--vp-target-soft);color:var(--vp-target);' +
				'box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--vp-target) 26%,transparent);' +
				'font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em;' +
				'font-variant-numeric:tabular-nums}',
			'.vp-cell-head .r{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:18px;' +
				'height:18px;padding:0 5px;border-radius:5px;background:var(--vp-ref-soft);color:var(--vp-ref);' +
				'box-shadow:inset 0 0 0 1px rgba(75,140,247,.26);' +
				'font:700 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em;' +
				'font-variant-numeric:tabular-nums}',
			/* 选择器是给 agent 的定位信息，不是灰噪点：原来 11px 的 --vp-muted 在灰底上几乎读不出
			   #_SCROLL_EL_ID 这种全大写下划线 id，现在用正文色只压半档，字号提到 11.5。 */
			'.vp-cell-sel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
				'font:11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:inherit;opacity:.82}',
			// 说明只占一行，多的省略——要看全点开这张卡（行内编辑器里是全文本）。
			// 以前两行截断，可右栏有参考维度、左栏没有，两栏卡片就一高一低。
			'.vp-cell-note{display:flex;align-items:center;gap:6px;min-width:0;font-size:12px;line-height:1.45}',
			'.vp-cell-note .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.vp-cell-note.none{color:var(--vp-muted)}',
			'.vp-rowedit{grid-column:1/-1;display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:8px;' +
				'border:1px solid var(--vp-border);background:var(--vp-surface)}',
			'.vp-rowedit .meta{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--vp-muted);min-width:0}',
			'.vp-rowedit .meta .sel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
				'font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
			'.vp-rowedit textarea{width:100%;box-sizing:border-box;min-height:44px;max-height:120px;padding:6px 8px;' +
				'border-radius:6px;border:1px solid var(--vp-border);background:var(--dsw-specific-input-major,transparent);' +
				'color:inherit;font:12px/1.5 system-ui,sans-serif;resize:vertical;outline:none}',
			'.vp-rowedit textarea:focus{border-color:var(--vp-accent)}',
			'.vp-dims{display:flex;flex-wrap:wrap;gap:4px}',
			'.vp-dimchip{height:22px;padding:0 7px;border-radius:999px;border:1px solid var(--vp-border);background:transparent;' +
				'color:var(--vp-muted);font-size:11px;cursor:pointer}',
			'.vp-dimchip[aria-pressed="true"]{background:rgba(75,140,247,.16);border-color:rgba(75,140,247,.42);color:#2f6fd0;font-weight:600}',
			'.vp-rowedit .actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
			'html[data-theme="dark"] .vp-dims .vp-dimchip[aria-pressed="true"],.dark .vp-dims .vp-dimchip[aria-pressed="true"]{color:#9cc2ff}',

			/* ---- pick mode --------------------------------------------------- */
			'.vp-switch{position:relative;width:38px;height:22px;flex:none;padding:0;border-radius:999px;cursor:pointer;' +
				'border:1px solid var(--vp-border);background:var(--vp-surface-2);transition:background .15s ease-out}',
			'.vp-switch[aria-checked="true"]{background:var(--vp-accent);border-color:var(--vp-accent)}',
			'.vp-switch:disabled{opacity:.45;cursor:default}',
			'.vp-switch .knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;' +
				'transition:transform .15s ease-out;box-shadow:0 1px 2px rgba(0,0,0,.3)}',
			'.vp-switch[aria-checked="true"] .knob{transform:translateX(16px)}',
			'.vp-hint{padding:8px 12px 0;font-size:12px;color:var(--vp-muted);flex:none}',

			/* ---- body -------------------------------------------------------- */
			'.vp-body{flex:1;min-height:0;overflow:auto;padding:10px 12px 12px;display:flex;flex-direction:column;gap:10px}',
			'.vp-empty{border:1px dashed var(--vp-border);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px}',
			'.vp-step{display:flex;align-items:flex-start;gap:9px;padding:7px 8px;border-radius:8px;border:1px solid transparent;' +
				'background:transparent;color:inherit;text-align:left;cursor:pointer;font-size:13px;line-height:1.5}',
			'.vp-step:hover:not(:disabled){background:var(--vp-surface)}',
			'.vp-step:disabled{opacity:.55;cursor:default}',
			'.vp-step .n{flex:none;width:18px;height:18px;border-radius:50%;background:var(--vp-surface-2);' +
				'display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;margin-top:1px}',
			'.vp-step.done .n{background:var(--vp-ok);color:#fff}',

			/* ---- cards ------------------------------------------------------- */
			'.vp-card{display:flex;gap:10px;padding:10px;border-radius:10px;border:1px solid var(--vp-border);' +
				'background:var(--vp-surface);flex:none}',
			'.vp-card:focus-within{border-color:color-mix(in srgb,var(--vp-accent) 45%,var(--vp-border))}',
			'.vp-thumb{width:96px;height:72px;flex:none;padding:0;border-radius:6px;border:1px solid var(--vp-border);' +
				'background:var(--vp-surface-2);overflow:hidden;cursor:zoom-in;display:flex;align-items:center;justify-content:center}',
			'.vp-thumb img{width:100%;height:100%;object-fit:contain;display:block}',
			'.vp-thumb.none{cursor:default;color:var(--vp-muted);font-size:11px}',
			'.vp-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}',
			'.vp-card-head{display:flex;align-items:center;gap:6px;min-width:0}',
			'.vp-idx{font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--vp-muted);flex:none}',
			'.vp-tag{font-size:12px;font-weight:600;flex:none;color:var(--vp-accent)}',
			'.vp-host{font-size:12px;color:var(--vp-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
			'.vp-sel{display:block;width:100%;margin:0;padding:4px 6px;border:none;border-radius:5px;background:transparent;' +
				'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--vp-accent);text-align:left;' +
				'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:copy}',
			'.vp-sel:hover{background:var(--vp-surface-2)}',
			'.vp-text{font-size:12px;color:var(--vp-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.vp-comment{width:100%;box-sizing:border-box;min-height:46px;max-height:132px;padding:6px 8px;border-radius:6px;' +
				'border:1px solid var(--vp-border);background:var(--dsw-specific-input-major,transparent);color:inherit;' +
				'font:13px/1.5 system-ui,sans-serif;resize:vertical;outline:none}',
			'.vp-comment:focus{border-color:var(--vp-accent)}',
			'.vp-actions{display:flex;align-items:center;gap:6px;justify-content:flex-end}',
			'.vp-saved{font-size:11px;color:var(--vp-muted);margin-right:auto}',

			/* ---- footer ------------------------------------------------------ */
			'.vp-foot{display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px;border-top:1px solid var(--vp-border);flex:none}',
			'.vp-cta-row{display:flex;gap:6px}',
			'.vp-cta-row .vp-btn{flex:none}',
			'.vp-cta-row .vp-btn.block{flex:1 1 auto;width:auto;min-width:0}',
			'.vp-foot-hint{margin:0;font-size:12px;line-height:1.5;color:var(--vp-muted)}',

			/* ---- toast ------------------------------------------------------- */
			'.vp-toast{position:absolute;left:12px;right:12px;bottom:92px;z-index:30;display:flex;align-items:center;gap:8px;' +
				'padding:9px 10px;border-radius:8px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,.2)}',
			'.vp-toast.ok{background:var(--vp-ok);color:#fff}',
			'.vp-toast.warn{background:var(--vp-warn);color:#fff}',
			'.vp-toast.err{background:var(--vp-danger);color:#fff}',
			'.vp-toast span{flex:1;min-width:0}',
			'.vp-toast button{flex:none;border:1px solid rgba(255,255,255,.5);border-radius:5px;background:transparent;' +
				'color:inherit;font-size:12px;padding:3px 7px;cursor:pointer}',
			'.vp-toast button:hover{background:rgba(255,255,255,.16)}',

			/* ---- container queries ------------------------------------------ */
			'@container (max-width:560px){' +
				'.vp-colhead{grid-template-columns:1fr}' +
				'.vp-cols{grid-template-columns:1fr}' +
				'}',
			'@container (max-width:320px){' +
				'.vp-card{flex-direction:column}' +
				'.vp-thumb{width:100%;height:auto;aspect-ratio:16/9}' +
				'.vp-title{font-size:12px}' +
				'.vp-foot-hint{display:none}' +
				'}',
			'@container (max-width:260px){' +
				'.vp-head{padding:8px}' +
				'.vp-host{display:none}' +
				'.vp-pill{max-width:120px}' +
				'}',
			'@media (prefers-reduced-motion:reduce){.vp-root *{transition:none!important}}',

			/* ---- 截图放大层 ---------------------------------------------------- */
			// 挂在 document.body 上、不进 .vp-root：放大层要用 top layer 才能盖住整个窗口，
			// 而面板根节点是 container-type:inline-size 的容器（布局包含 = fixed 定位的包含块），
			// 又受侧栏 overflow 裁剪，放在里面再怎么 fixed 也只有侧栏那么宽。
			'.vp-shotview{position:fixed;inset:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;margin:0;' +
				'padding:16px;box-sizing:border-box;border:0;background:transparent;color:#fff;overflow:hidden}',
			'.vp-shotview[open]{display:flex;align-items:center;justify-content:center}',
			'.vp-shotview::backdrop{background:rgba(9,11,15,.86)}',
			'.vp-shotview img{display:block;max-width:100%;max-height:calc(100vh - 84px);width:auto;height:auto;border-radius:8px;' +
				'background:#fff;box-shadow:0 18px 48px rgba(0,0,0,.55);cursor:zoom-out}',
			'.vp-shotview-bar{position:absolute;left:16px;right:16px;bottom:12px;display:flex;align-items:center;justify-content:center;' +
				'gap:10px;font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:rgba(255,255,255,.78);pointer-events:none}',
			'.vp-shotview-bar .cap{max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.vp-shotview-bar .hint{opacity:.75}',
			'.vp-shotview-x{position:absolute;top:12px;right:14px;width:32px;height:32px;border-radius:8px;cursor:pointer;' +
				'border:1px solid rgba(255,255,255,.28);background:rgba(12,15,20,.55);color:#fff;font-size:15px;line-height:1}',
			'.vp-shotview-x:hover{background:rgba(255,255,255,.18)}',
			// 两栏卡片的小图也能点开：光标提示可放大，尺寸与描边契约不变。
			'.vp-cell-shot{cursor:zoom-in}',
		].join('\n');

		function ensureStyle() {
			if (document.getElementById('dsh-annotator-style')) return null;
			var style = document.createElement('style');
			style.id = 'dsh-annotator-style';
			style.textContent = CSS;
			document.head.appendChild(style);
			return style;
		}

		/**
		 * 截图放大查看。
		 *
		 * 缩略图只有 96×72（两栏卡片里 54×36），元素细节根本看不清；v10 把「点缩略图」
		 * 统一改成「在浏览器中定位」之后，放大入口就丢了。这里用原生 <dialog> 的 showModal()
		 * 开一个全窗口查看层：它进的是 top layer，不受 .vp-root 的 container-type（布局包含）
		 * 与侧栏 overflow 的裁剪，也不跟 React 树耦合。
		 */
		var shotViewer = null;

		function closeShotViewer() {
			if (!shotViewer) return;
			var viewer = shotViewer;
			shotViewer = null;
			try {
				viewer.dialog.close();
			} catch {
				// 已经被 Esc / 外部关掉时 close() 会抛 InvalidStateError，忽略。
			}
			viewer.dialog.remove();
			try {
				if (viewer.previous && typeof viewer.previous.focus === 'function') viewer.previous.focus();
			} catch {
				// 打开时聚焦的那个元素可能已经被重渲染掉了。
			}
		}

		function openShotViewer(src, caption) {
			if (!src) return;
			closeShotViewer();
			var previous = document.activeElement;
			var dialog = document.createElement('dialog');
			dialog.className = 'vp-shotview';
			dialog.setAttribute('aria-label', caption ? '截图：' + caption : '元素截图放大查看');
			var img = document.createElement('img');
			img.src = src;
			img.alt = caption || '元素截图';
			var bar = document.createElement('div');
			bar.className = 'vp-shotview-bar';
			var cap = document.createElement('span');
			cap.className = 'cap';
			cap.textContent = caption || '';
			var hint = document.createElement('span');
			hint.className = 'hint';
			hint.textContent = '点任意处或按 Esc 关闭';
			var close = document.createElement('button');
			close.type = 'button';
			close.className = 'vp-shotview-x';
			close.setAttribute('aria-label', '关闭截图预览');
			close.textContent = '✕';
			close.addEventListener('click', function (event) {
				event.stopPropagation();
				closeShotViewer();
			});
			bar.appendChild(cap);
			bar.appendChild(hint);
			dialog.appendChild(img);
			dialog.appendChild(bar);
			dialog.appendChild(close);
			// 点空白或点图片本身都算看完；关闭按钮已经 stopPropagation，不会重复触发。
			dialog.addEventListener('click', closeShotViewer);
			// Esc 在原生 dialog 上先触发 cancel：拦下来自己收，避免两层各关一次。
			dialog.addEventListener('cancel', function (event) {
				event.preventDefault();
				closeShotViewer();
			});
			document.body.appendChild(dialog);
			shotViewer = { dialog: dialog, previous: previous };
			try {
				dialog.showModal();
			} catch {
				// 极老的运行时没有 showModal：退回普通层也能看，只是没有 top layer。
				dialog.setAttribute('open', '');
			}
			close.focus();
		}

		async function request(path, init) {
			var response = await fetch(API + path, Object.assign({ headers: { accept: 'application/json' } }, init));
			var text = await response.text();
			var data;
			try {
				data = text ? JSON.parse(text) : {};
			} catch {
				data = { ok: false, error: text.slice(0, 200) };
			}
			if (!response.ok && data.ok === undefined) data.ok = false;
			return data;
		}

		var post = (path, body) =>
			request(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body ?? {}),
			});

		function hostOf(url) {
			try {
				return new URL(url).host;
			} catch {
				return '';
			}
		}

		function markdownFor(data, picks) {
			if (data && typeof data.markdown === 'string') return data.markdown;
			return picks.map((pick) => pick.selector).join('\n');
		}

		/** One compact Chinese block per pick: reference + position + text + comment. */
		function pickBlock(pick, idx, shotRef) {
			var lines = [];
			// Display truncation only — the full selector/text stays in the picks data
			// and reaches the agent verbatim through visual_annotator_read.
			var selector = String(pick.selector || pick.tag || '(未知选择器)');
			if (selector.length > 100) selector = selector.slice(0, 100) + '…';
			lines.push('[' + idx + '] 元素：' + selector);
			if (pick.url) lines.push('    页面：' + pick.url);
			var r = pick.pageRect;
			if (r) {
				var pos = [r.x, r.y].map(Math.round).map(String).join(', ');
				var size = [r.width, r.height].map(Math.round).map(String).join('×');
				lines.push('    位置：(' + pos + ') ' + size + 'px');
			}
			if (pick.text) lines.push('    文本：' + String(pick.text).slice(0, 40));
			if (shotRef) lines.push('    截图：' + shotRef);
			var comment = String(pick.comment ?? '').trim();
			lines.push(comment ? '    评论：' + comment : '    （未写评论）');
			return lines.join('\n');
		}

		/** One-line location summary for reference mode: selector · page · position. */
		function refLoc(pick) {
			var parts = [];
			var sel = String(pick.selector || pick.tag || '');
			if (sel.length > 60) sel = sel.slice(0, 60) + '…';
			if (sel) parts.push(sel);
			if (pick.url) {
				try {
					var u = new URL(pick.url);
					parts.push(u.host + u.pathname);
				} catch {
					parts.push(pick.url);
				}
			}
			var r = pick.pageRect;
			if (r)
				parts.push(
					'(' +
						Math.round(r.x) +
						',' +
						Math.round(r.y) +
						') ' +
						Math.round(r.width) +
						'×' +
						Math.round(r.height) +
						'px',
				);
			return parts.join(' · ');
		}

		/**
		 * The only insert shape: one marker line per pick with compact location; full details via the tool.
		 *
		 * 参考模式改的是首行与分组：首行明确「只改改动标注，参照那几处与它的代码不动」，
		 * 参考标注单独一段并标出维度。措辞必须和 agent 侧工具描述一致，否则模型仍可能去改参照元素。
		 */
		/**
		 * The only insert shape: one marker line per pick, full details via the tool.
		 *
		 * 参考对照把「改」与「照」写成同一组的两行，横向对应关系在文本里也保留；
		 * 边界只按标注划（参照可以与改动同页），措辞必须和 agent 侧工具描述一致。
		 */
		/** 一条改动可以参照好几处：pairIds 是权威，老数据只有单个 pairId 也要认。 */
		function pairIdsOfPick(pick) {
			var ids = Array.isArray(pick.pairIds) ? pick.pairIds.slice() : [];
			var seen = ids.some((id) => String(id) === String(pick.pairId));
			if (pick.pairId != null && !seen) ids.unshift(pick.pairId);
			return ids;
		}

		/** 参考编号 R1-2：按「全部参考」在同一页里的出现顺序算，不是按本次插入的子集算。
		 *  子集计数会把不重发的旧参考挤掉编号：同一处参考在草稿里叫 R1-1、在工具返回里叫 R1-2，
		 *  agent 会看到两套编号。chips 前缀（refCodeOf）与 host 侧（shared/annotation-markdown.js）都按全量算，
		 *  文本回落必须同一个口径。 */
		function refCodeFromList(allRefs, pick) {
			var key = pick.pageKey || '';
			var index = 0;
			for (var i = 0; i < allRefs.length; i++) {
				if ((allRefs[i].pageKey || '') !== key) continue;
				index += 1;
				if (String(allRefs[i].id) === String(pick.id)) break;
			}
			return (pick.refLabel || 'R') + '-' + index;
		}

		function composeRefText(picks, imageCount, attached, allRefs) {
			var refs = picks.filter((pick) => pick.role === 'reference');
			var targets = picks.filter((pick) => pick.role !== 'reference');
			var codes = {};
			// 编号基于「当前全部参考」，插入子集里没有的旧参考也占号，保证与 chips/工具口径一致。
			var refBase = Array.isArray(allRefs) && allRefs.length ? allRefs : refs;
			refs.forEach((pick) => {
				codes[String(pick.id)] = refCodeFromList(refBase, pick);
			});
			var byId = {};
			refs.forEach((pick) => {
				byId[String(pick.id)] = pick;
			});
			var lines = [];
			if (refs.length) {
				lines.push(TASK_REFERENCE);
				if (targets.length === 0) lines.push('（本次没有改动标注：按下面的参照规范新建。）');
			} else lines.push(TASK_PLAIN);
			if (imageCount > 0 && attached) lines.push('（' + imageCount + ' 张元素截图已作为附件插入）');
			var marker = function (pick) {
				return '[标注 #' + pick.id + ']';
			};
			var refLine = function (pick) {
				var dims = Array.isArray(pick.spec) && pick.spec.length ? ' ｜ 参考维度：' + pick.spec.join('、') : '';
				var comment = String(pick.comment ?? '').trim();
				return (
					'  ' +
					marker(pick) +
					'（' +
					(codes[String(pick.id)] || '参考') +
					'）' +
					(comment ? ' ' + comment : '') +
					' ｜ ' +
					refLoc(pick) +
					dims
				);
			};
			if (refs.length) {
				targets.forEach((target, index) => {
					var comment = String(target.comment ?? '').trim();
					lines.push('');
					lines.push('对照 ' + (index + 1));
					lines.push(
						'  改动：' + marker(target) + (comment ? ' ' + comment : '（未填写修改要求）') + ' ｜ ' + refLoc(target),
					);
					var linked = pairIdsOfPick(target)
						.map((id) => byId[String(id)])
						.filter(Boolean);
					if (linked.length === 1) lines.push('  参照：' + refLine(linked[0]));
					else if (linked.length > 1) {
						lines.push('  参照以下几处（同一处改动，多个规范一并参照）：');
						linked.forEach((ref) => lines.push(refLine(ref)));
					} else lines.push('  参照：（未指定参照标注，可参照下方 R 编号的规范）');
				});
				var claimed = {};
				targets.forEach((target) => {
					pairIdsOfPick(target).forEach((id) => {
						claimed[String(id)] = 1;
					});
				});
				var loose = refs.filter((pick) => !claimed[String(pick.id)]);
				if (loose.length) {
					lines.push('');
					lines.push(
						loose.length === refs.length && !targets.length
							? '参照以下标注新建：'
							: '另有参照（没有对应改动，可参照其新建）：',
					);
					loose.forEach((pick) => lines.push(refLine(pick)));
				}
			} else {
				picks.forEach((pick) => {
					var comment = String(pick.comment ?? '').trim();
					var loc = refLoc(pick);
					lines.push('[标注 #' + pick.id + ']' + (comment ? ' ' + comment : '') + (loc ? ' ｜ ' + loc : ''));
				});
			}
			lines.push('标注详情与截图由 dsh-annotator 插件的 visual_annotator_read 工具按 id 提供。');
			return lines.join('\n');
		}

		/* ------------------------------------------------------------------ */
		/* Reference chips: register one input-trigger source so inserted       */
		/* markers become real composer chips that expand to full location      */
		/* text at submit time (sinkSerialized -> codec.serialize).             */
		/* ------------------------------------------------------------------ */
		var VP_SOURCE_NAME = 'visual-annotator';
		/**
		 * Latest pick snapshots by id, for chip serialization at submit time.
		 *
		 * Lives on window, not in this closure: the input-trigger source is registered
		 * once per GUI session and keeps the FIRST module's codec closure. A re-pulled
		 * panel script would otherwise write into a fresh object that the surviving
		 * codec never reads — every chip inserted afterwards would expand to
		 * 「该标注已被清除」.
		 */
		function vpPicks() {
			return window.__DSH_VP_CHIPS__ || (window.__DSH_VP_CHIPS__ = {});
		}
		var VP_SOURCE_READY = false;

		/**
		 * Model-side expansion of one chip: the full location block.
		 *
		 * Ask the host when the local registry has nothing: a chip can outlive both the
		 * module that registered it and its entry in the panel list (inserted picks are
		 * consumed from the list but stay resolvable on the host).
		 */
		async function vpSerializeRef(id) {
			var key = String(id);
			var picks = vpPicks();
			var pick = picks[key];
			if (!pick) {
				try {
					var data = await post('/pick', { id: key });
					if (data && data.ok && data.pick) {
						pick = data.pick;
						picks[key] = pick;
					}
				} catch {
					/* fall through to the marker text */
				}
			}
			if (!pick)
				return (
					'[标注 #' +
					id +
					']（该标注已不在列表；请调用 visual_annotator_read（ids: [' +
					String(id).replace(/\D/g, '') +
					']）读取详情）'
				);
			return pickBlock(pick, '标注 #' + pick.id, pick.shotPath || pick.shotUrl || null);
		}

		/** Register the chip source once per client session (never disposed: old drafts must stay serializable). */
		function ensureVpSource(ctx) {
			if (VP_SOURCE_READY) return true;
			if (!ctx || typeof ctx.get !== 'function') return false;
			try {
				var it = ctx.get('inputTriggers');
				if (!it || typeof it.registerSource !== 'function' || !it.live || !it.live.sources) return false;
				var exists = it.live.sources.some((s) => s.name === VP_SOURCE_NAME);
				if (!exists) {
					it.registerSource({
						name: VP_SOURCE_NAME,
						trigger: '@',
						codec: {
							clipboardText: (ref) => '[标注 #' + ref + ']',
							serialize: (ref) => vpSerializeRef(ref),
						},
					});
				}
				VP_SOURCE_READY = true;
			} catch {
				VP_SOURCE_READY = false;
			}
			return VP_SOURCE_READY;
		}

		/** Resolve the inputActions of the currently mounted composer (DOM walk), falling back to props. */
		function resolveLiveActions(fallback) {
			try {
				var tb = document.querySelector('[role="textbox"]');
				if (!tb) return fallback;
				var key = Object.keys(tb).find((k) => k.indexOf('__reactFiber') === 0);
				if (!key) return fallback;
				var f = tb[key];
				while (f) {
					var mp = f.memoizedProps;
					if (mp && mp.inputActions && typeof mp.inputActions.insertText === 'function') return mp.inputActions;
					f = f.return;
				}
			} catch {
				/* fall through */
			}
			return fallback;
		}

		/** The session-scoped dispatch ctx (actx) backing the input-trigger controller for this session. */
		function resolveActx(ctx, sessionId) {
			try {
				var it = ctx.get('inputTriggers');
				var arr = it && it.live && it.live.controllers ? Array.from(it.live.controllers.values) : []; // values is a getter returning an ITERABLE — concat would nest it
				var hit = null;
				for (var i = 0; i < arr.length; i++) {
					var c = arr[i];
					if (!c || c.disposed || !c.deps || !c.deps.actx) continue;
					if (!hit) hit = c;
					if (sessionId && c.deps.sessionId === sessionId) {
						hit = c;
						break;
					}
				}
				return hit && hit.deps.actx ? hit.deps.actx : null;
			} catch {
				return null;
			}
		}

		/** Visible composer text (chips excluded by innerText; checked separately). */
		function composerText() {
			try {
				var tb = document.querySelector('[role="textbox"]');
				return tb ? String(tb.innerText || '') : '';
			} catch {
				return '';
			}
		}

		/** Whether the draft actually shows every fragment (catches writes into a detached shell). */
		function draftContains(fragments) {
			var text = composerText();
			return fragments.every((frag) => text.indexOf(frag) >= 0);
		}

		/** Fetch one pick screenshot as a browser File for the attachment rail. */
		async function shotFile(pick) {
			if (!pick.shotUrl) return null;
			try {
				var res = await fetch(pick.shotUrl, { headers: { accept: 'image/png' } });
				if (!res.ok) return null;
				var blob = await res.blob();
				if (!blob.size) return null;
				return new File([blob], '元素截图-' + pick.id + '.png', { type: 'image/png' });
			} catch {
				return null;
			}
		}

		/* ---- icons -------------------------------------------------------- */
		function svg(children, size) {
			return h(
				'svg',
				{
					width: size || 15,
					height: size || 15,
					viewBox: '0 0 16 16',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': 'true',
				},
				children,
			);
		}

		var IconScope = () =>
			svg([
				h('circle', { key: 'c', cx: 8, cy: 8, r: 2.2 }),
				h('path', {
					key: 'p',
					d: 'M1 4V2.5A1.5 1.5 0 0 1 2.5 1H4M12 1h1.5A1.5 1.5 0 0 1 15 2.5V4M15 12v1.5a1.5 1.5 0 0 1-1.5 1.5H12M4 15H2.5A1.5 1.5 0 0 1 1 13.5V12',
				}),
			]);
		var IconTarget = () =>
			svg(
				[
					h('circle', { key: 'c', cx: 8, cy: 8, r: 5 }),
					h('circle', { key: 'd', cx: 8, cy: 8, r: 1.4 }),
					h('path', { key: 'p', d: 'M8 1v2M8 13v2M1 8h2M13 8h2' }),
				],
				14,
			);
		var IconMore = () =>
			svg(
				[
					h('circle', { key: 'a', cx: 3, cy: 8, r: 1 }),
					h('circle', { key: 'b', cx: 8, cy: 8, r: 1 }),
					h('circle', { key: 'c', cx: 13, cy: 8, r: 1 }),
				],
				14,
			);
		var IconCopy = () =>
			svg(
				[
					h('rect', { key: 'a', x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5 }),
					h('path', { key: 'b', d: 'M10.5 3.5H3.5A1 1 0 0 0 2.5 4.5v8' }),
				],
				14,
			);
		var IconX = () => svg([h('path', { key: 'a', d: 'M4 4l8 8M12 4l-8 8' })], 13);

		function PickerPanel(props) {
			var [state, setState] = useState({
				status: 'idle',
				mode: 'off',
				activeUrl: '',
				activeTitle: '',
				picks: [],
				tabs: [],
				browsers: {},
				browser: null,
				browserOrder: [],
				browserLabels: {},
				browserDefault: null,
				reused: false,
				cdpBase: null,
				windowKept: false,
				resumed: false,
				markdown: '',
				pages: [],
				activePageKey: '',
				summary: '',
				error: null,
				error_message: null,
				hostRev: '',
			});
			// 选过的浏览器记在本机：下次打开面板默认还是它，而不是永远回到 Chrome。
			var STORE_BROWSER = 'dsh-annotator-browser';
			var readSavedBrowser = function () {
				try {
					return window.localStorage.getItem(STORE_BROWSER) || '';
				} catch {
					return '';
				}
			};
			var rememberBrowser = function (id) {
				try {
					window.localStorage.setItem(STORE_BROWSER, id);
				} catch {
					/* 存储被禁用时只是记不住这次选择 */
				}
			};
			var [savedBrowser, setSavedBrowser] = useState(readSavedBrowser);
			var [url, setUrl] = useState('');
			var [busy, setBusy] = useState('');
			var [drafts, setDrafts] = useState({});
			var [saved, setSaved] = useState({});
			var [toast, setToast] = useState(null);
			// 只有两个模式：普通标注（只改目标）与参考对照（左边改、右边照）。
			var [viewMode, setViewMode] = useState('plain');
			var [expandedId, setExpandedId] = useState('');
			// 待落位：{ slot: 'target'|'reference', pairId }。点过空位之后，下一处标注自动配给这一行，
			// 不用再靠「第一条未配对的目标」这种猜法。
			var [arming, setArming] = useState(null);
			// 已选中一条孤立参考，等着点左边某条改动把它配上（替代原来的下拉选择）。
			var [assigning, setAssigning] = useState('');
			var [slotMenu, setSlotMenu] = useState('');
			var [menu, setMenu] = useState(false);
			var [tabMenu, setTabMenu] = useState(false);
			// 勾选清空：存 id 而不是下标——轮询换掉列表后下标会指向别的条目。
			var [selected, setSelected] = useState([]);
			// 批量勾选是显式模式：勾选框平时不渲染，点底部「批量操作」才出现，退出时清掉已勾选。
			var [selectMode, setSelectMode] = useState(false);
			var urlRef = useRef(null);
			var toastTimer = useRef(null);
			var saveTimers = useRef({});
			// Host 推来的 pendingConsume token：只对没见过的 token 自动插入一次。
			var pendingSeen = useRef(0);
			// 最近一次「用户动手改落点」的时间：轮询可能带回改之前那一拍的值。
			var armAt = useRef(0);
			var sessionId = props.sessionId ?? null;

			var cwd = props.useSessions
				? props.useSessions(function (snapshot) {
						var id = sessionId;
						if (!id || !snapshot || !snapshot.byId) return '';
						var row = snapshot.byId[id];
						return row && row.cwd ? String(row.cwd) : '';
					})
				: '';

			var flash = function (kind, text, action, ms) {
				if (toastTimer.current) clearTimeout(toastTimer.current);
				setToast({ kind: kind, text: text, action: action || null });
				// Success is transient; warnings/errors stay until replaced or dismissed.
				if (kind === 'ok') toastTimer.current = setTimeout(() => setToast(null), ms || (action ? 6000 : 3200));
			};

			/**
			 * 落点属于 host：页面 HUD 上按 ⌥R 或点「改动 / 参照」开关时，面板要在下一次
			 * 轮询里跟上，否则 HUD 说「参照」、面板还停在改动栏，同一个动作两套说法。
			 * 只在值真的变了才写 state，避免每秒轮询都重渲染一条色条。
			 */
			// 上一拍从 host 读到的落点。切栏只认「这一拍才刚变成参照」的那一下：轮询每
			// 1.5s 都无条件切一次的话，用户点回普通模式会在下一拍被无声拉回，等于不让人选。
			var armSeen = useRef('');
			var adoptArming = (raw) => {
				var slot = raw && (raw.slot === 'target' || raw.slot === 'reference') ? raw.slot : '';
				var pairId = slot && raw.pairId ? String(raw.pairId) : '';
				// 刚点下去、POST 还没落到 host 的那一拍，轮询会带回旧值（null）；短窗口内不回清。
				if (!slot && Date.now() - (armAt.current || 0) < 1200) return;
				var prevSlot = armSeen.current;
				armSeen.current = slot;
				setArming((prev) => {
					var prevArmed = prev && prev.slot ? prev.slot : '';
					if (prevArmed === slot && String((prev && prev.pairId) || '') === pairId) return prev;
					return slot ? { slot: slot, pairId: pairId } : null;
				});
				// 从 HUD 第一次切到参照落点，顺手进参照模式（那里才有右栏可落）：只在
				// 「上一拍不是参照」时切，之后用户自己点回普通模式就不再被拉走。
				if (slot === 'reference' && prevSlot !== 'reference') setViewMode('pair');
			};

			var apply = (data) => {
				if (!data || (data.ok === false && data.error)) {
					setState((prev) => Object.assign({}, prev, { error_message: data?.error ?? '请求失败' }));
					return;
				}
				setState((prev) =>
					Object.assign({}, prev, {
						status: data.status ?? prev.status,
						mode: data.mode ?? prev.mode,
						activeUrl: data.activeUrl ?? prev.activeUrl,
						activeTitle: data.activeTitle ?? prev.activeTitle,
						picks: data.picks ?? prev.picks,
						tabs: Array.isArray(data.tabs) ? data.tabs : prev.tabs,
						browsers: data.browsers ?? prev.browsers,
						browser: data.browser ?? prev.browser,
						browserOrder: data.browserOrder ?? prev.browserOrder,
						browserLabels: data.browserLabels ?? prev.browserLabels,
						browserDefault: data.browserDefault ?? prev.browserDefault,
						reused: data.reused ?? prev.reused,
						cdpBase: data.cdpBase ?? prev.cdpBase,
						windowKept: data.windowKept ?? prev.windowKept,
						resumed: data.resumed ?? prev.resumed,
						markdown: data.markdown ?? prev.markdown,
						pages: Array.isArray(data.pages) ? data.pages : prev.pages,
						activePageKey: data.activePageKey ?? prev.activePageKey,
						summary: data.summary ?? prev.summary,
						pendingConsume: data.pendingConsume ?? prev.pendingConsume,
						error: data.error ?? null,
						error_message: null,
						hostRev: data.rev ?? prev.hostRev,
					}),
				);
				adoptArming(data.arming);
			};

			/** Build prefix the running host reports, e.g. 'v9' out of 'v9-1726544940000'. */
			var hostBuild = (String(state.hostRev || '').match(/^(v\d+)-/) || [])[1] || '';
			var hostStale = !!hostBuild && hostBuild !== PANEL_BUILD;
			/** Explain a 404 route: the host half predates this panel. */
			var staleHint = (what) =>
				'DSH 还在跑旧版插件（host ' +
				hostBuild +
				' / 面板 ' +
				PANEL_BUILD +
				'），' +
				what +
				'不可用。重启 DSH Desktop 后重新打开面板即可。';

			/** Poll the host: fast while the panel is visible, slow when the tab is hidden. */
			useEffect(function () {
				var alive = true;
				var timer = null;
				var tick = async function () {
					try {
						var data = await request('/state');
						if (alive) apply(data);
					} catch (error) {
						if (alive)
							setState(function (prev) {
								return Object.assign({}, prev, { error_message: String((error && error.message) || error) });
							});
					}
				};
				var schedule = function () {
					if (timer) clearInterval(timer);
					timer = setInterval(tick, document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
				};
				tick();
				schedule();
				var onVisible = function () {
					schedule();
					if (!document.hidden) tick();
				};
				document.addEventListener('visibilitychange', onVisible);
				return function () {
					alive = false;
					if (timer) clearInterval(timer);
					document.removeEventListener('visibilitychange', onVisible);
					// 面板卸载时别把放大层留在 body 上：它不在 React 树里，没人替它收。
					closeShotViewer();
				};
			}, []);

			useEffect(
				function () {
					// Never auto-fill the address bar with the DSH GUI's own URL: if the
					// debug window ever lands on the GUI page (leftover tab), pre-filling
					// it makes the next launch re-open the web build instead of a target.
					var active = state.activeUrl || '';
					if (active && !url && !active.startsWith(location.origin)) setUrl(active);
				},
				[state.activeUrl],
			);

			var picks = state.picks ?? [];
			var pages = state.pages ?? [];
			var targets = picks.filter((pick) => pick.role !== 'reference');
			var refs = picks.filter((pick) => pick.role === 'reference');
			// 勾选存的是 id，列表刷新后可能留下已经被删掉的 id：只认当前还在列表里的。
			var selectedIds = selected.filter((id) => picks.some((pick) => String(pick.id) === String(id)));
			var toggleSelect = function (id) {
				var key = String(id);
				setSelected((prev) => (prev.indexOf(key) >= 0 ? prev.filter((item) => item !== key) : prev.concat(key)));
			};
			var toggleSelectMode = function () {
				setSelectMode(!selectMode);
				// 退出批量即清勾选：留着看不见的勾选状态，下次进批量会「莫名已选」。
				if (selectMode) setSelected([]);
			};

			/** 参考标注的显示编号 R1-1：同一参考页内按出现顺序（refCodeFromList 的全量口径）。 */
			var refCodeOf = function (pick) {
				return refCodeFromList(refs, pick);
			};

			var pairIdsOf = pairIdsOfPick;
			var isTargetId = (id) => targets.some((item) => String(item.id) === String(id));
			var isRefId = (id) => refs.some((item) => String(item.id) === String(id));
			var pairCount = (pick) => pairIdsOf(pick).length;

			/** 一组「一条改动 + 它参照的若干条参考」；没人认领的参考单独成行。 */
			var pairRows = function () {
				var byId = {};
				refs.forEach((pick) => {
					byId[String(pick.id)] = pick;
				});
				var claimed = {};
				var rows = targets.map((target) => {
					var list = [];
					pairIdsOf(target).forEach((id) => {
						var ref = byId[String(id)];
						if (!ref || claimed[String(ref.id)]) return;
						claimed[String(ref.id)] = 1;
						list.push(ref);
					});
					return { target: target, refs: list, ref: list[0] || null };
				});
				refs.forEach((pick) => {
					if (!claimed[String(pick.id)]) rows.push({ target: null, refs: [], ref: pick });
				});
				return rows;
			};
			var rows = pairRows();
			// 参考标注插过一次就不再自动带上：同一份规范不该每轮重发。
			// 新参考自动带上；已经引用过的只在「它所照的那条改动本次要插入」时跟着走一遍，
			// 否则文本里会留下「参照：R1-1」却没有 R1-1 的定义。
			var linkedIds = {};
			targets.forEach((target) => {
				pairIdsOf(target).forEach((id) => {
					linkedIds[String(id)] = 1;
				});
			});
			// 已引用（上次插入留下的）参照默认不重发；用户在参照卡上点了「再次引用」
			// （included=true）后重新参与下一次插入，仍然挂在改动下的照常带上。
			var keepRefs = refs.filter((pick) => !pick.referencedAt || pick.included === true || linkedIds[String(pick.id)]);
			var insertable = viewMode === 'pair' ? targets.concat(keepRefs) : targets;
			// 「插入对照」的前提是真的有对照：只有「改动」、一条「参照」都还没有时按钮置灰。
			// 早先它照样能点，用户以为插的是对照，实际只把目标标注塞进了输入框——那时该走普通标注。
			var canInsert = insertable.length > 0 && (viewMode !== 'pair' || refs.length > 0);
			var ctaPicks = canInsert ? insertable : [];

			/** options.move：把这条参考从原来那组挪过来，而不是让它同时挂在两处。 */
			var setPair = async (targetId, refId, options) => {
				try {
					var data = await post('/pair', {
						targetId: targetId,
						refId: refId,
						move: !!(options && options.move === true),
					});
					apply(data);
					if (data && data.ok === false) flash('err', String(data.message || data.error || '没有配上'));
				} catch (error) {
					flash('err', String((error && error.message) || error));
				}
			};

			/** 单条标注改角色：拖到「照」栏表头就等于点这里。 */
			var setPickRole = async (id, role) => {
				try {
					var data = await post('/pick-role', { id: id, role: role });
					apply(data);
					if (data && data.ok === false) flash('err', String(data.message || data.error || '角色没有改成'));
				} catch (error) {
					flash('err', String((error && error.message) || error));
				}
			};

			/**
			 * 再次引用：插入后被保留的参照默认不再重发（included=false）。
			 * 参照卡上点「再次引用」把它勾回来，下一次插入会一并带上（重发）。
			 */
			var reuseRef = async (ref, want) => {
				try {
					var data = await post('/pick-include', { id: ref.id, included: want === true });
					apply(data);
					if (data && data.ok === false) {
						flash('err', String(data.message || data.error || '没有改成'));
						return;
					}
					flash('ok', want ? '已勾选再次引用：这条参照会参与下一次插入' : '已取消再次引用');
				} catch (error) {
					flash('err', String((error && error.message) || error));
				}
			};

			/** 只解开一组里的一条参考，别的配对不动。 */
			var unpairOne = async (targetId, refId) => {
				try {
					apply(await post('/unpair', { targetId: targetId, refId: refId }));
				} catch (error) {
					flash('err', String((error && error.message) || error));
				}
			};

			var setPairAll = async (refId) => {
				try {
					var data = await post('/pair-all', { refId: refId });
					apply(data);
					if (data && data.ok === false) {
						flash('err', String(data.message || data.error || '没有套用'));
					} else if (data && data.paired) {
						flash('ok', '已套用到 ' + data.paired + ' 条还没配对的目标');
					} else {
						flash('info', '没有还需要配的目标了');
					}
				} catch (error) {
					flash('err', String((error && error.message) || error));
				}
			};

			var setPickSpec = async (id, spec) => {
				try {
					apply(await post('/pick-spec', { id: id, spec: spec }));
				} catch (error) {
					flash('err', String((error && error.message) || error));
				}
			};

			/** Attach screenshots as real composer image attachments. */
			var attachShots = async (list) => {
				var ia = props.inputActions;
				var ctx = props.ctx;
				if (!ia || typeof ia.addAttachments !== 'function' || !ctx || typeof ctx.get !== 'function' || !sessionId) {
					return { ok: false, count: 0 };
				}
				var conv;
				try {
					conv = ctx.get('conversation');
				} catch {
					return { ok: false, count: 0 };
				}
				if (!conv || typeof conv.createDrafts !== 'function') return { ok: false, count: 0 };
				var files = [];
				for (var i = 0; i < list.length; i++) {
					var file = await shotFile(list[i]);
					if (file) files.push(file);
				}
				if (files.length === 0) return { ok: true, count: 0 };
				var draftsToAttach;
				try {
					draftsToAttach = conv.createDrafts(sessionId, files);
				} catch {
					return { ok: false, count: 0 };
				}
				var ok = false;
				try {
					ok = !!ia.addAttachments(draftsToAttach.map((draft) => draft.id));
				} catch {
					ok = false;
				}
				if (!ok && typeof conv.releaseDraftAttachments === 'function') {
					try {
						conv.releaseDraftAttachments(draftsToAttach);
					} catch {
						/* already owned by composer */
					}
				}
				return { ok: ok, count: ok ? files.length : 0 };
			};

			/**
			 * Chip insert: one real composer chip per pick; expands to full location text at submit.
			 * seq 是 [{pick, prefix}]：prefix 写「改动 N：」或「　参照 R1-1：」，谁参考谁在草稿里逐行对应。
			 * pick 为 null 的项是纯文本行（共享参照的 chip 已在首次出现处插过），只写 prefix、不再插 chip。
			 */
			var insertViaChips = (ia, actx, seq, header) => {
				header = header || TASK_PLAIN;
				if (!ia.insertText(header + '\n', ia.captureInsertion())) return false;
				for (var i = 0; i < seq.length; i++) {
					var pick = seq[i].pick;
					var prefix = seq[i].prefix || '';
					if (prefix && !ia.insertText(prefix + '\n', ia.captureInsertion())) return false;
					if (!pick) continue;
					var span = ia.captureInsertion();
					var applied = false;
					try {
						applied =
							actx.bail(actx, 'slash/input-insert-reference', {
								reference: {
									source: VP_SOURCE_NAME,
									ref: pick.id,
									label: '标注 #' + pick.id,
									clipboardText: '[标注 #' + pick.id + ']',
								},
								span,
							}) === true;
					} catch {
						return false;
					}
					if (!applied) return false;
					var comment = String(pick.comment ?? '').trim();
					if (comment && !ia.insertText(comment + '\n', ia.captureInsertion())) return false;
				}
				if (
					!ia.insertText(
						'标注详情与截图由 dsh-annotator 插件的 visual_annotator_read 工具按 id 提供。',
						ia.captureInsertion(),
					)
				)
					return false;
				// Verify on the live composer: header text must show, and every chip must exist in the DOM.
				var tb = document.querySelector('[role="textbox"]');
				if (!tb || !draftContains([header.replace(/[：:]\s*$/, '')])) return false;
				var chipCount = tb.querySelectorAll('[data-composer-chip="' + VP_SOURCE_NAME + '"]').length;
				// 校验按带 chip 的项数算：纯文本行（共享参照回指）本来就不该有 chip。
				var chipItems = 0;
				for (var j = 0; j < seq.length; j++) if (seq[j].pick) chipItems++;
				return chipCount >= chipItems;
			};

			/** Plain-text insert with landing verification and a setDraft fallback. */
			var insertViaText = (ia, text) => {
				if (ia && typeof ia.insertText === 'function' && typeof ia.captureInsertion === 'function') {
					try {
						if (ia.insertText(text, ia.captureInsertion()) && draftContains([text.split('\n')[0]])) return true;
					} catch {
						/* fall through to setDraft */
					}
				}
				if (ia && typeof ia.setDraft === 'function') {
					try {
						var currentDraft = composerText().replace(/\u00a0/g, ' ');
						ia.setDraft(currentDraft + (currentDraft && !currentDraft.endsWith('\n') ? '\n' : '') + text);
						if (draftContains([text.split('\n')[0]])) return true;
					} catch {
						/* fall through to clipboard */
					}
				}
				return false;
			};

			/**
			 * Inserted annotations are consumed: they leave the list (undoable) so the next
			 * round starts empty instead of forcing a manual delete of every old card.
			 */
			var consumeInserted = async (ids, message, kind) => {
				var undo = {
					label: '撤销',
					onClick: async function () {
						try {
							var data = await post('/restore', {});
							if (!data.restored) {
								flash('err', '恢复失败：撤销已过期');
								return;
							}
							apply(data);
							flash('ok', '已恢复 ' + data.restored + ' 条标注');
						} catch {
							flash('err', '恢复失败');
						}
					},
				};
				var dropDrafts = function () {
					setDrafts(function (prev) {
						var next = Object.assign({}, prev);
						ids.forEach(function (id) {
							delete next[id];
						});
						return next;
					});
				};
				// Older hosts predate /consume; removing one by one still empties the list.
				var consumeOneByOne = async function () {
					var latest = null;
					for (var i = 0; i < ids.length; i++) {
						try {
							var one = await post('/remove', { id: ids[i] });
							if (one && Array.isArray(one.picks)) latest = one;
						} catch {
							/* keep going: a single failure must not strand the others */
						}
					}
					return latest;
				};
				try {
					var data = await post('/consume', { ids: ids });
					if (!data || data.ok === false) throw new Error(String((data && data.error) || 'consume failed'));
					apply(data);
					dropDrafts();
					var left = (data.picks && data.picks.length) || 0;
					flash(kind, message + (left === 0 ? '，列表已清空' : '，已从列表移除'), undo);
				} catch {
					// Host without /consume (or a failed batch): fall back to per-pick removal so the
					// list still empties; the draft is already written, so never report a failed insert.
					var latest = await consumeOneByOne();
					if (latest) {
						apply(latest);
						dropDrafts();
						flash(kind, message + '，列表已清空（撤销只能恢复最后 1 条；重启 DSH 后可整批撤销）', null);
						return;
					}
					flash(kind, message + '，但列表清空失败，请手动删除', null);
				}
			};

			/**
			 * One user action must land exactly one insertion: the panel can be mounted twice at
			 * the same time (sidebar slot + sidebar tab, keepMounted), and every mount registers its
			 * own window Ctrl+Enter listener and its own pendingConsume effect. Without a shared
			 * gate one keypress inserts the same block once per mount — the user sees three
			 * identical annotations. The gate lives on window so hot-reloaded module copies share it.
			 */
			var INSERT_GATE = '__DSH_VP_INSERT_GATE__';
			var insertGate = function () {
				var gate = null;
				try {
					gate = window[INSERT_GATE];
				} catch {
					gate = null;
				}
				if (!gate || typeof gate !== 'object') {
					gate = { events: typeof WeakSet === 'function' ? new WeakSet() : null, tokens: {}, busy: false };
					try {
						window[INSERT_GATE] = gate;
					} catch {
						/* no writable window: fall back to per-mount inserts */
					}
				}
				if (!gate.tokens) gate.tokens = {};
				return gate;
			};

			/** Claim one user action; false means a sibling mount already took it. */
			var claimInsert = function (kind, key) {
				var gate = insertGate();
				if (kind === 'key') {
					// A keydown object is claimed once: auto-repeat sends fresh events and still inserts.
					if (!gate.events || !key) return true;
					if (gate.events.has(key)) return false;
					gate.events.add(key);
					return true;
				}
				if (kind === 'token') {
					if (gate.tokens[key]) return false;
					gate.tokens[key] = 1;
					return true;
				}
				// Click: the insert awaits screenshot attachments, so a second click on the same list
				// during that window is a duplicate, not a new intent.
				if (gate.busy) return false;
				gate.busy = true;
				return true;
			};

			var releaseInsert = function (kind, key) {
				var gate = insertGate();
				if (kind === 'click') gate.busy = false;
				else if (kind === 'token' && key !== undefined) delete gate.tokens[key];
			};

			/** insertPicks behind the gate. True only when this call really inserted. */
			var insertOnce = async (list, kind, key) => {
				if (!claimInsert(kind, key)) return false;
				var ok = false;
				try {
					ok = await insertPicks(list);
				} catch {
					ok = false;
				}
				if (ok) releaseInsert('click', null);
				else releaseInsert(kind, key);
				return ok;
			};

			/** Insert: screenshots as attachments + one chip per pick. */
			var insertPicks = async (list) => {
				if (!list || list.length === 0) return false;
				var withComment = list.map((pick) =>
					Object.assign({}, pick, {
						comment: drafts[pick.id] !== undefined ? drafts[pick.id] : (pick.comment ?? ''),
					}),
				);
				var attached = await attachShots(withComment);
				// 第 4 参传组件作用域的全部参考：编号按全量算，不因插入子集而错位。
				var text = composeRefText(withComment, attached.count, attached.ok, refs);
				var paired = withComment.some((pick) => pick.role === 'reference');
				var header = paired ? TASK_REFERENCE : TASK_PLAIN;
				// seq = [{pick, prefix}]：普通模式无前缀；对照模式按「改动 N → 参照 R…」成对展开，
				// 未被任何改动引用的参照单列一节，保证草稿里能看出谁参考谁。
				// pick 为 null 的项是纯文本回指行：共享参照的 chip 只在首次出现处插一次，
				// 后续改动下补一行「同改动 N」指回去——谁参照谁在草稿里逐行可查。
				var seq;
				if (!paired) {
					seq = withComment.map((pick) => ({ pick: pick, prefix: '' }));
				} else {
					var refById = {};
					withComment.forEach((pick) => {
						if (pick.role === 'reference') refById[String(pick.id)] = pick;
					});
					// 改动编号必须按 id 查表：withComment 全是浅拷贝，indexOf 比对象引用
					// 永远 -1，曾把每条改动都写成「改动 0」。
					var targetSeq = {};
					targets.forEach((pick, i) => {
						targetSeq[String(pick.id)] = i + 1;
					});
					// claimed[refId] 存首次带出该参照的改动编号：chip 不重复插，关系不丢。
					var claimed = {};
					seq = [];
					withComment.forEach((pick) => {
						if (pick.role === 'reference') return;
						var num = targetSeq[String(pick.id)];
						seq.push({ pick: pick, prefix: '改动 ' + num + '：' });
						pairIdsOfPick(pick).forEach((id) => {
							var ref = refById[String(id)];
							if (!ref) return;
							if (claimed[String(ref.id)]) {
								seq.push({
									pick: null,
									prefix:
										'　参照 ' +
										refCodeOf(ref) +
										'（[标注 #' +
										ref.id +
										']，同改动 ' +
										claimed[String(ref.id)] +
										'，见上）',
								});
								return;
							}
							claimed[String(ref.id)] = num;
							seq.push({ pick: ref, prefix: '　参照 ' + refCodeOf(ref) + '：' });
						});
					});
					withComment.forEach((pick) => {
						if (pick.role !== 'reference' || claimed[String(pick.id)]) return;
						seq.push({ pick: pick, prefix: '　参照 ' + refCodeOf(pick) + '（未对应改动）：' });
					});
				}
				var ia = resolveLiveActions(props.inputActions);
				var actx = ensureVpSource(props.ctx) ? resolveActx(props.ctx, sessionId) : null;
				var ok = false;
				if (actx && typeof actx.bail === 'function' && ia && typeof ia.captureInsertion === 'function') {
					try {
						ok = insertViaChips(ia, actx, seq, header);
					} catch {
						ok = false;
					}
					if (!ok) {
						// Partial chip state: wipe the draft before the text fallback rewrites it.
						try {
							ia.setDraft('');
						} catch {
							/* ignore */
						}
					}
				}
				if (!ok) ok = insertViaText(ia, text);
				if (ok) {
					var label = withComment.length === 1 ? '1 条' : withComment.length + ' 条';
					var note = attached.ok ? '，含 ' + attached.count + ' 张截图' : '；截图未附上，定位详情在发送时展开';
					await consumeInserted(
						withComment.map((pick) => pick.id),
						(paired ? '已插入 ' : '已插入 ') + label + '标注' + note,
						attached.ok ? 'ok' : 'warn',
					);
					return true;
				}
				flash('warn', '输入框不可用，已复制到剪贴板', null);
				try {
					navigator.clipboard?.writeText(text);
				} catch {
					/* clipboard unavailable */
				}
				return false;
			};

			var markdown = useMemo(() => markdownFor(state, picks), [state.markdown, picks]);

			// 页面内 HUD 的「完成·插入」：host 把请求记成单调递增的 pendingConsume token。
			// 面板只对没见过的 token 行动一次；只有插入真正成功才记账——失败时退回上一个
			// token，等下一次 picks/token 变化时自动重试，插入不会静默丢失。
			useEffect(
				function () {
					var token = state.pendingConsume || 0;
					if (!token || token === pendingSeen.current) return;
					if (!canInsert) {
						// token 到达前列表已被清空，或者参考对照里只有「改」没有「照」：
						// 不插入、也不悬空重放，直接说清楚为什么，免得用户以为插了对照。
						pendingSeen.current = token;
						if (insertable.length && viewMode === 'pair') {
							flash('warn', '还没有参照标注：插入对照至少需要一处参照；仅插入改动请切换到普通模式');
						}
						return;
					}
					var previous = pendingSeen.current;
					pendingSeen.current = token;
					Promise.resolve(insertOnce(ctaPicks, 'token', token)).then(
						(ok) => {
							if (!ok) pendingSeen.current = previous;
						},
						() => {
							pendingSeen.current = previous;
						},
					);
				},
				[state.pendingConsume, picks, state.pages],
			);

			// Keep chip serialization data fresh (submit-time codec reads the registry).
			useEffect(function () {
				(state.picks ?? []).forEach((pick) => {
					// Re-read the registry every time: a re-pulled module may have replaced it.
					vpPicks()[pick.id] = Object.assign({}, pick, {
						comment: drafts[pick.id] !== undefined ? drafts[pick.id] : (pick.comment ?? ''),
					});
				});
			});

			var launch = async (browser) => {
				setBusy('launch');
				try {
					var body = { browser: browser, cwd: cwd };
					if (url) body.url = url;
					var data = await post('/launch', body);
					apply(data);
					// host 会把 "gitee.com" 补成 "https://gitee.com/"：输入框跟着显示真实地址，
					// 用户看到的就是浏览器实际打开的那一页。只在成功时同步，失败保留原文便于改。
					if (data.ok && typeof data.activeUrl === 'string' && data.activeUrl && data.activeUrl !== url) {
						setUrl(data.activeUrl);
					}
					// 只在真的起来了之后记住：失败的选择不该变成下次的默认值。
					if (data.ok && browser) {
						rememberBrowser(browser);
						setSavedBrowser(browser);
					}
					if (data.ok && data.reused) flash('ok', '已连接到外部浏览器，新地址会在同一窗口新开标签页');
					else if (data.ok && data.resumed) flash('ok', '已接回同一个浏览器实例（profile 未重建）');
					else if (data.ok) flash('ok', '浏览器已就绪');
					else if (data.error) flash('err', String(data.error));
				} finally {
					setBusy('');
				}
			};

			// 空间 = Chromium BrowserContext：同一窗口换 context，cookie 与标签页互不可见。
			var spaceAction = async (body, okText) => {
				setBusy('space');
				try {
					var data = await post('/space', body);
					apply(data);
					if (!data.ok && data.error) flash('err', String(data.error));
					else if (okText) flash('ok', okText);
				} catch (error) {
					flash('err', String((error && error.message) || error));
				} finally {
					setBusy('');
				}
			};

			var switchSpace = (spaceId) => {
				if (state.status !== 'ready') return;
				setTabMenu(false);
				var body = { action: 'use', id: spaceId };
				if (url) body.url = url;
				return spaceAction(body, null);
			};

			var createSpace = () => {
				if (state.status !== 'ready') return;
				return spaceAction({ action: 'create', url: url || state.activeUrl }, '已新建调试空间');
			};

			var closeSpace = () => {
				if (state.status !== 'ready' || !activeSpace) return;
				return spaceAction({ action: 'close', id: activeSpace }, '空间已关闭');
			};

			var toggleMode = async () => {
				if (state.status !== 'ready') return;
				setBusy('mode');
				try {
					var data = await post('/mode', { mode: state.mode === 'pick' ? 'off' : 'pick' });
					apply(data);
					flash('ok', data.mode === 'pick' ? '标注模式已开启：回到浏览器点击元素' : '已退出标注模式');
				} catch (error) {
					flash('err', String((error && error.message) || error));
				} finally {
					setBusy('');
				}
			};

			/** 只是断开：窗口、标签页和 profile 都留着，下次「打开浏览器」接回同一个实例。 */
			var detachBrowser = async () => {
				setMenu(false);
				setBusy('close');
				try {
					var reused = state.reused;
					apply(await post('/close', {}));
					flash(
						'ok',
						reused ? '已断开连接（外部浏览器保持开启）' : '已断开连接，浏览器与 profile 保留，下次接回同一实例',
					);
				} finally {
					setBusy('');
				}
			};

			/**
			 * One click empties the list. A fresh host returns the whole batch as one
			 * undo slot; an old host (pre-v14) still clears, but the batch undo does
			 * not exist there, so it walks /remove and the toast stops offering 撤销.
			 *
			 * ids 批量清空要 host ≥ v57（/clear 认 ids 参数）。更旧的宿主不认这个参数，
			 * 会把整栏都清掉——多删的条目虽然能整批撤销，但用户并没有要求清那一栏。
			 */
			var clearIdsSupported = () => {
				var n = Number(String(hostBuild || '').replace(/^v/, ''));
				return Number.isFinite(n) && n >= 57;
			};

			var clearAll = async (scope, ids) => {
				setMenu(false);
				scope = scope === 'target' || scope === 'reference' ? scope : 'all';
				// 勾选清空：只清这些 id，且必须先与当前栏取交集，过期勾选不能误伤别处。
				var wanted = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
				var pool = scope === 'target' ? targets : scope === 'reference' ? refs : picks;
				var doomed = wanted
					? pool.filter(function (pick) {
							return wanted.has(String(pick.id));
						})
					: pool;
				var count = doomed.length;
				if (!count) return;
				var bulk = !wanted || clearIdsSupported();
				var result = null;
				if (bulk) {
					try {
						result = await post(
							'/clear',
							wanted
								? {
										scope: scope,
										ids: doomed.map(function (pick) {
											return pick.id;
										}),
									}
								: { scope: scope },
						);
					} catch {
						result = null;
					}
				}
				if (!result || result.ok === false) {
					for (var pick of doomed) {
						try {
							var res = await post('/remove', { id: pick.id });
							if (!res || res.ok === false) throw new Error('remove failed');
							apply(res);
						} catch {
							flash('err', hostStale ? staleHint('清空') : '清空失败，请重试');
							return;
						}
					}
					setDrafts({});
					setSelected([]);
					flash('warn', '已清空 ' + count + ' 条标注（旧宿主，无法整批撤销）');
					return;
				}
				apply(result);
				setDrafts({});
				setSelected([]);
				var undoable = result.cleared === count;
				flash(
					undoable ? 'ok' : 'warn',
					'已清空 ' + count + ' 条标注',
					undoable
						? {
								label: '撤销',
								onClick: async function () {
									try {
										var back = await post('/restore', {});
										if (!back || back.ok === false || !back.restored) {
											flash('err', hostStale ? staleHint('撤销') : '恢复失败');
											return;
										}
										apply(back);
										flash('ok', '已恢复 ' + count + ' 条标注');
									} catch {
										flash('err', '恢复失败');
									}
								},
							}
						: null,
				);
			};

			var removePick = async (id) => {
				apply(await post('/remove', { id }));
				flash('ok', '已删除 1 条标注', {
					label: '撤销',
					onClick: async function () {
						try {
							var data = await post('/restore', {});
							if (data.ok === false) {
								flash('err', hostStale ? staleHint('撤销') : '恢复失败');
								return;
							}
							apply(data);
							flash('ok', '已恢复');
						} catch {
							flash('err', '恢复失败');
						}
					},
				});
			};

			var focusPick = async (id) => {
				try {
					var data = await post('/focus', { id: id });
					if (data.ok === false) {
						flash('err', hostStale ? staleHint('定位') : '定位失败：' + String(data.error || '请求失败'));
						return;
					}
					apply(data);
					if (data.focused === false) flash('warn', '在浏览器里没找到这个元素，可能已滚出页面或页面已变化');
				} catch (error) {
					flash('err', String((error && error.message) || error));
				}
			};

			/** Debounced comment persistence with an inline save indicator. */
			var editComment = (id, value) => {
				setDrafts((prev) => Object.assign({}, prev, { [id]: value }));
				setSaved((prev) => Object.assign({}, prev, { [id]: 'pending' }));
				if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
				saveTimers.current[id] = setTimeout(() => persistComment(id, value), 450);
			};

			var persistComment = async (id, value) => {
				if (saveTimers.current[id]) {
					clearTimeout(saveTimers.current[id]);
					saveTimers.current[id] = null;
				}
				setSaved((prev) => Object.assign({}, prev, { [id]: 'saving' }));
				try {
					apply(await post('/comment', { id: id, comment: value }));
					setSaved((prev) => Object.assign({}, prev, { [id]: 'saved' }));
				} catch {
					setSaved((prev) => Object.assign({}, prev, { [id]: 'error' }));
				}
			};

			var switchTab = async (targetId) => {
				setBusy('tab');
				try {
					apply(await post('/tab', { targetId: targetId }));
				} catch (error) {
					flash('err', String((error && error.message) || error));
				}
				setBusy('');
			};

			var copyMarkdown = () => {
				try {
					navigator.clipboard?.writeText(markdown);
					flash('ok', 'Markdown 已复制');
				} catch {
					flash('err', '复制失败');
				}
			};

			/* ---- derived state ------------------------------------------- */
			var ready = state.status === 'ready';
			var picking = state.mode === 'pick';
			// 浏览器注册表由 host 下发，面板不写死 id：新增浏览器只要 host 认识就自动出现在选择器里。
			// host 还是旧版（没有注册表）时退回 /state.browsers 的键，否则面板会在升级中途把「启动」按钮判成无浏览器。
			var browserOrder =
				state.browserOrder && state.browserOrder.length ? state.browserOrder : Object.keys(state.browsers ?? {});
			var browserLabels = Object.assign({ chrome: 'Chrome', edge: 'Edge', ego: 'ego lite' }, state.browserLabels ?? {});
			var installedBrowsers = browserOrder.filter((id) => Boolean(state.browsers?.[id]));
			// 选择器列出注册表里的每一个浏览器，没装的标「未安装」并禁用：早先只列装了
			// 的，这台机器没装 Edge 时选择器里就没有 Edge，看着像插件漏了支持。
			var browserChoices = browserOrder.map((id) => ({
				id,
				label: browserLabels[id] || id,
				available: Boolean(state.browsers?.[id]),
			}));
			var noBrowsers = browserOrder.length > 0 && installedBrowsers.length === 0;
			// 顺序：上次成功用过的 → host 缺省（注册表顺序里第一个装了的）→ 第一个装了的 → 'chrome'。
			var targetBrowser =
				(savedBrowser && installedBrowsers.includes(savedBrowser) ? savedBrowser : null) ??
				(installedBrowsers.includes(state.browserDefault) ? state.browserDefault : null) ??
				installedBrowsers[0] ??
				'chrome';
			var targetLabel = browserLabels[targetBrowser] || targetBrowser;
			// 选择器的值永远是「用户选中的浏览器」，不再在已连接时被强行改成当前这个：
			// 早先是选择器一变就 launch，结果只是用下拉框看看有哪些浏览器，
			// 也会把当前浏览器关掉再开一个新的（chrome ↔ edge 来回切换都一样）。
			// 现在换窗口只能由「切换」按钮触发。
			var launchTarget = targetBrowser;
			var connectedBrowser = ready ? state.browser || '' : '';
			var switchTarget = Boolean(connectedBrowser && launchTarget !== connectedBrowser);
			// 调试空间：host 是旧版或还没连上时，至少给一个默认空间，选择器不至于空着。
			var spaceList = state.spaces && state.spaces.length ? state.spaces : [{ id: '', name: '默认空间' }];
			var activeSpace = state.space || '';
			// 空间（独立 BrowserContext）目前只对 ego lite 有意义：它会和用户自己的
			// 那一屏共存，插件需要一个自己的空间才不抢人家；Chrome / Edge 用的是插件
			// 专属 profile，本来就是一整块干净的，多一层空间只会让面板更复杂。
			var isEgo = state.browser === 'ego';
			var showSpaces = ready && isEgo;
			var pillState = picking
				? 'pick'
				: ready
					? 'ready'
					: state.status === 'error'
						? 'error'
						: state.status === 'starting'
							? 'starting'
							: 'idle';
			var pillText = picking
				? '标注中 · ' + picks.length + ' 处'
				: ready
					? state.reused
						? '已连接 · 复用现有浏览器'
						: '已连接 · ' + (hostOf(state.activeUrl) || '浏览器')
					: state.status === 'starting'
						? '正在启动…'
						: state.status === 'error'
							? '连接失败'
							: state.windowKept
								? '已断开 · 浏览器保留'
								: '未连接';
			var insertLabel = '插入';
			// CTA 说清楚这次到底插什么：只有参考 = 照参考新建；混合 = 目标 + 参考分开算。
			var ctaLabel =
				viewMode === 'pair' ? '插入对照（' + insertable.length + ' 条）' : '全部插入（' + insertable.length + ' 条）';
			var tabs = state.tabs ?? [];
			// 标签条平铺：一行放不下就折行，最多直接给 10 枚，剩下的收进「更多」弹层，
			// 免得 5 个标签就把这条挤出横向滚动条。
			var TAB_LIMIT = 10;
			var visibleTabs = tabs.slice(0, TAB_LIMIT);
			var extraTabs = tabs.slice(TAB_LIMIT);

			var tabButton = function (tab, wide) {
				return h(
					'button',
					{
						key: tab.targetId,
						role: 'tab',
						'aria-selected': !!tab.active,
						className: 'vp-tab' + (tab.active ? ' on' : '') + (wide ? ' wide' : ''),
						title: (tab.title || tab.url || tab.targetId) + '\n' + (tab.url || ''),
						disabled: busy === 'tab',
						onClick: function () {
							setTabMenu(false);
							switchTab(tab.targetId);
						},
					},
					h('b', null, tab.active ? '●' : '○'),
					h('span', null, String(tab.title || tab.url || tab.targetId).slice(0, wide ? 80 : 24)),
					// 这一页里没有标注层：明确标出来，别让用户对着一个「没反应」的页面猜。
					tab.hud === false
						? h(
								'b',
								{
									className: 'vp-tab-warn',
									title: '这个标签页里没有标注层（host 会自动重试）。点一下这个标签页可再试一次。',
								},
								'!',
							)
						: null,
				);
			};

			/* ---- keyboard ------------------------------------------------ */
			useEffect(
				function () {
					var onKey = function (event) {
						var mod = event.ctrlKey || event.metaKey;
						// macOS 的 Option+A 会把 event.key 组合成 å，按物理键 code=KeyA 兜底判定。
						if (event.altKey && !mod && (event.code === 'KeyA' || event.key === 'a' || event.key === 'A')) {
							event.preventDefault();
							toggleMode();
							return;
						}
						if (mod && event.key === 'Enter') {
							if (!canInsert) return;
							event.preventDefault();
							insertOnce(ctaPicks, 'key', event);
							return;
						}
						if (event.key === 'Escape') {
							if (expandedId) {
								event.preventDefault();
								setExpandedId('');
								return;
							}
							if (slotMenu) {
								setSlotMenu('');
								return;
							}
							if (menu) {
								setMenu(false);
								return;
							}
							if (state.mode === 'pick') {
								event.preventDefault();
								post('/mode', { mode: 'off' }).then(apply);
							}
						}
					};
					window.addEventListener('keydown', onKey);
					return function () {
						window.removeEventListener('keydown', onKey);
					};
				},
				[state.mode, picks, state.pages, menu, expandedId, slotMenu],
			);

			/** 参考维度快捷标签：和 host 侧 page-roles 的 SPEC_DIMS 保持一致。 */
			var SPEC_DIMS = ['布局', '间距', '配色', '字体', '字号', '圆角', '交互', '文案'];

			/** 两个模式：普通模式（一处一条）/ 参照模式（左「改动」右「参照」）。 */
			var modeTabs = function () {
				if (!ready || !pages.length) return null;
				return h(
					'div',
					{ className: 'vp-mode', role: 'tablist' },
					h(
						'button',
						{
							role: 'tab',
							'aria-selected': viewMode === 'plain',
							className: viewMode === 'plain' ? 'on' : '',
							title: '普通模式：只列需要修改的标注，一处一条',
							onClick: () => {
								setArming(null);
								setAssigning('');
								// 普通模式没有勾选框：顺带退出批量并清掉已选，回参照模式不出现「莫名已选」。
								setSelectMode(false);
								setSelected([]);
								setViewMode('plain');
							},
						},
						h('span', { className: 'dot' }),
						'普通模式',
						h('span', { className: 'n' }, targets.length),
					),
					h(
						'button',
						{
							role: 'tab',
							'aria-selected': viewMode === 'pair',
							className: (viewMode === 'pair' ? 'on' : '') + ' ref',
							title: '参照模式：左侧为改动、右侧为参照，一条改动可参照多处',
							onClick: () => setViewMode('pair'),
						},
						h('span', { className: 'dot' }),
						'参照模式',
						h('span', { className: 'n' }, rows.length),
					),
				);
			};

			/** 栏头不提页面：一条标注属于哪一栏由落标时点的按钮决定，与它出自哪个标签页无关。 */
			var colHeads = function () {
				return h(
					'div',
					{ className: 'vp-colhead' },
					h(
						'div',
						{ className: 'col' },
						h(
							'div',
							{ className: 'vp-chead' },
							h('span', { className: 'k' }, '改动区'),
							h('span', { className: 'num' }, String(targets.length)),
							// 栏内直达清空：以前只有菜单里那三项，用户得先想起来还有菜单。
							h(
								'button',
								{
									type: 'button',
									className: 'vp-chead-clear',
									disabled: !targets.length,
									title: targets.length ? '清空改动区（可整批撤销）' : '改动区已经是空的',
									onClick: (event) => {
										event.stopPropagation();
										clearAll('target');
									},
								},
								'清空',
							),
						),
					),
					h(
						'div',
						// 拖「改动」到「参照」栏 = 这条改成参照：换个身份比翻菜单快。
						{
							className: 'col',
							title: '将左侧任一条改动拖到这里，即可将其改为参照',
							onDragOver: (event) => {
								event.preventDefault();
							},
							onDrop: (event) => {
								event.preventDefault();
								var raw = '';
								try {
									raw = String(
										event.dataTransfer.getData('application/x-vp-pick') ||
											event.dataTransfer.getData('text/plain') ||
											'',
									);
								} catch {
									raw = '';
								}
								var pick = picks.filter((item) => String(item.id) === raw)[0];
								if (!pick) return;
								if (pick.role === 'reference') {
									flash('info', '该标注已经是参照');
									return;
								}
								setPickRole(pick.id, 'reference');
								flash('ok', '该标注已改为参照');
							},
						},
						h(
							'div',
							{ className: 'vp-chead' },
							h('span', { className: 'k ref' }, '参照区'),
							h('span', { className: 'num' }, String(refs.length)),
							h(
								'button',
								{
									type: 'button',
									className: 'vp-chead-clear',
									disabled: !refs.length,
									title: refs.length ? '清空参照区（可整批撤销）' : '参照区已经是空的',
									onClick: (event) => {
										event.stopPropagation();
										clearAll('reference');
									},
								},
								'清空',
							),
						),
					),
					// 勾选清空：选中条横跨两栏，仅在批量模式且真的勾了东西之后出现——
					// 没人勾选时它是个空条，白占一行高度还会让人以为漏了一步。
					selectMode && selectedIds.length
						? h(
								'div',
								{ className: 'vp-selbar', role: 'status', 'aria-live': 'polite' },
								h('span', null, '已选 ' + selectedIds.length + ' 条'),
								h('span', { className: 'sp' }),
								h(
									'button',
									{
										type: 'button',
										title: '勾选全部 ' + picks.length + ' 条标注',
										onClick: () => setSelected(picks.map((pick) => String(pick.id))),
									},
									'全选',
								),
								h('button', { type: 'button', onClick: () => setSelected([]) }, '取消选择'),
								h(
									'button',
									{ type: 'button', className: 'danger', onClick: () => clearAll('all', selectedIds) },
									'清空所选',
								),
							)
						: null,
				);
			};

			/**
			 * 设落点：下一处标注进哪一栏。落点是粘性的——点一次「＋ 新增改动」，之后
			 * 在任意标签页上连点五处都在「改动」栏，不用每标一处回来按一次；再点一次取消。
			 * 角色在 host 落标那一刻就定下来，面板不再事后纠正（以前按页面角色落、再纠正，
			 * 页签一多就必然对不上，用户看到的就是「选的页签和标注不符」）。
			 */
			var armFor = function (slot, pairId) {
				armAt.current = Date.now();
				setArming({ slot: slot, pairId: pairId ? String(pairId) : '' });
				// 同步给 host：新标注当场归这一栏；落点落在已标注元素上时复用那一条。
				post('/arm', { slot: slot, pairId: pairId ? String(pairId) : null });
				setAssigning('');
				// 开标注模式这一步代劳掉：点完就能直接在页面上点元素。
				if (!picking) toggleMode();
				// 等待提示不再走 toast（会盖住卡片）：固定显示在标签页下方的 vp-armbar 色条里。
			};

			var cancelArm = function () {
				armAt.current = Date.now();
				setArming(null);
				post('/arm', null);
			};

			var pairCell = function (pick, role, opts) {
				var extra = opts || {};
				// 序号只写数字（改动）或 R 码（参照），外面那圈实心块负责「显眼」。
				var code = role === 'reference' ? refCodeOf(pick) : String(targets.indexOf(pick) + 1);
				var comment = drafts[pick.id] !== undefined ? drafts[pick.id] : (pick.comment ?? '');
				var text = String(comment || '').trim();
				var open = expandedId === String(pick.id);
				var toggle = function () {
					setExpandedId(open ? '' : String(pick.id));
				};
				var droppable = typeof extra.onDrop === 'function';
				var assignHere = !!assigning && role === 'target';
				var isSel = selectedIds.indexOf(String(pick.id)) >= 0;
				var shotLabel = (role === 'reference' ? '参照 ' : '改动 ') + code + ' · ' + String(pick.tag || '元素');
				return h(
					'div',
					{
						className:
							'vp-cell' +
							(role === 'reference' ? ' ref' : ' t') +
							(open ? ' sel' : '') +
							(assignHere ? ' drop' : '') +
							(isSel ? ' picked' : ''),
						role: 'button',
						tabIndex: 0,
						'aria-expanded': open,
						draggable: true,
						title:
							(role === 'reference'
								? '点一下展开看全并编辑 · 双击定位 · 拖到左侧改动卡上即可建立对照'
								: '点一下展开看全并编辑 · 双击定位 · 拖到右侧参照卡上即可建立对照') +
							(assignHere ? ' · 点击即为该改动配对这条参照' : ''),
						onClick: () => {
							// 正在「配给某条改动」：点一下就配，不必再开编辑器。
							if (assignHere) {
								var refId = String(assigning);
								setAssigning('');
								setPair(pick.id, refId);
								return;
							}
							toggle();
						},
						onDblClick: () => focusPick(pick.id),
						onKeyDown: (event) => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								toggle();
							}
						},
						onDragStart: (event) => {
							event.dataTransfer.effectAllowed = 'link';
							try {
								event.dataTransfer.setData('application/x-vp-pick', String(pick.id));
							} catch {
								/* 个别浏览器只认 text/plain，下面兜底 */
							}
							event.dataTransfer.setData('text/plain', String(pick.id));
						},
						onDragOver: droppable
							? (event) => {
									event.preventDefault();
									event.stopPropagation();
								}
							: undefined,
						onDrop: droppable ? extra.onDrop : undefined,
					},
					h(
						'div',
						{ className: 'vp-cell-main' },
						pick.shotUrl
							? h(
									'div',
									{
										className: 'vp-cell-shot',
										role: 'button',
										tabIndex: 0,
										title: '点击放大截图',
										'aria-label': '放大截图',
										onClick: (event) => {
											event.stopPropagation();
											openShotViewer(pick.shotUrl, shotLabel);
										},
										onDblClick: (event) => event.stopPropagation(),
										onKeyDown: (event) => {
											if (event.key !== 'Enter' && event.key !== ' ') return;
											event.preventDefault();
											event.stopPropagation();
											openShotViewer(pick.shotUrl, shotLabel);
										},
									},
									h('img', { src: pick.shotUrl, alt: '元素截图 ' + pick.id }),
								)
							: null,
						h(
							'div',
							{ className: 'vp-cell-info' },
							h(
								'div',
								{ className: 'vp-cell-head' },
								// 勾选框只在批量模式渲染：平时常驻空框是噪音，点底部「批量操作」才出现。
								// 点击只切换勾选，不展开卡片（stopPropagation 挡掉外层 onClick）。
								selectMode
									? h('button', {
											type: 'button',
											className: 'vp-check' + (isSel ? ' on' : ''),
											role: 'checkbox',
											'aria-checked': isSel ? 'true' : 'false',
											'aria-label': '勾选这条标注，用于批量清空',
											tabIndex: 0,
											title: isSel ? '已勾选：点一下取消' : '勾选后可「清空所选」批量删除',
											onClick: (event) => {
												event.preventDefault();
												event.stopPropagation();
												toggleSelect(pick.id);
											},
											onKeyDown: (event) => {
												event.stopPropagation();
											},
											onDblClick: (event) => {
												event.stopPropagation();
											},
										})
									: null,
								h(
									'span',
									{
										className: role === 'reference' ? 'r' : 'n',
										title: role === 'reference' ? '参照 ' + code : '改动 ' + code,
									},
									code,
								),
								h('span', { className: 'vp-cell-sel' }, String(pick.selector || pick.tag || '元素')),
								extra.badge
									? h(
											'span',
											{ className: 'vp-cell-badge' + (extra.badgeTone === 'owner' ? ' owner' : '') },
											extra.badge,
										)
									: null,
								pick.pageClosed
									? h(
											'span',
											{ className: 'vp-closed', title: '这一页已经关了；标注还在，重新打开同一地址会自动挂回' },
											'页面已关闭',
										)
									: null,
							),
							h(
								'div',
								{ className: 'vp-cell-note' + (text ? '' : ' none') },
								h(
									'span',
									{ className: 't', title: text || undefined },
									text || (role === 'reference' ? '需要参照此处的哪些特征？' : '需要修改成什么？'),
								),
								role === 'reference' && (pick.spec || []).length
									? h('span', { className: 'vp-cell-spec', title: pick.spec.join(' · ') }, pick.spec.join(' · '))
									: null,
							),
						),
					),
				);
			};

			/** 行内编辑器：全宽展开，评论 + 参考维度 + 这组已配的参考 + 定位/插入/删除。 */
			var rowEditor = function (row) {
				var pick = row.target || row.ref;
				// 一条参照可能被好几条改动引用：编辑器头部也列全，别只报第一条
				var owners =
					pick.role === 'reference'
						? targets
								.map(function (item, index) {
									return pairIdsOf(item).some(function (pid) {
										return String(pid) === String(pick.id);
									})
										? index + 1
										: 0;
								})
								.filter(function (index) {
									return index > 0;
								})
						: [];
				var comment = drafts[pick.id] !== undefined ? drafts[pick.id] : (pick.comment ?? '');
				var saveInfo = saved[pick.id];
				var saveText =
					saveInfo === 'saving' ? '保存中…' : saveInfo === 'saved' ? '已保存' : saveInfo === 'error' ? '保存失败' : '';
				// 一条参考常要落到好几处；这里算「还没配对的其他目标」，给一键套用。
				var rest = row.ref
					? targets.filter(function (item) {
							if (pairCount(item) > 0) return false;
							return !row.target || String(item.id) !== String(row.target.id);
						}).length
					: 0;
				return h(
					'div',
					{ className: 'vp-rowedit' },
					h(
						'div',
						{ className: 'meta' },
						h(
							'span',
							null,
							pick.role === 'reference'
								? '参照 ' + refCodeOf(pick) + (owners.length ? ' · 改动 ' + owners.join('、') : ' · 未配对')
								: '改动 #' + (targets.indexOf(pick) + 1),
						),
						h('span', { className: 'sel' }, String(pick.selector || pick.tag || '')),
						pick.pageClosed ? h('span', { className: 'vp-closed' }, '页面已关闭') : null,
						h('span', { className: 'vp-spacer' }),
						h('span', { className: 'vp-saved', role: 'status' }, saveText),
					),
					h('textarea', {
						placeholder:
							pick.role === 'reference'
								? '需要参照此处的哪些特征？例如：间距 16px、卡片圆角、按钮配色'
								: '需要修改成什么？例如：字号调整为 16px、按钮改用主色',
						'aria-label': pick.role === 'reference' ? '参照说明' : '修改要求',
						value: comment,
						onChange: (event) => editComment(pick.id, event.target.value),
						onBlur: (event) => persistComment(pick.id, event.target.value),
					}),
					pick.role === 'reference'
						? h(
								'div',
								{ className: 'vp-dims', role: 'group', 'aria-label': '参考维度' },
								SPEC_DIMS.map((dim) =>
									h(
										'button',
										{
											key: dim,
											className: 'vp-dimchip',
											'aria-pressed': (pick.spec || []).indexOf(dim) >= 0,
											onClick: () => {
												var spec = (pick.spec || []).slice();
												var at = spec.indexOf(dim);
												if (at >= 0) spec.splice(at, 1);
												else spec.push(dim);
												setPickSpec(pick.id, spec);
											},
										},
										dim,
									),
								),
								(pick.spec || []).length
									? h(
											'button',
											{
												key: '__clear',
												className: 'vp-dimchip clear',
												type: 'button',
												title: '一键取消这条参照已选的全部 ' + pick.spec.length + ' 个维度',
												onClick: () => setPickSpec(pick.id, []),
											},
											'清空 (' + pick.spec.length + ')',
										)
									: null,
							)
						: row.target
							? h(
									'div',
									{ className: 'vp-reflist' },
									h('span', { className: 'cap' }, '参照：'),
									(row.refs || []).map((ref) =>
										h(
											'span',
											{
												key: ref.id,
												className: 'vp-refchip',
												title: String(ref.comment || ref.selector || ''),
											},
											h('span', null, refCodeOf(ref)),
											h(
												'button',
												{
													type: 'button',
													'aria-label': '解除 ' + refCodeOf(ref) + ' 与此改动的关联',
													onClick: () => unpairOne(row.target.id, ref.id),
												},
												'×',
											),
										),
									),
									h(
										'button',
										{ className: 'vp-dimchip', type: 'button', onClick: () => armFor('reference', row.target.id) },
										'＋ 添加参照',
									),
								)
							: null,
					h(
						'div',
						{ className: 'actions' },
						h(
							'button',
							{ className: 'vp-btn sm', title: '在浏览器中定位', onClick: () => focusPick(pick.id) },
							'在页面中定位',
						),
						row.target
							? h(
									'button',
									{
										className: 'vp-btn sm pri',
										title: '插入此组（改动及其全部参照）',
										onClick: () => insertOnce([row.target].concat(row.refs || (row.ref ? [row.ref] : [])), 'click'),
									},
									'插入此组',
								)
							: null,
						rest
							? h(
									'button',
									{
										className: 'vp-btn sm',
										title: '将此参照应用到其余 ' + rest + ' 条尚未配对的改动',
										onClick: () => setPairAll(row.ref.id),
									},
									'应用到其余 ' + rest + ' 条改动',
								)
							: null,
						row.groupTargetId && row.ref
							? h(
									'button',
									{
										className: 'vp-btn sm',
										title: '仅解除此参照与该改动的关联，标注本身保留',
										onClick: () => unpairOne(row.groupTargetId, row.ref.id),
									},
									'解除关联',
								)
							: null,
						h('span', { className: 'vp-spacer' }),
						h(
							'button',
							{ className: 'vp-btn sm danger', title: '删除这条标注', onClick: () => removePick(pick.id) },
							'删除标注',
						),
					),
				);
			};

			/**
			 * 参考对照主体：左右两栏。左栏「改动」每条一处，卡下挂着它参照的标注（1:N）；
			 * 右栏「参照」平铺全部参照标注，卡片徽标写明归属。对照关系三个方向都能拖：
			 * 参照卡拖到改动卡 / 改动卡拖到参照卡 / 参照卡拖到另一张参照卡（归入同一改动）。
			 */
			var pairView = function () {
				if (!pages.length) {
					return h('div', { className: 'vp-empty' }, h('span', null, '先打开浏览器，再开始标注。'));
				}
				var draggedId = function (event) {
					try {
						return String(
							event.dataTransfer.getData('application/x-vp-pick') || event.dataTransfer.getData('text/plain') || '',
						);
					} catch {
						return '';
					}
				};
				/** 一条参照当前被哪几条改动引用：返回序号数组（1 起）。多对多，一条参照可以同时挂给好几条改动。 */
				var ownerIndexesOf = function (ref) {
					var id = String(ref.id);
					return targets
						.map(function (item, index) {
							return pairIdsOf(item).some(function (pid) {
								return String(pid) === id;
							})
								? index + 1
								: 0;
						})
						.filter(function (index) {
							return index > 0;
						});
				};
				/** 第一条归属（拖拽落点、展开编辑器用）：未配对返回 0。 */
				var ownerIndexOf = function (ref) {
					return ownerIndexesOf(ref)[0] || 0;
				};
				var onDropRef = function (targetId, event) {
					event.preventDefault();
					event.stopPropagation();
					var id = draggedId(event);
					if (!id || !isRefId(id)) return;
					var target = targets.filter((item) => String(item.id) === String(targetId))[0];
					var already =
						target &&
						pairIdsOf(target).some(function (item) {
							return String(item) === id;
						});
					if (already) {
						flash('info', '该参照已在此组中');
						return;
					}
					setPair(targetId, id);
					flash('ok', '已为该改动配对一条参照');
				};
				var onDropTarget = function (refId, event) {
					event.preventDefault();
					event.stopPropagation();
					var id = draggedId(event);
					if (!id || !isTargetId(id)) return;
					setPair(id, refId);
					flash('ok', '已为该参照配对一条改动');
				};
				// 参照卡叠到参照卡 = 归入同一改动：右栏内部也能靠拖拽整理归属。
				var onDropRefOnRef = function (dropRefId, event) {
					event.preventDefault();
					event.stopPropagation();
					var id = draggedId(event);
					if (!id || !isRefId(id) || String(id) === String(dropRefId)) return;
					var dropRef = refs.filter((item) => String(item.id) === String(dropRefId))[0];
					var owner = dropRef ? ownerIndexOf(dropRef) : 0;
					var target = owner ? targets[owner - 1] : targets[0];
					if (!target) {
						flash('warn', '还没有改动标注：请先在左侧点击「＋ 新增改动」');
						return;
					}
					var already = pairIdsOf(target).some(function (pid) {
						return String(pid) === id;
					});
					if (already) {
						flash('info', '该参照已在此组中');
						return;
					}
					setPair(target.id, id);
					flash('ok', owner ? '已将该参照归入改动 #' + owner : '已将该参照配给改动 #' + (targets.indexOf(target) + 1));
				};
				/** 左栏一张改动卡：卡片本身接收参照拖入，卡下的 chips 写清它参照了哪些标注。 */
				var targetCard = function (target) {
					var tid = String(target.id);
					var linkedRefs = refs.filter(function (item) {
						return pairIdsOf(target).some(function (pid) {
							return String(pid) === String(item.id);
						});
					});
					var openTarget = expandedId === tid;
					var armedHere = arming && arming.slot === 'reference' && String(arming.pairId) === tid;
					var refMenuOpen = slotMenu === 'refs-' + tid;
					// 已标注、但还没挂到这条改动上的参照：下拉里直接勾选即可配对，不必去页面重新标注。
					var looseRefs = refs.filter(function (item) {
						return !pairIdsOf(target).some(function (pid) {
							return String(pid) === String(item.id);
						});
					});
					return h(
						'div',
						{ className: 'vp-grpwrap', key: tid },
						h(
							'div',
							{
								className: 'vp-tcell',
								onDragOver: (event) => {
									if (draggedId(event)) event.preventDefault();
								},
								onDrop: (event) => onDropRef(target.id, event),
							},
							pairCell(target, 'target'),
							h(
								'div',
								{ className: 'vp-reflist vp-relrow' },
								h('span', { className: 'cap' }, linkedRefs.length ? '参照：' : '参照：未选择'),
								linkedRefs.map((ref) =>
									h(
										'span',
										{ key: ref.id, className: 'vp-refchip', title: String(ref.comment || ref.selector || '') },
										h('span', null, refCodeOf(ref)),
										h(
											'button',
											{
												type: 'button',
												'aria-label': '解除 ' + refCodeOf(ref) + ' 与此改动的关联',
												onClick: () => unpairOne(target.id, ref.id),
											},
											'×',
										),
									),
								),
								h(
									'button',
									{
										className: 'vp-dimchip' + (armedHere ? ' arm' : '') + (refMenuOpen ? ' on' : ''),
										type: 'button',
										'aria-expanded': refMenuOpen,
										title: '从已标注的参照里选一条挂上来；也可以在任意标签页新标一处参照',
										onClick: () => setSlotMenu(refMenuOpen ? '' : 'refs-' + tid),
									},
									armedHere ? '正在等待标注…' : '＋ 添加参照 ▾',
								),
							),
							refMenuOpen
								? h(
										'div',
										{ className: 'vp-refmenu', role: 'menu', 'aria-label': '选择参照' },
										looseRefs.length
											? looseRefs.map((item) => {
													var note = String(item.comment || item.selector || '').trim();
													if (note.length > 34) note = note.slice(0, 34) + '…';
													return h(
														'button',
														{
															key: item.id,
															role: 'menuitem',
															title: note ? refCodeOf(item) + ' · ' + note : refCodeOf(item),
															onClick: () => {
																setSlotMenu('');
																setPair(target.id, item.id);
															},
														},
														h('span', { className: 't' }, refCodeOf(item) + (note ? ' · ' + note : '')),
													);
												})
											: h('div', { className: 'hint' }, '现有参照都已挂在这条改动上'),
										h(
											'button',
											{
												role: 'menuitem',
												title: '点击后，下一处参照标注自动配给这条改动（任意标签页都可）',
												onClick: () => {
													setSlotMenu('');
													armFor('reference', target.id);
												},
											},
											h('span', { className: 't' }, '＋ 新标注一处参照'),
										),
									)
								: null,
						),
						openTarget ? rowEditor({ target: target, refs: linkedRefs, ref: linkedRefs[0] || null }) : null,
					);
				};
				/** 右栏一张参照卡：徽标写明归属；已引用的带「再次引用」开关；展开的编辑器就地渲染在卡片下面。 */
				var refCard = function (ref) {
					var owners = ownerIndexesOf(ref);
					var owner = owners[0] || 0;
					var open = expandedId === String(ref.id);
					var used = Boolean(ref.referencedAt);
					var again = used && ref.included === true;
					return h(
						'div',
						{ className: 'vp-grpwrap', key: 'ref-' + ref.id },
						h(
							'div',
							{
								className: 'vp-tcell',
								onDragOver: (event) => {
									if (draggedId(event)) event.preventDefault();
								},
								onDrop: (event) => {
									// 落点既可能是「改动拖到参照」也可能是「参照叠到参照」：按拖起来的身份分发。
									var id = draggedId(event);
									if (id && isRefId(id)) onDropRefOnRef(ref.id, event);
									else onDropTarget(ref.id, event);
								},
							},
							pairCell(ref, 'reference'),
							// 右栏也有一条关系行：写明这条参照归给哪条改动；有就对齐，没有就空着同高
							h(
								'div',
								{ className: 'vp-relrow' },
								h(
									'span',
									{
										className: 'vp-cell-badge' + (owners.length ? ' owner' : ''),
										title: owners.length
											? '被改动 ' + owners.join('、') + ' 引用：一条参照可以同时挂给多条改动'
											: '还没有配给任何改动：拖到左侧改动卡上，或点开这条参照配',
									},
									owners.length ? '→ 改动 ' + owners.join('、') : used ? '已引用' : '未配对',
								),
								h('span', { className: 'vp-spacer' }),
								used
									? h(
											'button',
											{
												className: 'vp-dimchip' + (again ? ' on' : ''),
												type: 'button',
												title: again
													? '这条参照会在下一次插入时一并重发；点一下取消'
													: '这条参照在上次插入中已引用：点一下让它参与下一次插入',
												onClick: () => reuseRef(ref, !again),
											},
											again ? '✓ 将再次引用' : '再次引用',
										)
									: null,
							),
						),
						open
							? rowEditor({
									target: null,
									ref: ref,
									refs: [],
									groupTargetId: owner ? String(targets[owner - 1].id) : '',
								})
							: null,
					);
				};
				if (!targets.length && !refs.length) {
					return h(
						'div',
						{ className: 'vp-pairs' },
						colHeads(),
						h(
							'div',
							{ className: 'vp-empty' },
							h(
								'button',
								{ className: 'vp-step' + (picking ? ' done' : ''), disabled: !ready, onClick: toggleMode },
								h('span', { className: 'n' }, picking ? '✓' : '1'),
								h('span', null, '开启标注模式，在任意标签页点击需要修改的元素'),
							),
							h(
								'div',
								{ className: 'vp-step', style: { cursor: 'default' } },
								h('span', { className: 'n' }, '2'),
								h(
									'span',
									null,
									'再用「＋ 新增改动」「＋ 添加参照」决定下一处进哪一栏',
									h('br'),
									h('small', { style: { opacity: 0.75 } }, '任意标签页都能标；一条改动可参照多处'),
								),
							),
						),
					);
				}
				return h(
					'div',
					{ className: 'vp-pairs' },
					colHeads(),
					h(
						'div',
						{ className: 'vp-cols' },
						h(
							'div',
							{ className: 'vp-col' },
							targets.length
								? null
								: h(
										'div',
										{ className: 'vp-empty-hint' },
										'还没有改动标注：点击下方按钮，在任意标签页标注需要修改的元素',
									),
							targets.map(targetCard),
							h(
								'button',
								{
									className: 'vp-addref' + (arming && arming.slot === 'target' ? ' arm' : ''),
									type: 'button',
									title: '点击后，在任意标签页点的元素都归入「改动」；可连续标多处，再点一次取消',
									onClick: () =>
										arming && arming.slot === 'target' && !arming.pairId ? cancelArm() : armFor('target'),
								},
								arming && arming.slot === 'target' ? '正在等待标注…' : '＋ 新增改动',
							),
						),
						h(
							'div',
							{ className: 'vp-col' },
							refs.length
								? null
								: h(
										'div',
										{ className: 'vp-empty-hint' },
										'还没有参照标注：点击下方按钮，在任意标签页标注需要参照的元素',
									),
							refs.map(refCard),
							h(
								'button',
								{
									className: 'vp-addref' + (arming && arming.slot === 'reference' && !arming.pairId ? ' arm' : ''),
									type: 'button',
									title: '点击后，在任意标签页点的元素都归入「参照」；可连续标多处，再点一次取消',
									onClick: () =>
										arming && arming.slot === 'reference' && !arming.pairId ? cancelArm() : armFor('reference'),
								},
								arming && arming.slot === 'reference' && !arming.pairId ? '正在等待标注…' : '＋ 添加参照',
							),
						),
					),
				);
			};
			/** 普通模式：只列要改的标注，一条一处，写清怎么改就行。 */
			var plainList = function () {
				if (!targets.length) {
					return h(
						'div',
						{ className: 'vp-empty' },
						h(
							'button',
							{ className: 'vp-step', onClick: () => urlRef.current && urlRef.current.focus() },
							h('span', { className: 'n' }, '1'),
							h('span', null, '打开要修改的页面', h('br'), h('small', { style: { opacity: 0.75 } }, '填地址 → 启动')),
						),
						h(
							'button',
							{ className: 'vp-step' + (picking ? ' done' : ''), disabled: !ready, onClick: toggleMode },
							h('span', { className: 'n' }, picking ? '✓' : '2'),
							h(
								'span',
								null,
								'开启标注模式',
								h('br'),
								h('small', { style: { opacity: 0.75 } }, '在页面点击元素，或按 ' + HOTKEY + ' 开启标注'),
							),
						),
						h(
							'button',
							{ className: 'vp-step', disabled: true },
							h('span', { className: 'n' }, '3'),
							h(
								'span',
								null,
								'写评论并插入对话',
								h('br'),
								h('small', { style: { opacity: 0.75 } }, '截图、定位与评论一起发送'),
							),
						),
					);
				}
				var cards = targets.map(function (pick, index) {
					var comment = drafts[pick.id] !== undefined ? drafts[pick.id] : (pick.comment ?? '');
					var saveInfo = saved[pick.id];
					var saveText =
						saveInfo === 'saving'
							? '保存中…'
							: saveInfo === 'saved'
								? '已保存'
								: saveInfo === 'error'
									? '保存失败'
									: '';
					return h(
						'div',
						{ className: 'vp-card', key: pick.id },
						h(
							'button',
							{
								className: 'vp-thumb' + (pick.shotUrl ? '' : ' none'),
								title: pick.shotUrl ? '点击放大截图' : '无截图',
								'aria-label': pick.shotUrl ? '放大截图' : '无截图',
								onClick: () =>
									pick.shotUrl
										? openShotViewer(pick.shotUrl, '标注 #' + (index + 1) + ' · ' + String(pick.tag || '元素'))
										: null,
							},
							pick.shotUrl ? h('img', { src: pick.shotUrl, alt: '元素截图 ' + pick.id }) : '无截图',
						),
						h(
							'div',
							{ className: 'vp-meta' },
							h(
								'div',
								{ className: 'vp-card-head' },
								h('span', { className: 'vp-idx' }, '#' + (index + 1)),
								h('span', { className: 'vp-tag' }, String(pick.tag || '元素')),
								h('span', { className: 'vp-host', title: pick.url }, hostOf(pick.url) || ''),
								h('span', { className: 'vp-spacer' }),
								h(
									'button',
									{
										className: 'vp-icon-btn',
										title: '在浏览器中定位',
										'aria-label': '在浏览器中定位',
										onClick: () => focusPick(pick.id),
									},
									h(IconTarget),
								),
								h(
									'button',
									{
										className: 'vp-icon-btn',
										title: '删除这条标注',
										'aria-label': '删除这条标注',
										onClick: () => removePick(pick.id),
									},
									h(IconX),
								),
							),
							h(
								'button',
								{
									className: 'vp-sel',
									title: '点击复制选择器\n' + (pick.selector || ''),
									onClick: () => {
										try {
											navigator.clipboard?.writeText(String(pick.selector || ''));
											flash('ok', '选择器已复制');
										} catch {
											flash('err', '复制失败');
										}
									},
								},
								String(pick.selector || '(无选择器)'),
							),
							pick.text ? h('div', { className: 'vp-text', title: pick.text }, pick.text) : null,
							h('textarea', {
								className: 'vp-comment',
								placeholder: '想怎么改？例如：字号调大到 16px、按钮改成主色',
								'aria-label': '标注评论',
								value: comment,
								onChange: (event) => editComment(pick.id, event.target.value),
								onBlur: (event) => persistComment(pick.id, event.target.value),
							}),
							h(
								'div',
								{ className: 'vp-actions' },
								h('span', { className: 'vp-saved', role: 'status' }, saveText),
								h(
									'button',
									{
										className: 'vp-btn sm pri',
										title: '插入这条标注，并从列表移除',
										onClick: () => insertOnce([pick], 'click'),
									},
									insertLabel,
								),
							),
						),
					);
				});
				return h('div', { className: 'vp-plain' }, cards);
			};

			// host 复用「已标注的那一条」时列表不会增长，这里单独收复用通知：让用户知道
			// 点的是旧标注、不是新标了一条。落点保持不动（粘性），接着标下一处即可。
			var reuseSeen = useRef(0);
			useEffect(
				function () {
					var notice = state.reuseNotice;
					if (!notice || notice.ts === reuseSeen.current) return;
					reuseSeen.current = notice.ts;
					flash(
						'ok',
						notice.role === 'reference'
							? '已复用那条已标注的元素：归入「参照」'
							: '已复用那条已标注的元素：归入「改动」',
					);
				},
				[state, arming],
			);

			/* ---- render --------------------------------------------------- */
			return h(
				'div',
				{ className: 'vp-root' },
				h(
					'div',
					{ className: 'vp-head' },
					h('span', { className: 'vp-title' }, '指哪改哪'),
					h(
						'span',
						{
							className: 'vp-pill',
							'data-state': pillState,
							role: 'status',
							title: [
								state.browser ? browserLabels[state.browser] || state.browser : '',
								state.activeTitle || state.activeUrl || '',
							]
								.filter(Boolean)
								.join(' · '),
						},
						h('i', { className: 'dot' }),
						h('span', null, pillText),
					),
					h('span', { className: 'vp-spacer' }),
					h(
						'span',
						{ className: 'vp-headmode' },
						// 开关旁带可见名称：光一个小滑块看不出它管什么。
						h('span', { className: 'vp-switch-label' + (picking ? ' on' : '') }, picking ? '标注中' : '标注'),
						h(
							'button',
							{
								className: 'vp-switch',
								role: 'switch',
								'aria-checked': picking,
								'aria-label': '标注模式',
								disabled: !ready || busy === 'mode',
								title: !ready
									? '先打开浏览器'
									: picking
										? '标注模式开启中：在页面里点击元素 · Esc 退出（' + HOTKEY + '）'
										: '开启标注模式（' + HOTKEY + '）',
								onClick: toggleMode,
							},
							h('span', { className: 'knob' }),
						),
					),
					h(
						'button',
						{
							className: 'vp-icon-btn' + (menu ? ' on' : ''),
							'aria-label': '更多操作',
							'aria-expanded': menu,
							title: '更多操作',
							onClick: () => setMenu(!menu),
						},
						h(IconMore),
					),
				),
				menu
					? h(
							'div',
							{ className: 'vp-menu', role: 'menu' },
							h(
								'button',
								{ role: 'menuitem', onClick: detachBrowser, disabled: !ready || busy === 'close' },
								h('span', null, state.reused ? '断开连接（外部浏览器保留）' : '断开连接（保留浏览器）'),
								h('span', { className: 'kbd' }, ready ? '' : '未连接'),
							),
							// 清空按角色分三种，只在参照模式出现；普通模式的菜单和 0.5.5 一致，只有断开连接。
							viewMode === 'pair'
								? [
										h(
											'button',
											{
												role: 'menuitem',
												className: 'danger',
												disabled: targets.length === 0,
												onClick: () => clearAll('target'),
											},
											h('span', null, '清空目标标注'),
											h('span', { className: 'kbd' }, String(targets.length)),
										),
										h(
											'button',
											{
												role: 'menuitem',
												className: 'danger',
												disabled: refs.length === 0,
												onClick: () => clearAll('reference'),
											},
											h('span', null, '清空参照标注'),
											h('span', { className: 'kbd' }, String(refs.length)),
										),
										h(
											'button',
											{
												role: 'menuitem',
												className: 'danger',
												disabled: picks.length === 0,
												onClick: () => clearAll('all'),
											},
											h('span', null, '清空全部标注'),
											h('span', { className: 'kbd' }, String(picks.length)),
										),
									]
								: null,
						)
					: null,
				state.error_message
					? h(
							'div',
							{ className: 'vp-banner error', role: 'alert' },
							h('span', null, state.error_message),
							h('button', { className: 'vp-btn sm', onClick: () => request('/state').then(apply) }, '重试'),
							h(
								'button',
								{
									className: 'vp-icon-btn',
									'aria-label': '关闭提示',
									onClick: () => setState((prev) => Object.assign({}, prev, { error_message: null })),
								},
								h(IconX),
							),
						)
					: null,
				hostStale
					? h(
							'div',
							{ className: 'vp-banner warn', role: 'status' },
							h(
								'span',
								null,
								'插件版本不一致：host ' +
									hostBuild +
									' / 面板 ' +
									PANEL_BUILD +
									'。定位与撤销暂不可用，重启 DSH Desktop 后重新打开面板即可。',
							),
						)
					: null,
				noBrowsers
					? h(
							'div',
							{ className: 'vp-banner warn' },
							h(
								'span',
								null,
								'未检测到 Chrome / Edge / ego lite。可设置 DSH_VISUAL_ANNOTATOR_CHROME、DSH_VISUAL_ANNOTATOR_EDGE、DSH_VISUAL_ANNOTATOR_EGO 指向可执行文件。',
							),
						)
					: null,
				h(
					'div',
					{ className: 'vp-connect' },
					// 注册表里只有一个浏览器时才不摆选择器：其余情况至少要让人看见「edge 支持但没装」。
					browserChoices.length > 1
						? h(
								'select',
								{
									className: 'vp-select',
									value: launchTarget,
									'aria-label': '要用哪个浏览器',
									title: ready ? '选择要用的浏览器；选好后点「切换」才会真的换窗口' : '选择要启动的浏览器',
									disabled: busy === 'launch',
									onChange: (event) => {
										// 只记住选择，绝不动浏览器：选一下就关掉当前窗口另起一个太突然了。
										// 换窗口只能由「切换」按钮显式触发。
										var next = event.target.value;
										setSavedBrowser(next);
										rememberBrowser(next);
									},
								},
								browserChoices.map((choice) =>
									h(
										'option',
										{ key: choice.id, value: choice.id, disabled: !choice.available },
										choice.label + (choice.available ? '' : '（未安装）'),
									),
								),
							)
						: null,
					h('input', {
						className: 'vp-input',
						ref: urlRef,
						placeholder: 'http://localhost:3000/…',
						'aria-label': '要调试的页面地址',
						value: url,
						onChange: (event) => setUrl(event.target.value),
						onKeyDown: (event) => {
							if (event.key === 'Enter' && !ready) launch(launchTarget);
						},
					}),
					ready && !switchTarget
						? h(
								'button',
								{
									className: 'vp-btn',
									disabled: busy === 'launch',
									title: '在浏览器中打开该地址（同窗口新标签；相同地址则切换过去）',
									onClick: () => launch(launchTarget),
								},
								busy === 'launch' ? '…' : '打开',
							)
						: ready
							? h(
									'button',
									{
										className: 'vp-btn pri',
										disabled: busy === 'launch',
										title:
											'关掉当前 ' +
											(browserLabels[connectedBrowser] || connectedBrowser) +
											' 窗口，改用 ' +
											targetLabel +
											' 打开该地址（标注记录保留）',
										onClick: () => launch(launchTarget),
									},
									busy === 'launch' ? '…' : '切换到' + targetLabel,
								)
							: h(
									'button',
									{
										className: 'vp-btn pri',
										disabled: busy === 'launch' || installedBrowsers.length === 0,
										title: '启动 ' + targetLabel + ' 打开该地址',
										onClick: () => launch(launchTarget),
									},
									busy === 'launch' ? '…' : '启动',
								),
				),
				// 调试空间：换 context 而不是换窗口，cookie 与标签页天然隔离。
				showSpaces
					? h(
							'div',
							{ className: 'vp-spaces' },
							h('span', { className: 'vp-label' }, '空间'),
							h(
								'select',
								{
									className: 'vp-select',
									value: activeSpace,
									'aria-label': '调试空间',
									title: '每个空间有独立的 cookie 与标签页，互不干扰',
									disabled: busy === 'space',
									onChange: (event) => switchSpace(event.target.value),
								},
								spaceList.map((space) => h('option', { key: space.id || 'default', value: space.id }, space.name)),
							),
							h(
								'button',
								{
									className: 'vp-btn sm',
									title: '新建一个调试空间（独立 cookie）',
									disabled: busy === 'space',
									onClick: createSpace,
								},
								'＋',
							),
							activeSpace
								? h(
										'button',
										{
											className: 'vp-btn sm danger',
											title: '关闭当前空间及其标签页',
											disabled: busy === 'space',
											onClick: closeSpace,
										},
										'×',
									)
								: null,
						)
					: null,
				modeTabs(),
				ready && tabs.length > 0
					? h(
							'div',
							{
								className: 'vp-tabs',
								title: isEgo
									? '这里只列 agent 空间的页面；点一下会把该标签页切到浏览器前台，之后的标注从这一页取'
									: '这个窗口里的全部标签页；点一下会切到浏览器前台，之后的标注从这一页取',
							},
							h(
								'div',
								{ className: 'vp-tabs-head' },
								h('span', { className: 'cap' }, '标签页 ' + tabs.length),
								isEgo ? h('span', { className: 'hint' }, '仅 agent 空间') : null,
								h('span', { className: 'vp-spacer' }),
								extraTabs.length
									? h(
											'button',
											{
												className: 'vp-btn sm' + (tabMenu ? ' on' : ''),
												'aria-expanded': tabMenu,
												title: '还有 ' + extraTabs.length + ' 个标签页，点开切换',
												onClick: function () {
													setTabMenu(!tabMenu);
												},
											},
											'更多 ' + extraTabs.length,
										)
									: null,
							),
							h(
								'div',
								{ className: 'vp-tablist', role: 'tablist', 'aria-label': '浏览器标签页' },
								visibleTabs.map((tab) => tabButton(tab, false)),
							),
							extraTabs.length && tabMenu
								? h(
										'div',
										{ className: 'vp-tabmore', role: 'menu', 'aria-label': '其余标签页' },
										extraTabs.map((tab) => tabButton(tab, true)),
									)
								: null,
						)
					: null,
				picking || arming
					? h(
							'div',
							{ className: 'vp-armbar', role: 'status' },
							h(
								'span',
								null,
								arming
									? arming.slot === 'reference'
										? '落点「参照」：在任意标签页点元素都进右栏，可连续标多处'
										: '落点「改动」：在任意标签页点元素都进左栏，可连续标多处'
									: '标注模式开启中：在页面里点击元素 · Esc 退出',
							),
							arming ? h('button', { type: 'button', onClick: cancelArm }, '取消') : null,
						)
					: null,
				h(
					'div',
					{ className: 'vp-body' },
					// 普通模式只列改动。有参照标注（HUD 的参照落点标出来的）时它是看不见的，
					// 更不会参与插入：不提示就等于这几处标注凭空消失。
					viewMode === 'pair' || !refs.length
						? null
						: h(
								'div',
								{ className: 'vp-refs-note', role: 'status' },
								h('span', null, '还有 ', h('b', null, String(refs.length)), ' 处参照不在普通模式里显示'),
								h('button', { type: 'button', onClick: () => setViewMode('pair') }, '切到参照模式'),
							),
					viewMode === 'pair' ? pairView() : plainList(),
				),
				h(
					'div',
					{ className: 'vp-foot' },
					h(
						'div',
						{ className: 'vp-cta-row' },
						h(
							'button',
							{
								className: 'vp-btn pri block',
								disabled: !canInsert,
								title:
									!canInsert && viewMode === 'pair'
										? '还没有参照标注：建立对照后方可插入'
										: viewMode === 'pair'
											? '将每组「改动 → 参照」一并插入输入框；参照只读，不会被修改'
											: '把这 ' + insertable.length + ' 条标注一起插入输入框，并从列表移除',
								onClick: () => insertOnce(ctaPicks, 'click'),
							},
							ctaLabel,
						),
						// 批量勾选按需出现：底部一个「批量操作」开关统管两栏（清空左边），勾选框平时不渲染。
						viewMode === 'pair'
							? h(
									'button',
									{
										type: 'button',
										className: 'vp-btn' + (selectMode ? ' on' : ''),
										title: selectMode
											? '退出批量勾选（已勾选的一并清掉）'
											: '批量勾选：显示出每条标注的勾选框，可多选后「清空所选」',
										disabled: !picks.length,
										onClick: toggleSelectMode,
									},
									'批量操作',
								)
							: null,
						h(
							'button',
							{
								className: 'vp-btn',
								disabled: picks.length === 0,
								title:
									viewMode === 'pair'
										? '清空标注：只清改动 / 只清参照 / 全部清空（可撤销）'
										: '一键清空全部标注（可撤销）',
								onClick: () => clearAll('all'),
							},
							'清空',
						),
						h(
							'button',
							{
								className: 'vp-btn',
								disabled: picks.length === 0,
								title: '复制 Markdown 到剪贴板',
								'aria-label': '复制 Markdown',
								onClick: copyMarkdown,
							},
							h(IconCopy),
						),
					),
					h(
						'p',
						{ className: 'vp-foot-hint' },
						picks.length === 0
							? '开启标注模式后，在浏览器里点击想改的元素'
							: viewMode === 'pair'
								? '左侧为改动、右侧为参照；插入后参照保留并标「已引用」，点卡片上的「再次引用」可重发'
								: '插入后自动清空；清空或误删都能一键撤销',
					),
				),
				toast
					? h(
							'div',
							{ className: 'vp-toast ' + toast.kind, role: toast.kind === 'err' ? 'alert' : 'status' },
							h('span', null, toast.text),
							toast.action ? h('button', { onClick: toast.action.onClick }, toast.action.label) : null,
							h('button', { 'aria-label': '关闭提示', onClick: () => setToast(null) }, '✕'),
						)
					: null,
			);
		}

		function mountNativeTab(ctx, sidebar, tabs) {
			var style = ensureStyle();
			var disposeType = tabs.register({
				id: TAB_ID,
				kind: TAB_KIND,
				keepMounted: true,
				priority: 'extension',
				title: () => '指哪改哪',
				guide: [{ id: 'visual-annotator', order: 88, title: () => '指哪改哪', icon: IconScope }],
			});
			var disposeBody = ctx.slots.register(
				{ name: 'sidebar.right.pane.tab', key: TAB_ID, inject: () => ({ ctx }) },
				PickerPanel,
			);
			var opened = false;
			var openTab = function () {
				if (opened) return;
				try {
					sidebar.openTab(TAB_KIND);
					opened = true;
				} catch {
					/* the pane may not be mounted yet; the user can open it from the tab list */
				}
			};
			try {
				if (sidebar.mounted && typeof sidebar.mounted.subscribe === 'function') {
					var off = sidebar.mounted.subscribe(function () {
						openTab();
					});
					openTab();
					return function () {
						off && off();
						disposeBody && disposeBody();
						disposeType && disposeType();
						style && style.remove();
					};
				}
			} catch {
				/* ignore */
			}
			openTab();
			return function () {
				disposeBody && disposeBody();
				disposeType && disposeType();
				style && style.remove();
			};
		}

		function apply(ctx) {
			// Register the chip source as soon as the plugin loads, not when the panel
			// happens to mount: a chip can be pasted into a draft while the panel is closed
			// and must still expand at submit time.
			ensureVpSource(ctx);
			var mountOnce = function (nativeCtx) {
				var sidebar, tabs;
				try {
					sidebar = nativeCtx.get ? nativeCtx.get('sidebarRight') : undefined;
					tabs = nativeCtx.get ? nativeCtx.get('sidebarRightTabs') : undefined;
				} catch {
					return;
				}
				if (!sidebar || !tabs || typeof tabs.register !== 'function') return;
				ctx.effect
					? ctx.effect(() => mountNativeTab(ctx, sidebar, tabs), 'dsh-annotator panel')
					: mountNativeTab(ctx, sidebar, tabs);
			};
			if (typeof ctx.inject === 'function') ctx.inject(['sidebarRight', 'sidebarRightTabs'], mountOnce);
			else mountOnce(ctx);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = 'dsh-annotator';
		return module.exports;
	},
});

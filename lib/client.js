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
		var PANEL_BUILD = 'v37';
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
				'--vp-surface:rgba(127,127,127,.06);--vp-surface-2:rgba(127,127,127,.12);' +
				'position:relative;display:flex;flex-direction:column;height:100%;min-height:0;' +
				'font:13px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit;container-type:inline-size}',
			'@media (prefers-color-scheme:dark){.vp-root{--vp-accent:#79b8ff;--vp-accent-fg:#0b1c33;' +
				'--vp-accent-weak:rgba(121,184,255,.16);--vp-danger:#ff7b72;--vp-ok:#3fb950;--vp-warn:#d29922}}',
			'html[data-theme="dark"] .vp-root,.dark .vp-root{--vp-accent:#79b8ff;--vp-accent-fg:#0b1c33;' +
				'--vp-accent-weak:rgba(121,184,255,.16);--vp-danger:#ff7b72;--vp-ok:#3fb950;--vp-warn:#d29922}',
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
			'.vp-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;' +
				'border:1px solid transparent;border-radius:6px;background:transparent;color:var(--vp-muted);cursor:pointer}',
			'.vp-icon-btn:hover{background:var(--vp-surface-2);color:inherit}',
			'.vp-icon-btn.on{background:var(--vp-surface-2);color:inherit}',

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
				'border-radius:999px;background:var(--vp-surface-2);flex:none}',
			'.vp-mode button{height:22px;padding:0 10px;border:0;border-radius:999px;background:transparent;' +
				'color:var(--vp-muted);font:11.5px/1 system-ui,sans-serif;cursor:pointer;white-space:nowrap}',
			'.vp-mode button.on{background:var(--vp-surface);color:inherit;box-shadow:0 1px 2px rgba(0,0,0,.14)}',
			'.vp-mode .n{font-size:10.5px;opacity:.7;margin-left:4px}',

			/* ---- 参考模式的两个页面槽：改这里 / 照这个 ------------------------- */
			'.vp-slots{display:flex;gap:8px;padding:0 12px 8px;flex:none;min-width:0}',
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
			'.vp-pairs{display:flex;flex-direction:column;gap:8px}',
			/* 两栏表头：左「改」右「照」，页面身份写在表头里，不再单开一排选页控件。 */
			'.vp-colhead{display:flex;align-items:stretch;gap:0;padding-bottom:2px;border-bottom:1px solid var(--vp-border)}',
			'.vp-colhead .col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:2px}',
			'.vp-chead{display:flex;align-items:center;gap:4px;min-width:0}',
			'.vp-chead .k{flex:none;font:600 10.5px/1 system-ui,sans-serif;padding:2px 5px;border-radius:4px;' +
				'background:var(--vp-surface-2);color:var(--vp-muted)}',
			'.vp-chead .k.ref{background:rgba(75,140,247,.16);color:#2f6fd0}',
			'html[data-theme="dark"] .vp-chead .k.ref,.dark .vp-chead .k.ref{color:#9cc2ff}',
			'.vp-chead button{flex:1 1 auto;min-width:0;display:inline-flex;align-items:center;gap:4px;height:22px;' +
				'padding:0 5px;border:1px solid transparent;border-radius:5px;background:transparent;color:inherit;' +
				'font:11.5px/1 system-ui,sans-serif;cursor:pointer;text-align:left}',
			'.vp-chead button:hover{background:var(--vp-surface-2)}',
			'.vp-chead button .t{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.vp-chead button .t.none{color:var(--vp-muted)}',
			'.vp-chead button .n{flex:none;font-size:10.5px;opacity:.7}',
			'.vp-pagemenu{margin:4px 0 0;padding:4px;border-radius:7px;border:1px solid var(--vp-border);' +
				'background:var(--dsw-specific-menu-bg,Canvas);box-shadow:0 8px 22px rgba(0,0,0,.18);' +
				'display:flex;flex-direction:column;gap:2px}',
			'.vp-pagemenu button{display:flex;align-items:center;gap:6px;padding:5px 7px;border:0;border-radius:5px;' +
				'background:transparent;color:inherit;font:12px/1.35 system-ui,sans-serif;text-align:left;cursor:pointer}',
			'.vp-pagemenu button:hover{background:var(--vp-surface-2)}',
			'.vp-pagemenu button.on{color:var(--vp-accent)}',
			'.vp-pagemenu button .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			/* 一组「一条改动 + 它参照的若干条参考」：中间这条线就是 1:N 的关系本身。 */
			'.vp-grpwrap{display:flex;flex-direction:column;gap:4px}',
			'.vp-grp{display:flex;align-items:stretch;gap:0}',
			'.vp-grp .l{flex:1 1 0;min-width:0;display:flex}',
			'.vp-grp .l>*{flex:1 1 auto;min-width:0}',
			'.vp-grp .r{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:4px}',
			'.vp-grp .r>*{min-width:0}',
			'.vp-grail{position:relative;flex:none;width:14px}',
			'.vp-grail::before{content:"";position:absolute;left:0;right:6px;top:26px;height:1px;background:rgba(75,140,247,.45)}',
			'.vp-grail::after{content:"";position:absolute;right:6px;top:26px;bottom:26px;width:1px;background:rgba(75,140,247,.45)}',
			'.vp-grail.one::after{top:26px;bottom:calc(100% - 27px)}',
			'.vp-grp.drop .l .vp-cell{border-color:var(--vp-accent);box-shadow:inset 0 0 0 1px var(--vp-accent-weak)}',
			'.vp-addref{display:flex;align-items:center;justify-content:center;min-height:30px;padding:4px 6px;' +
				'border-radius:8px;border:1px dashed rgba(75,140,247,.5);background:transparent;color:#2f6fd0;' +
				'font:11.5px/1.3 system-ui,sans-serif;cursor:pointer;text-align:center}',
			'html[data-theme="dark"] .vp-addref,.dark .vp-addref{color:#9cc2ff}',
			'.vp-addref:hover{background:rgba(75,140,247,.1)}',
			'.vp-addref.arm{border-style:solid;border-color:#4b8cf7;background:rgba(75,140,247,.14);font-weight:600}',
			'.vp-orphanrow{display:flex;align-items:flex-start;gap:6px}',
			'.vp-orphanrow .vp-cell{flex:1 1 auto;min-width:0}',
			'.vp-orphanrow .vp-dimchip{flex:none;height:auto;min-height:26px;max-width:92px;line-height:1.3;' +
				'white-space:normal;text-align:center}',
			'.vp-dimchip.arm{border-color:rgba(75,140,247,.6);background:rgba(75,140,247,.14);color:#2f6fd0}',
			'.vp-cell.drop{border-color:var(--vp-accent);box-shadow:inset 0 0 0 1px var(--vp-accent-weak)}',
			'.vp-cell[draggable="true"]{cursor:grab}',
			'.vp-cell-spec{font-size:10.5px;color:#2f6fd0;opacity:.9}',
			'html[data-theme="dark"] .vp-cell-spec,.dark .vp-cell-spec{color:#9cc2ff}',
			'.vp-reflist{display:flex;flex-wrap:wrap;align-items:center;gap:4px}',
			'.vp-reflist .cap{font-size:11px;color:var(--vp-muted)}',
			'.vp-refchip{display:inline-flex;align-items:center;gap:2px;height:22px;padding:0 2px 0 6px;border-radius:999px;' +
				'background:rgba(75,140,247,.14);color:#2f6fd0;font:600 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace}',
			'html[data-theme="dark"] .vp-refchip,.dark .vp-refchip{color:#9cc2ff}',
			'.vp-refchip button{width:16px;height:16px;border:0;border-radius:50%;background:transparent;color:inherit;' +
				'font-size:12px;line-height:1;cursor:pointer}',
			'.vp-refchip button:hover{background:rgba(75,140,247,.24)}',
			'.vp-cell{display:flex;flex-direction:column;gap:3px;min-width:0;padding:5px 6px;border-radius:8px;' +
				'border:1px solid var(--vp-border);background:var(--vp-surface);cursor:pointer;text-align:left;' +
				'color:inherit;font:inherit}',
			'.vp-cell:hover{background:var(--vp-surface-2)}',
			'.vp-cell.sel{border-color:color-mix(in srgb,var(--vp-accent) 55%,var(--vp-border));' +
				'box-shadow:inset 0 0 0 1px var(--vp-accent-weak)}',
			'.vp-cell.ref{border-color:rgba(75,140,247,.38);background:rgba(75,140,247,.06)}',
			'.vp-landing{display:flex;align-items:center;gap:6px;padding:7px 9px;border-radius:8px;' +
				'border:1px dashed color-mix(in srgb,var(--vp-accent) 55%,var(--vp-border));background:var(--vp-accent-weak);' +
				'font-size:12px;line-height:1.45;flex:none}',
			'.vp-landing.reference{border-color:rgba(75,140,247,.6);background:rgba(75,140,247,.1)}',
			'.vp-landing .v{font-weight:600}',
			'.vp-landing .hint{color:var(--vp-muted);font-size:11.5px;min-width:0;overflow:hidden;text-overflow:ellipsis}',
			'.vp-landing button{margin-left:auto;flex:none;height:22px;padding:0 8px;border-radius:999px;' +
				'border:1px solid var(--vp-border);background:transparent;color:inherit;font-size:11.5px;cursor:pointer}',
			'.vp-sec{display:flex;align-items:baseline;gap:6px;margin:9px 0 6px;font-size:11.5px;color:var(--vp-muted)}',
			'.vp-sub{border:0;background:none;padding:0;color:var(--vp-accent);font:11.5px/1.4 system-ui,sans-serif;' +
				'cursor:pointer;text-align:left}',
			'.vp-cell-shot{height:54px;border-radius:4px;overflow:hidden;background:var(--vp-surface-2);flex:none}',
			'.vp-cell-shot img{width:100%;height:100%;object-fit:cover;object-position:top left;display:block}',
			'.vp-cell-head{display:flex;align-items:center;gap:4px;min-width:0}',
			'.vp-cell-head .n{flex:none;font:600 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--vp-muted)}',
			'.vp-cell-head .r{flex:none;font:600 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:2px 4px;' +
				'border-radius:3px;background:rgba(75,140,247,.16);color:#2f6fd0}',
			'html[data-theme="dark"] .vp-cell-head .r,.dark .vp-cell-head .r{color:#9cc2ff}',
			'.vp-cell-sel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
				'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--vp-muted);min-width:0}',
			'.vp-cell-note{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;' +
				'font-size:12px;line-height:1.45;min-height:17px}',
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
			'.vp-pick{display:flex;align-items:center;gap:10px;margin:2px 12px 0;padding:10px 12px;border-radius:10px;' +
				'background:var(--vp-surface);border:1px solid var(--vp-border);flex:none}',
			'.vp-pick.on{background:var(--vp-accent-weak);border-color:color-mix(in srgb,var(--vp-accent) 40%,transparent)}',
			'.vp-pick .txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
			'.vp-pick .t{font-size:13px;font-weight:600}',
			'.vp-pick .s{font-size:12px;color:var(--vp-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.vp-switch{position:relative;width:38px;height:22px;flex:none;padding:0;border-radius:999px;cursor:pointer;' +
				'border:1px solid var(--vp-border);background:var(--vp-surface-2);transition:background .15s ease-out}',
			'.vp-switch[aria-checked="true"]{background:var(--vp-accent);border-color:var(--vp-accent)}',
			'.vp-switch:disabled{opacity:.45;cursor:default}',
			'.vp-switch .knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;' +
				'transition:transform .15s ease-out;box-shadow:0 1px 2px rgba(0,0,0,.3)}',
			'.vp-switch[aria-checked="true"] .knob{transform:translateX(16px)}',
			'.vp-hint{padding:8px 12px 0;font-size:12px;color:var(--vp-muted);flex:none}',

			/* ---- body -------------------------------------------------------- */
			'.vp-body{flex:1;min-height:0;overflow:auto;padding:10px 12px 12px;display:flex;flex-direction:column;gap:8px}',
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
			/* 提示条在流内：原来 absolute 压在标注卡上，挡住最后几组。 */
			'.vp-toast{display:flex;align-items:center;gap:8px;margin:8px 12px 0;padding:9px 10px;border-radius:8px;' +
				'font-size:12px;flex:none;box-shadow:0 4px 14px rgba(0,0,0,.14)}',
			'.vp-toast.ok{background:var(--vp-ok);color:#fff}',
			'.vp-toast.warn{background:var(--vp-warn);color:#fff}',
			'.vp-toast.err{background:var(--vp-danger);color:#fff}',
			'.vp-toast span{flex:1;min-width:0}',
			'.vp-toast button{flex:none;border:1px solid rgba(255,255,255,.5);border-radius:5px;background:transparent;' +
				'color:inherit;font-size:12px;padding:3px 7px;cursor:pointer}',
			'.vp-toast button:hover{background:rgba(255,255,255,.16)}',

			/* ---- container queries ------------------------------------------ */
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
		].join('\n');

		function ensureStyle() {
			if (document.getElementById('dsh-annotator-style')) return null;
			var style = document.createElement('style');
			style.id = 'dsh-annotator-style';
			style.textContent = CSS;
			document.head.appendChild(style);
			return style;
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
		 * 参考模式改的是首行与分组：首行明确「参考页只读」，参考标注单独一段并标出
		 * 维度。措辞必须和 agent 侧工具描述一致，否则模型仍可能去改参考页。
		 */
		/**
		 * The only insert shape: one marker line per pick, full details via the tool.
		 *
		 * 参考对照把「改」与「照」写成同一组的两行，横向对应关系在文本里也保留；
		 * 措辞必须和 agent 侧工具描述一致，否则模型仍可能去改参考页。
		 */
		/** 一条改动可以参照好几处：pairIds 是权威，老数据只有单个 pairId 也要认。 */
		function pairIdsOfPick(pick) {
			var ids = Array.isArray(pick.pairIds) ? pick.pairIds.slice() : [];
			var seen = ids.some((id) => String(id) === String(pick.pairId));
			if (pick.pairId != null && !seen) ids.unshift(pick.pairId);
			return ids;
		}

		function composeRefText(picks, imageCount, attached) {
			var refs = picks.filter((pick) => pick.role === 'reference');
			var targets = picks.filter((pick) => pick.role !== 'reference');
			var codes = {};
			var seen = {};
			refs.forEach((pick) => {
				var label = pick.refLabel || 'R';
				var key = label + '|' + (pick.pageKey || '');
				seen[key] = (seen[key] || 0) + 1;
				codes[String(pick.id)] = label + '-' + seen[key];
			});
			var byId = {};
			refs.forEach((pick) => {
				byId[String(pick.id)] = pick;
			});
			var lines = [];
			if (refs.length) {
				lines.push(
					'请按参考页的规范改下面这些地方。左边「改」是要改的目标，右边「照」是参考；参考页只读，禁止修改参考页及其代码：',
				);
				if (targets.length === 0) lines.push('（本次没有目标标注：请照参考规范新建页面。）');
			} else lines.push('请根据以下标注修改代码：');
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
			if (refs.length || targets.length > 1) {
				targets.forEach((target, index) => {
					var comment = String(target.comment ?? '').trim();
					lines.push('');
					lines.push('对照 ' + (index + 1));
					lines.push(
						'  改：' + marker(target) + (comment ? ' ' + comment : '（没写要改什么）') + ' ｜ ' + refLoc(target),
					);
					var linked = pairIdsOfPick(target)
						.map((id) => byId[String(id)])
						.filter(Boolean);
					if (linked.length === 1) lines.push('  照：' + refLine(linked[0]));
					else if (linked.length > 1) {
						lines.push('  照这几处（同一处改动，几处规范一起用）：');
						linked.forEach((ref) => lines.push(refLine(ref)));
					} else lines.push('  照：（没有选参考，可参照下面的参考页规范）');
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
							? '照这些参考新建：'
							: '另有参考（没有对应目标，照它新建）：',
					);
					loose.forEach((pick) => lines.push(refLine(pick)));
				}
			} else {
				var only = targets[0];
				var comment = String(only.comment ?? '').trim();
				lines.push(marker(only) + (comment ? ' ' + comment : '') + ' ｜ ' + refLoc(only));
			}
			lines.push('标注详情与截图由 visual_annotator_read 工具按 id 提供。');
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
			var urlRef = useRef(null);
			var toastTimer = useRef(null);
			var saveTimers = useRef({});
			// Host 推来的 pendingConsume token：只对没见过的 token 自动插入一次。
			var pendingSeen = useRef(0);
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
			var targetPage = pages.find((page) => page.role === 'target') || null;
			var refPages = pages.filter((page) => page.role === 'reference');

			/** 参考标注的显示编号 R1-1：同一参考页内按出现顺序。 */
			var refCodeOf = function (pick) {
				var key = pick.pageKey || '';
				var index = 0;
				for (var i = 0; i < refs.length; i++) {
					if ((refs[i].pageKey || '') !== key) continue;
					index += 1;
					if (String(refs[i].id) === String(pick.id)) break;
				}
				return (pick.refLabel || 'R') + '-' + index;
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
			// 否则文本里会留下「照：R1-1」却没有 R1-1 的定义。
			var linkedIds = {};
			targets.forEach((target) => {
				pairIdsOf(target).forEach((id) => {
					linkedIds[String(id)] = 1;
				});
			});
			var keepRefs = refs.filter((pick) => !pick.referencedAt || linkedIds[String(pick.id)]);
			var insertable = viewMode === 'pair' ? targets.concat(keepRefs) : targets;
			// 「插入对照」的前提是真的有对照：只标了「改」、一条「照」都还没有时按钮灰掉。
			// 早先它照样能点，用户以为插的是对照，实际只把目标标注塞进了输入框——那时该走普通标注。
			var canInsert = insertable.length > 0 && (viewMode !== 'pair' || refs.length > 0);
			var ctaPicks = canInsert ? insertable : [];

			/**
			 * 换页面角色：目标页只有 1 个、参考页可以有好几个（上限 5，由 host 拦）。
			 * 切换目标页时旧目标退回中性页；参考页多了不降级，右栏用「等 N 页」聚合。
			 */
			var changePageRole = async (page, role) => {
				setSlotMenu('');
				if (!page || page.role === role) return;
				var count = picks.filter((pick) => pick.pageKey === page.key).length;
				var rewrite = true;
				if (count > 0 && role !== 'neutral') {
					var question =
						'把「' +
						(page.title || hostOf(page.url) || '这一页') +
						'」改成' +
						(role === 'reference' ? '参考页' : '目标页') +
						'？\n\n已经标的 ' +
						count +
						' 条会一起改成' +
						(role === 'reference' ? '参考（只读，不会被改）' : '目标（要改这里）') +
						'。';
					try {
						rewrite = window.confirm(question);
					} catch {
						rewrite = true;
					}
				}
				try {
					// 参考页可以多个（A 的布局 + B 的配色），上限由 host 拦；目标页仍只有 1 个，host 会自动降级旧页。
					var data = await post('/page-role', { key: page.key, role: role, rewrite: rewrite });
					apply(data);
					// 服务端拒绝时也会回 200，不能只看 HTTP 状态就说切成功了。
					if (data && data.ok === false) {
						flash('err', String(data.message || data.error || '页面角色没有改成'));
					}
				} catch (error) {
					flash('err', String((error && error.message) || error));
				}
			};

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
			 * 参考对照会先写一行「改：」/「照：R1-1」，插入后的草稿仍保持左右对应。
			 */
			var insertViaChips = (ia, actx, list, header, prefixOf) => {
				header = header || '请根据以下标注修改代码：';
				if (!ia.insertText(header + '\n', ia.captureInsertion())) return false;
				for (var i = 0; i < list.length; i++) {
					var pick = list[i];
					var prefix = prefixOf ? prefixOf(pick) : '';
					if (prefix && !ia.insertText(prefix + '\n', ia.captureInsertion())) return false;
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
				if (!ia.insertText('标注详情与截图由 visual_annotator_read 工具按 id 提供。', ia.captureInsertion()))
					return false;
				// Verify on the live composer: header text must show, and every chip must exist in the DOM.
				var tb = document.querySelector('[role="textbox"]');
				if (!tb || !draftContains([header.replace(/[：:]\s*$/, '')])) return false;
				var chipCount = tb.querySelectorAll('[data-composer-chip="' + VP_SOURCE_NAME + '"]').length;
				return chipCount >= list.length;
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
				var text = composeRefText(withComment, attached.count, attached.ok);
				var paired = withComment.some((pick) => pick.role === 'reference');
				var header = paired
					? '请按参考页的规范改下面这些地方（参考页只读，禁止修改参考页及其代码）：'
					: '请根据以下标注修改代码：';
				var refIndex = 0;
				var codeById = {};
				withComment.forEach((pick) => {
					if (pick.role !== 'reference') return;
					refIndex += 1;
					codeById[String(pick.id)] = (pick.refLabel || 'R') + '-' + refIndex;
				});
				var prefixOf = paired
					? function (pick) {
							return pick.role === 'reference' ? '照：' + (codeById[String(pick.id)] || '参考') : '改：';
						}
					: null;
				var ia = resolveLiveActions(props.inputActions);
				var actx = ensureVpSource(props.ctx) ? resolveActx(props.ctx, sessionId) : null;
				var ok = false;
				if (actx && typeof actx.bail === 'function' && ia && typeof ia.captureInsertion === 'function') {
					try {
						ok = insertViaChips(ia, actx, withComment, header, prefixOf);
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
							flash('warn', '还没有「照」的标注：插入对照至少要标一处参考；只插目标请切回普通标注');
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
			 */
			var clearAll = async (scope) => {
				setMenu(false);
				scope = scope === 'target' || scope === 'reference' ? scope : 'all';
				var doomed = scope === 'target' ? targets : scope === 'reference' ? refs : picks;
				var count = doomed.length;
				if (!count) {
					flash('warn', '这一类里没有可清空的标注');
					return;
				}
				var result = null;
				try {
					result = await post('/clear', { scope: scope });
				} catch {
					result = null;
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
					flash('warn', '已清空 ' + count + ' 条标注（旧宿主，无法整批撤销）');
					return;
				}
				apply(result);
				setDrafts({});
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
			var SPEC_DIMS = ['布局', '间距', '配色', '字号', '圆角', '交互', '文案'];
			var pageCount = function (key) {
				return picks.filter((pick) => pick.pageKey === key).length;
			};

			/** 两个模式：普通标注（一条一处改）/ 参考对照（左「改」右「照」）。 */
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
							title: '普通标注：只列要改的地方，一条一处',
							onClick: () => {
								setArming(null);
								setAssigning('');
								setViewMode('plain');
							},
						},
						'普通',
						h('span', { className: 'n' }, targets.length),
					),
					h(
						'button',
						{
							role: 'tab',
							'aria-selected': viewMode === 'pair',
							className: viewMode === 'pair' ? 'on' : '',
							title: '参考对照：左「改」是要改的，右「照」是照着做的；一条改动可以照好几处',
							onClick: () => setViewMode('pair'),
						},
						'参考',
						h('span', { className: 'n' }, rows.length),
					),
				);
			};

			var titleOf = function (page) {
				return String(page.title || hostOf(page.url) || page.url || '未命名');
			};

			/** 选页菜单：嵌在栏里，不再单开一排「改这里 / 照这个」。 */
			/** 提示条走文档流，贴在底部按钮上方；原来的绝对定位会盖住最后几组标注。 */
			var toastBar = function () {
				if (!toast) return null;
				return h(
					'div',
					{ className: 'vp-toast ' + toast.kind, role: toast.kind === 'err' ? 'alert' : 'status' },
					h('span', null, toast.text),
					toast.action ? h('button', { onClick: toast.action.onClick }, toast.action.label) : null,
					h('button', { 'aria-label': '关闭提示', onClick: () => setToast(null) }, '✕'),
				);
			};

			var pageMenu = function (role) {
				return h(
					'div',
					{ className: 'vp-pagemenu', role: 'menu', 'aria-label': role === 'reference' ? '选择参考页' : '选择目标页' },
					pages.map((page) => {
						// 参考页可以多个，所以这里是多选：点已选中的再点一次就退回普通页。
						var checked = role === 'reference' ? page.role === 'reference' : page.role === role;
						var toggle = role === 'reference' && page.role === 'reference';
						return h(
							'button',
							{
								key: page.key,
								role: role === 'reference' ? 'menuitemcheckbox' : 'menuitemradio',
								'aria-checked': checked,
								className: checked ? 'on' : '',
								title: toggle ? '再点一次改回普通页（不参与对照）' : '',
								onClick: () => changePageRole(page, toggle ? 'neutral' : role),
							},
							h('span', { className: 't' }, titleOf(page)),
							h(
								'span',
								{ style: { fontSize: '10.5px', opacity: 0.6, flex: 'none' } },
								checked ? '当前' : pageCount(page.key) ? String(pageCount(page.key)) : '',
							),
						);
					}),
					role === 'target'
						? h(
								'button',
								{
									key: '__none',
									role: 'menuitemradio',
									'aria-checked': !targetPage,
									className: targetPage ? '' : 'on',
									onClick: () => {
										setSlotMenu('');
										if (targetPage) changePageRole(targetPage, 'neutral');
									},
								},
								h('span', { className: 't' }, '（不设目标页，按参考新建）'),
							)
						: null,
				);
			};

			/**
			 * 两栏表头自带页面身份：左「改」是哪一页，右「照」是哪几页。
			 * 顶上原来还有一排「改这里 / 照这个」，和下面的左右分栏说的是同一件事，已删。
			 */
			var colHeads = function () {
				var tOpen = slotMenu === 'target';
				var rOpen = slotMenu === 'reference';
				var refName = refPages.length
					? titleOf(refPages[0]) + (refPages.length > 1 ? ' 等 ' + refPages.length + ' 页' : '')
					: '选要照着做的页面';
				return h(
					'div',
					{ className: 'vp-colhead' },
					h(
						'div',
						{ className: 'col' },
						h(
							'div',
							{ className: 'vp-chead' },
							h('span', { className: 'k' }, '改'),
							h(
								'button',
								{
									type: 'button',
									'aria-expanded': tOpen,
									title: targetPage ? titleOf(targetPage) + '\n点一下换一页' : '点一下选要改的页面',
									onClick: () => setSlotMenu(tOpen ? '' : 'target'),
								},
								h(
									'span',
									{ className: 't' + (targetPage ? '' : ' none') },
									targetPage ? titleOf(targetPage) : '选要改的页面',
								),
								h('span', { className: 'n' }, targetPage ? '换' : '＋'),
							),
						),
						tOpen ? pageMenu('target') : null,
					),
					h('div', { className: 'vp-grail', 'aria-hidden': 'true' }),
					h(
						'div',
						// 拖「改」到「照」= 这条改成参考：换个身份比翻菜单快。
						{
							className: 'col',
							title: '把左边任意一条改动拖到这里，就把它改成参考',
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
									flash('info', '这条本来就是参考');
									return;
								}
								setPickRole(pick.id, 'reference');
								flash('ok', '这条已改成参考');
							},
						},
						h(
							'div',
							{ className: 'vp-chead' },
							h('span', { className: 'k ref' }, '照'),
							h(
								'button',
								{
									type: 'button',
									'aria-expanded': rOpen,
									title: refPages.length
										? refPages.map(titleOf).join('\n') + '\n参考页只读，不会被改'
										: '点一下选参考页（可多选）',
									onClick: () => setSlotMenu(rOpen ? '' : 'reference'),
								},
								h('span', { className: 't' + (refPages.length ? '' : ' none') }, refName),
								h('span', { className: 'n' }, refPages.length ? '换' : '＋'),
							),
						),
						rOpen ? pageMenu('reference') : null,
					),
				);
			};

			/**
			 * 待落位：先把「下一处落到哪」说清楚，再去标。
			 * 这里不再依赖「已经选好参考页」——以前没有参考页就直接劝回去，用户点完照标还是落进「改」。
			 * 落点由 user 先点定，真正落错时 pairWatch 会当场把那一处纠正到这一栏。
			 */
			var armFor = function (slot, pairId) {
				setArming({ slot: slot, pairId: pairId ? String(pairId) : '' });
				setAssigning('');
				// 开标注模式这一步代劳掉：点完就能直接在页面上点元素。
				if (!picking) toggleMode();
				flash(
					'info',
					slot === 'reference'
						? '去参考页点一处要照着做的元素；落错会当场归到「照」'
						: '去目标页点一处要改的元素；落错会当场归到「改」',
				);
			};

			var cancelArm = function () {
				setArming(null);
			};

			var pairCell = function (pick, role, opts) {
				var extra = opts || {};
				var code = role === 'reference' ? refCodeOf(pick) : '#' + (targets.indexOf(pick) + 1);
				var comment = drafts[pick.id] !== undefined ? drafts[pick.id] : (pick.comment ?? '');
				var text = String(comment || '').trim();
				var open = expandedId === String(pick.id);
				var toggle = function () {
					setExpandedId(open ? '' : String(pick.id));
				};
				var droppable = typeof extra.onDrop === 'function';
				var assignHere = !!assigning && role === 'target';
				return h(
					'div',
					{
						className:
							'vp-cell' + (role === 'reference' ? ' ref' : '') + (open ? ' sel' : '') + (assignHere ? ' drop' : ''),
						role: 'button',
						tabIndex: 0,
						'aria-expanded': open,
						draggable: true,
						title:
							(role === 'reference'
								? '点一下改说明 · 双击定位 · 拖到左边某条改动就配上'
								: '点一下改说明 · 双击定位 · 拖到右边某条参考就配上') + (assignHere ? ' · 点一下就配上这条参考' : ''),
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
					pick.shotUrl
						? h('div', { className: 'vp-cell-shot' }, h('img', { src: pick.shotUrl, alt: '元素截图 ' + pick.id }))
						: null,
					h(
						'div',
						{ className: 'vp-cell-head' },
						h('span', { className: role === 'reference' ? 'r' : 'n' }, code),
						h('span', { className: 'vp-cell-sel' }, String(pick.selector || pick.tag || '元素')),
						extra.orphan ? h('span', { className: 'vp-closed' }, '未配对') : null,
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
						text || (role === 'reference' ? '要参考这里的什么？' : '想怎么改？'),
					),
					role === 'reference' && (pick.spec || []).length
						? h('div', { className: 'vp-cell-spec' }, pick.spec.join(' · '))
						: null,
				);
			};

			/** 行内编辑器：全宽展开，评论 + 参考维度 + 这组已配的参考 + 定位/插入/删除。 */
			var rowEditor = function (row) {
				var pick = row.target || row.ref;
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
							pick.role === 'reference' ? '参考 ' + refCodeOf(pick) : '目标 #' + (targets.indexOf(pick) + 1),
						),
						h('span', { className: 'sel' }, String(pick.selector || pick.tag || '')),
						pick.pageClosed ? h('span', { className: 'vp-closed' }, '页面已关闭') : null,
						h('span', { className: 'vp-spacer' }),
						h('span', { className: 'vp-saved', role: 'status' }, saveText),
					),
					h('textarea', {
						placeholder:
							pick.role === 'reference'
								? '要参考这里的什么？例如：间距 16px、卡片圆角、按钮配色'
								: '想怎么改？例如：字号调到 16px、按钮换成主色',
						'aria-label': pick.role === 'reference' ? '参考说明' : '要改什么',
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
							)
						: row.target
							? h(
									'div',
									{ className: 'vp-reflist' },
									h('span', { className: 'cap' }, '照：'),
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
													'aria-label': '把 ' + refCodeOf(ref) + ' 移出这一组',
													onClick: () => unpairOne(row.target.id, ref.id),
												},
												'×',
											),
										),
									),
									h(
										'button',
										{ className: 'vp-dimchip', type: 'button', onClick: () => armFor('reference', row.target.id) },
										'＋ 照一处',
									),
								)
							: null,
					h(
						'div',
						{ className: 'actions' },
						h('button', { className: 'vp-btn sm', title: '在浏览器中定位', onClick: () => focusPick(pick.id) }, '定位'),
						row.target
							? h(
									'button',
									{
										className: 'vp-btn sm pri',
										title: '插入这一组（改 + 它照的全部参考）',
										onClick: () => insertOnce([row.target].concat(row.refs || (row.ref ? [row.ref] : [])), 'click'),
									},
									'插入这组',
								)
							: null,
						rest
							? h(
									'button',
									{
										className: 'vp-btn sm',
										title: '把这条参考套用到其余 ' + rest + ' 条还没配对的目标',
										onClick: () => setPairAll(row.ref.id),
									},
									'套用其余 ' + rest + ' 条',
								)
							: null,
						row.groupTargetId && row.ref
							? h(
									'button',
									{
										className: 'vp-btn sm',
										title: '只把这条参考从这一组里摘出来，标注本身保留',
										onClick: () => unpairOne(row.groupTargetId, row.ref.id),
									},
									'移出这组',
								)
							: null,
						h('span', { className: 'vp-spacer' }),
						h(
							'button',
							{ className: 'vp-btn sm danger', title: '删除这条标注', onClick: () => removePick(pick.id) },
							'删除',
						),
					),
				);
			};

			/**
			 * 参考对照主体：一条改动一行，右边挂着它参照的若干条参考（1:N）。
			 * 中间那条线就是「照」的关系本身；拖拽也沿着这条线做——参考卡拖到某条改动上 = 配上，
			 * 改动卡拖到「照」栏表头 = 这条改成参考，参考卡上的 × = 只解开这一条。
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
						flash('info', '这条参考已经在这一组里了');
						return;
					}
					setPair(targetId, id);
					flash('ok', '已配上一条参考');
				};
				var onDropTarget = function (refId, event) {
					event.preventDefault();
					event.stopPropagation();
					var id = draggedId(event);
					if (!id || !isTargetId(id)) return;
					setPair(id, refId);
					flash('ok', '已配上一条改动');
				};
				var pairGroup = function (row) {
					var target = row.target;
					var openTarget = expandedId === String(target.id);
					var armedHere = arming && arming.slot === 'reference' && String(arming.pairId) === String(target.id);
					var assignHere = !!assigning;
					return h(
						'div',
						{ className: 'vp-grpwrap', key: String(target.id) },
						h(
							'div',
							{
								className: 'vp-grp' + (assignHere ? ' drop' : ''),
								onDragOver: (event) => {
									if (draggedId(event)) event.preventDefault();
								},
								onDrop: (event) => onDropRef(target.id, event),
							},
							h('div', { className: 'l' }, pairCell(target, 'target')),
							h('div', { className: 'vp-grail' + (row.refs.length > 1 ? '' : ' one'), 'aria-hidden': 'true' }),
							h(
								'div',
								{ className: 'r' },
								row.refs.map((ref) =>
									pairCell(ref, 'reference', {
										groupTargetId: target.id,
										onDrop: (event) => onDropTarget(ref.id, event),
									}),
								),
								h(
									'button',
									{
										className: 'vp-addref' + (armedHere ? ' arm' : ''),
										type: 'button',
										title: '点一下，下一处参考标注就配给这条改动（自动开标注模式）',
										onClick: () => armFor('reference', target.id),
									},
									armedHere ? '正在等你标…' : row.refs.length ? '＋ 再照一处' : '＋ 照这里',
								),
							),
						),
						openTarget ? rowEditor({ target: target, refs: row.refs, ref: row.refs[0] || null }) : null,
						row.refs.map((ref) =>
							expandedId === String(ref.id)
								? rowEditor({ target: null, ref: ref, refs: [], groupTargetId: target.id })
								: null,
						),
					);
				};
				var orphanRow = function (row) {
					var ref = row.ref;
					var open = expandedId === String(ref.id);
					var on = String(assigning) === String(ref.id);
					return h(
						'div',
						{ className: 'vp-grpwrap', key: 'orphan-' + ref.id },
						h(
							'div',
							{
								className: 'vp-orphanrow',
								onDragOver: (event) => {
									if (draggedId(event)) event.preventDefault();
								},
								onDrop: (event) => onDropTarget(ref.id, event),
							},
							pairCell(ref, 'reference', { orphan: true }),
							h(
								'button',
								{
									className: 'vp-dimchip' + (on ? ' arm' : ''),
									type: 'button',
									title: '先点这里，再点左边任意一条改动',
									onClick: () => {
										setAssigning(on ? '' : String(ref.id));
										flash('info', on ? '已取消' : '现在点左边任意一条改动，就把这条参考配给它');
									},
								},
								on ? '点左边一条改动…' : '配给某条改动',
							),
						),
						open ? rowEditor({ target: null, ref: ref, refs: [] }) : null,
					);
				};
				var pairedRows = rows.filter((row) => !!row.target);
				var orphanRows = rows.filter((row) => !row.target);
				if (!rows.length) {
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
								h('span', null, '开标注模式，在目标页点一处要改的'),
							),
							h(
								'div',
								{ className: 'vp-step', style: { cursor: 'default' } },
								h('span', { className: 'n' }, '2'),
								h(
									'span',
									null,
									'再点「＋ 照这里」，到参考页标一处照着做的',
									h('br'),
									h('small', { style: { opacity: 0.75 } }, '一条改动可以照好几处；参考页只读'),
								),
							),
						),
					);
				}
				return h(
					'div',
					{ className: 'vp-pairs' },
					arming
						? h(
								'div',
								{ className: 'vp-landing' + (arming.slot === 'reference' ? ' reference' : ''), role: 'status' },
								h('span', { className: 'v' }, arming.slot === 'reference' ? '下一处落进「照」' : '下一处落进「改」'),
								h(
									'span',
									{ className: 'hint' },
									arming.slot === 'reference' ? '在哪个页面点都算参考' : '点到参考页上也会纠正回来',
								),
								h('button', { type: 'button', onClick: cancelArm }, '取消'),
							)
						: null,
					colHeads(),
					pairedRows.map(pairGroup),
					orphanRows.length
						? h(
								'div',
								{ className: 'vp-sec' },
								h('span', null, '还没配给哪条改动的参考 ' + orphanRows.length),
								h('span', null, '· 拖到左边，或点「配给某条改动」'),
							)
						: null,
					orphanRows.map(orphanRow),
				);
			};

			/** 普通模式：只列要改的标注，一条一处，写清怎么改就行。 */
			var plainList = function () {
				if (!targets.length) {
					if (refs.length) {
						return h(
							'div',
							{ className: 'vp-empty' },
							h(
								'button',
								{ className: 'vp-step', onClick: () => setViewMode('pair') },
								h('span', { className: 'n' }, '↔'),
								h(
									'span',
									null,
									'已有 ' + refs.length + ' 条参考标注',
									h('br'),
									h('small', { style: { opacity: 0.75 } }, '切到「参考对照」看左右对应'),
								),
							),
						);
					}
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
								title: pick.shotUrl ? '在浏览器中定位这个元素' : '无截图',
								'aria-label': '在浏览器中定位这个元素',
								onClick: () => (pick.shotUrl ? focusPick(pick.id) : null),
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
				// 普通模式也要能看见参考：参考并非只有「切到对照」时存在。
				var paired = targets.filter(function (item) {
					return pairCount(item) > 0;
				}).length;
				var note = refs.length
					? h(
							'button',
							{
								className: 'vp-refnote',
								title: '切到「参考对照」看左右对应',
								onClick: () => setViewMode('pair'),
							},
							h('span', { className: 'r' }, '照'),
							h('span', null, String(refs.length) + ' 条参考标注'),
							paired ? h('span', { className: 'n' }, String(paired) + ' 条已配对') : null,
							h('span', { className: 'go' }, '看对应 →'),
						)
					: null;
				return h('div', { className: 'vp-plain' }, note, cards);
			};

			// 待落位之后新标的那一处，落到用户先点的那一栏：角色不对就当场纠正，而不是只提示一句。
			var pairWatch = useRef(0);
			useEffect(
				function () {
					var count = picks.length;
					var grew = count > pairWatch.current;
					pairWatch.current = count;
					if (!arming || !grew) return;
					var last = picks[count - 1];
					if (!last) return;
					var want = arming.slot;
					var pair = arming.pairId;
					var got = last.role === 'reference' ? 'reference' : 'target';
					setArming(null);
					// 页面的角色决定标注落在哪一栏；只标这一条时用单条覆盖纠正，不动整页。
					(async function () {
						if (got !== want) {
							await setPickRole(last.id, want);
							flash('ok', want === 'reference' ? '这一处已归到「照」' : '这一处已归到「改」');
						}
						if (!pair) return;
						// 参考是新标的，host 可能已经把它兜底配给了别人；挪过来，别同时挂在两处。
						if (want === 'reference') await setPair(pair, last.id, { move: true });
						else await setPair(last.id, pair);
					})();
				},
				[picks, arming],
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
							// 清空按角色分三种：参考页标注往往要留到下一轮，和目标任务不该一起被清掉。
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
								h('span', null, '清空参考标注'),
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
				h(
					'div',
					{ className: 'vp-pick' + (picking ? ' on' : '') },
					h(
						'div',
						{ className: 'txt' },
						h('span', { className: 't' }, '标注模式'),
						h(
							'span',
							{ className: 's' },
							!ready
								? '先打开浏览器'
								: picking
									? '在页面里点击元素 · Esc 退出'
									: picks.length > 0
										? '已标注 ' + picks.length + ' 处 · ' + HOTKEY + ' 开启'
										: '在页面里点击元素，写一句想怎么改',
						),
					),
					h(
						'button',
						{
							className: 'vp-switch',
							role: 'switch',
							'aria-checked': picking,
							'aria-label': '标注模式',
							disabled: !ready || busy === 'mode',
							onClick: toggleMode,
						},
						h('span', { className: 'knob' }),
					),
				),
				h('div', { className: 'vp-body' }, viewMode === 'pair' ? pairView() : plainList()),
				toastBar(),
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
										? '还没有「照」的标注：先标一处参考，插入对照才有对照可插'
										: viewMode === 'pair'
											? '把每行「改 → 照」一起插入输入框；参考页只读，不会被改'
											: '把这 ' + insertable.length + ' 条标注一起插入输入框',
								onClick: () => insertOnce(ctaPicks, 'click'),
							},
							ctaLabel,
						),
						h(
							'button',
							{
								className: 'vp-btn',
								disabled: picks.length === 0,
								title: '清空标注：只清目标页 / 只清参考页 / 全部清空（可撤销）',
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
							? '开启标注模式后，在浏览器里点击想标注的元素'
							: viewMode === 'pair'
								? '一行一组：左「改」是要改的地方，右「照」是参考；插入后参考保留并标「已引用」'
								: '插入后自动清空；清空或误删都能一键撤销',
					),
				),
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

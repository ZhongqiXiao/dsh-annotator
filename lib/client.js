/**
 * dsh-visual-annotator — Web (client) half.
 *
 * One native right-sidebar tab: a control deck for the visible Chrome/Edge
 * window the host half drives.
 *
 * Layout (v10): status header -> connect strip -> annotation switch -> cards ->
 * single primary action. Everything global and destructive lives behind the
 * overflow menu; the panel is a container query so it survives a narrow rail.
 */

window.__ModuleLoader__.load({
	id: 'dsh-visual-annotator',
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
		var TAB_ID = 'dsh-visual-annotator';
		var TAB_KIND = 'visual-annotator';
		var API = '/api/visual-annotator';
		/** Bumped together with HOST_REV (lib/index.js); a mismatch means panel and host came from different builds. */
		var PANEL_BUILD = 'v17';
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
			'.vp-tabs{display:flex;align-items:center;gap:6px;padding:0 12px 8px;flex:none;min-width:0}',
			'.vp-tabs .cap{font-size:12px;color:var(--vp-muted);flex:none}',
			'.vp-tablist{display:flex;gap:4px;overflow-x:auto;min-width:0;scrollbar-width:thin}',
			'.vp-tab{display:inline-flex;align-items:center;gap:5px;max-width:150px;padding:0 8px;height:26px;flex:none;' +
				'border:1px solid var(--vp-border);border-radius:999px;background:transparent;color:inherit;font-size:12px;cursor:pointer}',
			'.vp-tab:hover{background:var(--vp-surface-2)}',
			'.vp-tab.on{background:var(--vp-accent-weak);border-color:transparent;color:var(--vp-accent);font-weight:600}',
			'.vp-tab b{font-size:11px;opacity:.7;font-weight:600}',
			'.vp-tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

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
			if (document.getElementById('dsh-visual-annotator-style')) return null;
			var style = document.createElement('style');
			style.id = 'dsh-visual-annotator-style';
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

		/** The only insert shape: one marker line per pick with compact location; full details via the tool. */
		function composeRefText(picks, imageCount, attached) {
			var lines = ['请根据以下标注修改代码：'];
			if (imageCount > 0 && attached) lines.push('（' + imageCount + ' 张元素截图已作为附件插入）');
			picks.forEach((pick) => {
				var comment = String(pick.comment ?? '').trim();
				var loc = refLoc(pick);
				lines.push('[标注 #' + pick.id + ']' + (comment ? ' ' + comment : '') + (loc ? ' ｜ ' + loc : ''));
			});
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
				markdown: '',
				error: null,
				error_message: null,
				hostRev: '',
			});
			var [url, setUrl] = useState('');
			var [busy, setBusy] = useState('');
			var [drafts, setDrafts] = useState({});
			var [saved, setSaved] = useState({});
			var [toast, setToast] = useState(null);
			var [menu, setMenu] = useState(false);
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
						markdown: data.markdown ?? prev.markdown,
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

			/** Chip insert: one real composer chip per pick; expands to full location text at submit. */
			var insertViaChips = (ia, actx, list) => {
				if (!ia.insertText('请根据以下标注修改代码：\n', ia.captureInsertion())) return false;
				for (var i = 0; i < list.length; i++) {
					var pick = list[i];
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
				if (!tb || !draftContains(['请根据以下标注修改代码'])) return false;
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
				var ia = resolveLiveActions(props.inputActions);
				var actx = ensureVpSource(props.ctx) ? resolveActx(props.ctx, sessionId) : null;
				var ok = false;
				if (actx && typeof actx.bail === 'function' && ia && typeof ia.captureInsertion === 'function') {
					try {
						ok = insertViaChips(ia, actx, withComment);
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
						'已插入 ' + label + '标注' + note,
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
					if (!picks.length) {
						// token 到达前列表已被用户清空：没有可插入内容，消费掉以免悬空重放。
						pendingSeen.current = token;
						return;
					}
					var previous = pendingSeen.current;
					pendingSeen.current = token;
					Promise.resolve(insertPicks(picks)).then(
						(ok) => {
							if (!ok) pendingSeen.current = previous;
						},
						() => {
							pendingSeen.current = previous;
						},
					);
				},
				[state.pendingConsume, picks],
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
					if (data.ok) flash('ok', '浏览器已就绪');
					else if (data.error) flash('err', String(data.error));
				} finally {
					setBusy('');
				}
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

			var closeBrowser = async () => {
				setMenu(false);
				setBusy('close');
				try {
					apply(await post('/close', {}));
					flash('ok', '浏览器已关闭');
				} finally {
					setBusy('');
				}
			};

			/**
			 * One click empties the list. A fresh host returns the whole batch as one
			 * undo slot; an old host (pre-v14) still clears, but the batch undo does
			 * not exist there, so it walks /remove and the toast stops offering 撤销.
			 */
			var clearAll = async () => {
				setMenu(false);
				var count = picks.length;
				if (!count) return;
				var result = null;
				try {
					result = await post('/clear', {});
				} catch {
					result = null;
				}
				if (!result || result.ok === false) {
					for (var pick of picks) {
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
			var noBrowsers = !state.browsers || (!state.browsers.chrome && !state.browsers.edge);
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
					? '已连接 · ' + (hostOf(state.activeUrl) || '浏览器')
					: state.status === 'starting'
						? '正在启动…'
						: state.status === 'error'
							? '连接失败'
							: '未连接';
			var insertLabel = '插入';
			var ctaLabel = '全部插入（' + picks.length + ' 条）';
			var tabs = state.tabs ?? [];

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
							if (picks.length === 0) return;
							event.preventDefault();
							insertPicks(picks);
							return;
						}
						if (event.key === 'Escape') {
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
				[state.mode, picks, menu],
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
							title: state.activeTitle || state.activeUrl || '',
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
							onClick: () => {
								setMenu(!menu);
								setConfirmClear(false);
							},
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
								{ role: 'menuitem', onClick: closeBrowser, disabled: !ready || busy === 'close' },
								h('span', null, '关闭浏览器'),
								h('span', { className: 'kbd' }, ready ? '' : '未连接'),
							),
							h(
								'button',
								{
									role: 'menuitem',
									className: 'danger',
									disabled: picks.length === 0,
									onClick: clearAll,
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
							h('span', null, '未检测到 Chrome / Edge。可设置环境变量 DSH_VISUAL_ANNOTATOR_CHROME 指向可执行文件。'),
						)
					: null,
				h(
					'div',
					{ className: 'vp-connect' },
					h('input', {
						className: 'vp-input',
						ref: urlRef,
						placeholder: 'http://localhost:3000/…',
						'aria-label': '要调试的页面地址',
						value: url,
						onChange: (event) => setUrl(event.target.value),
						onKeyDown: (event) => {
							if (event.key === 'Enter' && !ready)
								launch(state.browsers?.edge && !state.browsers?.chrome ? 'edge' : 'chrome');
						},
					}),
					ready
						? h(
								'button',
								{
									className: 'vp-btn',
									disabled: busy === 'launch',
									title: '在浏览器中打开该地址（同窗口新标签；相同地址则切换过去）',
									onClick: () => launch(state.browsers?.edge && !state.browsers?.chrome ? 'edge' : 'chrome'),
								},
								busy === 'launch' ? '…' : '打开',
							)
						: h(
								'button',
								{
									className: 'vp-btn pri',
									disabled: busy === 'launch' || !state.browsers?.chrome,
									title: '启动 Chrome 打开该地址',
									onClick: () => launch('chrome'),
								},
								busy === 'launch' ? '…' : '启动',
							),
				),
				ready && tabs.length > 0
					? h(
							'div',
							{ className: 'vp-tabs' },
							h('span', { className: 'cap' }, '标签页'),
							h(
								'div',
								{ className: 'vp-tablist', role: 'tablist', 'aria-label': '浏览器标签页' },
								tabs.map((tab) =>
									h(
										'button',
										{
											key: tab.targetId,
											role: 'tab',
											'aria-selected': !!tab.active,
											className: 'vp-tab' + (tab.active ? ' on' : ''),
											title: tab.url || tab.targetId,
											disabled: busy === 'tab',
											onClick: () => switchTab(tab.targetId),
										},
										h('b', null, tab.active ? '●' : '○'),
										h('span', null, String(tab.title || tab.url || tab.targetId).slice(0, 24)),
									),
								),
							),
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
				h(
					'div',
					{ className: 'vp-body' },
					picks.length === 0
						? h(
								'div',
								{ className: 'vp-empty' },
								h(
									'button',
									{ className: 'vp-step', onClick: () => urlRef.current && urlRef.current.focus() },
									h('span', { className: 'n' }, '1'),
									h(
										'span',
										null,
										'打开要修改的页面',
										h('br'),
										h('small', { style: { opacity: 0.75 } }, '填地址 → 启动'),
									),
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
							)
						: picks.map((pick, index) => {
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
													onClick: () => insertPicks([pick]),
												},
												insertLabel,
											),
										),
									),
								);
							}),
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
								disabled: picks.length === 0,
								title: '把这 ' + picks.length + ' 条标注一起插入输入框，并从列表移除',
								onClick: () => insertPicks(picks),
							},
							ctaLabel,
						),
						h(
							'button',
							{
								className: 'vp-btn',
								disabled: picks.length === 0,
								title: '一键清空全部标注（可撤销）',
								onClick: clearAll,
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
						picks.length === 0 ? '开启标注模式后，在浏览器里点击想改的元素' : '插入后自动清空；清空或误删都能一键撤销',
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
					? ctx.effect(() => mountNativeTab(ctx, sidebar, tabs), 'dsh-visual-annotator panel')
					: mountNativeTab(ctx, sidebar, tabs);
			};
			if (typeof ctx.inject === 'function') ctx.inject(['sidebarRight', 'sidebarRightTabs'], mountOnce);
			else mountOnce(ctx);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = 'dsh-visual-annotator';
		return module.exports;
	},
});

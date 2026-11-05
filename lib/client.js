/**
 * dsh-visual-annotator — Web (client) half.
 *
 * Adds one native right-sidebar tab: a control deck for the visible
 * Chrome/Edge window the host half drives. Address bar + launch/close in one
 * row, a prominent pick-mode toggle, annotated cards (screenshot thumbnail,
 * reference, comment, per-card insert), and a visible status strip.
 *
 * "插入输入框" assembles a structured composer draft:
 *   1. element screenshots as real image attachments (conversation service),
 *   2. a compact Chinese prompt block with selector / URL / rect / comment.
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

		var inject = ['slots', 'sidebarRight', 'sidebarRightTabs'];
		var TAB_ID = 'dsh-visual-annotator';
		var TAB_KIND = 'visual-annotator';
		var API = '/api/visual-annotator';
		var POLL_MS = 1500;

		var BORDER = 'var(--dsw-alias-border-l2, rgba(127,127,127,.22))';
		var MUTED = 'var(--dsw-alias-text-secondary, rgba(127,127,127,.95))';

		var CSS = [
			'.vp-root{display:flex;flex-direction:column;height:100%;min-height:0;font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit}',
			'.vp-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid ' +
				BORDER +
				';flex:none}',
			'.vp-title{font-weight:600;font-size:13px;flex:none}',
			'.vp-dot{width:8px;height:8px;border-radius:50%;background:#9ca3af;flex:none}',
			'.vp-dot.ready{background:#22c55e}',
			'.vp-dot.pick{background:#2f81f7;box-shadow:0 0 0 3px rgba(47,129,247,.25)}',
			'.vp-dot.starting{background:#f59e0b}',
			'.vp-dot.error{background:#ef4444}',
			'.vp-status{color:' +
				MUTED +
				';font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
			'.vp-spacer{flex:1}',
			'.vp-row{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid ' + BORDER + ';flex:none}',
			'.vp-row.tight{padding:6px 10px}',
			'.vp-input{flex:1;min-width:0;padding:6px 8px;border-radius:6px;border:1px solid ' +
				BORDER +
				';background:var(--dsw-specific-input-major, transparent);color:inherit;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;outline:none}',
			'.vp-input:focus{border-color:#2f81f7}',
			'.vp-btn{padding:6px 10px;border-radius:6px;border:1px solid ' +
				BORDER +
				';background:rgba(127,127,127,.08);color:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
			'.vp-btn:hover{background:rgba(127,127,127,.18)}',
			'.vp-btn:disabled{opacity:.45;cursor:default}',
			'.vp-btn.pri{background:#2f81f7;border-color:#2f81f7;color:#fff}',
			'.vp-btn.pri:hover{background:#1f6feb}',
			'.vp-btn.big{flex:1;padding:8px 10px;font-size:13px;font-weight:600}',
			'.vp-btn.big.on{background:#2f81f7;border-color:#2f81f7;color:#fff}',
			'.vp-btn.danger{color:#ef4444;border-color:rgba(239,68,68,.45)}',
			'.vp-btn.icon{padding:6px 8px}',
			'.vp-body{flex:1;min-height:0;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px}',
			'.vp-empty{border:1px dashed ' +
				BORDER +
				';border-radius:8px;padding:14px;color:' +
				MUTED +
				';font-size:12px;line-height:1.7}',
			'.vp-empty b{color:inherit}',
			'.vp-card{display:flex;gap:8px;border:1px solid ' +
				BORDER +
				';border-radius:8px;padding:8px;background:rgba(127,127,127,.05)}',
			'.vp-thumb{width:96px;height:72px;flex:none;object-fit:contain;border-radius:5px;background:rgba(127,127,127,.14);border:1px solid ' +
				BORDER +
				';cursor:zoom-in}',
			'.vp-thumb.none{display:flex;align-items:center;justify-content:center;color:' +
				MUTED +
				';font-size:10px;cursor:default}',
			'.vp-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
			'.vp-sel{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#2f81f7;word-break:break-all;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;unicode-bidi:plaintext}',
			'.vp-text{font-size:11px;color:' + MUTED + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.vp-comment{width:100%;box-sizing:border-box;min-height:44px;max-height:120px;padding:5px 7px;border-radius:6px;border:1px solid ' +
				BORDER +
				';background:var(--dsw-specific-input-major, transparent);color:inherit;font:12px/1.45 system-ui,sans-serif;resize:vertical;outline:none}',
			'.vp-comment:focus{border-color:#2f81f7}',
			'.vp-actions{display:flex;gap:6px;justify-content:flex-end;align-items:center}',
			'.vp-attachinfo{font-size:10px;color:' + MUTED + ';margin-right:auto}',
			'.vp-foot{display:flex;gap:6px;padding:8px 10px;border-top:1px solid ' + BORDER + ';flex:none}',
			'.vp-foot .vp-btn{flex:1}',
			'.vp-hint{font-size:11px;color:' + MUTED + ';padding:0 10px 8px;flex:none}',
			'.vp-warn{margin:0 10px;padding:6px 8px;border-radius:6px;background:rgba(239,68,68,.12);color:#ef4444;font-size:11px;flex:none}',
			'.vp-strip{padding:6px 10px 0}',
			'.vp-seg{display:flex;flex:none;border:1px solid ' + BORDER + ';border-radius:6px;overflow:hidden}',
			'.vp-seg .vp-btn{border:none;border-radius:0;padding:6px 8px;flex:none;background:transparent}',
			'.vp-seg .vp-btn.on{background:#2f81f7;color:#fff}',
			'.vp-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:2px 0}',
			'.vp-tab{border:1px solid ' +
				BORDER +
				';background:transparent;color:inherit;border-radius:5px;padding:3px 8px;font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none}',
			'.vp-tab.on{background:#2f81f7;color:#fff;border-color:transparent}',
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

		/** Reference mode: one marker line per pick with compact location; full details via the tool. */
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

		function composeInsertText(picks, imageCount, attached, mode) {
			if (mode === 'ref') return composeRefText(picks, imageCount, attached);
			var head = '请根据以下 ' + picks.length + ' 处页面元素标注修改代码：';
			if (imageCount > 0 && attached) head += '\n（' + imageCount + ' 张元素截图已作为附件插入，请先查看）';
			var blocks = picks.map((pick, i) => {
				var shotRef = attached ? null : pick.shotUrl || null;
				return pickBlock(pick, i + 1, shotRef);
			});
			return head + '\n\n' + blocks.join('\n\n');
		}

		/* ------------------------------------------------------------------ */
		/* Reference chips: register one input-trigger source so inserted       */
		/* markers become real composer chips that expand to full location      */
		/* text at submit time (sinkSerialized -> codec.serialize).             */
		/* ------------------------------------------------------------------ */
		var VP_SOURCE_NAME = 'visual-annotator';
		/** Latest pick snapshots by id, for chip serialization at submit time. */
		var VP_PICKS = {};
		var VP_SOURCE_READY = false;

		/** Model-side expansion of one chip: the full location block. */
		function vpSerializeRef(id) {
			var pick = VP_PICKS[String(id)];
			if (!pick)
				return '[标注 #' + id + ']（该标注已被清除；请调用 visual_annotator_read（不带 ids）获取现有标注列表）';
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
							serialize: (ref) => Promise.resolve(vpSerializeRef(ref)),
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

		var Icon = () =>
			h(
				'svg',
				{ width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 },
				h('path', {
					d: 'M1 4V2.5A1.5 1.5 0 0 1 2.5 1H4M12 1h1.5A1.5 1.5 0 0 1 15 2.5V4M15 12v1.5a1.5 1.5 0 0 1-1.5 1.5H12M4 15H2.5A1.5 1.5 0 0 1 1 13.5V12',
				}),
				h('circle', { cx: 8, cy: 8, r: 2.2 }),
			);

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
			});
			var [url, setUrl] = useState('');
			var [busy, setBusy] = useState('');
			var [drafts, setDrafts] = useState({});
			var [notice, setNotice] = useState('');
			/** Insert mode: 'ref' = one [标注 #id] marker line per pick; 'detail' = full dump. */
			var [insertMode, setInsertMode] = useState(function () {
				try {
					var saved = localStorage.getItem('dsh-visual-annotator-insert-mode');
					return saved === 'detail' ? 'detail' : 'ref';
				} catch {
					return 'ref';
				}
			});
			var focusedRef = React.useRef(null);
			var sessionId = props.sessionId ?? null;

			var cwd = props.useSessions
				? props.useSessions(function (snapshot) {
						var id = sessionId;
						if (!id || !snapshot || !snapshot.byId) return '';
						var row = snapshot.byId[id];
						return row && row.cwd ? String(row.cwd) : '';
					})
				: '';

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
						error: data.error ?? null,
						error_message: null,
					}),
				);
			};

			useEffect(function () {
				var alive = true;
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
				tick();
				var timer = setInterval(tick, POLL_MS);
				return function () {
					alive = false;
					clearInterval(timer);
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
				var drafts;
				try {
					drafts = conv.createDrafts(sessionId, files);
				} catch {
					return { ok: false, count: 0 };
				}
				var ok = false;
				try {
					ok = !!ia.addAttachments(drafts.map((draft) => draft.id));
				} catch {
					ok = false;
				}
				if (!ok && typeof conv.releaseDraftAttachments === 'function') {
					try {
						conv.releaseDraftAttachments(drafts);
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

			/** Structured insert: screenshots as attachments + chips (or compact Chinese prompt text). */
			var insertPicks = async (list) => {
				if (!list || list.length === 0) return;
				var withComment = list.map((pick) =>
					Object.assign({}, pick, {
						comment: drafts[pick.id] !== undefined ? drafts[pick.id] : (pick.comment ?? ''),
					}),
				);
				setNotice('正在插入…');
				var attached = await attachShots(withComment);
				var text = composeInsertText(withComment, attached.count, attached.ok, insertMode);
				var ia = resolveLiveActions(props.inputActions);
				var actx = ensureVpSource(props.ctx) && insertMode === 'ref' ? resolveActx(props.ctx, sessionId) : null;
				var ok = false;
				var usedChips = false;
				if (actx && typeof actx.bail === 'function' && ia && typeof ia.captureInsertion === 'function') {
					try {
						ok = insertViaChips(ia, actx, withComment);
						usedChips = ok;
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
					setNotice(
						(usedChips ? '已插入引用芯片' : '已插入输入框') +
							(attached.ok
								? '（含 ' + attached.count + ' 张截图附件；发送时自动展开定位详情）'
								: usedChips
									? '（截图未能附上，定位详情发送时展开）'
									: '（截图未能附上，已在文本中给出链接）'),
					);
					return;
				}
				setNotice('输入框不可用，已复制到剪贴板');
				try {
					navigator.clipboard?.writeText(text);
				} catch {
					/* clipboard unavailable */
				}
			};

			var markdown = useMemo(() => markdownFor(state, picks), [state.markdown, picks]);

			// Keep chip serialization data fresh (submit-time codec reads VP_PICKS).
			useEffect(function () {
				(state.picks ?? []).forEach((pick) => {
					VP_PICKS[pick.id] = Object.assign({}, pick, {
						comment: drafts[pick.id] !== undefined ? drafts[pick.id] : (pick.comment ?? ''),
					});
				});
			});

			var launch = async (browser) => {
				setBusy('launch');
				try {
					var body = { browser: browser, cwd: cwd };
					if (url) body.url = url;
					apply(await post('/launch', body));
				} finally {
					setBusy('');
				}
			};

			var toggleMode = async () => {
				setBusy('mode');
				try {
					apply(await post('/mode', { mode: state.mode === 'pick' ? 'off' : 'pick' }));
				} finally {
					setBusy('');
				}
			};

			var closeBrowser = async () => {
				setBusy('close');
				try {
					apply(await post('/close', {}));
				} finally {
					setBusy('');
				}
			};

			var clearAll = async () => {
				apply(await post('/clear', {}));
				setDrafts({});
			};

			var removePick = async (id) => {
				apply(await post('/remove', { id }));
			};

			var persistComment = async (id, value) => {
				focusedRef.current = null;
				apply(await post('/comment', { id, comment: value }));
			};

			var dotClass =
				state.mode === 'pick'
					? 'pick'
					: state.status === 'ready'
						? 'ready'
						: state.status === 'error'
							? 'error'
							: state.status === 'starting'
								? 'starting'
								: '';

			var statusText =
				state.status === 'ready'
					? (state.activeTitle || hostOf(state.activeUrl) || '已连接') + (state.mode === 'pick' ? ' · 标注中' : '')
					: state.status === 'starting'
						? '正在启动浏览器…'
						: state.status === 'error'
							? state.error || '启动失败'
							: '浏览器未启动';

			var noBrowsers = !state.browsers || (!state.browsers.chrome && !state.browsers.edge);
			var ready = state.status === 'ready';

			var switchTab = async (targetId) => {
				setBusy('tab');
				try {
					apply(await post('/tab', { targetId }));
				} catch (error) {
					setState((prev) => Object.assign({}, prev, { error_message: String((error && error.message) || error) }));
				}
				setBusy('');
			};
			var setMode = (next) => {
				setInsertMode(next);
				try {
					localStorage.setItem('dsh-visual-annotator-insert-mode', next);
				} catch {
					/* storage unavailable */
				}
			};
			var insertLabel = insertMode === 'ref' ? '插入引用' : '插入输入框';
			var insertTitle =
				insertMode === 'ref'
					? '把这条标注（截图附件 + [标注 #id] 引用 + 评论）插入聊天输入框'
					: '把这条标注（截图附件 + 完整信息）插入聊天输入框';
			var allLabel = insertMode === 'ref' ? '全部插入引用（' + picks.length + '）' : '全部插入（' + picks.length + '）';
			return h(
				'div',
				{ className: 'vp-root' },
				h(
					'div',
					{ className: 'vp-head' },
					h('span', { className: 'vp-title' }, '指哪改哪'),
					h('span', { className: 'vp-dot ' + dotClass }),
					h('span', { className: 'vp-status', title: state.activeUrl }, statusText),
					h('span', { className: 'vp-spacer' }),
					ready
						? h(
								'button',
								{
									className: 'vp-btn danger icon',
									disabled: busy === 'close',
									title: '关闭浏览器窗口',
									onClick: closeBrowser,
								},
								'关闭',
							)
						: null,
				),
				state.error_message
					? h('div', { className: 'vp-strip' }, h('div', { className: 'vp-warn' }, state.error_message))
					: null,
				noBrowsers
					? h(
							'div',
							{ className: 'vp-strip' },
							h(
								'div',
								{ className: 'vp-warn' },
								'未检测到 Chrome / Edge，可设置环境变量 DSH_VISUAL_ANNOTATOR_CHROME 指向可执行文件',
							),
						)
					: null,
				h(
					'div',
					{ className: 'vp-row' },
					h('input', {
						className: 'vp-input',
						placeholder: 'http://localhost:3000/…',
						value: url,
						onChange: (event) => setUrl(event.target.value),
						onKeyDown: (event) => {
							if (event.key === 'Enter' && !ready) launch('chrome');
						},
					}),
					ready
						? h(
								'button',
								{
									className: 'vp-btn',
									disabled: busy === 'launch',
									title: '在 Chrome 中打开输入的地址（同窗口新开标签页，相同地址则切换过去）',
									onClick: () => launch(state.browsers?.edge && !state.browsers?.chrome ? 'edge' : 'chrome'),
								},
								busy === 'launch' ? '…' : '在 Chrome 中调试',
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
				ready
					? h(
							'div',
							{ className: 'vp-row' },
							h(
								'button',
								{
									className: 'vp-btn big' + (state.mode === 'pick' ? ' on' : ''),
									disabled: busy === 'mode',
									onClick: toggleMode,
								},
								state.mode === 'pick' ? '● 标注中 — 点击停止（Esc）' : '开始标注元素',
							),
						)
					: null,
				ready && (state.tabs ?? []).length > 0
					? h(
							'div',
							{ className: 'vp-tabs' },
							(state.tabs ?? []).map((t) =>
								h(
									'button',
									{
										key: t.targetId,
										className: 'vp-tab' + (t.active ? ' on' : ''),
										title: t.url || t.targetId,
										disabled: busy === 'tab',
										onClick: () => switchTab(t.targetId),
									},
									String(t.title || t.url || t.targetId).slice(0, 24),
								),
							),
						)
					: null,
				h(
					'div',
					{ className: 'vp-hint' },
					ready && state.mode === 'pick'
						? '在浏览器窗口里悬停高亮、点击元素，写评论后点「添加标注」，会自动截图。'
						: ready
							? '点「开始标注元素」后到浏览器窗口框选页面元素。'
							: '输入页面地址点「启动」，即可在真实浏览器里点选标注元素。',
				),
				h(
					'div',
					{ className: 'vp-body' },
					picks.length === 0
						? h(
								'div',
								{ className: 'vp-empty' },
								h('div', null, h('b', null, '1. '), '输入要调试的页面地址，点「启动」打开浏览器窗口'),
								h('div', null, h('b', null, '2. '), '点「开始标注元素」，在页面里点击要改的元素并写评论'),
								h('div', null, h('b', null, '3. '), '每条标注卡片上点「插入输入框」，截图与引用会一起进入对话'),
							)
						: picks.map((pick) => {
								var comment = drafts[pick.id] !== undefined ? drafts[pick.id] : (pick.comment ?? '');
								return h(
									'div',
									{ className: 'vp-card', key: pick.id },
									pick.shotUrl
										? h('img', {
												className: 'vp-thumb',
												src: pick.shotUrl,
												alt: '元素截图',
												title: '点击查看原图',
												onClick: () => window.open(pick.shotUrl, '_blank'),
											})
										: h('div', { className: 'vp-thumb none' }, '无截图'),
									h(
										'div',
										{ className: 'vp-meta' },
										h('code', { className: 'vp-sel', title: pick.selector }, pick.selector || pick.tag),
										pick.text ? h('div', { className: 'vp-text', title: pick.text }, pick.text) : null,
										h('textarea', {
											className: 'vp-comment',
											placeholder: '评论：想怎么改？',
											value: comment,
											onChange: (event) => {
												var value = event.target.value;
												setDrafts(function (prev) {
													return Object.assign({}, prev, { [pick.id]: value });
												});
											},
											onBlur: (event) => persistComment(pick.id, event.target.value),
										}),
										h(
											'div',
											{ className: 'vp-actions' },
											h(
												'button',
												{
													className: 'vp-btn pri',
													title: insertTitle,
													onClick: () => insertPicks([pick]),
												},
												insertLabel,
											),
											h(
												'button',
												{ className: 'vp-btn danger', title: '删除这条标注', onClick: () => removePick(pick.id) },
												'删除',
											),
										),
									),
								);
							}),
				),
				notice ? h('div', { className: 'vp-hint' }, notice) : null,
				h(
					'div',
					{ className: 'vp-foot' },
					h(
						'div',
						{ className: 'vp-seg', title: '插入内容形态：引用=轻量标记，详细=完整信息' },
						h(
							'button',
							{ className: 'vp-btn' + (insertMode === 'ref' ? ' on' : ''), onClick: () => setMode('ref') },
							'引用',
						),
						h(
							'button',
							{ className: 'vp-btn' + (insertMode === 'detail' ? ' on' : ''), onClick: () => setMode('detail') },
							'详细',
						),
					),
					h(
						'button',
						{ className: 'vp-btn pri', disabled: picks.length === 0, onClick: () => insertPicks(picks) },
						allLabel,
					),
					h(
						'button',
						{
							className: 'vp-btn',
							disabled: picks.length === 0,
							onClick: () => {
								try {
									navigator.clipboard?.writeText(markdown);
									setNotice('Markdown 已复制');
								} catch {
									setNotice('复制失败');
								}
							},
						},
						'复制',
					),
					h('button', { className: 'vp-btn danger', disabled: picks.length === 0, onClick: clearAll }, '清空'),
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
				guide: [{ id: 'visual-annotator', order: 88, title: () => '指哪改哪', icon: Icon }],
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

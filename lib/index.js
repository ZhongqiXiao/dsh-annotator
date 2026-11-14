/**
 * dsh-annotator — host half.
 *
 * Registers the HTTP surface the Web panel talks to (same-origin fetch on the
 * DSH web server) plus one agent-facing tool, and owns the visible Chrome/Edge
 * window driven over the CDP pipe.
 */

import fs from 'node:fs';

import { VisualPicker, availableBrowsers } from './session.js';
import { isResend, pageKeyOf, pairIdsOf, pairedTargetsOf, pickRoleOf, refLabelOf } from './shared/page-roles.js';
import { TOOL_OUTPUT_SCHEMA, TOOL_PARAMETERS } from './shared/tool-schema.js';

export const name = 'dsh-annotator';
export const inject = ['webServer'];

const ROUTE_PREFIX = '/api/visual-annotator';
/** Proves which build of the host half is live in the running DSH. */
const HOST_REV = 'v43-' + Date.now();
/** Populated when ctx.tools.register rejects the definition; surfaced by /state. */
let toolError = null;
/** True once visual_annotator_read is really in the live registry (not just declared). */
let toolReady = false;

async function readJson(req) {
	// The DSH web server may already have parsed the body; `for await` covers the
	// plain IncomingMessage case. Both are tried so a POST never silently loses
	// its payload (a lost body used to launch about:blank instead of the URL).
	const direct = req?.body;
	if (direct && typeof direct === 'object' && !Buffer.isBuffer(direct)) return direct;
	if (typeof direct === 'string' && direct) {
		try {
			return JSON.parse(direct);
		} catch {
			return {};
		}
	}
	if (Buffer.isBuffer(direct) && direct.length) {
		try {
			return JSON.parse(direct.toString('utf8'));
		} catch {
			return {};
		}
	}
	if (req?.readableEnded) return {};
	const chunks = [];
	try {
		for await (const chunk of req) {
			chunks.push(Buffer.from(chunk));
			if (chunks.reduce((total, item) => total + item.length, 0) > 4_000_000) break;
		}
	} catch {
		return {};
	}
	const raw = Buffer.concat(chunks).toString('utf8');
	if (!raw) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

function sendJson(res, status, value) {
	const body = JSON.stringify(value);
	res.statusCode = status;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.setHeader('Cache-Control', 'no-store');
	res.end(body);
}

/** Ego-browser authoritative fallback: a present Origin must match Host. */
function sameOriginRejection(req) {
	const origin = req?.headers?.origin;
	if (!origin) return undefined;
	let originHost;
	try {
		originHost = new URL(origin).host;
	} catch {
		return 403;
	}
	if (!req.headers.host || originHost !== req.headers.host) return 403;
	return undefined;
}

/**
 * Admission gate mirroring DSH's own web auth (dsh-client-connection
 * HostConnectionService.requestRejection): Host/Origin fence (403) plus the
 * signed browser-cookie check (401). Falls back to the ego-style same-origin
 * fence when the connection service is absent (headless profiles).
 * Returns the HTTP status to reject with, or undefined to admit.
 */
function requestRejection(ctx, req) {
	const connection = ctx.get?.('connection');
	if (connection && typeof connection.requestRejection === 'function') {
		try {
			return connection.requestRejection(req);
		} catch (error) {
			ctx.logger?.warn?.(`dsh-annotator: connection admission failed: ${String(error?.message ?? error)}`);
		}
	}
	return sameOriginRejection(req);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Normalizes the tool's shots argument: 'none' | 'all' | positive integer (default latest 3). */
export function normalizeShots(value) {
	if (value === 'none' || value === 'all') return value;
	const n = Number(value);
	if (Number.isInteger(n) && n > 0) return n;
	return 3;
}

/**
 * Markdown for an id-filtered pick subset.
 *
 * Without references this keeps the historical single-block shape (exact wording
 * included: existing prompts and tests match on 「页面元素标注（N 处）」). With
 * references it splits into a read-only spec section per reference page and one
 * target section, because "change this" and "look like this" are opposite
 * instructions and a flat list invites the agent to edit the wrong page.
 */
export function filteredPicksMarkdown(picks) {
	if (!picks.length) return '（没有匹配 id 的页面元素标注）';
	const references = picks.filter((pick) => pick.role === 'reference');
	const targets = picks.filter((pick) => pick.role !== 'reference');
	// 参考标注的编号（R1-1、R1-2…）：目标标注靠它说清「照哪一条改」。
	const code = new Map();
	const perPage = new Map();
	for (const pick of references) {
		const key = pick.pageKey || pageKeyOf(pick.url);
		const next = (perPage.get(key) || 0) + 1;
		perPage.set(key, next);
		code.set(String(pick.id), (pick.refLabel || 'R') + '-' + next);
	}
	const lines = [];
	const push = (pick, label) => {
		const text = pick.text ? '：' + String(pick.text).replace(/\s+/g, ' ').slice(0, 80) : '';
		lines.push('', label + ' \`' + (pick.selector || pick.tag) + '\` — ' + pick.tag + text);
		if (pick.url) lines.push('   页面：' + pick.url);
		if (pick.pageRect)
			lines.push(
				'   位置：x=' +
					Math.round(pick.pageRect.x) +
					' y=' +
					Math.round(pick.pageRect.y) +
					' ' +
					Math.round(pick.pageRect.width) +
					'×' +
					Math.round(pick.pageRect.height),
			);
		if (Array.isArray(pick.spec) && pick.spec.length) lines.push('   参考维度：' + pick.spec.join('、'));
		if (pick.comment) lines.push('   评论：' + pick.comment);
		if (pick.shotPath) lines.push('   截图：' + pick.shotPath);
	};
	if (!references.length) {
		lines.push('页面元素标注（' + picks.length + ' 处）');
		picks.forEach((pick, index) => push(pick, String(index + 1) + '.'));
		return lines.join('\n');
	}
	lines.push('页面元素标注（' + picks.length + ' 处：' + targets.length + ' 目标 / ' + references.length + ' 参照）');
	const seen = new Set();
	for (const pick of references) {
		const key = pick.pageKey || pageKeyOf(pick.url);
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push('');
		lines.push(
			'## 参照页 ' +
				(pick.refLabel || 'R') +
				' — ' +
				(pick.pageTitle || pick.url || '参照页') +
				'（只读规范，禁止修改此页或其代码）',
		);
		for (const item of references) {
			if ((item.pageKey || pageKeyOf(item.url)) !== key) continue;
			push(item, code.get(String(item.id)) + '.');
		}
	}
	if (targets.length) {
		lines.push('');
		lines.push('## 目标页 — ' + (targets[0].pageTitle || targets[0].url || '目标页') + '（待修改）');
		targets.forEach((pick, index) => {
			push(pick, 'T' + (index + 1) + '.');
			const pairIds = pairIdsOf(pick);
			const pairs = pairIds.map((id) => picks.find((item) => String(item.id) === id)).filter(Boolean);
			if (!pairs.length) {
				lines.push('   参照：未指定参照标注' + (references.length ? '（可参照上面的参照页规范）' : ''));
				return;
			}
			const labels = [];
			const dims = [];
			for (const pair of pairs) {
				const pairCode = code.get(String(pair.id));
				if (pairCode && !labels.includes(pairCode)) labels.push(pairCode);
				for (const dim of Array.isArray(pair.spec) ? pair.spec : []) if (!dims.includes(dim)) dims.push(dim);
			}
			lines.push(
				'   参照：' +
					labels.join('、') +
					(dims.length ? ' 的' + dims.join('、') : '') +
					'（只改目标页这里，参照页与其代码只读）',
			);
		});
	}
	return lines.join('\n');
}

/** Persists the chosen pick screenshots as durable attachments for the tool render. */
async function saveShotAttachments(ctx, picks, shots) {
	if (shots === 'none') return [];
	const store = ctx.get?.('attachments');
	if (!store || typeof store.saveImages !== 'function') return [];
	const withShots = picks.filter((pick) => pick.shotPath && fs.existsSync(pick.shotPath));
	const chosen = shots === 'all' ? withShots : withShots.slice(-shots);
	const attachments = [];
	for (const pick of chosen) {
		try {
			const data = fs.readFileSync(pick.shotPath).toString('base64');
			const refs = await store.saveImages([{ mediaType: 'image/png', data, name: `visual-annotator-${pick.id}.png` }]);
			if (refs?.[0]) attachments.push({ pickId: pick.id, ref: refs[0] });
		} catch (error) {
			ctx.logger?.warn?.(`dsh-annotator: shot attachment failed for ${pick.id}: ${String(error?.message ?? error)}`);
		}
	}
	return attachments;
}

export function apply(ctx) {
	// 传 logger 让启动降级（--no-sandbox 回退）这类「不该静默」的事进 host 日志。
	const picker = new VisualPicker({ log: (level, message) => ctx.logger?.[level]?.(message) });
	const disposers = [];
	let closed = false;
	/** Pick count at the tool's previous read; wait_seconds waits for growth past it. */
	let lastReadCount = -1;

	const teardown = () => {
		if (closed) return;
		closed = true;
		for (const dispose of disposers.splice(0)) {
			try {
				dispose?.();
			} catch {
				/* the web server may already be gone */
			}
		}
		// host 卸载时窗口不该继续飘在桌面上；profile 留在临时目录，重开接着用。
		void picker.close({ terminate: true });
	};
	ctx.effect?.(() => teardown);

	const mount = (rawServer) => {
		const server = rawServer?.register ? rawServer : ctx.get?.('webServer');
		if (!server || typeof server.register !== 'function') {
			ctx.logger?.warn?.('dsh-annotator: webServer service unavailable, panel routes not mounted');
			return;
		}
		const route = (path, handler) => {
			const guarded = async (req, res) => {
				const rejection = requestRejection(ctx, req);
				if (rejection !== undefined) {
					sendJson(res, rejection, { ok: false, error: 'unauthorized' });
					return;
				}
				await handler(req, res);
			};
			const dispose = server.register({ kind: 'exact', path: ROUTE_PREFIX + path, handler: guarded });
			disposers.push(dispose);
		};

		route('/state', async (_req, res) => {
			// 面板每秒轮询一次：顺手用 Target.getTargets 对一遍标签页（标题/URL），
			// 不依赖 targetInfoChanged 一定能送达——某些页面标题是框架异步写的，
			// 或者在 attach 之前就改完，只靠事件时面板会一直显示 URL。
			await picker.refreshTabs().catch(() => {});
			const snapshot = picker.snapshot();
			sendJson(res, 200, {
				ok: true,
				...snapshot,
				rev: HOST_REV,
				file: import.meta.url,
				// Registration used to fail silently; /state now distinguishes
				// "registered fine" from "register threw" so a missing tool is diagnosable.
				tool: { registered: toolReady, error: toolError },
				toolError,
				markdown: picker.toMarkdown(),
				browsers: availableBrowsers(),
			});
		});

		route('/launch', async (req, res) => {
			const body = await readJson(req);
			const snapshot = await picker.launch({
				url: body.url,
				browser: body.browser,
				cwd: body.cwd,
				cleanProfile: body.cleanProfile === undefined ? undefined : body.cleanProfile === true,
			});
			sendJson(res, 200, {
				ok: snapshot.status === 'ready',
				...snapshot,
				rev: HOST_REV,
				received: { url: body.url ?? null, browser: body.browser ?? null, cwd: body.cwd ?? null },
				markdown: picker.toMarkdown(),
			});
		});

		route('/space', async (req, res) => {
			// 调试空间 = Chromium BrowserContext（与 ego lite 的 task space 同一原语）。
			// action: create（新建并切过去）/ use（切换）/ close（销毁并回默认）。
			const body = await readJson(req);
			const action = String(body.action ?? 'use');
			try {
				let snapshot;
				if (action === 'create') snapshot = await picker.createSpace({ name: body.name, url: body.url });
				else if (action === 'close') snapshot = await picker.closeSpace(body.id);
				else snapshot = await picker.useSpace(body.id, body.url);
				sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
			} catch (error) {
				sendJson(res, 200, {
					ok: false,
					error: String(error?.message ?? error),
					error_message: String(error?.message ?? error),
					...picker.snapshot(),
				});
			}
		});

		route('/probe', async (_req, res) => {
			// Health check: proves the page-side overlay is actually alive on the
			// active tab. Deliberately evaluates one fixed expression only.
			const picker0 = picker;
			let value = null;
			let error = null;
			try {
				const snapshot = picker0.snapshot();
				if (snapshot.status !== 'ready') throw new Error(`browser ${snapshot.status}`);
				const result = await picker0.probeOverlay();
				value = result;
			} catch (caught) {
				error = String(caught?.message ?? caught);
			}
			sendJson(res, 200, {
				ok: error === null,
				rev: HOST_REV,
				overlay: value,
				error,
				...picker0.snapshot(),
			});
		});

		route('/mode', async (req, res) => {
			const body = await readJson(req);
			const snapshot = await picker.setMode(body.mode);
			sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
		});

		route('/navigate', async (req, res) => {
			const body = await readJson(req);
			const snapshot = await picker.navigate(String(body.url ?? ''));
			sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
		});

		route('/tab', async (req, res) => {
			const body = await readJson(req);
			const snapshot = await picker.activateTab(String(body.targetId ?? ''));
			sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
		});

		route('/comment', async (req, res) => {
			const body = await readJson(req);
			const snapshot = picker.setComment(String(body.id ?? ''), body.comment);
			sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
		});

		route('/remove', async (req, res) => {
			const body = await readJson(req);
			const snapshot = await picker.removePick(String(body.id ?? ''));
			sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
		});

		// The panel inserted these picks into the composer: drop them from the list so the
		// next annotation round starts clean. /restore still brings the whole batch back.
		route('/consume', async (req, res) => {
			const body = await readJson(req);
			const snapshot = await picker.consumePicks(Array.isArray(body.ids) ? body.ids : []);
			sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
		});

		// Chip expansion resolves one id at submit time. The pick may already have left
		// the list (it was inserted in an earlier round), so answer from the archive too.
		route('/pick', async (req, res) => {
			const body = await readJson(req);
			const pick = picker.findPick(String(body.id ?? ''));
			sendJson(res, 200, { ok: Boolean(pick), pick, archived: picker.retired.length });
		});

		route('/focus', async (req, res) => {
			const body = await readJson(req);
			const snapshot = await picker.focusPick(String(body.id ?? ''));
			sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
		});

		route('/restore', async (_req, res) => {
			const snapshot = await picker.restorePick();
			sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
		});

		route('/clear', async (req, res) => {
			const body = await readJson(req);
			// scope: 'target' | 'reference' | 'all'（缺省 all）。参考标注是复用资产，清空要保持精准。
			const snapshot = await picker.clear(body.scope);
			sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
		});

		route('/close', async (req, res) => {
			const body = await readJson(req);
			// terminate=true 才真的关浏览器；缺省只断开，窗口与 profile 留给下次重连。
			const snapshot = await picker.close({ terminate: body.terminate === true });
			sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
		});

		// 页面角色：target（0..1）/ reference（0..5）/ neutral。改写既有标注要显式 rewrite
		// （面板 v43 起一律 rewrite=false：换角色只影响新标注，不再整页翻转）。
		route('/page-role', async (req, res) => {
			const body = await readJson(req);
			const result = await picker.setPageRole({
				key: body.key,
				url: body.url,
				title: body.title,
				role: body.role,
				targetId: body.targetId,
				rewrite: body.rewrite === undefined ? true : body.rewrite === true,
			});
			sendJson(res, 200, { ...result, markdown: picker.toMarkdown() });
		});

		route('/pick-role', async (req, res) => {
			const body = await readJson(req);
			const result = picker.setPickRole(String(body.id ?? ''), body.role);
			sendJson(res, 200, { ...result, markdown: picker.toMarkdown() });
		});

		route('/pick-include', async (req, res) => {
			const body = await readJson(req);
			const result = picker.setPickInclude(String(body.id ?? ''), body.included !== false);
			sendJson(res, 200, { ...result, markdown: picker.toMarkdown() });
		});

		// 配对：把一条目标标注配到一条参考标注上（参考模式「一行一对」的对应关系）。
		route('/pair', async (req, res) => {
			const body = await readJson(req);
			const result = picker.setPair(String(body.targetId ?? ''), body.refId == null ? '' : String(body.refId), {
				move: body.move === true,
			});
			sendJson(res, 200, { ...result, markdown: picker.toMarkdown() });
		});

		// 只解开一条参考（右栏参考卡上的小 ×），其余参考还挂在这条目标上。
		route('/unpair', async (req, res) => {
			const body = await readJson(req);
			const result = picker.unpair(String(body.targetId ?? ''), String(body.refId ?? ''));
			sendJson(res, 200, { ...result, markdown: picker.toMarkdown() });
		});

		route('/pair-all', async (req, res) => {
			const body = await readJson(req);
			const result = picker.pairAll(String(body.refId ?? ''));
			sendJson(res, 200, { ...result, markdown: picker.toMarkdown() });
		});

		route('/pick-spec', async (req, res) => {
			const body = await readJson(req);
			const result = picker.setPickSpec(String(body.id ?? ''), body.spec);
			sendJson(res, 200, { ...result, markdown: picker.toMarkdown() });
		});

		// 对比层按需整页截图：POST 触发一次 CDP 抓取，GET 取回字节。
		route('/pageshot', async (req, res) => {
			const url = new URL(req.url ?? '/', 'http://127.0.0.1');
			const isPost = (req.method ?? 'GET').toUpperCase() === 'POST';
			if (isPost) {
				const body = await readJson(req);
				try {
					const result = await picker.capturePageShot(body.key);
					sendJson(res, 200, { ...result, ...picker.snapshot() });
				} catch (error) {
					sendJson(res, 200, {
						ok: false,
						error: String(error?.message ?? error),
						error_message: String(error?.message ?? error),
						...picker.snapshot(),
					});
				}
				return;
			}
			const key = url.searchParams.get('key') ?? '';
			const file = picker.pageShotFile(key);
			if (!file) {
				sendJson(res, 404, { ok: false, error: 'page shot not found' });
				return;
			}
			try {
				const bytes = fs.readFileSync(file);
				res.statusCode = 200;
				res.setHeader('Content-Type', 'image/png');
				res.setHeader('Cache-Control', 'no-store');
				res.end(bytes);
			} catch (error) {
				sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
			}
		});

		route('/shot', async (req, res) => {
			const id = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('id') ?? '';
			const file = picker.shotFile(id);
			if (!file) {
				sendJson(res, 404, { ok: false, error: 'shot not found' });
				return;
			}
			try {
				const bytes = fs.readFileSync(file);
				res.statusCode = 200;
				res.setHeader('Content-Type', 'image/png');
				res.setHeader('Cache-Control', 'no-store');
				res.end(bytes);
			} catch (error) {
				sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
			}
		});
	};

	const webServer = ctx.get?.('webServer');
	if (webServer) mount(webServer);
	else ctx.inject?.(['webServer'], (wctx) => mount(wctx.get?.('webServer')));

	const registerTool = (tools) => {
		// A second attempt would hit the duplicate-name error and look like a failure.
		if (!tools?.register || toolReady) return;
		try {
			const dispose = tools.register({
				name: 'visual_annotator_read',
				description:
					"读取用户在 Visual Picker 面板里对网页元素的标注（CSS 选择器、元素文本、评论、截图路径）。用户说“看我的标注/元素标注/截图”时先调用。当用户消息中出现「[标注 #pN]」引用标记时必须调用本工具，并用 ids 参数只取对应标注。返回 markdown、picks 列表，并按 shots 参数把元素截图作为图片附件内联。参数 shots：'none' 不带截图；'all' 内联全部；正整数 n=只内联最近 n 张；缺省内联最近 3 张。参数 wait_seconds（0-60，默认 0）：浏览器运行中且自上次读取后没有新标注时轮询等待，出现新标注或超时立即返回，可替代轮询实现“用户标注完成即推送”。参数 roles 可按角色过滤：'target' 只要改动对象、'reference' 只要只读参照规范。标注带 role 字段：role=reference 的标注来自参照页，只用于提取视觉/交互规范，禁止修改参照页对应代码；role=target 才是改动对象。目标页可能为 0，此时按参照新建页面。参照对照模式：目标标注的 pairIds 是它参照的全部参照标注（pairId 是第一条，兼容旧用法），pairedTargets 是这条参照被哪几条目标引用。改一处可以同时参照多处；markdown 里每个目标下面都有一行「参照：R1-1、R2-2 的配色、圆角」，照着改即可。",
				parameters: TOOL_PARAMETERS,
				timeoutMs: 90000,
				output: {
					schema: TOOL_OUTPUT_SCHEMA,
					render: (_args, value) => {
						const blocks = [{ type: 'text', text: String(value?.markdown ?? JSON.stringify(value, null, 2)) }];
						for (const item of value?.attachments ?? []) {
							if (item?.ref) blocks.push({ type: 'image', attachment: item.ref });
						}
						return blocks;
					},
				},
				execute: async (args) => {
					const shots = normalizeShots(args?.shots);
					const waitSeconds = Math.max(0, Math.min(60, Number(args?.wait_seconds) || 0));
					const deadline = waitSeconds > 0 ? Date.now() + waitSeconds * 1000 : 0;
					// Push-style substitute: poll until a pick arrives past the previous
					// read instead of returning unchanged snapshots. Skipped entirely when
					// the browser is not running — nothing can arrive then.
					while (
						deadline > 0 &&
						picker.state.status === 'ready' &&
						picker.state.picks.length <= lastReadCount &&
						Date.now() < deadline
					) {
						await sleep(400);
					}
					// Includes picks already inserted: a chip keeps its id, and the agent may
					// be asked about that id long after the panel list moved on.
					const pages = picker.state.pages ?? [];
					const all = picker.readablePicks().map((pick) => {
						const pageKey = pick.pageKey || pageKeyOf(pick.url);
						const role = pickRoleOf(pick, pages);
						return {
							id: pick.id,
							selector: pick.selector,
							tag: pick.tag,
							text: pick.text,
							comment: pick.comment,
							shotPath: pick.shotPath ?? null,
							url: pick.url,
							pageRect: pick.pageRect ?? null,
							role,
							roleSource: pick.roleSource ?? 'page',
							pageKey,
							pageTitle: pick.pageTitle ?? '',
							refLabel: role === 'reference' ? refLabelOf(pages, pageKey) : '',
							spec: pick.spec ?? [],
							included: pick.included !== false,
							referenced: Boolean(pick.referencedAt),
							resend: isResend(pick),
							pageClosed: Boolean(pick.pageClosed),
							pairId: pick.pairId == null ? null : String(pick.pairId),
							// 这条目标参照的全部参考（一条改法可以同时照多处：版式照 A、配色照 B）。
							pairIds: pairIdsOf(pick),
							// 参考标注被哪几条目标标注引用：agent 才知道一条规范要落到几处。
							pairedTargets: pairedTargetsOf(picker.readablePicks(), pick.id),
						};
					});
					lastReadCount = all.length;
					// Reference mode: the composer only carries [标注 #pN] markers, so the
					// tool must be able to fetch exactly the referenced subset.
					const wanted = Array.isArray(args?.ids) ? args.ids.map((id) => String(id)) : null;
					// roles: 'target' | 'reference' | 'all' 或数组；缺省全部。
					const roleArg = args?.roles;
					const roleList = Array.isArray(roleArg)
						? roleArg.map((role) => String(role))
						: roleArg == null || roleArg === 'all'
							? null
							: [String(roleArg)];
					let picks = wanted && wanted.length ? all.filter((pick) => wanted.includes(pick.id)) : all.slice();
					if (roleList && roleList.length) {
						const allowed = new Set(roleList.map((role) => (role === 'ref' ? 'reference' : role)));
						picks = picks.filter((pick) => allowed.has(pick.role));
					}
					const attachments = await saveShotAttachments(ctx, picks, shots);
					return {
						ok: true,
						count: picks.length,
						rev: HOST_REV,
						markdown: wanted && wanted.length ? filteredPicksMarkdown(picks) : picker.toMarkdown(),
						picks,
						attachments,
					};
				},
			});
			disposers.push(dispose);
			toolReady = true;
		} catch (error) {
			toolError = String(error?.stack ?? error?.message ?? error);
			ctx.logger?.warn?.(`dsh-annotator: tool registration failed: ${toolError}`);
		}
	};
	// The tools service can be provided after this plugin applies. Probing once
	// used to drop the tool silently, so wait for the service instead.
	const tools = ctx.get?.('tools');
	if (tools?.register) registerTool(tools);
	else ctx.inject?.(['tools'], (toolsCtx) => registerTool(toolsCtx.get?.('tools')));
}

export default { name, inject, apply };

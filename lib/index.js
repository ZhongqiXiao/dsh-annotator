/**
 * dsh-visual-annotator — host half.
 *
 * Registers the HTTP surface the Web panel talks to (same-origin fetch on the
 * DSH web server) plus one agent-facing tool, and owns the visible Chrome/Edge
 * window driven over the CDP pipe.
 */

import fs from 'node:fs';

import { VisualPicker, availableBrowsers } from './session.js';

export const name = 'dsh-visual-annotator';
export const inject = ['webServer'];

const ROUTE_PREFIX = '/api/visual-annotator';
/** Proves which build of the host half is live in the running DSH. */
const HOST_REV = 'v8-' + Date.now();
/** Populated when ctx.tools.register rejects the definition; surfaced by /state. */
let toolError = null;

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
			ctx.logger?.warn?.(`dsh-visual-annotator: connection admission failed: ${String(error?.message ?? error)}`);
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

/** Markdown for an id-filtered pick subset (same shape as VisualPicker.toMarkdown). */
export function filteredPicksMarkdown(picks) {
	if (!picks.length) return '（没有匹配 id 的页面元素标注）';
	const lines = [`页面元素标注（${picks.length} 处）`];
	picks.forEach((pick, index) => {
		lines.push(
			'',
			`${index + 1}. \`${pick.selector || pick.tag}\` — ${pick.tag}${pick.text ? `：${pick.text.replace(/\s+/g, ' ').slice(0, 80)}` : ''}`,
		);
		if (pick.url) lines.push(`   页面：${pick.url}`);
		if (pick.pageRect)
			lines.push(
				`   位置：x=${Math.round(pick.pageRect.x)} y=${Math.round(pick.pageRect.y)} ${Math.round(pick.pageRect.width)}×${Math.round(pick.pageRect.height)}`,
			);
		if (pick.comment) lines.push(`   评论：${pick.comment}`);
		if (pick.shotPath) lines.push(`   截图：${pick.shotPath}`);
	});
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
			ctx.logger?.warn?.(
				`dsh-visual-annotator: shot attachment failed for ${pick.id}: ${String(error?.message ?? error)}`,
			);
		}
	}
	return attachments;
}

export function apply(ctx) {
	const picker = new VisualPicker();
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
		void picker.close();
	};
	ctx.effect?.(() => teardown);

	const mount = (rawServer) => {
		const server = rawServer?.register ? rawServer : ctx.get?.('webServer');
		if (!server || typeof server.register !== 'function') {
			ctx.logger?.warn?.('dsh-visual-annotator: webServer service unavailable, panel routes not mounted');
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
			const snapshot = picker.snapshot();
			sendJson(res, 200, {
				ok: true,
				...snapshot,
				rev: HOST_REV,
				file: import.meta.url,
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

		route('/clear', async (_req, res) => {
			const snapshot = picker.clear();
			sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
		});

		route('/close', async (_req, res) => {
			const snapshot = await picker.close();
			sendJson(res, 200, { ok: true, ...snapshot, markdown: picker.toMarkdown() });
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

	try {
		const tools = ctx.get?.('tools');
		if (tools?.register) {
			const dispose = tools.register({
				name: 'visual_annotator_read',
				description:
					"读取用户在 Visual Picker 面板里对网页元素的标注（CSS 选择器、元素文本、评论、截图路径）。用户说“看我的标注/元素标注/截图”时先调用。当用户消息中出现「[标注 #pN]」引用标记时必须调用本工具，并用 ids 参数只取对应标注。返回 markdown、picks 列表，并按 shots 参数把元素截图作为图片附件内联。参数 shots：'none' 不带截图；'all' 内联全部；正整数 n=只内联最近 n 张；缺省内联最近 3 张。参数 wait_seconds（0-60，默认 0）：浏览器运行中且自上次读取后没有新标注时轮询等待，出现新标注或超时立即返回，可替代轮询实现“用户标注完成即推送”。",
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {
						ids: {
							type: 'array',
							items: { type: 'string' },
							description:
								'只返回这些 id 的标注（如 ["p1","p3"]）；配合用户消息里的「[标注 #pN]」引用标记使用。缺省返回全部。',
						},
						shots: {
							type: ['string', 'integer'],
							description: "内联截图控制：'none' 不带截图；'all' 全部；正整数 n=最近 n 张；缺省最近 3 张。",
						},
						wait_seconds: {
							type: 'integer',
							description: '等待新标注秒数 0-60（默认 0）：无新 pick 时轮询等待，出现新 pick 或超时返回。',
						},
					},
				},
				timeoutMs: 90000,
				output: {
					schema: {
						type: 'object',
						required: ['ok'],
						additionalProperties: false,
						properties: {
							ok: { type: 'boolean' },
							count: { type: 'integer' },
							rev: { type: 'string' },
							markdown: { type: 'string' },
							picks: {
								type: 'array',
								items: {
									type: 'object',
									additionalProperties: false,
									properties: {
										id: { type: 'string' },
										selector: { type: 'string' },
										tag: { type: 'string' },
										text: { type: 'string' },
										comment: { type: 'string' },
										shotPath: { type: ['string', 'null'] },
										url: { type: 'string' },
										pageRect: { type: ['object', 'null'] },
									},
								},
							},
						},
						attachments: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									pickId: { type: 'string' },
									ref: { type: 'object' },
								},
							},
						},
					},
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
					const all = picker.state.picks.map((pick) => ({
						id: pick.id,
						selector: pick.selector,
						tag: pick.tag,
						text: pick.text,
						comment: pick.comment,
						shotPath: pick.shotPath ?? null,
						url: pick.url,
						pageRect: pick.pageRect ?? null,
					}));
					lastReadCount = all.length;
					// Reference mode: the composer only carries [标注 #pN] markers, so the
					// tool must be able to fetch exactly the referenced subset.
					const wanted = Array.isArray(args?.ids) ? args.ids.map((id) => String(id)) : null;
					const picks = wanted && wanted.length ? all.filter((pick) => wanted.includes(pick.id)) : all;
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
		}
	} catch (error) {
		toolError = String(error?.stack ?? error?.message ?? error);
		ctx.logger?.warn?.(`dsh-visual-annotator: tool registration failed: ${toolError}`);
	}
}

export default { name, inject, apply };

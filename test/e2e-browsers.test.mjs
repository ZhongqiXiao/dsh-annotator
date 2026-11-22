/**
 * 端到端用例：真的把浏览器拉起来，按用户的使用顺序走一遍。
 *
 * 默认不跑（node --test 会在 CI 里跳过），因为要真的 spawn 浏览器、开窗口/无头进程，
 * 机器上没有浏览器时只能静默通过，那还不如明确 skip。开启方式：
 *
 *   npm run test:e2e     # = E2E=1 + HEADLESS=1
 *
 * 宿主自身带沙箱时（本会话就是），Chrome 的浏览器进程会立刻 SIGTRAP、CDP
 * socket 在握手后关闭。插件现在自己认这个签名并带 `--no-sandbox` 重试一次
 * （见 `shouldTrySandboxFallback`），所以用例不需要再传任何开关——这里跑的
 * 正是产品路径上的那段回退逻辑。ego lite 自带 `--no-sandbox`，不会触发。
 *
 * 用例退出时必须不留进程与临时目录：`teardown` 按 profile 目录 pkill（连
 * helper 子进程一起），末尾的 `after` 再把本条用例的目录兜一遍。
 *
 * 覆盖的是「浏览器 × 启动/复用/切换/空间」这些只有真浏览器才能证明的行为：
 * - 启动后状态、可执行文件、拾取层真的注入
 * - 同址不重复开标签、新址新开标签
 * - 断开连接（保留窗口）后再启动，接回的是同一个实例（页面里的标记还在）
 * - 换浏览器：旧窗口关掉、新实例起来
 * - 调试空间：cookie 隔离、标签条按空间过滤、关闭后回默认空间
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { VisualPicker, availableBrowsers } from '../lib/session.js';

const ENABLED = process.env.DSH_VISUAL_ANNOTATOR_E2E === '1';
const LABELS = { chrome: 'Chrome', edge: 'Edge', ego: 'ego lite' };
const OVERLAY_ROOT = '__dsh-vp-root';

/** /text 页面上的长文案：4800 字，远超页面脚本 4000 字的采集上限，用来验证截断与真实字数上报。 */
const LONG_TEXT = '这是一段很长的产品文案。'.repeat(400);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeout = 8000, interval = 100, what = '条件' } = {}) {
	const deadline = Date.now() + timeout;
	for (;;) {
		if (await predicate()) return true;
		if (Date.now() > deadline) throw new Error('等待超时：' + what);
		await sleep(interval);
	}
}

/** 一个真实的本机站点：/cookie 会种 cookie，其余地址是普通页面。 */
async function withServer(run) {
	const server = http.createServer((req, res) => {
		res.setHeader('content-type', 'text/html; charset=utf-8');
		if (String(req.url).startsWith('/cookie')) res.setHeader('set-cookie', 'scope=canvas; Path=/');
		const long = String(req.url).startsWith('/text') ? '<p id="long">' + LONG_TEXT + '</p>' : '';
		res.end('<!doctype html><meta charset="utf-8"><title>e2e ' + req.url + '</title><h1 id="h">hello</h1>' + long);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const base = 'http://127.0.0.1:' + server.address().port;
	try {
		return await run(base);
	} finally {
		server.close();
	}
}

/** 本条用例建过的目录：teardown 之后 `after` 还要再兜一遍。 */
const createdDirs = [];

function makePicker(options = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-e2e-'));
	createdDirs.push(dir);
	// adoptRunning: false —— 用例必须起自己的实例。ego lite 默认会去接管用户
	// 已经开着的那个窗口（pgrep + lsof 找监听端口），那样断言里的标签数、空间数
	// 就取决于用户当下开着什么，用例会变成"看运气"。
	return { dir, picker: new VisualPicker({ baseDir: dir, adoptRunning: false, ...options }) };
}

/** 在当前活动页面里求值（与 probeOverlay 走同一个 CDP 通道）。 */
async function evaluate(picker, expression) {
	const sessionId = picker.attached.get(picker.activeTargetId);
	assert.ok(sessionId, '当前应有已 attach 的页面');
	const result = await picker._evaluate(expression, sessionId);
	return result?.result?.value ?? null;
}

/**
 * 求值到满足断言为止。新标签刚 attach 时页面可能还在 about:blank 或尚未
 * 执行注入脚本，一次求值的结果不稳定；用户真实操作时也是「等一下再看」。
 */
async function evaluateEventually(picker, expression, check, what) {
	let last;
	await waitFor(
		async () => {
			try {
				last = await evaluate(picker, expression);
			} catch {
				return false;
			}
			return check(last);
		},
		{ what },
	);
	return last;
}

/**
 * 按 profile 目录杀掉这条用例起的浏览器：主进程、renderer/GPU helper 都会在，
 * 而事后我们手里通常只剩一个目录名（接回外部实例时连 pid 都没有）。
 */
function killByDir(dir) {
	if (!dir) return;
	try {
		execFileSync('pkill', ['-f', dir], { stdio: 'ignore' });
	} catch {
		/* pkill 无匹配时退出码为 1，这正是我们要的结果 */
	}
}

async function teardown(picker, dir) {
	const pid = picker.proc?.pid;
	await picker.close({ terminate: true }).catch(() => {});
	if (pid) await waitFor(() => !alive(pid), { timeout: 5000, what: '浏览器进程退出' }).catch(() => {});
	killByDir(dir);
	// 浏览器退出时还在删自己的临时 profile，rm 会撞上 ENOTEMPTY；重试几次即可。
	try {
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	} catch {
		/* 临时目录残留不影响用例结论 */
	}
}

// 用例抛在 teardown 之前（例如断言失败）时也别留进程：跑完统一按目录清一遍。
after(async () => {
	for (const dir of createdDirs) killByDir(dir);
	await sleep(300);
	for (const dir of createdDirs) {
		try {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		} catch {
			/* 同上 */
		}
	}
});

if (!ENABLED) {
	test('浏览器端到端用例默认跳过（DSH_VISUAL_ANNOTATOR_E2E=1 才真跑）', { skip: true }, () => {});
} else {
	const available = availableBrowsers();
	const installed = Object.keys(available).filter((id) => available[id]);

	test('至少找到一个可启动的浏览器', () => {
		assert.ok(installed.length > 0, '这台机器上没有 Chrome / Edge / ego lite，端到端用例无从验证');
	});

	// CI 用 DSH_VISUAL_ANNOTATOR_E2E_REQUIRE=chrome,edge 声明「这台机器必须有的浏览器」。
	// 没有这条断言时，Edge 没装好会静默降级成「只跑了 Chrome」——CI 是绿的，覆盖是假的。
	const required = String(process.env.DSH_VISUAL_ANNOTATOR_E2E_REQUIRE ?? '')
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);
	test('本平台要求的浏览器都装了（' + (required.join(' / ') || '未声明') + '）', () => {
		const missing = required.filter((id) => !installed.includes(id));
		assert.deepEqual(
			missing,
			[],
			'缺少必需的浏览器：' + missing.join(', ') + '（安装步骤没生效，或路径不在 CANDIDATES 里）',
		);
	});

	for (const browser of installed) {
		const label = LABELS[browser] ?? browser;

		// 2026-11-18 main 上那条「0 !== 1」就是这样来的：默认空间的 context id 猜
		// 错了，真正的页面被当成「别的空间」从标签条里筛掉。这一条把口径钉死：
		// 默认空间的标签条必须和浏览器的真实页面一一对应，猜错也不许丢页面。
		// ego lite 自己会切到独立空间，标签条按空间过滤，这里不对它断言。
		test(label + '：标签条与浏览器真实页面一一对应', async () => {
			if (browser === 'ego') return;
			const { dir, picker } = makePicker();
			try {
				await withServer(async (base) => {
					await picker.launch({ browser, cwd: dir, url: base + '/a' });
					const live = await picker.cdp.send('Target.getTargets');
					const pages = (live.targetInfos ?? []).filter(
						(info) => info.type === 'page' && !String(info.url).startsWith('devtools://'),
					);
					const ids = (tabs) => tabs.map((tab) => tab.targetId).sort();
					assert.deepEqual(ids(picker.snapshot().tabs), ids(pages), '默认空间的标签条应与浏览器真实的页面一致');
					// 模拟老 CDP：没有 defaultBrowserContextId，默认空间只能猜，且猜错了。
					picker.defaultContextId = 'stale-' + Date.now();
					assert.equal(picker.snapshot().tabs.length, pages.length, '默认空间猜错了也不许把页面筛掉');
				});
			} finally {
				await teardown(picker, dir);
			}
		});

		test(label + '：启动 → 拾取层注入 → 标签复用 → 断开后接回同一实例', async () => {
			const { dir, picker } = makePicker();
			try {
				await withServer(async (base) => {
					const first = await picker.launch({ browser, cwd: dir, url: base + '/a' });
					assert.equal(first.status, 'ready', '启动后应 ready');
					assert.equal(first.browser, browser);
					assert.equal(first.executable, available[browser], '应使用注册表里的可执行文件');
					await evaluateEventually(
						picker,
						'!!document.getElementById("' + OVERLAY_ROOT + '")',
						(value) => value === true,
						'拾取层注入',
					);

					// 页面里的悬浮菜单必须真的可见：.hud 在 CSS 里是 display:none，
					// 少了 render() 里那行就会连胶囊一起隐身，用户只能盲按快捷键。
					// 启动后默认自动进入 pick（lib/shared/auto-pick.js），此时显示的是控制台
					// .cluster，折叠胶囊 .pill 反而是隐藏的——按当前模式挑该显示的那个来断言，
					// 否则一条「自动进入标注模式」的改动会把这条注入用例判成回归。
					await evaluateEventually(
						picker,
						'(() => { const host = document.getElementById("' +
							OVERLAY_ROOT +
							'"); const root = host && host.shadowRoot; const hud = root && root.querySelector(".hud"); const cluster = root && root.querySelector(".cluster"); const pill = root && root.querySelector(".pill"); if (!hud || !cluster || !pill) return null; if (getComputedStyle(hud).display === "none") return false; const on = document.documentElement.classList.contains("__dsh-vp-pick"); return getComputedStyle(on ? cluster : pill).display !== "none"; })()',
						(value) => value === true,
						'HUD 可见',
					);

					const opened = picker.snapshot().tabs.length;
					assert.equal(opened, 1, '第一次打开应只有一个页面');
					await picker.launch({ browser, url: base + '/a' });
					assert.equal(picker.snapshot().tabs.length, opened, '同一地址不应重复开标签');

					await picker.launch({ browser, url: base + '/b' });
					assert.equal(picker.snapshot().tabs.length, opened + 1, '新地址应新开标签');

					// 断开连接：窗口和页面必须留着，否则「复用」就是假的。
					// 标记打在当前活动页（/b）上，接回后要能在同一个页面里读到它，
					// 才证明是同一个渲染进程，而不是把页面重新加载了一遍。
					const markedUrl = picker.snapshot().activeUrl;
					await evaluateEventually(picker, '(window.__vpMark = 42)', (value) => value === 42, '页面可求值');
					await picker.close();
					const kept = picker.snapshot();
					assert.equal(kept.status, 'idle');
					assert.equal(kept.windowKept, true, '缺省 close 应只断开、保留窗口');

					await picker.launch({ browser, cwd: dir, url: base + '/a' });
					const resumed = picker.snapshot();
					assert.equal(resumed.status, 'ready');
					assert.equal(resumed.resumed, true, '应接回已有实例，而不是新起进程');
					assert.equal(resumed.tabs.length, opened + 1, '接回后原有标签仍在');

					const marked = resumed.tabs.find((tab) => tab.url === markedUrl);
					assert.ok(marked, '接回后打标记的那个标签还在');
					await picker.activateTab(marked.targetId);
					assert.equal(
						await evaluateEventually(picker, 'window.__vpMark', (value) => value === 42, '标记仍在同一页面'),
						42,
						'页面实例应是同一个（标记还在）',
					);
				});
			} finally {
				await teardown(picker, dir);
			}
		});

		test(label + '：启动即进入标注模式，用户关掉后打开网页仍粘住', async (t) => {
			// ego lite 启动会接管既有窗口，导航语义与 Chrome/Edge 不同（它有自己的
			// 窗口复用用例）；这条验收的是 issue #4 的行为，只在 Chrome/Edge 上跑。
			if (browser === 'ego') return t.skip('ego lite 的窗口接管与导航语义不同，另有用例覆盖');

			const { dir, picker } = makePicker();
			try {
				await withServer(async (base) => {
					const launched = await picker.launch({ browser, cwd: dir, url: base + '/a' });
					assert.equal(launched.mode, 'pick', '启动后应直接进入标注模式，不用再点一次');
					// host 状态对、注入层没跟上时用户看到的还是关着的，所以两边都要验。
					await evaluateEventually(
						picker,
						'(window.__DSH_VP__ || {}).getMode ? window.__DSH_VP__.getMode() : null',
						(value) => value === 'pick',
						'注入层也进入 pick',
					);

					await picker.setMode('off');
					assert.equal(picker.snapshot().mode, 'off');
					// 用户关掉之后打开新网页：不能再被自动打开（要粘住用户的选择）。
					await picker.navigate(base + '/b');
					assert.equal(picker.snapshot().mode, 'off', '用户关掉后打开网页仍应是关的');
					await evaluateEventually(
						picker,
						'(window.__DSH_VP__ || {}).getMode ? window.__DSH_VP__.getMode() : null',
						(value) => value === 'off',
						'新页面也保持关闭',
					);

					// 再手动打开：恢复正常，下一次打开网页照常自动进入。
					await picker.setMode('pick');
					await picker.navigate(base + '/c');
					assert.equal(picker.snapshot().mode, 'pick', '手动再打开后，打开网页应恢复自动进入');
				});
			} finally {
				await teardown(picker, dir);
			}
		});

		// 文案动作（复制整段原文 / 改文案）全在页面脚本里：单测只能断言字符串在，
		// 命中的是不是同一张卡片、剪贴板收到的是不是整段原文、标记有没有跟着标注
		// 落库，只有真点一次才算证明。
		test(label + '：带文字的元素能复制整段原文，改文案标记随标注落库', async (t) => {
			// ego lite 启动会接管既有窗口、页面落在自己的空间里，合成点击打不到它注入
			// 的那一页（且会把后续 ego 用例带脏）；这条在 Chrome/Edge 上验。
			if (browser === 'ego') return t.skip('ego lite 的窗口接管与空间语义不同，文案动作在 Chrome/Edge 上验');

			const { dir, picker } = makePicker();
			try {
				await withServer(async (base) => {
					await picker.launch({ browser, cwd: dir, url: base + '/text' });
					await evaluateEventually(
						picker,
						'!!document.getElementById("' + OVERLAY_ROOT + '")',
						(value) => value === true,
						'拾取层注入',
					);
					// 无头浏览器里 navigator.clipboard 不可写：换成记录器，才能断言复制到的是整段原文。
					await evaluate(
						picker,
						'Object.defineProperty(navigator, "clipboard", { value: { writeText: function (t) { window.__copied = String(t); return Promise.resolve(); } }, configurable: true }); true',
					);
					await picker.setMode('pick');
					const root = 'document.getElementById("' + OVERLAY_ROOT + '").shadowRoot';
					// overlay 在 document 上捕获 pointerdown/click：合成一次与用户相同的点击。
					await evaluate(
						picker,
						'(function(){var el=document.getElementById("long");var r=el.getBoundingClientRect();' +
							'var o={bubbles:true,cancelable:true,clientX:r.x+5,clientY:r.y+5,button:0,buttons:0,pointerId:1,pointerType:"mouse",isPrimary:true};' +
							'el.dispatchEvent(new PointerEvent("pointermove",o));el.dispatchEvent(new PointerEvent("pointerdown",o));' +
							'el.dispatchEvent(new MouseEvent("click",o));return true})()',
					);
					// 引用块只放开头一小段：卡片不能因为正文长就被撑开。
					const quote = await evaluateEventually(
						picker,
						root + '.querySelector(".quote") ? ' + root + '.querySelector(".quote").textContent : null',
						(value) => typeof value === 'string' && value.length > 0,
						'卡片弹出',
					);
					assert.ok(quote.length <= 91, '引用块只放开头 90 字，实际 ' + quote.length);

					await evaluateEventually(
						picker,
						root + '.querySelector(".qacts") ? getComputedStyle(' + root + '.querySelector(".qacts")).display : null',
						(value) => value === 'flex',
						'文案动作行露出',
					);
					await evaluate(picker, root + '.querySelector(".qcopy").click(); true');
					const copied = await evaluateEventually(
						picker,
						'window.__copied || ""',
						(value) => String(value).length > 0,
						'复制动作写完剪贴板',
					);
					assert.equal(copied.length, 4000, '复制的是整段原文（受 4000 字采集上限），实际 ' + copied.length);

					await evaluate(picker, root + '.querySelector(".qedit").click(); true');
					const hint = await evaluateEventually(
						picker,
						root + '.querySelector("textarea") ? ' + root + '.querySelector("textarea").value : null',
						(value) => typeof value === 'string' && value.includes('优化这段文案'),
						'改文案预填改写要求',
					);
					assert.ok(hint.includes('只替换元素里的文字'), '预填要交代只换文字不动结构样式');
					assert.equal(
						await evaluate(picker, root + '.querySelector(".qedit").getAttribute("aria-pressed")'),
						'true',
						'按钮要显示已标记',
					);

					// 卡片上提交：HUD 的完成按钮也带 .pri，必须限定 .card 里的那颗。
					await evaluate(picker, root + '.querySelector(".card button.pri").click(); true');
					await waitFor(() => picker.snapshot().picks.length > 0, { what: '标注落到 host' });
					const pick = picker.snapshot().picks[0];
					assert.equal(pick.textLength, LONG_TEXT.length, '要上报页面真实字数，而不是采集上限');
					assert.equal(pick.textTruncated, true, '超出采集上限要带截断标记');
					assert.equal(pick.textEdit, true, '「改文案」标记要跟着标注走');
					assert.ok(pick.comment.includes('优化这段文案'), '预填的改写要求要作为评论落库');
				});
			} finally {
				await teardown(picker, dir);
			}
		});

		test(label + '：浏览器里新开的标签页会实时出现在标签条', async () => {
			const { dir, picker } = makePicker();
			try {
				await withServer(async (base) => {
					await picker.launch({ browser, cwd: dir, url: base + '/a' });
					const spaceId = picker.snapshot().space;
					const before = picker.snapshot().tabs.length;
					// 关键：这次开页绕开插件自己的 navigate，模拟用户在浏览器里按 ⌘T 新开的
					// 那一页——插件只能靠 Target 发现事件知道它，不该等到下次启动。
					// 用户在浏览器里按 ⌘T 新开的那一页**是前台页**（会把焦点抢过去）；
					// 之前这里写 background: true 是为了不抢焦点，但 headless Edge 下
					// 后台页根本不加载，标题永远回填不上——那是测试造出来的场景，
					// 不是产品缺陷。这里按真实操作建前台页。
					const created = await picker.cdp.send('Target.createTarget', {
						url: base + '/live',
						background: false,
						...(spaceId ? { browserContextId: spaceId } : {}),
					});
					await waitFor(() => picker.snapshot().tabs.some((tab) => tab.targetId === created.targetId), {
						// CI 的 2 vCPU runner 上，spawn 出来的浏览器被抢占时这两个事件
						// （发现新页 / 标题回填）真的会晚到；这里等的是事件本身，放宽窗口
						// 不是掩盖缺陷，而是别把「机器慢」判成「功能坏」。
						timeout: 15000,
						what: '新标签页出现在标签条',
					});
					assert.equal(picker.snapshot().tabs.length, before + 1, '标签条应多出这一页');

					// 标题是异步行生成的：面板不能永远停在 URL 上。
					await waitFor(
						() => {
							const tab = picker.snapshot().tabs.find((item) => item.targetId === created.targetId);
							return tab?.title === 'e2e /live';
						},
						{ timeout: 15000, what: '新标签页的标题回填到标签条' },
					);

					const after = await picker.activateTab(created.targetId);
					assert.equal(
						after.tabs.find((tab) => tab.active)?.targetId,
						created.targetId,
						'面板里点一下应把该页标成当前页（浏览器同时切到前台）',
					);
				});
			} finally {
				await teardown(picker, dir);
			}
		});
		test(label + '：只写域名不带协议也能打开（不是 about:blank）', async () => {
			const { dir, picker } = makePicker();
			try {
				await withServer(async (base) => {
					// 本地站点本身就是 http：把协议去掉，模拟用户在地址栏只敲 127.0.0.1:端口/a。
					const bare = base.replace(/^http:\/\//, '') + '/a';
					const snapshot = await picker.launch({ browser, cwd: dir, url: bare });
					assert.equal(snapshot.status, 'ready');
					assert.equal(snapshot.activeUrl, base + '/a', '裸地址应补成 http:// 并真的打开这一页');
					assert.equal(await evaluate(picker, 'location.href'), base + '/a');
				});
			} finally {
				await teardown(picker, dir);
			}
		});

		test(label + '：调试空间与默认空间的 cookie 互不可见', async () => {
			const { dir, picker } = makePicker();
			try {
				await withServer(async (base) => {
					await picker.launch({ browser, cwd: dir, url: base + '/cookie' });
					await evaluateEventually(
						picker,
						'document.cookie',
						(value) => /scope=canvas/.test(String(value)),
						'默认空间拿到 cookie',
					);

					// 启动后落在哪个空间，cookie 就归哪个空间：ego 会径直进「agent 空间」，
					// Chrome/Edge 是默认空间。基线一律取当前状态，别假设是哪一个。
					const home = picker.snapshot().space;
					const before = picker.snapshot().spaces.length;
					const created = await picker.createSpace({ url: base + '/plain' });
					assert.equal(created.spaces.length, before + 1, '新建后多一个空间');
					assert.equal(created.space.length > 8, true, '应切到新空间');
					assert.equal(created.tabs.length, 1, '标签条只列当前空间的页面');
					assert.doesNotMatch(
						String(await evaluate(picker, 'document.cookie')),
						/scope=canvas/,
						'新空间不应看到默认空间的 cookie',
					);
					await evaluateEventually(
						picker,
						'!!document.getElementById("' + OVERLAY_ROOT + '")',
						(value) => value === true,
						'新空间里拾取层同样注入',
					);

					const back = await picker.useSpace(home);
					assert.equal(back.space, home);
					await evaluateEventually(
						picker,
						'document.cookie',
						(value) => /scope=canvas/.test(String(value)),
						'切回原空间 cookie 仍在',
					);

					const closed = await picker.closeSpace(created.space);
					assert.equal(closed.spaces.length, before, '关闭后空间数回到基线');
					assert.notEqual(closed.space, created.space, '应离开被销毁的空间');
				});
			} finally {
				await teardown(picker, dir);
			}
		});
	}

	if (installed.includes('ego')) {
		// 只用我们自己 spawn 的实例做接管对象：用户日常开着的 ego 里有他的标签与登录态，
		// 用例不该往那儿建空间。第二个 picker 只认这一个端点，也避免跑到别人的浏览器里。
		const owner = makePicker();
		const second = makePicker({ adoptRunning: true });
		test('ego：接管已运行的实例，在其中开自己的空间且不抢对方的浏览器', async () => {
			try {
				await withServer(async (base) => {
					await owner.picker.launch({ browser: 'ego', cwd: owner.dir, url: base + '/a' });
					const pid = owner.picker.proc?.pid;
					assert.ok(pid, '第一个实例应是我们自己 spawn 的');

					// 端口是随机分配的（--remote-debugging-port=0），浏览器把端口写进
					// profile 的 DevToolsActivePort；profile 目录由 picker 自己算出。
					const profileDir = owner.picker.windowProfileDir;
					assert.ok(profileDir, 'spawn 之后应记下 profile 目录');
					const port = await waitForPort(path.join(profileDir, 'DevToolsActivePort'));
					second.picker.egoEndpoints = () => ['http://127.0.0.1:' + port];

					const attached = await second.picker.launch({ browser: 'ego', cwd: second.dir, url: base + '/b' });
					assert.equal(attached.status, 'ready');
					assert.equal(attached.reused, true, '应接管已运行的实例，而不是再起一个');
					assert.equal(attached.resumed, true);
					assert.equal(second.picker.proc, null, '接管时我们不持有进程');
					assert.ok(attached.space, '应切到自己的 agent 空间');
					assert.ok(alive(pid), '原实例仍活着');

					await second.picker.close({ terminate: true });
					assert.ok(alive(pid), '断开接管不能杀掉对方的浏览器');

					const again = await owner.picker.launch({ browser: 'ego', url: base + '/a' });
					assert.equal(again.status, 'ready', '原实例仍可继续使用');
				});
			} finally {
				await teardown(second.picker, second.dir);
				await teardown(owner.picker, owner.dir);
			}
		});
	} else {
		test('ego 复用用例跳过：这台机器没装 ego lite', { skip: true }, () => {});
	}

	if (installed.length >= 2) {
		test('换浏览器：旧实例被关掉，新实例起来', async () => {
			const [firstBrowser, secondBrowser] = installed;
			const { dir, picker } = makePicker();
			try {
				await withServer(async (base) => {
					await picker.launch({ browser: firstBrowser, cwd: dir, url: base + '/a' });
					const oldPid = picker.proc?.pid;
					assert.ok(oldPid, '应是我们自己 spawn 的进程');

					const switched = await picker.launch({ browser: secondBrowser, url: base + '/a' });
					assert.equal(switched.browser, secondBrowser, '应换成新浏览器');
					assert.equal(switched.status, 'ready');
					assert.notEqual(picker.proc?.pid, oldPid, '应是新进程');
					await waitFor(() => !alive(oldPid), { what: '旧浏览器进程退出', timeout: 10000 });
				});
			} finally {
				await teardown(picker, dir);
			}
		});
	} else {
		test('换浏览器用例跳过：这台机器只装了一个浏览器', { skip: true }, () => {});
	}
}

/** 等浏览器写出 DevToolsActivePort 并取出端口（文件首行是端口）。 */
async function waitForPort(file) {
	let port = 0;
	await waitFor(
		() => {
			try {
				port = Number(String(fs.readFileSync(file, 'utf8')).split('\n')[0]);
			} catch {
				return false;
			}
			return Number.isInteger(port) && port > 0;
		},
		{ what: 'DevToolsActivePort 出现', timeout: 15000 },
	);
	return port;
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

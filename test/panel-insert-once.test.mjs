import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { TASK_PLAIN } from '../lib/shared/annotation-markdown.js';

const SOURCE = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
const PICK = { id: 'p4', selector: 'button.primary', comment: '字体太大', text: '提交' };
// 插入草稿的开头就是提示词里的任务句（普通模式：无参照）。
const HEADER = TASK_PLAIN;

/** Minimal hooks runtime: enough of React's contract to mount a panel and run its effects. */
function createRuntime() {
	let current = null;
	let scheduled = false;
	const react = {
		createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
		useState(initial) {
			const i = current.cursor++;
			if (!(i in current.hooks)) current.hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
			const hook = current.hooks[i];
			return [
				hook.value,
				(next) => {
					hook.value = typeof next === 'function' ? next(hook.value) : next;
					current.dirty = true;
					scheduled = true;
				},
			];
		},
		useEffect(fn, deps) {
			const i = current.cursor++;
			const prev = current.hooks[i];
			const same =
				prev &&
				prev.deps &&
				deps &&
				prev.deps.length === deps.length &&
				prev.deps.every((d, k) => Object.is(d, deps[k]));
			if (prev && same) return;
			current.hooks[i] = { deps, cleanup: prev && prev.cleanup, fn, fresh: true };
			current.pending.push(current.hooks[i]);
		},
		useMemo(fn, deps) {
			const i = current.cursor++;
			const prev = current.hooks[i];
			const same =
				prev &&
				prev.deps &&
				deps &&
				prev.deps.length === deps.length &&
				prev.deps.every((d, k) => Object.is(d, deps[k]));
			if (same) return prev.value;
			const value = fn();
			current.hooks[i] = { deps, value };
			return value;
		},
		useRef(value) {
			const i = current.cursor++;
			if (!(i in current.hooks)) current.hooks[i] = { current: value };
			return current.hooks[i];
		},
		useCallback: (fn) => fn,
	};

	async function pump(component, props, rounds = 12) {
		for (let round = 0; round < rounds; round++) {
			scheduled = false;
			current.cursor = 0;
			current.pending = [];
			const tree = component(props);
			for (const effect of current.pending) {
				if (typeof effect.cleanup === 'function') effect.cleanup();
				effect.fresh = false;
				effect.cleanup = effect.fn();
			}
			await new Promise((r) => setImmediate(r));
			await new Promise((r) => setImmediate(r));
			if (!scheduled) return tree;
		}
		throw new Error('panel did not settle');
	}

	function mount(component, props) {
		const inst = { cursor: 0, hooks: [], pending: [], dirty: false };
		const prev = current;
		current = inst;
		const render = () => {
			current = inst;
			return pump(component, props);
		};
		return { render, unmount: () => (current = prev) };
	}

	return { react, mount };
}

function createWindow() {
	const listeners = new Map();
	const store = new Map();
	return {
		listeners,
		__ModuleLoader__: null,
		localStorage: {
			getItem: (k) => (store.has(k) ? store.get(k) : null),
			setItem: (k, v) => store.set(k, String(v)),
			removeItem: (k) => store.delete(k),
		},
		navigator: { platform: 'Win32', userAgent: 'Win32' },
		addEventListener: (type, fn) => {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type).add(fn);
		},
		removeEventListener: (type, fn) => listeners.get(type) && listeners.get(type).delete(fn),
		setTimeout: (_fn) => 0,
		clearTimeout: () => {},
	};
}

function createComposer() {
	let draft = '';
	const textbox = {
		get innerText() {
			return draft;
		},
		textContent: '',
	};
	const inputActions = {
		insertText(text) {
			draft += text;
			return true;
		},
		setDraft(text) {
			draft = text;
			return true;
		},
		captureInsertion: () => ({ from: draft.length, to: draft.length }),
		addAttachments: () => true,
	};
	return { inputActions, textbox, read: () => draft, reset: () => (draft = '') };
}

function loadPanel(window, react) {
	let definition;
	window.__ModuleLoader__ = { load: (next) => (definition = next) };
	const factory = new Function(
		'window',
		'document',
		'fetch',
		'setTimeout',
		'clearTimeout',
		'setInterval',
		'clearInterval',
		'File',
		SOURCE,
	);
	return { defined: () => definition, factory, react };
}

function makeHarness() {
	const window = createWindow();
	const composer = createComposer();
	const document = {
		head: { appendChild() {} },
		getElementById: () => null,
		createElement: () => ({ setAttribute() {}, remove() {}, appendChild() {} }),
		querySelector: (sel) => (sel === '[role="textbox"]' ? composer.textbox : null),
		querySelectorAll: () => [],
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	const harness = { window, composer, document, state: null };
	const fetch = async (url) => {
		if (String(url).endsWith('/state')) {
			const state = Object.assign(
				{ ok: true, status: 'ready', mode: 'pick', picks: [PICK], tabs: [], browsers: {}, markdown: '' },
				harness.state || {},
			);
			return { ok: true, json: async () => state, text: async () => JSON.stringify(state) };
		}
		return { ok: true, json: async () => ({ ok: true }), text: async () => JSON.stringify({ ok: true }) };
	};
	harness.fetch = fetch;
	return harness;
}

function panelFrom(harness, runtime) {
	const { defined, factory, react } = loadPanel(harness.window, runtime.react);
	factory(
		harness.window,
		harness.document,
		harness.fetch,
		setTimeout,
		clearTimeout,
		() => 0,
		() => {},
		class File {},
	);
	const mod = defined().factory((name) => {
		assert.equal(name, 'react');
		return react;
	});
	let component = null;
	const ctx = {
		get: (key) => (key === 'inputTriggers' ? { live: { sources: [] }, registerSource: () => {} } : undefined),
		slots: { register: (spec, comp) => ((component = comp), () => {}) },
		inject: (list, fn) =>
			fn({
				get: (k) =>
					k === 'sidebarRight'
						? { mounted: { subscribe: () => () => {} }, openTab() {} }
						: k === 'sidebarRightTabs'
							? { register: () => () => {} }
							: undefined,
			}),
		effect: (fn) => fn(),
	};
	mod.apply(ctx);
	assert.ok(component, 'panel component registered');
	return { component, mod };
}

/** One physical keypress reaches every mounted panel; the gate must let exactly one insert through. */
async function fireKeydown(harness, keydown, event) {
	for (const fn of keydown) fn(event);
	for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

async function mounts(harness, runtime, count) {
	const { component } = panelFrom(harness, runtime);
	const keydown = () => [...(harness.window.listeners.get('keydown') || [])];
	const list = [];
	for (let i = 0; i < count; i++) {
		list.push(
			runtime.mount(component, {
				ctx: { get: () => undefined },
				inputActions: harness.composer.inputActions,
				sessionId: 's1',
			}),
		);
	}
	for (const m of list) await m.render();
	// let the state fetches land, then render again so listeners bind the loaded picks
	for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
	for (const m of list) await m.render();
	return { keydown, list };
}

test('one Ctrl+Enter inserts once even when the panel is mounted twice', async () => {
	const harness = makeHarness();
	const runtime = createRuntime();
	const { keydown, list } = await mounts(harness, runtime, 2);
	for (const m of list) await m.render();
	const listeners = keydown();
	assert.equal(listeners.length, 2, 'both mounts listen on window');

	await fireKeydown(harness, listeners, { key: 'Enter', ctrlKey: true, preventDefault() {}, target: null });

	const draft = harness.composer.read();
	assert.equal(draft.split(HEADER).length - 1, 1, 'expected one insertion, draft was:\n' + draft);
});

test('reference draft numbers refs over the full list, not the insert subset', async () => {
	const harness = makeHarness();
	// 复现编号错位的场景：页 B 上有一条已引用过（referencedAt 置位、不再重发）的旧参照 p1，
	// 新参照 p2 配给页 A 的改动 p3。插入列表 = [p3, p2]（p1 被 keepRefs 挤掉）。
	// p2 的编号必须按「全部参照」算（R1-2），不能在插入子集里从 1 重数成 R1-1——
	// 那会跟 host 工具侧（annotationMarkdown 按全量编号）看到的两套编号对不上。
	harness.state = {
		mode: 'pick',
		arming: { slot: 'reference' },
		picks: [
			{
				id: 'p1',
				role: 'reference',
				pageKey: 'https://b/1',
				url: 'https://b/1',
				refLabel: 'R1',
				referencedAt: 1,
				included: false,
				comment: '旧参照',
			},
			{ id: 'p2', role: 'reference', pageKey: 'https://b/1', url: 'https://b/1', refLabel: 'R1', comment: '新参照' },
			{ id: 'p3', role: 'target', pageKey: 'https://a/1', url: 'https://a/1', comment: '改动', pairIds: ['p2'] },
		],
	};
	const runtime = createRuntime();
	const { keydown } = await mounts(harness, runtime, 1);
	await fireKeydown(harness, keydown(), { key: 'Enter', ctrlKey: true, preventDefault() {}, target: null });
	const draft = harness.composer.read();
	assert.ok(draft.length > 0, 'expected an insertion, draft was empty');
	assert.ok(draft.includes('[标注 #p2]'), 'draft must carry the new reference, draft:\n' + draft);
	assert.ok(draft.includes('R1-2'), 'new ref must be numbered R1-2 (full-list basis), draft:\n' + draft);
	assert.ok(!draft.includes('R1-1'), 'must not collide with the consumed old ref R1-1, draft:\n' + draft);
});

test('every target keeps its reference rows when one ref is shared by several targets', async () => {
	const harness = makeHarness();
	// 共享参照：两个改动 p2/p3 都参照同一条 p1。草稿里两处改动都要带出 R1-1，
	// 不能只挂在第一处（chips 路径的 claimed 去重曾把后面几处的参照行整行吞掉）。
	harness.state = {
		mode: 'pick',
		arming: { slot: 'reference' },
		picks: [
			{ id: 'p1', role: 'reference', pageKey: 'https://b/1', url: 'https://b/1', refLabel: 'R1', comment: '参照' },
			{ id: 'p2', role: 'target', pageKey: 'https://a/1', url: 'https://a/1', comment: '改动一', pairIds: ['p1'] },
			{ id: 'p3', role: 'target', pageKey: 'https://a/1', url: 'https://a/1', comment: '改动二', pairIds: ['p1'] },
		],
	};
	const runtime = createRuntime();
	const { keydown } = await mounts(harness, runtime, 1);
	await fireKeydown(harness, keydown(), { key: 'Enter', ctrlKey: true, preventDefault() {}, target: null });
	const draft = harness.composer.read();
	assert.ok(draft.includes('对照 1'), 'first target must be numbered, draft:\n' + draft);
	assert.ok(draft.includes('对照 2'), 'second target must be numbered, draft:\n' + draft);
	assert.ok(draft.split('R1-1').length - 1 >= 2, 'both targets must reference R1-1, draft:\n' + draft);
	assert.ok(draft.includes('[标注 #p2]') && draft.includes('[标注 #p3]'), 'both targets inserted, draft:\n' + draft);
});

test('chips path numbers targets by id and keeps shared refs visible (source contract)', () => {
	// Bug1「改动 0」：withComment 是浅拷贝，indexOf 比对象引用永远不中。插入前缀编号必须按 id 查表
	// （渲染层的 targets.indexOf 作用在原始 picks 对象上，引用成立，不算此列）。
	assert.ok(
		!SOURCE.includes("'改动 ' + (targets.indexOf(pick) + 1)"),
		'insert prefix numbering must not rely on indexOf object identity',
	);
	assert.ok(SOURCE.includes('targetSeq['), 'numbering must come from an id-keyed table');
	// Bug2 共享参照：首次出现插 chip，后续改动补「同改动 N」回指行（pick 为 null 的纯文本项）。
	assert.ok(SOURCE.includes('同改动 '), 'shared refs must point back to the first target');
	assert.ok(SOURCE.includes('pick: null'), 'shared-ref backpointer items must be text-only');
	// 插入与校验都要认得纯文本行：跳过 chip，按 chip 项数而不是 seq.length 校验。
	assert.ok(SOURCE.includes('if (!pick) continue;'), 'insertViaChips must skip text-only items');
	assert.ok(!SOURCE.includes('chipCount >= seq.length'), 'chip verification must count chip items only');
});

test('two separate Ctrl+Enter presses are not merged into one', async () => {
	const harness = makeHarness();
	const runtime = createRuntime();
	const { keydown, list } = await mounts(harness, runtime, 2);
	for (const m of list) await m.render();
	const listeners = keydown();

	// Two distinct keydown objects (auto-repeat / double press) must each be honoured; only the
	// same physical event reaching a second mount is a duplicate.
	const first = { key: 'Enter', ctrlKey: true, preventDefault() {}, target: null };
	const second = { key: 'Enter', ctrlKey: true, preventDefault() {}, target: null };
	for (const fn of listeners) fn(first);
	for (const fn of listeners) fn(second);
	for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

	const draft = harness.composer.read();
	assert.equal(draft.split(HEADER).length - 1, 2, 'two presses must insert two blocks, draft was:\n' + draft);
});

test('pair view checkboxes stay hidden until the 批量操作 toggle shows them', async () => {
	const harness = makeHarness();
	harness.state = {
		mode: 'pick',
		arming: { slot: 'reference' },
		// pairView 只在有已打开页面时渲染两栏（否则显示「先打开浏览器」），注入两页。
		pages: [
			{ key: 'https://a/1', title: 'A', url: 'https://a/1' },
			{ key: 'https://b/1', title: 'B', url: 'https://b/1' },
		],
		picks: [
			{ id: 'p1', role: 'target', pageKey: 'https://a/1', url: 'https://a/1', comment: '改动', pairIds: [] },
			{ id: 'p2', role: 'reference', pageKey: 'https://b/1', url: 'https://b/1', refLabel: 'R1', comment: '参照' },
		],
	};
	const runtime = createRuntime();
	const { list } = await mounts(harness, runtime, 1);

	// vdom 树遍历：只找节点，不碰字符串叶子。
	const collect = (node, pred, out = []) => {
		if (!node || typeof node !== 'object') return out;
		if (pred(node)) out.push(node);
		for (const child of node.children || []) collect(child, pred, out);
		return out;
	};
	const classNameStartsWith = (prefix) => (n) =>
		typeof n.props?.className === 'string' && n.props.className.startsWith(prefix);
	const checks = (tree) => collect(tree, classNameStartsWith('vp-check'));
	const batchBtns = (tree) => collect(tree, (n) => Array.isArray(n.children) && n.children.includes('批量操作'));
	const selbars = (tree) => collect(tree, (n) => n.props?.className === 'vp-selbar');

	let tree = await list[0].render();
	assert.equal(checks(tree).length, 0, 'checkboxes must stay hidden by default');
	assert.equal(selbars(tree).length, 0, 'selection bar must stay hidden by default');

	const btns = batchBtns(tree);
	assert.equal(btns.length, 1, 'footer carries exactly one 批量操作 toggle');
	// 位置契约（用户拍板）：批量操作在底部操作行、清空按钮左边。
	const ctaRow = collect(tree, (n) => n.props?.className === 'vp-cta-row')[0];
	const order = (ctaRow.children || []).map((child) => (child.children && child.children[0]) || '');
	assert.ok(order.indexOf('批量操作') >= 0, '批量操作 button is in the footer action row');
	assert.ok(order.indexOf('清空') > order.indexOf('批量操作'), '批量操作 must sit left of 清空');
	btns[0].props.onClick({ stopPropagation() {} });
	tree = await list[0].render();
	assert.equal(checks(tree).length, 2, 'one checkbox per pick after enabling batch mode');

	checks(tree)[0].props.onClick({ preventDefault() {}, stopPropagation() {} });
	tree = await list[0].render();
	assert.equal(selbars(tree).length, 1, 'selection bar appears once something is checked');
	assert.equal(
		collect(tree, (n) => Array.isArray(n.children) && n.children.includes('已选 1 条')).length,
		1,
		'bar must count exactly one selected pick',
	);

	batchBtns(tree)[0].props.onClick({ stopPropagation() {} });
	tree = await list[0].render();
	assert.equal(checks(tree).length, 0, 'checkboxes gone after leaving batch mode');
	assert.equal(selbars(tree).length, 0, 'selection bar gone after leaving batch mode');
});

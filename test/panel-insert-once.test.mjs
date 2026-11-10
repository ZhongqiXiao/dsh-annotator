import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
const PICK = { id: 'p4', selector: 'button.primary', comment: '字体太大', text: '提交' };
const HEADER = '请根据以下标注修改代码：';

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

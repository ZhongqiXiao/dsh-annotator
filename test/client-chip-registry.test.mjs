import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');

const reactStub = {
	createElement: (...args) => ({ args }),
	useState: (value) => [value, () => {}],
	useEffect: () => {},
	useMemo: (factory) => factory(),
	useRef: (value) => ({ current: value }),
	useCallback: (fn) => fn,
};

/**
 * Load the panel script the way the GUI does, into a caller-supplied window.
 *
 * Two loads sharing one window mimic a re-pulled panel script: the first module's
 * registered chip codec survives, the second module is the one that fetches picks.
 */
function loadPanel(window, { fetch } = {}) {
	let definition;
	window.__ModuleLoader__ = { load: (next) => (definition = next) };
	const documentStub = {
		head: { appendChild() {} },
		getElementById: () => null,
		addEventListener() {},
		removeEventListener() {},
	};
	const factory = new Function(
		'window',
		'document',
		'fetch',
		'setTimeout',
		'clearTimeout',
		'setInterval',
		'clearInterval',
		SOURCE,
	);
	factory(
		window,
		documentStub,
		fetch ?? (async () => assert.fail('unexpected fetch')),
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
	);
	return definition.factory((name) => {
		assert.equal(name, 'react');
		return reactStub;
	});
}

function chipRegistry() {
	const sources = [];
	const inputTriggers = { live: { sources }, registerSource: (source) => sources.push(source) };
	const ctx = { get: (key) => (key === 'inputTriggers' ? inputTriggers : undefined) };
	return { sources, ctx };
}

const PICK = { id: 'p4', selector: 'button.primary', comment: '这个字体也需要优化', text: '提交' };

test('a chip inserted before the panel script was re-pulled still expands', async () => {
	const window = {};
	const first = loadPanel(window);
	const { sources, ctx } = chipRegistry();
	first.apply(ctx);
	const codec = sources.find((source) => source.name === 'visual-annotator').codec;

	// The GUI re-pulls the panel (HOST_REV bump); the new module is the one that sees picks.
	loadPanel(window);
	window.__DSH_VP_CHIPS__ = { p4: PICK };

	const text = await codec.serialize('p4');
	assert.match(text, /button\.primary/);
	assert.match(text, /这个字体也需要优化/);
	assert.doesNotMatch(text, /已不在列表/);
});

test('a chip whose pick left the panel list is resolved from the host', async () => {
	const window = {};
	const { sources, ctx } = chipRegistry();
	const seen = [];
	loadPanel(window, {
		fetch: async (url, init) => {
			seen.push(JSON.parse(init.body));
			return { ok: true, text: async () => JSON.stringify({ ok: true, pick: PICK }) };
		},
	}).apply(ctx);
	const codec = sources.find((source) => source.name === 'visual-annotator').codec;

	const text = await codec.serialize('p4');
	assert.deepEqual(seen, [{ id: 'p4' }]);
	assert.match(text, /这个字体也需要优化/);
	assert.equal(window.__DSH_VP_CHIPS__.p4.selector, 'button.primary');
});

test('a chip the host no longer knows names the id to read', async () => {
	const window = {};
	const { sources, ctx } = chipRegistry();
	loadPanel(window, {
		fetch: async () => ({ ok: false, text: async () => JSON.stringify({ ok: false }) }),
	}).apply(ctx);
	const codec = sources.find((source) => source.name === 'visual-annotator').codec;

	const text = await codec.serialize('p7');
	assert.match(text, /ids: \[7\]/);
	assert.match(text, /visual_annotator_read/);
});

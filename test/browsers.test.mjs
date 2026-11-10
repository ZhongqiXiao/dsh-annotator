import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	BROWSER_ENV,
	BROWSER_IDS,
	BROWSER_LABELS,
	availableBrowserIds,
	browserChoices,
	browserLabel,
	defaultBrowserId,
	isBrowserId,
	normalizeBrowserId,
	parseExtraArgs,
	shouldTrySandboxFallback,
} from '../lib/shared/browsers.js';

test('the registry covers chrome, edge and ego lite in that order', () => {
	assert.deepEqual(BROWSER_IDS, ['chrome', 'edge', 'ego']);
	// Every id needs a display name and an override variable, or the panel shows a
	// raw id and the user has no way to point at a non-standard install.
	for (const id of BROWSER_IDS) {
		assert.equal(typeof BROWSER_LABELS[id], 'string');
		assert.ok(BROWSER_LABELS[id].length > 0);
		assert.match(BROWSER_ENV[id], /^DSH_VISUAL_ANNOTATOR_[A-Z]+$/);
	}
	assert.equal(BROWSER_LABELS.ego, 'ego lite');
});

test('unknown ids fall back instead of throwing', () => {
	assert.equal(isBrowserId('ego'), true);
	assert.equal(isBrowserId('firefox'), false);
	assert.equal(isBrowserId(undefined), false);
	// An old panel that still posts "chrome" keeps working; so does a garbage value.
	assert.equal(normalizeBrowserId('chrome'), 'chrome');
	assert.equal(normalizeBrowserId('firefox'), 'chrome');
	assert.equal(normalizeBrowserId(null), 'chrome');
	assert.equal(normalizeBrowserId('firefox', 'edge'), 'edge');
	assert.equal(browserLabel('ego'), 'ego lite');
	// A bad id is labelled as the fallback, never as "undefined".
	assert.equal(browserLabel('firefox'), 'Chrome');
});

test('defaultBrowserId honors an installed preference, then registry order', () => {
	const onlyEgo = { chrome: null, edge: null, ego: '/Applications/ego lite.app/Contents/MacOS/ego lite' };
	assert.equal(defaultBrowserId(onlyEgo), 'ego');
	// Chrome wins over Edge when both are there, matching BROWSER_IDS order.
	assert.equal(defaultBrowserId({ chrome: '/c', edge: '/e' }), 'chrome');
	// A preference only counts when that browser is actually installed.
	assert.equal(defaultBrowserId({ chrome: '/c', edge: '/e' }, 'edge'), 'edge');
	assert.equal(defaultBrowserId({ chrome: '/c' }, 'edge'), 'chrome');
	assert.equal(defaultBrowserId({}, 'edge'), null);
	assert.equal(defaultBrowserId(undefined), null);
});

test('extra browser args only accept switches, never bare words', () => {
	// The default is "nothing extra": the sandboxed flags are opt-in.
	assert.deepEqual(parseExtraArgs(undefined), []);
	assert.deepEqual(parseExtraArgs(''), []);
	assert.deepEqual(parseExtraArgs('--no-sandbox'), ['--no-sandbox']);
	// Comma or whitespace, both are natural ways to write a list in an env var.
	assert.deepEqual(parseExtraArgs('--no-sandbox, --disable-gpu'), ['--no-sandbox', '--disable-gpu']);
	assert.deepEqual(parseExtraArgs('  --foo=bar   --baz  '), ['--foo=bar', '--baz']);
	// A bare word would be treated by Chromium as a URL to open, so drop it.
	assert.deepEqual(parseExtraArgs('https://example.com --no-sandbox'), ['--no-sandbox']);
	assert.deepEqual(parseExtraArgs('--'), []);
});

test('sandbox fallback fires only on a real crash, once, and honours the opt-out', () => {
	// 正常启动不动它：宿主没沙箱时 Chrome 该保留自己的 sandbox。
	assert.equal(shouldTrySandboxFallback({ crashed: false }), false);
	assert.equal(shouldTrySandboxFallback({ crashed: undefined }), false);
	assert.equal(shouldTrySandboxFallback({}), false);
	// 崩了才回退，且默认开启。
	assert.equal(shouldTrySandboxFallback({ crashed: true }), true);
	// 已经带 --no-sandbox 的（ego lite / 上一轮回退过）不再重试，避免死循环。
	assert.equal(shouldTrySandboxFallback({ crashed: true, alreadyNoSandbox: true }), false);
	// 用户显式关掉回退时，宁可报错也不擅自降级。
	assert.equal(shouldTrySandboxFallback({ crashed: true, optOut: true }), false);
});

test('the picker lists uninstalled browsers too, marked unavailable', () => {
	// 没装 Edge 的机器上，选择器里仍要有 Edge 这一项（禁用），否则用户会以为插件不支持。
	const choices = browserChoices({ chrome: '/chrome', edge: null, ego: '/ego' });
	assert.deepEqual(
		choices.map((choice) => [choice.id, choice.label, choice.available]),
		[
			['chrome', 'Chrome', true],
			['edge', 'Edge', false],
			['ego', 'ego lite', true],
		],
	);
	// 一个都没装：仍然全列，只是全部不可选。
	assert.deepEqual(
		browserChoices({}).map((choice) => choice.available),
		[false, false, false],
	);
	assert.deepEqual(browserChoices(undefined, ['ego']), [{ id: 'ego', label: 'ego lite', available: false }]);
});

test('availableBrowserIds keeps registry order and drops missing entries', () => {
	assert.deepEqual(availableBrowserIds({ ego: '/ego', chrome: '/c' }), ['chrome', 'ego']);
	assert.deepEqual(availableBrowserIds({ edge: '/e' }), ['edge']);
	assert.deepEqual(availableBrowserIds({}), []);
	assert.deepEqual(availableBrowserIds(undefined), []);
	// A null path means "not installed" even though the key exists.
	assert.deepEqual(availableBrowserIds({ chrome: null, ego: '' }), []);
});

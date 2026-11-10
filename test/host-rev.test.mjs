import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	checkStaticBuildSync,
	diffHunkNewRanges,
	hunksTouchRanges,
	overlayPayloadRanges,
	parseHostRev,
	parseOverlayRev,
	parsePanelBuild,
} from '../lib/shared/host-rev.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
// The overlay template opens with String.raw<BT>(() => { and closes with })()<BT>;
const BT = String.fromCharCode(96);

test('parseHostRev reads the documented vN- shape', () => {
	assert.deepEqual(parseHostRev("const HOST_REV = 'v28-' + Date.now();"), { value: 'v28-', prefix: 'v28', number: 28 });
	assert.equal(parseHostRev('const HOST_REV = Date.now();'), null);
	assert.equal(parseHostRev(''), null);
});

test('parsePanelBuild and parseOverlayRev read their markers', () => {
	assert.equal(parsePanelBuild("var PANEL_BUILD = 'v28';"), 'v28');
	assert.equal(parsePanelBuild('var PANEL_BUILD = 28;'), null);
	assert.equal(parseOverlayRev('var REV = 12;'), 12);
	assert.equal(parseOverlayRev('var RETHINK = 12;'), null);
});

test('static check accepts the real sources and rejects a skew', () => {
	const ok = checkStaticBuildSync({
		hostSource: read('../lib/index.js'),
		clientSource: read('../lib/client.js'),
		overlaySource: read('../lib/overlay.js'),
	});
	assert.deepEqual(ok.problems, [], '本仓基线必须天然通过静态契约');

	const skewed = checkStaticBuildSync({
		hostSource: "const HOST_REV = 'v29-' + Date.now();",
		clientSource: "var PANEL_BUILD = 'v28';",
		overlaySource: 'var REV = 12;',
	});
	assert.equal(skewed.ok, false);
	assert.equal(skewed.problems[0].code, 'prefix-mismatch');
});

test('overlayPayloadRanges covers BINDING_NAME and the String.raw literal', () => {
	const fixture = [
		'/** header */',
		'export const BINDING_NAME = "__x";',
		'',
		'export const OVERLAY_SCRIPT = String.raw' + BT + '(() => {',
		'  var REV = 3;',
		'})()' + BT + ';',
	].join('\n');
	assert.deepEqual(overlayPayloadRanges(fixture), [
		{ start: 2, end: 2 },
		{ start: 4, end: 6 },
	]);
});

test('diffHunkNewRanges parses git show hunks', () => {
	const patch = ['diff --git a/f b/f', '@@ -1,3 +1,4 @@', ' x', '+y', '@@ -10 +12,2 @@', '+z'].join('\n');
	assert.deepEqual(diffHunkNewRanges(patch), [
		{ start: 1, end: 4 },
		{ start: 12, end: 13 },
	]);
});

test('hunksTouchRanges detects payload touches and ignores header-only edits', () => {
	const payload = [{ start: 14, end: 862 }];
	assert.equal(hunksTouchRanges([{ start: 800, end: 810 }], payload), true);
	assert.equal(hunksTouchRanges([{ start: 1, end: 9 }], payload), false);
	assert.equal(hunksTouchRanges([], payload), false);
});

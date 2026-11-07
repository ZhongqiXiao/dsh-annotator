import assert from 'node:assert/strict';
import test from 'node:test';

import { BINDING_NAME, OVERLAY_SCRIPT } from '../lib/overlay.js';

// OVERLAY_SCRIPT 是一段注入页面的字符串，`node --check lib/overlay.js` 只检查外层模块，
// 里面的内嵌脚本写错不会被发现，所以这里单独编译一次。
test('overlay script compiles as a standalone page script', () => {
	assert.doesNotThrow(() => new Function(OVERLAY_SCRIPT));
});

test('overlay reports picks through the CDP binding name', () => {
	assert.ok(OVERLAY_SCRIPT.includes(BINDING_NAME));
	assert.ok(OVERLAY_SCRIPT.includes('__dsh-vp-root'));
});

// 页面快捷键层会把 shadow 卡片里的按键当成页面快捷键并 preventDefault()，
// 卡片于是「有光标但打不进字」。守卫、defaultPrevented 兜底与版本接管都不能丢。
test('overlay shields card keystrokes and can replace an older instance', () => {
	assert.ok(OVERLAY_SCRIPT.includes('guardCardKeys'));
	assert.ok(OVERLAY_SCRIPT.includes('defaultPrevented'));
	assert.ok(OVERLAY_SCRIPT.includes('rev: REV'));
});

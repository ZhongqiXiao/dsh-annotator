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

// v3：页面内 HUD 控制舱 + 双向模式上报。Esc/暂停/折叠胶囊经 setMode 上报 kind:'mode'，
// 撤销与完成直接发 kind:'undo' / kind:'consume'；host 经 sync() 推回 mode 与计数。
test('overlay v3 reports mode changes and exposes the host sync channel', () => {
	assert.ok(OVERLAY_SCRIPT.includes("kind: 'mode'"));
	assert.ok(OVERLAY_SCRIPT.includes("kind: 'undo'"));
	assert.ok(OVERLAY_SCRIPT.includes("kind: 'consume'"));
	assert.ok(OVERLAY_SCRIPT.includes('sync: function'));
	assert.ok(OVERLAY_SCRIPT.includes('setMode(info.mode, true)'));
});

// badge 升级成了可交互 HUD：pick 模式是控制台，off 模式是右下角折叠胶囊（可重开）。
test('overlay renders an interactive HUD instead of a display-only badge', () => {
	assert.ok(OVERLAY_SCRIPT.includes('class="cluster"'));
	assert.ok(OVERLAY_SCRIPT.includes('class="pill"'));
	assert.ok(!OVERLAY_SCRIPT.includes('.badge{'));
});

// 回归：HUD 完成按钮与卡片提交按钮都带 .pri，提交绑定必须限定 .card，
// 否则 querySelector('.pri') 命中 HUD 按钮而「添加标注」点击无反应。
test('overlay binds the card commit button within the card scope', () => {
	assert.ok(OVERLAY_SCRIPT.includes("querySelector('.card button.pri')"));
	assert.ok(!OVERLAY_SCRIPT.includes("querySelector('.pri')"));
});

// 页面内 Alt+A 直接开关标注模式；macOS 的 Option+A 会把 key 组合成 å，判定必须走
// 物理键 code=KeyA，提示文案按平台显示 ⌥Option+A / Alt+A。
test('overlay supports Alt+A in the page with a platform-aware hint', () => {
	assert.ok(OVERLAY_SCRIPT.includes("e.code === 'KeyA'"));
	assert.ok(OVERLAY_SCRIPT.includes('var HOTKEY = MAC'));
	assert.ok(OVERLAY_SCRIPT.includes("'<span class=\"k\">' + HOTKEY + '</span>'"));
});

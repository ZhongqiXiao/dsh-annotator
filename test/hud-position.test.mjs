import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampHudPosition, parseHudPosition } from '../lib/shared/hud-position.js';

// HUD 被拖出视口就再也点不到，只能刷新页面：这几个用例守的就是「留在看得见的地方」。
test('clampHudPosition keeps the HUD inside the viewport with a margin', () => {
	const bounds = { viewportWidth: 1000, viewportHeight: 800, margin: 8 };
	// 拖到右下角外面：钳到「视口 - 尺寸 - margin」。
	assert.deepEqual(clampHudPosition({ x: 5000, y: 5000, width: 300, height: 60 }, bounds), {
		x: 1000 - 300 - 8,
		y: 800 - 60 - 8,
	});
	// 拖到左上角外面：钳到 margin，不是 0（贴边会顶住圆角与阴影）。
	assert.deepEqual(clampHudPosition({ x: -400, y: -400, width: 300, height: 60 }, bounds), { x: 8, y: 8 });
	// 本来就在里面：一个像素都不动。
	assert.deepEqual(clampHudPosition({ x: 120, y: 240, width: 300, height: 60 }, bounds), { x: 120, y: 240 });
});

test('clampHudPosition leaves the position alone when the viewport is unknown', () => {
	// 初始 render 时 innerWidth 可能是 0（隐藏的 iframe、折叠的窗口）：
	// 这时候把坐标清零，用户存下来的位置就白丢了。
	assert.deepEqual(
		clampHudPosition({ x: 240, y: 180, width: 300, height: 60 }, { viewportWidth: 0, viewportHeight: 0 }),
		{
			x: 240,
			y: 180,
		},
	);
});

test('clampHudPosition sticks to the margin when the HUD is wider than the viewport', () => {
	// 窗口比 HUD 还窄：贴住左上留白，至少把手和左上角还能点到。
	assert.deepEqual(
		clampHudPosition({ x: 0, y: 0, width: 900, height: 60 }, { viewportWidth: 400, viewportHeight: 300 }),
		{
			x: 8,
			y: 8,
		},
	);
});

test('parseHudPosition rejects junk instead of sending the HUD to the top-left corner', () => {
	assert.equal(parseHudPosition(null), null);
	assert.equal(parseHudPosition(''), null);
	assert.equal(parseHudPosition('not json'), null);
	assert.equal(parseHudPosition('null'), null);
	assert.equal(parseHudPosition('[]'), null);
	assert.equal(parseHudPosition('{"x":"a","y":2}'), null);
	assert.equal(parseHudPosition('{"x":1}'), null);
	assert.deepEqual(parseHudPosition('{"x":12.4,"y":-3}'), { x: 12.4, y: -3 });
});

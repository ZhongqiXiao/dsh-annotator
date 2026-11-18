import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');

// 用户反馈「面板中的截图无法点击放大，包括普通模式和对照模式都不能点击放大了」。
// 根因：v10 的 UX 改版把普通卡缩略图的 onClick 从「打开大图」换成了「在页面中定位」，
// 两栏卡的小图则从来没有点击处理。缩略图只有 96×72（两栏里 54×36），细节全靠放大。
// 这几条断言守住「点缩略图 = 开原生 dialog 大图」的契约，别再被「顺手改成定位」吃掉。

test('普通卡缩略图点开放大层，定位走独立的定位按钮', () => {
	assert.ok(
		CLIENT.includes("? openShotViewer(pick.shotUrl, '标注 #' + (index + 1)"),
		'普通卡缩略图的 onClick 调用 openShotViewer',
	);
	assert.ok(CLIENT.includes("title: pick.shotUrl ? '点击放大截图' : '无截图'"), '悬停提示写明点击放大');
	assert.ok(CLIENT.includes("'aria-label': '放大截图'"), '缩略图有无障碍名');
	assert.ok(!CLIENT.includes('onClick: () => (pick.shotUrl ? focusPick(pick.id) : null)'), '旧的「点图即定位」已移除');
	// 放大不等于砍掉定位：卡片头部的目标图标仍是定位入口。
	assert.ok(CLIENT.includes("'aria-label': '在浏览器中定位',"), '定位按钮仍在');
	assert.ok(CLIENT.includes('onClick: () => focusPick(pick.id),'), '定位仍调 focusPick');
});

test('两栏卡的小图也能点开：role=button、可聚焦、Enter/Space 同样放大', () => {
	assert.ok(CLIENT.includes("className: 'vp-cell-shot',"), '小图容器还在');
	assert.ok(
		CLIENT.includes(
			"var shotLabel = (role === 'reference' ? '参照 ' : '改动 ') + code + ' · ' + String(pick.tag || '元素');",
		),
		'放大标题带栏位与编号',
	);
	assert.ok(CLIENT.includes("title: '点击放大截图',"), '两栏小图提示点击放大');
	assert.ok(CLIENT.includes('onClick: (event) => {'), '小图有点击处理');
	assert.ok(CLIENT.includes('event.stopPropagation();'), '点小图不该顺带展开整卡');
	assert.ok(CLIENT.includes('openShotViewer(pick.shotUrl, shotLabel);'), '点击与小键盘都开放大层');
	assert.ok(CLIENT.includes("if (event.key !== 'Enter' && event.key !== ' ') return;"), '键盘可达');
});

// 放大层必须进 top layer：面板根 .vp-root 是 container-type:inline-size 的容器
// （布局包含 = fixed 定位的包含块），又在侧栏 overflow 里，放里面永远只有侧栏那么宽。
test('放大层挂在 document.body 上并用 dialog.showModal() 进 top layer', () => {
	assert.ok(CLIENT.includes("document.createElement('dialog')"), '用原生 dialog');
	assert.ok(CLIENT.includes("dialog.className = 'vp-shotview';"), '挂上放大层类名');
	assert.ok(CLIENT.includes('document.body.appendChild(dialog);'), '挂在 body 上，不进 .vp-root');
	assert.ok(CLIENT.includes('dialog.showModal();'), '进 top layer');
	assert.ok(CLIENT.includes("dialog.setAttribute('open', '');"), '无 showModal 时退回普通层');
	assert.ok(CLIENT.includes('.vp-shotview{position:fixed;inset:0;width:100vw'), '样式覆盖整个窗口');
	assert.ok(CLIENT.includes('.vp-shotview::backdrop{background:rgba(9,11,15,.86)}'), '有背景遮罩');
	assert.ok(CLIENT.includes('max-height:calc(100vh - 84px)'), '大图按窗口高度缩放，不撑出屏幕');
});

test('放大层可点任意处、Esc、关闭按钮三种方式退出，面板卸载时不留尸体', () => {
	assert.ok(CLIENT.includes("dialog.addEventListener('click', closeShotViewer);"), '点任意处关闭');
	assert.ok(CLIENT.includes("dialog.addEventListener('cancel'"), 'Esc 由 cancel 事件接管');
	assert.ok(CLIENT.includes("close.setAttribute('aria-label', '关闭截图预览');"), '关闭按钮有无障碍名');
	assert.ok(CLIENT.includes("hint.textContent = '点任意处或按 Esc 关闭';"), '写明退出方式');
	assert.ok(CLIENT.includes('// 面板卸载时别把放大层留在 body 上'), '清理时机有注释说明');
	assert.ok(CLIENT.includes('.vp-cell-shot{cursor:zoom-in}'), '两栏小图光标提示可放大');
});

test('同一时刻只留一层放大视图', () => {
	assert.ok(CLIENT.includes('if (!src) return;'), '没有截图就不开');
	assert.ok(CLIENT.includes('closeShotViewer();'), '开新层前先收掉旧层');
});

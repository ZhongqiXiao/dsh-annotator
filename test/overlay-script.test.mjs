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
// 角色徽标已撤掉：落点由 seg 的选中态与圆点颜色表达，同一行再挂一个「参考 R2」只是重复。
test('overlay renders an interactive HUD instead of a display-only badge', () => {
	assert.ok(OVERLAY_SCRIPT.includes('class="cluster"'));
	assert.ok(OVERLAY_SCRIPT.includes('class="pill"'));
	assert.ok(OVERLAY_SCRIPT.includes('<span class="met">'), '本页计数与控制台同排');
	assert.ok(OVERLAY_SCRIPT.includes('class="seg-b t"'), '落点开关在控制台里');
	assert.ok(!OVERLAY_SCRIPT.includes('<span class="badge"></span>'), '角色徽标已移除');
});

// 回归：.hud button 这种宽选择器会把 .seg 里的两段按钮也画成带边框的普通按钮，
// 落点开关于是变成两个互不相干的按钮、seg 底槽被撑破。按钮样式必须只挂在「栏的直接子按钮」上。
test('overlay scopes HUD button styles to the bars, not the landing switch', () => {
	assert.ok(OVERLAY_SCRIPT.includes('.hud .cluster>button,.hud .pill>button{'), '按钮样式按栏限定');
	assert.ok(!OVERLAY_SCRIPT.includes('.hud button{'), '别再用 .hud button 的宽选择器');
	assert.ok(OVERLAY_SCRIPT.includes('.seg-b{display:inline-flex'), '两段按钮自己一套几何');
	assert.ok(OVERLAY_SCRIPT.includes('height:22px'), '两段按钮比 28px 的按钮矮一档，正好嵌进 seg 底槽');
});

// 回归：.hud 容器在 CSS 里是 display:none 的初始态，若 render() 不打开它，
// 整块悬浮菜单（胶囊/控制台）永远不可见——键盘用户只能盲按 Alt+A。
test('overlay unhides the HUD container on render', () => {
	assert.ok(OVERLAY_SCRIPT.includes("nodes.hud.style.display = 'block'"));
});

// 回归：HUD 完成按钮与卡片提交按钮都带 .pri，提交绑定必须限定 .card，
// 否则 querySelector('.pri') 命中 HUD 按钮而「添加标注」点击无反应。
test('overlay binds the card commit button within the card scope', () => {
	assert.ok(OVERLAY_SCRIPT.includes("querySelector('.card button.pri')"));
	assert.ok(!OVERLAY_SCRIPT.includes("querySelector('.pri')"));
});

// 回归：render() 会清掉 hover 高亮框，点完元素后如果不另画一个常亮框，
// 用户打字时就看不出自己标的是哪个元素。
test('overlay keeps the picked element highlighted while the card is open', () => {
	assert.ok(OVERLAY_SCRIPT.includes('class="mark"'));
	assert.ok(OVERLAY_SCRIPT.includes('showMark(state.target.rect)'));
	assert.ok(OVERLAY_SCRIPT.includes("nodes.mark.style.display = 'none'"));
});

// 卡片是 fixed 定位，页面滚动/改窗口后不跟就会停在已经无关的位置上。
test('overlay follows the target on scroll and resize', () => {
	assert.ok(OVERLAY_SCRIPT.includes("on(W, 'scroll', followTarget, true)"));
	assert.ok(OVERLAY_SCRIPT.includes("on(W, 'resize', followTarget, false)"));
	assert.ok(OVERLAY_SCRIPT.includes('state.targetEl'));
});

// 卡片可能贴在元素上方或下方，尖角与朝向类必须一起决定，否则尖角会指错方向。
// 早先下方放不下就取 top = max(8, rect.y - h - 8)：目标贴着视口顶部、或者目标本身
// 是一大块时 top 落到 8，卡片整张跳到视口左上角并盖住刚点的元素——用户报的
// 「标注框跳到左上角、形状被遮挡」。现在先夹进视口再摆，朝向按实际几何决定，
// 与目标在水平方向都不重叠时干脆不画尖角。
test('overlay picks the card side and aims the notch at the element', () => {
	assert.ok(OVERLAY_SCRIPT.includes('var clampTop = function (y)'));
	assert.ok(
		OVERLAY_SCRIPT.includes('var top = clampTop(below ? rect.y + rect.height + gap : rect.y - h - gap);'),
		'上下两个落点都要夹进视口，别让 top 落到 8 这种角落值',
	);
	assert.ok(!OVERLAY_SCRIPT.includes('Math.max(8, rect.y - h - 8)'), '不许再回落到左上角的旧 clamp');
	assert.ok(OVERLAY_SCRIPT.includes("card.style.setProperty('--vp-notch'"));
	assert.ok(OVERLAY_SCRIPT.includes('var intersectsX = left + w > rect.x && left < rect.x + rect.width;'));
	assert.ok(OVERLAY_SCRIPT.includes("card.classList.toggle('below', intersectsX && top >= rect.y + rect.height - 1)"));
	assert.ok(OVERLAY_SCRIPT.includes("card.classList.toggle('above', intersectsX && top + h <= rect.y + 1)"));
});

// 页面内 Alt+A 直接开关标注模式；macOS 的 Option+A 会把 key 组合成 å，判定必须走
// 物理键 code=KeyA，提示文案按平台显示 ⌥ A / Alt A。
test('overlay supports Alt+A in the page with a platform-aware hint', () => {
	assert.ok(OVERLAY_SCRIPT.includes("e.code === 'KeyA'"));
	assert.ok(OVERLAY_SCRIPT.includes('var HOTKEY = MAC'));
	assert.ok(OVERLAY_SCRIPT.includes("'<span class=\"k\">' + HOTKEY + '</span>'"));
});

// 落点切换（⌥R / Alt+R）与标注开关同一套判定：按物理键 code，不分平台写两遍；
// 输入法组合中（Windows 的 Alt 组合、中文输入法）必须让键，不能抢走用户的候选框操作。
test('overlay supports Alt+R for the landing switch on every platform', () => {
	assert.ok(OVERLAY_SCRIPT.includes("e.code === 'KeyR'"), 'Alt+R 走物理键判定，Windows 与 macOS 共用');
	assert.ok(OVERLAY_SCRIPT.includes("var HOTKEY_R = MAC ? '⌥ R' : 'Alt+R'"), '非 Mac 提示写 Alt+R');
	assert.ok(OVERLAY_SCRIPT.includes('e.isComposing || e.keyCode === 229'), '输入法组合中不抢键');
});

// 普通模式下不展开 HUD 也得能把已有标注拿走：折叠胶囊里要有「复制提示词」，
// 而且同样能换落点——否则普通模式就只能「只能标、不能带走」。
// 提示词内容由 host 生成（与面板复制、工具输出同一份），页面只负责放进剪贴板：
// 页面自己再拼一遍，就是第三份会漂移的实现。
test('overlay copies the host prompt and switches landing from the collapsed pill too', () => {
	assert.ok(OVERLAY_SCRIPT.includes('class="cp"'), '控制台与胶囊各有一个复制按钮');
	assert.ok(OVERLAY_SCRIPT.includes('class="pill-main"'), '胶囊拆成容器：里面有开启标注与复制两个动作');
	assert.ok(OVERLAY_SCRIPT.includes('function copyPrompt()'));
	assert.ok(OVERLAY_SCRIPT.includes('state.prompt = info.prompt'), '提示词由 host 下发，页面不自己拼');
	assert.ok(OVERLAY_SCRIPT.includes("e.code === 'KeyC'"), 'Alt+C 也能复制');
	assert.ok(OVERLAY_SCRIPT.includes('function legacyCopy(text)'), 'http 页面剪贴板不可用时要有退路');
	// 落点开关在胶囊里也有一份，事件委托必须挂在 .hud 上，挂 .cluster 会漏掉胶囊。
	assert.ok(OVERLAY_SCRIPT.includes("on(nodes.hud, 'click', function (e) {"), '落点委托覆盖控制台与胶囊');
	assert.ok(!OVERLAY_SCRIPT.includes("on(nodes.cluster, 'click', function (e) {"), '别只绑在控制台上');
});

// setLanding 曾经调用一个从不存在的局部 flash()：换落点当场抛 ReferenceError，
// 提示条与随后的 flush 一起被吞（落点其实换了，但用户看不到任何反馈）。
// 现在页面里只有一份 flash 实现，对外 API 委托它——文字断言守住"引用必须指向已定义的函数"。
test('overlay defines the flash helper it calls', () => {
	assert.ok(OVERLAY_SCRIPT.includes('function flash(message)'), 'flash 必须有实现');
	assert.ok(OVERLAY_SCRIPT.includes('    flash: flash'), '对外 API 委托同一份实现，别各写一遍');
	assert.equal(OVERLAY_SCRIPT.split('function flash(message)').length - 1, 1, '只允许一份实现');
});

// 提交快捷键曾经把「⌘↵」塞进同一个键帽，两个字形挤在 20px 方块里糊成一团，
// 用户反馈看不清。现在拆成并排的独立键帽，且键名按平台给：Mac 显示 ⌘ / ⏎，
// Windows 与 Linux 显示 Ctrl / Enter——给非 Mac 用户画一个 ↵ 是 Mac 键盘才有的符号。
// Mac 用 ⏎（U+23CE）而不是 ↵（U+21B5）：后者在 12px 等宽字体里细得看不出是个键。
test('overlay splits the commit shortcut into platform-aware keycaps', () => {
	assert.ok(OVERLAY_SCRIPT.includes('class="keys"'));
	assert.ok(OVERLAY_SCRIPT.includes("var keys = MAC ? ['⌘', '⏎'] : ['Ctrl', 'Enter']"));
	assert.ok(OVERLAY_SCRIPT.includes("(k.length === 1 ? ' sym' : '')"));
	assert.ok(!OVERLAY_SCRIPT.includes("'⌘↵'"));
	// 悬停提示同一套键名，别在 Windows 上又冒出 ⌘ Enter
	assert.ok(OVERLAY_SCRIPT.includes("(MAC ? '⌘ Enter' : 'Ctrl Enter')"));
});

// 引用块原来靠左边缘一条 2px 橙线示意"这是被引用的原文"，读起来像块色卡；
// 现在用衬线体的开引号做书签，正文不再手工包中文引号。
test('overlay marks the quoted snippet with a typographic quote, not a color bar', () => {
	// 两个反斜杠：这段 CSS 住在 JS 字符串里，写成单反斜杠时最低位的八进制转义会被
	// JS 先吃掉，浏览器收到的 content 变成控制符 + C，卡片上就画出一个字母 C。
	assert.ok(
		OVERLAY_SCRIPT.includes('.card .quote::before{content:"\\\\201C"'),
		'CSS 码点要写成双反斜杠 201C，否则单反斜杠被 JS 当作八进制转义吃掉',
	);
	assert.ok(OVERLAY_SCRIPT.includes('nodes.quote.textContent = snippet;'));
	assert.ok(!OVERLAY_SCRIPT.includes('border-left:2px solid rgba(255,122,69,.55)'));
});

// 落点开关在展开控制台与折叠胶囊里各要一份，语义必须完全一致。两份字面量复制粘贴
// 的结果是漏改一边（改了 data-slot 或 title，另一处还指着旧行为）。
test('overlay 的落点开关只有一份标记定义', () => {
	assert.equal(OVERLAY_SCRIPT.split('<span class="seg" role="group"').length - 1, 1, '只允许一份字面量');
	assert.ok(OVERLAY_SCRIPT.includes('var segMarkup ='));
	assert.equal(OVERLAY_SCRIPT.split('segMarkup,').length - 1, 2, '控制台与胶囊各引用一次');
});

// prettier 不格式化模板字符串内部：顶格的 CSS 规则不会被任何门禁拦下，
// 读起来像漏进数组的裸语句，只能靠这条断言守。
test('overlay 的 CSS 规则都是缩进过的', () => {
	assert.ok(!OVERLAY_SCRIPT.includes("\n'.hud .cluster>button.pri:disabled"));
	assert.ok(!OVERLAY_SCRIPT.includes('\n// 主按钮禁用时'));
});

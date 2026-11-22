import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TASK_PLAIN, TASK_REFERENCE } from '../lib/shared/annotation-markdown.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');

// 用户看不懂「这条改动照的是哪几处」：小灰字序号、两栏同色细边框。
// 现在改动卡有暖橙竖线与描边、序号是实心块，参照卡上的归属 chip 用同一个暖橙，
// 一条改动与它照的蓝标靠颜色就能对上。这几条断言守住那套视觉契约。
// 栏头写的是「这一块放什么」，不是「这一条是什么」：改动区 / 参照区。
test('两栏栏头写「改动区 / 参照区」', () => {
	assert.ok(CLIENT.includes("h('span', { className: 'k' }, '改动区')"), '左栏头是改动区');
	assert.ok(CLIENT.includes("h('span', { className: 'k ref' }, '参照区')"), '右栏头是参照区');
});

test('改动卡带暖橙框线，序号是低调的同色徽标（不与正文抢视线）', () => {
	assert.ok(CLIENT.includes('.vp-cell.t{border-left:3px solid var(--vp-target)'), '改动卡左侧暖橙竖线');
	assert.ok(CLIENT.includes('--vp-target:#b45309'), '改动色 token 存在');
	assert.ok(CLIENT.includes("(role === 'reference' ? ' ref' : ' t')"), '改动卡真的挂上 t 类');
	assert.ok(
		CLIENT.includes('.vp-cell-head .n{flex:none;display:inline-flex;align-items:center;justify-content:center'),
	);
	// 用户反馈「编号区域和元素的引用抢视觉」：实心色块换成浅底同色字，序号只当索引。
	assert.ok(CLIENT.includes('height:18px;padding:0 5px;border-radius:5px;background:var(--vp-target-soft)'));
	assert.ok(CLIENT.includes('height:18px;padding:0 5px;border-radius:5px;background:var(--vp-ref-soft)'));
	assert.ok(!CLIENT.includes('background:var(--vp-target);color:var(--vp-target-fg)'), '改动序号不再是实心块');
});

// 用户反馈「图片文字间没有过渡，会出现遮挡的效果」「#_SCROLL_EL_ID 可读性较差」：
// 缩略图缩到 54×36、留 10px 间距并加一圈内描边；选择器从灰色小字提到正文色半档。
test('缩略图与文字之间有间距和描边，选择器按正文色可读', () => {
	assert.ok(CLIENT.includes('.vp-cell-main{display:flex;align-items:center;gap:10px'), '图与文字之间留 10px');
	assert.ok(
		CLIENT.includes(
			'.vp-cell-shot{width:54px;height:36px;border-radius:6px;overflow:hidden;background:var(--vp-surface-2);',
		),
	);
	assert.ok(CLIENT.includes('flex:none;box-shadow:inset 0 0 0 1px var(--vp-border)}'), '缩略图有内描边');
	assert.ok(
		CLIENT.includes('font:11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:inherit;opacity:.82}'),
		'选择器用正文色、只压半档',
	);
	assert.ok(!CLIENT.includes('font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--vp-muted)'));
});

// 用户反馈「改动卡下面多一行参照 chips，两栏就错位」：
// 两栏都固定一条 26px 的关系行（左=配了哪些参照，右=这条参照归给哪条改动），
// 组高恒等才会逐行对齐；靠塞空白假行对齐的话，chips 一换行就再次错位。
test('两栏共用一条固定高度的关系行，左右组高恒等', () => {
	assert.ok(
		CLIENT.includes(
			'.vp-relrow{display:flex;align-items:center;gap:6px;height:26px;min-width:0;flex:none;overflow:hidden}',
		),
		'关系行固定 26px，内容再多也不改高度',
	);
	assert.ok(
		CLIENT.includes('.vp-reflist.vp-relrow{flex-wrap:nowrap;height:26px;overflow:hidden}'),
		'左栏 chips 单行不换行（换行就会把对齐搞坏）',
	);
	assert.ok(CLIENT.includes("className: 'vp-reflist vp-relrow'"), '左栏关系行挂上轨道');
	assert.ok(CLIENT.includes("className: 'vp-relrow'"), '右栏也有同一条关系行，未配对时也占位');
	assert.ok(!CLIENT.includes("badge: owner ? '→ 改动 ' + owner"), '归属已从卡头徽标挪到关系行');
});

test('参照卡把归属写成指向改动的暖橙 chip', () => {
	assert.ok(CLIENT.includes("owners.length ? '→ 改动 ' + owners.join('、')"), '归属 chip 直接写「→ 改动 N」');
	assert.ok(CLIENT.includes('.vp-cell-badge.owner{background:var(--vp-target-weak)'));
	assert.ok(CLIENT.includes('.vp-relrow .vp-cell-badge{margin-left:0;'), '关系行里的徽标不再走 margin-left:auto');
});

// 用户反馈：两条改动引用同一条参照，参照下的归属还是只写「改动 1」。
// 归属是列表，不是单值——多对多必须列全，否则第二条改动在右栏看不见。
test('一条参照被多条改动引用时，归属 chip 列全', () => {
	assert.ok(CLIENT.includes('var ownerIndexesOf = function (ref)'), '归属按数组算，不再只取第一条');
	assert.ok(
		CLIENT.includes("owners.length ? '→ 改动 ' + owners.join('、') : used ? '已引用' : '未配对'"),
		'归属 chip 依次列出所有改动序号',
	);
	assert.ok(
		CLIENT.includes('max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'),
		'归属 chip 长了省略，不撑开关系行',
	);
	assert.ok(CLIENT.includes("' · 改动 ' + owners.join('、')"), '展开的编辑器头部也列全');
});

test('序号只写数字，不带 # 前缀（徽标本身说明是改动）', () => {
	assert.ok(CLIENT.includes("var code = role === 'reference' ? refCodeOf(pick) : String(targets.indexOf(pick) + 1);"));
	assert.ok(!CLIENT.includes("'#' + (targets.indexOf(pick) + 1)"));
});

// 审查发现的回归：adoptArming 每 1.5s 轮询都无条件 setViewMode('pair')，
// 用户点「普通模式」后下一拍就被无声拽回去——等于不让人选。
test('落点切栏只在「这一拍刚变成参照」时发生一次', () => {
	assert.ok(CLIENT.includes('armSeen.current'), '要记住上一拍的落点');
	assert.ok(CLIENT.includes("if (slot === 'reference' && prevSlot !== 'reference') setViewMode('pair');"));
	assert.ok(!CLIENT.includes("if (slot === 'reference') setViewMode('pair');"), '不能再无条件切栏');
});

// 普通模式只列改动：HUD 的参照落点标出来的那几处既不显示也不参与插入，
// 不给入口就等于「标了却凭空消失」。
test('普通模式有参照标注时给一条切栏入口', () => {
	assert.ok(CLIENT.includes('.vp-refs-note{'));
	assert.ok(CLIENT.includes('处参照不在普通模式里显示'));
	assert.ok(CLIENT.includes("onClick: () => setViewMode('pair') }, '切到参照模式'"));
});
// 用户反馈「左边区域和右边区域没有间隔」「样式重叠」：两栏之间只有 8px 空档、栏头没有分隔，
// 展开的参照下拉还留在文档流里把左栏撑高，看起来像右栏卡片的复制品。
// 这三条守住「真有分隔线 / 下拉是浮层 / 两栏文字左缘对齐」。
test('两栏之间有竖线，参照下拉是浮层，两栏文字左缘对齐', () => {
	assert.ok(
		CLIENT.includes('.vp-col+.vp-col{padding:0 0 0 12px;border-left:1px solid var(--vp-border)}'),
		'两栏之间一条竖线',
	);
	assert.ok(
		CLIENT.includes('.vp-colhead .col+.col{padding:0 0 7px 12px;border-left:1px solid var(--vp-border)}'),
		'栏头与两栏同一条线',
	);
	// 栅格线只有在 gap 为 0 时才和边框重合；留 gap 的话竖线会浮在两道空档中间。
	assert.ok(CLIENT.includes('.vp-cols{display:grid;grid-template-columns:1fr 1fr;gap:0;align-items:stretch}'));
	assert.ok(CLIENT.includes('.vp-refmenu{position:absolute;'), '下拉必须是浮层，不能把左栏撑高');
	assert.ok(
		CLIENT.includes('.vp-cell.t{border-left:3px solid var(--vp-target);padding-left:6px;'),
		'多出的 2px 左边框用内距补回来，两栏文字才能对齐',
	);
});

// 提示词与插入草稿的任务句必须逐字一致：两处各写一份就会漂，用户拿到的指令有两个版本
//（「请根据以下标注修改代码」对「任务：按「改动」标注修改对应元素…」）。
test('面板插入草稿的任务句与提示词逐字一致', () => {
	assert.ok(CLIENT.includes(TASK_REFERENCE), '参照模式的插入开头与提示词同一句');
	assert.ok(CLIENT.includes(TASK_PLAIN), '普通模式的插入开头与提示词同一句');
	assert.ok(!CLIENT.includes('请根据以下标注修改代码'), '旧的「请根据以下标注修改代码」已清掉');
});

// 用户反馈「每个标注区域大小不一」「文字太多」「新增改动 / 添加参照按钮没对齐」：
// 左栏卡片没有参考维度那一行，右栏有，两栏卡片就一高一低；说明两行截断还会再撑高。
// 现在卡定高、说明单行省略（点开卡看全），两列等高 + 按钮贴底，两个按钮落在同一条线上。
test('两栏卡片同高、说明单行省略、底部按钮贴底对齐', () => {
	assert.ok(
		CLIENT.includes(
			'.vp-cell{display:flex;flex-direction:column;gap:4px;min-width:0;height:56px;box-sizing:border-box;',
		),
		'卡片定高，两栏同尺寸',
	);
	assert.ok(
		CLIENT.includes(
			'.vp-cell-note{display:flex;align-items:center;gap:6px;min-width:0;font-size:12px;line-height:1.45}',
		),
		'说明是一行 flex 行',
	);
	assert.ok(
		CLIENT.includes('.vp-cell-note .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'),
		'文字过多省略，不换行',
	);
	assert.ok(!CLIENT.includes('-webkit-line-clamp:2'), '说明不再两行截断');
	assert.ok(CLIENT.includes("h('span', { className: 'vp-cell-spec'"), '参考维度并进说明行右端，不再另起一行');
	assert.ok(
		CLIENT.includes('justify-content:center;margin-top:auto;height:34px;'),
		'两个「＋」按钮贴到列底，等高才对齐',
	);
	assert.ok(CLIENT.includes('align-items:stretch'), '两列等高');
});

// 批量勾选按需出现（用户反馈：两栏常驻几十个空勾选框是噪音，批量清空才是低频操作）。
// 布局契约（用户拍板）：按钮统一放底部操作行、清空左边，文案「批量操作」，栏头不放。
test('勾选框默认不渲染，点底部「批量操作」才出现', () => {
	assert.ok(CLIENT.includes('var [selectMode, setSelectMode] = useState(false)'), '批量勾选必须是显式模式状态');
	assert.ok(CLIENT.includes("'vp-btn' + (selectMode ? ' on' : '')"), '底部按钮统管批量开关，开着时高亮提示');
	assert.ok(CLIENT.includes("'批量操作',"), '按钮文案是「批量操作」');
	assert.ok(!CLIENT.includes('vp-chead-batch'), '栏头不再放批量开关（统一到底部）');
	assert.ok(CLIENT.includes('selectMode && selectedIds.length'), '选中条仅在批量模式下才出现');
	assert.ok(CLIENT.includes('if (selectMode) setSelected([]);'), '退出批量必须清掉已勾选，不留隐藏状态');
});

// 正文块曾经是单行省略：长文案在面板里只剩开头几个字，用户连复制都拿不到全文，
// 提示词里的「原文」也就跟着没用。现在保留换行，并配「复制文字 / 改文案」两个动作。
test('面板正文块保留换行，并提供复制文字与改文案', () => {
	assert.ok(CLIENT.includes('white-space:pre-wrap'), '正文块保留换行');
	assert.ok(
		!CLIENT.includes('.vp-text{font-size:12px;color:var(--vp-muted);overflow:hidden'),
		'单行省略必须撤掉，否则用户看到的不是原文',
	);
	assert.ok(CLIENT.includes("'复制文字'"));
	assert.ok(CLIENT.includes("pick.textEdit ? '改文案 ✓' : '改文案'"), '改文案按钮要能显示已标记');
	assert.ok(CLIENT.includes('期望文案（可不填）'), '期望文案输入框');
	assert.ok(CLIENT.includes("post('/wanted-text'"));
	assert.ok(CLIENT.includes("post('/text-edit'"));
	// 参考侧只读：不给改文案按钮，避免 agent 顺手改参考页的文案。
	assert.ok(CLIENT.includes('var isRef = pick.role ==='));
});

test('插入对话的文本块对长文案单列「原文」', () => {
	assert.ok(CLIENT.includes("lines.push('    原文：'"));
	assert.ok(CLIENT.includes("lines.push('    期望文案：'"));
});

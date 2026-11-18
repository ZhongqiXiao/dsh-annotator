import assert from 'node:assert/strict';
import test from 'node:test';

import { annotationMarkdown, TASK_PLAIN, TASK_REFERENCE } from '../lib/shared/annotation-markdown.js';

const ref = (id, over = {}) => ({
	id,
	role: 'reference',
	pageKey: 'https://example.com/ref',
	pageTitle: '参考页',
	url: 'https://example.com/ref',
	tag: 'button',
	selector: '#save',
	text: '保存',
	spec: ['配色', '圆角'],
	comment: '就照这个按钮',
	...over,
});

const target = (id, over = {}) => ({
	id,
	role: 'target',
	pageKey: 'https://example.com/target',
	pageTitle: '目标页',
	url: 'https://example.com/target',
	tag: 'button',
	selector: '#submit',
	text: '提交',
	...over,
});

// 没有参照时也不给「要怎么改」就不再是提示词、只是一份元素清单：读到的 agent 只能自己猜。
// 单块编号（1. 2. …）保持不变，老提示词与 test/index.test.mjs 依赖它。
test('无参照时给任务与执行要求，编号仍用单块数字', () => {
	const md = annotationMarkdown([target('1'), target('2')]);
	assert.match(md, /^页面元素标注（2 处）/);
	assert.ok(md.includes(TASK_PLAIN));
	assert.ok(md.includes('执行要求'));
	assert.ok(md.includes('1. `#submit` — button：提交'));
	assert.ok(md.includes('2. `#submit` — button：提交'));
	// 没有参照就不该出现只读约定与 T/R 编号，否则 agent 会去找不存在的参照。
	assert.ok(!md.includes('参照页'));
	assert.ok(!md.includes('参照：'));
	assert.ok(!md.includes('T1.'));
});

test('无参照时 source 追加在表头里，并补上右括号', () => {
	const md = annotationMarkdown([target('1')], { source: 'chrome：https://example.com/target' });
	assert.equal(md.split('\n')[0], '页面元素标注（1 处，来源 chrome：https://example.com/target）');
});

test('空列表走调用方给的空态文案', () => {
	assert.equal(annotationMarkdown([], { empty: '（没有匹配 id 的页面元素标注）' }), '（没有匹配 id 的页面元素标注）');
	assert.equal(annotationMarkdown([]), '（当前还没有页面元素标注）');
});

test('参照模式写清执行边界与改动↔参照的对照关系', () => {
	const md = annotationMarkdown([ref('r1'), target('t1', { pairIds: ['r1'] })]);
	assert.match(md, /^页面元素标注（2 处：1 处改动 \/ 1 处参照）/);
	// 第一句就是任务：改哪、别改哪，一句话说完，不留「按标注改」这种要人猜的口径。
	assert.ok(md.includes(TASK_REFERENCE));
	assert.ok(md.includes('执行要求'));
	// 要求逐条编号，最后一条要求自检：agent 改完要能自己核对一遍。
	assert.ok(md.includes('1. 只改带 T 编号的「改动」元素'));
	assert.ok(md.includes('4. 改完逐条自检'));
	// 边界按「带 T 编号的标注」划，不按页面划：页面没有角色，只是出处。
	assert.ok(md.includes('只改带 T 编号的「改动」元素'));
	assert.ok(md.includes('## 参照 R1 — 参考页（只读参考：不改这处元素，也不改它的代码）'));
	// 参照行按页编号：目标行的「参照：」要靠它才指得回具体元素。
	assert.ok(md.includes('R1-1. `#save` — button：保存'));
	assert.ok(md.includes('   参考维度：配色、圆角'));
	assert.ok(md.includes('## 改动 — 目标页（待修改）'));
	assert.ok(md.includes('T1. `#submit` — button：提交'));
	assert.ok(md.includes('   参照：R1-1 的配色、圆角（只改这一处，参照处只读）'));
});

test('目标标注的评论用「改法」，参照标注的评论用「评论」', () => {
	const md = annotationMarkdown([ref('r1'), target('t1', { comment: '按钮换成暖橙', pairIds: ['r1'] })]);
	assert.ok(md.includes('   改法：按钮换成暖橙'));
	assert.ok(md.includes('   评论：就照这个按钮'));
});

test('没配对的改动明确写未指定，而不是静默省略对照行', () => {
	const md = annotationMarkdown([ref('r1'), target('t1')]);
	assert.ok(md.includes('   参照：未指定参照标注（可按上面 R 编号的样式对齐）'));
});

// 面板在 0.6 把「改动页 / 参照页」整个删掉了：同一页既有要改的那处、也有照着看的那处。
// 提示词如果还写「参照页只读」，agent 会以为整页不能动（连 T1 都不敢改），所以同页要
// 明说「只改带 T 编号的那几处，本页参照只读」。
test('参照与改动在同一页时，两边都写清只读范围，不假装是两页', () => {
	const md = annotationMarkdown([
		ref('r1', { pageKey: 'https://mine/list', pageTitle: '列表页', url: 'https://mine/list' }),
		target('t1', { pageKey: 'https://mine/list', pageTitle: '列表页', url: 'https://mine/list', pairIds: ['r1'] }),
	]);
	assert.ok(md.includes('## 参照 R1 — 列表页（本页同时有改动：只改 T 编号那几处，这里只读）'));
	assert.ok(md.includes('## 改动 — 列表页（待修改；本页参照只读）'));
	assert.ok(!md.includes('参照页'));
	// 同一页只分两节，不按「角色」拆成两个页面标题
	assert.equal(md.match(/^## /gm).length, 2);
});

// 改动分散在两个标签页时，旧实现把 T1、T2 塞进同一个「目标页 — X」节，第二个页面的
// 改动挂在第一个页面标题下面。现在按页各分一节，T 编号全局连续。
test('改动分散在多页时按页分节，T 编号连续', () => {
	const md = annotationMarkdown([
		ref('r1'),
		target('t1', { pairIds: ['r1'] }),
		target('t2', { pageKey: 'https://mine/detail', pageTitle: '详情页', url: 'https://mine/detail', selector: 'h1' }),
	]);
	assert.ok(md.includes('## 改动 — 目标页（待修改）'));
	assert.ok(md.includes('## 改动 — 详情页（待修改）'));
	assert.ok(md.includes('T1. `#submit`'));
	assert.ok(md.includes('T2. `h1`'));
	assert.equal(md.match(/^## 改动 — /gm).length, 2);
});

test('一处改动对多条参照时，编号与维度按参照顺序合并去重', () => {
	const md = annotationMarkdown([
		ref('r1', { spec: ['配色'] }),
		ref('r2', {
			pageKey: 'https://example.com/ref2',
			pageTitle: '参考页二',
			url: 'https://example.com/ref2',
			spec: ['圆角'],
			selector: '#ghost',
		}),
		target('t1', { pairIds: ['r1', 'r2'] }),
	]);
	assert.ok(md.includes('   参照：R1-1、R2-1 的配色、圆角（只改这一处，参照处只读）'));
});

// 角色判断走 pickRoleOf：role 缺失或写成别的值时按改动处理，和 session / 工具输出一致。
// 直接读 pick.role 的话，只有这一条路径会把同一条标注分到另一栏。
test('角色经 pickRoleOf 归一：缺 role 的不是参照', () => {
	const md = annotationMarkdown([{ ...ref('r1') }, { ...target('t1'), role: undefined }]);
	assert.match(md, /1 处改动 \/ 1 处参照/);
	// 缺 role 的那条进了「改动」一节，而且没有配到参照：它没有被当成第二个参照。
	assert.ok(md.includes('参照：未指定参照标注'));
	assert.ok(!md.includes('R1-1 的'));
});

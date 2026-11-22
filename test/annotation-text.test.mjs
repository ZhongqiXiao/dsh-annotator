import assert from 'node:assert/strict';
import test from 'node:test';

import { TASK_PLAIN, TASK_REFERENCE, annotationMarkdown } from '../lib/shared/annotation-markdown.js';

// 文案改写的契约只有一条：agent 必须看到「要换掉的那段字」的完整原文，并且知道
// 只换文字、别动结构样式。给不全（截成 40 字）或不说清（当成普通样式改动），
// 落地的结果就是半句话被替换进页面，或者整块 DOM 被顺手重构。

function pick(overrides = {}) {
	return Object.assign(
		{
			id: 'p1',
			selector: '#title',
			tag: 'h1',
			url: 'https://example.com/a',
			pageRect: { x: 10, y: 20, width: 100, height: 30 },
		},
		overrides,
	);
}

// 40 × 12 字 = 480 字，超过原文行的 400 字上限，才会触发裁剪标记。
const LONG = '这是一段很长的产品文案。'.repeat(40);

test('长文本进「原文」行，标题不再塞进整段', () => {
	const markdown = annotationMarkdown([pick({ text: LONG, textLength: LONG.length })]);
	assert.ok(markdown.includes('1. `#title` — h1'), '标题只留选择器 + 标签');
	assert.ok(!markdown.includes('h1：'), '长文不挤进标题');
	const line = markdown.split('\n').find((one) => one.startsWith('   原文：'));
	assert.ok(line, '必须有原文行');
	assert.ok(line.includes('这里只带前 400 字'), '超长裁剪要标出只带了前 400 字');
	assert.ok(!line.includes('已截断'), '全文都在时别说被页面截断');
});

test('页面文字被采集上限截断时，原文行要说明页面共多少字', () => {
	const markdown = annotationMarkdown([
		pick({ text: '截断后的开头', textLength: 9000, textTruncated: true, textEdit: true }),
	]);
	assert.ok(markdown.includes('页面共 9000 字，已截断'), '字数必须指向页面全文，不是收到的片段');
});

test('短文本仍留在标题里，不额外加原文行（既有提示词形态不变）', () => {
	const markdown = annotationMarkdown([pick({ text: '保存' })]);
	assert.ok(markdown.includes('1. `#title` — h1：保存'));
	assert.ok(!markdown.includes('   原文：'), '短文本不重复');
	assert.ok(!markdown.includes('   期望文案：'));
});

test('标了「改文案」的短文本也要给原文行：改写对象必须逐字可见', () => {
	const markdown = annotationMarkdown([pick({ text: '保存', textEdit: true })]);
	assert.ok(markdown.includes('   原文：保存'));
});

test('填了期望文案就单独成行，agent 要逐字换成它', () => {
	const markdown = annotationMarkdown([pick({ text: '保存', textEdit: true, wantedText: '保存并发布' })]);
	assert.ok(markdown.includes('   原文：保存'));
	assert.ok(markdown.includes('   期望文案：保存并发布'));
});

test('元素没有文字但填了期望文案时，期望文案照样下发', () => {
	const markdown = annotationMarkdown([pick({ text: '', wantedText: '继续' })]);
	assert.ok(markdown.includes('   期望文案：继续'));
	assert.ok(!markdown.includes('   原文：'), '没有原文就别造一行空的');
});

test('原文行排在页面行之前：要替换的文字不能被位置信息隔开', () => {
	const markdown = annotationMarkdown([pick({ text: LONG, textLength: LONG.length })]);
	const index = (needle) => markdown.indexOf(needle);
	assert.ok(index('   原文：') > 0);
	assert.ok(index('   页面：') > 0);
	assert.ok(index('   原文：') < index('   页面：'));
});

test('执行要求写清「只换文字不动结构」，普通与参照两种形态各一条', () => {
	const plain = annotationMarkdown([pick({ text: LONG, textLength: LONG.length })]);
	assert.ok(plain.includes(TASK_PLAIN));
	assert.ok(plain.includes('4. 带「原文」的是文案改动：只替换该元素里的文字，结构、样式、属性都不动'));
	assert.ok(plain.includes('有「期望文案」就逐字换成它'));

	const ref = annotationMarkdown([
		pick({ id: 'r1', selector: '#ref', tag: 'p', role: 'reference', text: LONG, textLength: LONG.length }),
		pick({ id: 't1', text: '短', textEdit: true }),
	]);
	assert.ok(ref.includes(TASK_REFERENCE));
	assert.ok(ref.includes('5. 带「原文」的是文案改动'), '参照形态的文案要求接在第 4 条自检之后');
	assert.ok(ref.includes('R1-1. `#ref` — p'), '参照行仍然按 R 编号');
});

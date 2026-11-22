import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShots, filteredPicksMarkdown } from '../lib/index.js';

test('normalizeShots accepts none/all/positive integers and defaults to 3', () => {
	assert.equal(normalizeShots('none'), 'none');
	assert.equal(normalizeShots('all'), 'all');
	assert.equal(normalizeShots('1'), 1);
	assert.equal(normalizeShots(5), 5);
	assert.equal(normalizeShots('0'), 3);
	assert.equal(normalizeShots('-2'), 3);
	assert.equal(normalizeShots('abc'), 3);
	assert.equal(normalizeShots(undefined), 3);
	assert.equal(normalizeShots(2.5), 3);
});

test('filteredPicksMarkdown renders picks with comment, url, rect and shot', () => {
	const md = filteredPicksMarkdown([
		{
			selector: '#submit-btn',
			tag: 'button',
			text: '  提交  订单  ',
			url: 'http://localhost:5173/checkout',
			pageRect: { x: 10.4, y: 20.6, width: 80, height: 24 },
			comment: '按钮颜色改成主色',
			shotPath: 'C:/shots/p1.png',
		},
	]);
	assert.match(md, /页面元素标注（1 处）/);
	// 文本压平后 trim 掉首尾空白：全角冒号后面再跟一个空格，读起来像打错的字。
	assert.match(md, /1\. `#submit-btn` — button：提交 订单/);
	assert.match(md, /页面：http:\/\/localhost:5173\/checkout/);
	assert.match(md, /位置：x=10 y=21 80×24/);
	assert.match(md, /评论：按钮颜色改成主色/);
	assert.match(md, /截图：C:\/shots\/p1\.png/);
});

test('filteredPicksMarkdown handles empty list and sparse picks', () => {
	assert.equal(filteredPicksMarkdown([]), '（没有匹配 id 的页面元素标注）');
	const md = filteredPicksMarkdown([{ tag: 'div' }]);
	assert.match(md, /1\. `div` — div/);
	assert.doesNotMatch(md, /评论：/);
});

// 工具描述是 agent 唯一读到的契约：只读必须按「标注」划，不能写成「参照标注所在页面」——
// 参照与改动同页时，那句话会让它既不敢改 T 处、又不敢照 R 处，两头卡住。
test('tool contract keeps read-only scoped to the pick, not the page', async () => {
	const source = await import('node:fs/promises').then((fs) =>
		fs.readFile(new URL('../lib/index.js', import.meta.url), 'utf8'),
	);
	assert.ok(!source.includes('禁止修改参照标注所在页面的对应代码'));
	assert.ok(!source.includes('此时按参照新建页面'));
	assert.ok(source.includes('只读的是它指向的那个元素，不是它所在的整页'));
});

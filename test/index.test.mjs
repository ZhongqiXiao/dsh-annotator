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
	assert.match(md, /1\. `#submit-btn` — button： 提交 订单/);
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

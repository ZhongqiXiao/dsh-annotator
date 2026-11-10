import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAddress } from '../lib/shared/url.js';

test('裸域名补 https，不会开出 about:blank', () => {
	assert.equal(normalizeAddress('gitee.com'), 'https://gitee.com');
	assert.equal(normalizeAddress('  gitee.com/foo/bar  '), 'https://gitee.com/foo/bar');
	assert.equal(normalizeAddress('www.example.com:8080/a'), 'https://www.example.com:8080/a');
});

test('已经带协议的地址原样保留', () => {
	assert.equal(normalizeAddress('https://gitee.com'), 'https://gitee.com');
	assert.equal(normalizeAddress('http://example.com/a?b=1'), 'http://example.com/a?b=1');
	assert.equal(normalizeAddress('file:///tmp/a.html'), 'file:///tmp/a.html');
	assert.equal(normalizeAddress('chrome://version'), 'chrome://version');
	assert.equal(normalizeAddress('about:blank'), 'about:blank');
});

test('本机地址补 http，协议相对地址补 https', () => {
	assert.equal(normalizeAddress('localhost:5173'), 'http://localhost:5173');
	assert.equal(normalizeAddress('127.0.0.1:3000/app'), 'http://127.0.0.1:3000/app');
	assert.equal(normalizeAddress('[::1]:8080'), 'http://[::1]:8080');
	assert.equal(normalizeAddress('//cdn.example.com/a.js'), 'https://cdn.example.com/a.js');
});

test('含空格的当搜索词，空输入返回空串', () => {
	assert.equal(normalizeAddress('dsh visual annotator'), 'https://www.bing.com/search?q=dsh%20visual%20annotator');
	assert.equal(normalizeAddress(''), '');
	assert.equal(normalizeAddress('   '), '');
	assert.equal(normalizeAddress(undefined), '');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGuiPage } from '../lib/shared/gui-page.js';

test('loopback root with DSH title is a GUI page', () => {
	assert.equal(isGuiPage('http://127.0.0.1:63041/', 'DeepSeek Harness'), true);
	assert.equal(isGuiPage('http://localhost:56394/', 'DeepSeek Harness - Session'), true);
	assert.equal(isGuiPage('http://[::1]:8080/', 'deepseek harness'), true);
});

test('loopback root without DSH title is not a GUI page', () => {
	assert.equal(isGuiPage('http://127.0.0.1:63041/', 'My App'), false);
});

test('non-root loopback paths stay valid targets', () => {
	assert.equal(isGuiPage('http://localhost:5173/dashboard', 'DeepSeek Harness'), false);
	assert.equal(isGuiPage('http://127.0.0.1:3000/', 'deepseek docs'), false);
});

test('non-loopback hosts are never GUI pages', () => {
	assert.equal(isGuiPage('https://example.com/', 'DeepSeek Harness'), false);
	assert.equal(isGuiPage('', ''), false);
	assert.equal(isGuiPage(undefined, undefined), false);
});

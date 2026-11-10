import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	EGO_AGENT_SPACE_NAME,
	isEgoBrowserCommand,
	isEgoOnboardingTarget,
	listeningPortsByPid,
} from '../lib/shared/ego.js';

test('only the onboarding window counts as the ego guide', () => {
	assert.equal(isEgoOnboardingTarget({ type: 'browser_ui', url: 'chrome://onboarding/' }), true);
	assert.equal(isEgoOnboardingTarget({ type: 'page', url: 'chrome://onboarding/?v=2' }), true);
	// 正常页面、别的 chrome:// 页面、缺 url 都不能被当成引导关掉。
	assert.equal(isEgoOnboardingTarget({ type: 'page', url: 'https://example.com/' }), false);
	assert.equal(isEgoOnboardingTarget({ type: 'page', url: 'chrome://settings/' }), false);
	assert.equal(isEgoOnboardingTarget({}), false);
	assert.equal(isEgoOnboardingTarget({ type: 'iframe', url: 'chrome://onboarding/' }), false);
});

test('ego main process is told apart from its helpers', () => {
	assert.equal(isEgoBrowserCommand('/Applications/ego lite.app/Contents/MacOS/ego lite --user-data-dir=/tmp/x'), true);
	assert.equal(
		isEgoBrowserCommand('/Applications/ego lite.app/Contents/MacOS/ego lite --startup-ego-browser-service'),
		true,
	);
	assert.equal(isEgoBrowserCommand('/opt/ego lite/ego lite --remote-debugging-port=0'), true);
	assert.equal(isEgoBrowserCommand('C:\\Program Files\\ego lite\\ego lite.exe --remote-debugging-port=0'), true);
	// renderer / gpu / crashpad 这些子进程命令行里也带 app 路径，不能拿来连。
	assert.equal(
		isEgoBrowserCommand(
			'/Applications/ego lite.app/Contents/Frameworks/ego Framework.framework/Helpers/ego Helper (Renderer) --type=renderer',
		),
		false,
	);
	assert.equal(isEgoBrowserCommand(''), false);
});

test('the lsof field output maps each pid to its listening ports', () => {
	// 真实形状：p 开头的行换进程，n 开头的行是地址；ego 的命令名带空格也不影响。
	const output = [
		'p679',
		'crapportd',
		'f8',
		'n*:50658',
		'p36334',
		'cego lite',
		'f44',
		'n127.0.0.1:49429',
		'f45',
		'n[::1]:62122',
		'p36335',
		'f6',
		'n*:3999',
	].join('\n');
	const ports = listeningPortsByPid(output);
	assert.deepEqual(ports.get(36334), [49429, 62122]);
	assert.deepEqual(ports.get(36335), [3999]);
	assert.deepEqual(ports.get(679), [50658]);
	// 没有监听端口（进程刚退出）时返回空 Map，而不是抛。
	assert.equal(listeningPortsByPid('').size, 0);
	assert.equal(listeningPortsByPid(undefined).size, 0);
});

test('the agent space keeps a stable name', () => {
	assert.equal(EGO_AGENT_SPACE_NAME, 'agent 空间');
});

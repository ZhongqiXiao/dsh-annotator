#!/usr/bin/env node
// 端到端用例的跨平台入口。
//
// 为什么要有这一层：package.json 里原来写的是
//   DSH_VISUAL_ANNOTATOR_E2E=1 DSH_VISUAL_ANNOTATOR_HEADLESS=1 node --test ...
// 这种「VAR=值 命令」只有 POSIX shell 认。npm 在 Windows 上走 cmd.exe，
// 它会把整段当成一个叫 `DSH_VISUAL_ANNOTATOR_E2E=1` 的程序去执行，
// windows-latest 上直接红——而浏览器矩阵恰恰需要在 Windows 上跑同一份用例。
// 在本进程里设好环境变量再 spawn node，三个平台共用同一个入口。
//
// 额外参数原样转发给 node --test（本地只跑某个用例时用得上）。

import { spawn } from 'node:child_process';

const env = {
	...process.env,
	// 真跑浏览器 / 无头（CI 机器没有显示器）/ 不去接管本机已在跑的 ego lite。
	DSH_VISUAL_ANNOTATOR_E2E: '1',
	DSH_VISUAL_ANNOTATOR_HEADLESS: '1',
	DSH_VISUAL_ANNOTATOR_ADOPT_RUNNING: '0',
};

const args = ['--test', '--test-concurrency=1', '--test-force-exit'];
const extra = process.argv.slice(2);
args.push(...(extra.length ? extra : ['test/e2e-browsers.test.mjs']));

const child = spawn(process.execPath, args, { stdio: 'inherit', env });
child.on('error', (err) => {
	console.error('e2e 启动失败：' + err.message);
	process.exit(1);
});
child.on('exit', (code, signal) => {
	// 被信号杀掉时把信号透出去，别把「被杀」说成正常结束。
	if (signal) process.kill(process.pid, signal);
	else process.exit(code ?? 1);
});

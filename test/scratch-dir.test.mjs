import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { VisualPicker } from '../lib/session.js';
import { projectHash, projectSlug, scratchDir, scratchSubdir } from '../lib/shared/scratch-dir.js';

const ROOT = path.join(os.tmpdir(), 'dsh-visual-annotator');
const envRoot = (process.env.DSH_VISUAL_ANNOTATOR_DIR ?? '').trim();

test('默认临时根目录落在操作系统临时目录，不落代码仓', () => {
	const picker = new VisualPicker();
	if (envRoot) {
		assert.equal(path.resolve(picker.baseDir), path.resolve(envRoot));
	} else {
		assert.equal(path.resolve(picker.baseDir), path.resolve(ROOT));
		assert.equal(path.relative(os.tmpdir(), picker.baseDir).startsWith('..'), false);
	}
	// 没有 cwd 时不切分目录，profile 跨启动留存（activeBaseDir 只在 launch() 里设置）。
	assert.equal(picker.activeBaseDir, null);
});

test('传入 workspace cwd 时，profile 与截图的基目录改到临时目录下的项目子目录', () => {
	const picker = new VisualPicker();
	const base = picker._scratchBase('/work/app');
	assert.ok(base);
	assert.equal(path.relative(path.resolve(ROOT), base).startsWith('..'), false);
	// 关键回归点：基目录绝不能落在项目里（旧实现是 cwd/.dsh-visual-annotator）。
	assert.equal(path.relative('/work/app', base).startsWith('..'), true);
	assert.equal(base.includes(path.join('/work/app', '.dsh-visual-annotator')), false);
	// 同一个项目每次拿到同一个目录：profile 复用、_tryAdopt 仍能接管。
	assert.equal(base, picker._scratchBase('/work/app'));
	assert.equal(picker._scratchBase(''), null);
	assert.equal(picker._scratchBase('relative/dir'), null);
});

test('同一项目目录稳定，同名的不同项目互不共享', () => {
	const a = scratchDir(ROOT, '/work/app');
	assert.equal(a, scratchDir(ROOT, '/work/app'));
	assert.match(path.basename(a), /^app-[0-9a-f]{8}$/);
	const b = scratchDir(ROOT, '/other/app');
	assert.notEqual(a, b);
	assert.match(path.basename(b), /^app-[0-9a-f]{8}$/);
});

test('无法定位的 cwd 回落到临时根目录', () => {
	assert.equal(scratchSubdir(''), '');
	assert.equal(scratchSubdir('relative/dir'), '');
	assert.equal(scratchDir(ROOT, ''), path.resolve(ROOT));
	assert.equal(scratchDir(ROOT, 'relative/dir'), path.resolve(ROOT));
});

test('项目名保留可读部分并过滤非法字符', () => {
	assert.equal(projectSlug('/work/my app'), 'my-app');
	assert.equal(projectSlug('/work/我的 项目'), '我的-项目');
	assert.equal(projectSlug('/work/.hidden.'), 'hidden');
	assert.equal(projectSlug('/'), 'project');
	assert.equal(projectSlug('/work/' + 'a'.repeat(80)).length, 32);
	assert.match(scratchSubdir('/work/a:b*c?'), /^a-b-c-[0-9a-f]{8}$/);
});

test('Windows 大小写不敏感的同一路径共用目录', () => {
	assert.equal(projectHash('/Work/App', 'win32'), projectHash('/work/app', 'win32'));
	assert.notEqual(projectHash('/Work/App', 'darwin'), projectHash('/work/app', 'darwin'));
	assert.notEqual(projectHash('/work/app', 'linux'), projectHash('/work/APP', 'linux'));
});

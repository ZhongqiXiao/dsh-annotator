import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VisualPicker } from '../lib/session.js';

function seed(picks) {
	const picker = new VisualPicker();
	picker.state.picks = picks;
	return picker;
}

test('clear() empties the whole list in one call and keeps it restorable as one batch', async () => {
	const picker = seed([
		{ id: 1, seq: 1 },
		{ id: 2, seq: 2 },
		{ id: 3, seq: 3 },
	]);
	const cleared = await picker.clear();
	assert.equal(cleared.cleared, 3);
	assert.deepEqual(cleared.picks, []);
	assert.equal(picker.retired.length, 3);
	const back = picker.restorePick();
	assert.equal(back.restored, 3);
	assert.deepEqual(
		back.picks.map((pick) => pick.id),
		[1, 2, 3],
	);
	assert.equal(picker.retired.length, 0);
});

test('cleared picks still answer findPick/readablePicks so pasted chips keep expanding', async () => {
	const picker = seed([{ id: 4, seq: 4, selector: '#title', comment: '字体太小' }]);
	await picker.clear();
	assert.equal(picker.findPick('4')?.comment, '字体太小');
	assert.equal(picker.findPick(4)?.selector, '#title');
	assert.deepEqual(
		picker.readablePicks().map((pick) => pick.id),
		[4],
	);
});

// 面板的勾选清空：ids 与 scope 取交集。勾选来自单个栏，过期 id 必须被无视，
// 否则「勾了一条又删了别的」会把不相干的标注一起清掉。
test('clear(scope, ids) only clears the checked picks and undoes them as one batch', async () => {
	const picker = seed([
		{ id: 1, seq: 1, role: 'target' },
		{ id: 2, seq: 2, role: 'target' },
		{ id: 3, seq: 3, role: 'reference' },
	]);
	const cleared = await picker.clear('target', ['1', 999]);
	assert.equal(cleared.cleared, 1);
	assert.deepEqual(
		cleared.picks.map((pick) => pick.id),
		[2, 3],
	);
	// 撤销把这一批整条拿回来，不会顺带复活别的。
	const back = picker.restorePick();
	assert.equal(back.restored, 1);
	assert.deepEqual(back.picks.map((pick) => pick.id).sort(), [1, 2, 3]);
});

test('clear(scope, ids) refuses ids from the other column', async () => {
	const picker = seed([
		{ id: 1, seq: 1, role: 'target' },
		{ id: 2, seq: 2, role: 'reference' },
	]);
	const cleared = await picker.clear('reference', ['1']);
	assert.equal(cleared.cleared, 0);
	assert.equal(picker.state.picks.length, 2);
	assert.equal(picker.retired.length, 0);
});

test('clear() on an empty list is a no-op and leaves the archive untouched', async () => {
	const picker = seed([{ id: 5, seq: 5 }]);
	await picker.clear();
	const again = await picker.clear();
	assert.equal(again.cleared, 0);
	assert.equal(picker.retired.length, 1);
	assert.equal(picker.restorePick().restored, 1);
});

test('clear() keeps screenshots for the undo and drops them when the window closes', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-clear-'));
	const shot = path.join(dir, 's1.png');
	fs.writeFileSync(shot, 'png');
	const picker = seed([{ id: 1, seq: 1, shotPath: shot }]);
	try {
		await picker.clear();
		assert.equal(fs.existsSync(shot), true);
		picker.restorePick();
		assert.equal(fs.existsSync(shot), true);
		await picker.clear();
		await picker.close();
		assert.equal(fs.existsSync(shot), false);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

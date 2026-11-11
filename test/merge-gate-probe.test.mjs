import { test } from 'node:test';
import assert from 'node:assert/strict';

// 临时探针：故意失败，用来证明「用例红着合不进 main」（分支保护真的拦人）。
// 该文件只存在于 probe/red-checks 分支，验证完即删除，不合并。
test('merge gate probe: 这条断言故意失败', () => {
	assert.equal(1, 2, '分支保护探针：检查红时必须拦住合并');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_OUTPUT_SCHEMA, TOOL_PARAMETERS } from '../lib/shared/tool-schema.js';

// DSH 的 tools.register() 只接受收窄后的 JSON Schema 子集：
//   - type 必须是单个字符串，联合类型要用 oneOf；
//   - 关键字只允许 type/oneOf/properties/required/additionalProperties/items/enum/const + 注解。
// 旧实现把 type 写成数组（type: ['string','null']），register 会抛 JsonSchemaError，
// 插件又吞掉了这个错误，于是工具在文档里存在、在任何会话里都不存在。
const ALLOWED_KEYWORDS = new Set([
	'type',
	'oneOf',
	'properties',
	'required',
	'additionalProperties',
	'items',
	'enum',
	'const',
	'description',
	'title',
	'default',
	'examples',
]);
const ALLOWED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/** 深度遍历 schema 的每个节点（properties / items / oneOf 都要走到）。 */
function walkNodes(node, path, out) {
	if (node === null || typeof node !== 'object' || Array.isArray(node)) return out;
	out.push({ node, path });
	for (const [key, value] of Object.entries(node.properties ?? {})) walkNodes(value, path + '.properties.' + key, out);
	if (node.items !== undefined) walkNodes(node.items, path + '.items', out);
	(node.oneOf ?? []).forEach((member, index) => walkNodes(member, path + '.oneOf[' + index + ']', out));
	return out;
}

const nodesOf = (schema, rootPath) => walkNodes(schema, rootPath, []);

test('工具参数/输出 schema 不使用 type 数组（DSH 只接受单一 type 或 oneOf）', () => {
	for (const { node, path } of [...nodesOf(TOOL_PARAMETERS, 'parameters'), ...nodesOf(TOOL_OUTPUT_SCHEMA, 'schema')]) {
		if (Object.hasOwn(node, 'type')) {
			assert.equal(Array.isArray(node.type), false, path + '.type 不能是数组');
			assert.equal(typeof node.type, 'string', path + '.type 必须是字符串');
			assert.ok(ALLOWED_TYPES.has(node.type), path + '.type 取值超出 DSH 支持范围：' + String(node.type));
		}
		// type 与 oneOf 不能同时出现（DSH 会直接判违规）。
		if (Object.hasOwn(node, 'oneOf'))
			assert.equal(Object.hasOwn(node, 'type'), false, path + ' 不能同时声明 type 和 oneOf');
	}
});

test('工具参数/输出 schema 只使用 DSH 白名单关键字', () => {
	for (const { node, path } of [...nodesOf(TOOL_PARAMETERS, 'parameters'), ...nodesOf(TOOL_OUTPUT_SCHEMA, 'schema')]) {
		for (const key of Object.keys(node)) {
			assert.ok(ALLOWED_KEYWORDS.has(key), path + ' 使用了 DSH 不支持的关键字：' + key);
		}
	}
});

test('可空字段与多类型参数用 oneOf 表达', () => {
	assert.deepEqual(TOOL_PARAMETERS.properties.shots.oneOf, [{ type: 'string' }, { type: 'integer' }]);
	const pickProps = TOOL_OUTPUT_SCHEMA.properties.picks.items.properties;
	assert.deepEqual(pickProps.shotPath.oneOf, [{ type: 'string' }, { type: 'null' }]);
	assert.deepEqual(pickProps.pageRect.oneOf, [{ type: 'object' }, { type: 'null' }]);
});

test('schema 根必须是 object，且 output 声明 ok 为必填', () => {
	assert.equal(TOOL_PARAMETERS.type, 'object');
	assert.equal(TOOL_OUTPUT_SCHEMA.type, 'object');
	assert.deepEqual(TOOL_OUTPUT_SCHEMA.required, ['ok']);
	assert.equal(TOOL_OUTPUT_SCHEMA.properties.ok.type, 'boolean');
});

/**
 * Model-facing JSON Schema for the `visual_annotator_read` tool.
 *
 * Kept here (rather than inline) so a unit test can guard it: DSH's tool
 * registry only accepts a strict JSON Schema subset where `type` must be a
 * single string and unions must be spelled with `oneOf`. A `type` array makes
 * `tools.register()` throw `JsonSchemaError`, and the plugin used to swallow
 * that error — the tool then existed in the docs but never in an agent's
 * toolset. Do not reintroduce type arrays.
 */

/** Union of one JSON type and `null`, the subset-safe way to express "may be null". */
const nullable = (type) => ({ oneOf: [{ type }, { type: 'null' }] });

export const TOOL_PARAMETERS = {
	type: 'object',
	additionalProperties: false,
	properties: {
		ids: {
			type: 'array',
			items: { type: 'string' },
			description: '只返回这些 id 的标注（如 ["p1","p3"]）；配合用户消息里的「[标注 #pN]」引用标记使用。缺省返回全部。',
		},
		shots: {
			oneOf: [{ type: 'string' }, { type: 'integer' }],
			description: "内联截图控制：'none' 不带截图；'all' 全部；正整数 n=最近 n 张；缺省最近 3 张。",
		},
		wait_seconds: {
			type: 'integer',
			description: '等待新标注秒数 0-60（默认 0）：无新 pick 时轮询等待，出现新 pick 或超时返回。',
		},
	},
};

export const TOOL_OUTPUT_SCHEMA = {
	type: 'object',
	required: ['ok'],
	additionalProperties: false,
	properties: {
		ok: { type: 'boolean' },
		count: { type: 'integer' },
		rev: { type: 'string' },
		markdown: { type: 'string' },
		picks: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					id: { type: 'string' },
					selector: { type: 'string' },
					tag: { type: 'string' },
					text: { type: 'string' },
					comment: { type: 'string' },
					shotPath: nullable('string'),
					url: { type: 'string' },
					pageRect: nullable('object'),
				},
			},
		},
		attachments: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					pickId: { type: 'string' },
					ref: { type: 'object' },
				},
			},
		},
	},
};

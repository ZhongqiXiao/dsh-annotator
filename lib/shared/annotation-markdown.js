/**
 * One markdown for every consumer: the agent tool output, the panel's copy button,
 * and the HUD's 「复制提示词」. Three code paths writing their own version drift —
 * the panel used to omit the per-change 「参照：」 line the tool printed, so the
 * prompt pasted into another agent lost the whole 改动↔参照 mapping.
 *
 * The shape is a contract (docs/reference-mode.md §6):
 *   「页面元素标注（N 处：X 处改动 / Y 处参照）」
 *   「任务：…」/「执行要求」1..4
 *   「## 参照 R1 — 页面标题（只读参考…）」
 *   「R1-1. 选择器 — tag：文本」 …「   参照：R1-1 的配色、圆角（只改这一处）」
 *
 * 页面没有角色，只有标注有：参照完全可能和改动取自同一页（同一页的卡片 A 照着
 * 同一页的卡片 B 改）。所以这里按「页面」分组只用于分节阅读，绝不暗示两页对立；
 * 反过来，改动分散在多个标签页时也按页各分一节，不再假装只有一个「目标页」。
 */

import { normalizeSpec, pageKeyOf, pairIdsOf, pickRoleOf, refLabelsOf } from './page-roles.js';

/**
 * 任务的唯一说法：面板「插入」到输入框的草稿开头也用这两句（lib/client.js 里同名
 * 字面量，test/panel-target-visual.test.mjs 逐字比对）。一份提示词两个开头，用户
 * 拿到的就是两套指令。
 */
export const TASK_REFERENCE =
	'任务：按「改动」标注修改对应元素；「参照」只提供样式与结构，别改它指向的元素，也别改它的代码。改动与参照按编号逐行对应：一处改动可以参照多条；一条参照也可以被多处改动共用，重复出现即指同一处参照。';
export const TASK_PLAIN = '任务：按下列标注修改对应元素。';

/**
 * 「执行要求」的定位口径，两种形态共用同一句：选择器才是身份，坐标只是快照。
 * 坐标是 pageRect（getBoundingClientRect + scrollX/scrollY，CSS px）——滚动不影响它，
 * 但窗口尺寸、页面缩放、响应式重排和异步内容都会把它挪走，拿它当锚点必然认错元素。
 */
export const LOCATE_RULE =
	'定位一律以选择器为准：坐标是拾取时的页面坐标快照（窗口尺寸、页面缩放与内容变化都会让它失准），选择器对不上时按标签 + 文本 + HTML 片段在页面里重新找，别按坐标猜。';

/**
 * 原文行的两个上限：标题里只放得下一句，完整原文单独成行。
 * agent 要拿它做「整段替换」，只给前半句就会把半句话替换进页面。
 */
const TEXT_SNIPPET = 60;
const TEXT_FULL = 400;

/** 压空白后裁断；超长时标出总字数——不标的话，读到提示词的人会以为那就是全部。 */
function clipText(text, limit, total) {
	const flat = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	const count = Number(total) > flat.length ? Number(total) : flat.length;
	if (flat.length <= limit) return count > flat.length ? flat + '（页面共 ' + count + ' 字，已截断）' : flat;
	return (
		flat.slice(0, limit) +
		'…（' +
		(count > flat.length ? '页面共 ' + count + ' 字，已截断；' : '共 ' + count + ' 字；') +
		'这里只带前 ' +
		limit +
		' 字）'
	);
}

/**
 * 原文 / 期望文案两行。只给长文、标了「改文案」的、或者用户填了期望文案的：
 * 短文本在标题里已经写全，再补一行就是重复。
 */
function pushTextLines(lines, pick) {
	const flat = String(pick.text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	const wanted = String(pick.wantedText ?? '').trim();
	if (!flat && !wanted) return;
	const long = flat.length > TEXT_SNIPPET;
	if (!long && !pick.textEdit && !wanted) return;
	// 元素没有文字、只填了期望文案时也要有「期望文案」行：那是新文案的唯一来源。
	if (flat) lines.push('   原文：' + clipText(flat, TEXT_FULL, pick.textLength));
	if (wanted) lines.push('   期望文案：' + clipText(wanted, TEXT_FULL));
}

/** One pick as markdown lines; the caller owns the numbering. */
function pushPick(lines, pick, label, { commentLabel = '评论' } = {}) {
	lines.push('');
	const flat = String(pick.text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	lines.push(
		label +
			' `' +
			(pick.selector || pick.tag) +
			'` — ' +
			pick.tag +
			// 长文不进标题：标题要能一眼扫完，完整原文由下面的「原文：」行承担。
			(flat && flat.length <= TEXT_SNIPPET ? '：' + flat : ''),
	);
	// 「原文」紧跟标题：文案改写要替换的就是这段文字，排在页面/位置前面才不会被跳过。
	pushTextLines(lines, pick);
	if (pick.url) lines.push('   页面：' + pick.url);
	if (pick.pageRect)
		lines.push(
			'   位置：x=' +
				Math.round(pick.pageRect.x) +
				' y=' +
				Math.round(pick.pageRect.y) +
				' ' +
				Math.round(pick.pageRect.width) +
				'×' +
				Math.round(pick.pageRect.height) +
				// 页面坐标是「拾取那一瞬」的快照，不是身份：窗口拉大、页面缩放、异步内容撑开都会让它变。
				// 不标出来，读提示词的 agent 会把坐标当锚点，换了窗口尺寸就对不上。
				'（快照，仅供对照）',
		);
	const spec = normalizeSpec(pick.spec);
	if (spec.length) lines.push('   参考维度：' + spec.join('、'));
	if (pick.comment) lines.push('   ' + commentLabel + '：' + pick.comment);
	if (pick.html) lines.push('   HTML: `' + String(pick.html).replace(/\s+/g, ' ').slice(0, 300) + '`');
	if (pick.shotPath) lines.push('   截图：' + pick.shotPath);
}

/**
 * @param {Array<object>} picks
 * @param {{ empty?: string, source?: string }} [options]
 *   empty: no-pick message; source: 「，来源 chrome：url」 for the legacy single-block header.
 */
export function annotationMarkdown(picks, options = {}) {
	const list = Array.isArray(picks) ? picks : [];
	if (!list.length) return options.empty || '（当前还没有页面元素标注）';
	// 角色一律经 pickRoleOf 归一，和 session / 工具输出走同一个判断：直接读 pick.role
	// 的话，将来 role 多出一种值或缺失时，只有这一条路径会把标注分错边。
	const references = list.filter((pick) => pickRoleOf(pick) === 'reference');
	const targets = list.filter((pick) => pickRoleOf(pick) !== 'reference');

	// 没有参照时保持单块编号（老提示词与既有测试都依赖这一行），但也给任务与要求：
	// 一份没有「要怎么改」的标注列表，读到它的 agent 只能自己猜。
	if (!references.length) {
		const lines = ['页面元素标注（' + list.length + ' 处' + (options.source ? '，来源 ' + options.source : '') + '）'];
		lines.push('');
		lines.push(TASK_PLAIN);
		lines.push('');
		lines.push('执行要求');
		lines.push(LOCATE_RULE);
		lines.push('1. 一条标注对应一处元素，按该条的「评论」改。');
		lines.push('2. 只改这些元素，别顺手重构同一页的其它部分。');
		lines.push('3. 改完逐条自检，确认每条评论都落实到了对应元素上。');
		// 文案改写跟着标注一起下发：不写清「只换文字」，agent 常顺手改结构或样式，
		// 而用户要的往往只是把这句话说得更好——改的越少越安全。
		lines.push(
			'4. 带「原文」的是文案改动：只替换该元素里的文字，结构、样式、属性都不动；有「期望文案」就逐字换成它，没有就按评论重写并保持原意与信息量。',
		);
		list.forEach((pick, index) => pushPick(lines, pick, String(index + 1) + '.'));
		return lines.join('\n');
	}

	const labels = refLabelsOf(list);
	const labelOf = (pick) => labels.get(pick.pageKey || pageKeyOf(pick.url)) || pick.refLabel || 'R';
	// 参照标注的编号（R1-1、R1-2…）：目标行靠它说清「照哪一条改」。
	const code = new Map();
	const perPage = new Map();
	for (const pick of references) {
		const key = pick.pageKey || pageKeyOf(pick.url);
		const next = (perPage.get(key) || 0) + 1;
		perPage.set(key, next);
		code.set(String(pick.id), labelOf(pick) + '-' + next);
	}

	const keyOf = (pick) => pick.pageKey || pageKeyOf(pick.url);
	const titleOf = (items) => {
		const pick = items[0];
		return String(pick?.pageTitle || '').trim() || String(pick?.url || '').trim() || '页面';
	};
	const keysOf = (items) => {
		const keys = [];
		for (const pick of items) {
			const key = keyOf(pick);
			if (!keys.includes(key)) keys.push(key);
		}
		return keys;
	};

	const lines = [
		'页面元素标注（' + list.length + ' 处：' + targets.length + ' 处改动 / ' + references.length + ' 处参照）',
	];
	// 执行意图写在最前面：任务一句话说清「改什么、别改什么」，编号要求逐条对齐，
	// 最后一条要求自检——读到提示词的 agent 不用回头猜规矩。
	lines.push('');
	lines.push(TASK_REFERENCE);
	lines.push('');
	lines.push('执行要求');
	lines.push(LOCATE_RULE);
	lines.push(
		'1. 只改带 T 编号的「改动」元素；带 R 编号的是只读参考，只取它的样式与结构，不改那处元素，也不改它所在的代码。',
	);
	lines.push('2. 改动与参照可以来自同一页：同一页里带 R 编号的那几处依然只读，只改 T 编号那几处。');
	lines.push('3. 每条改动下的「参照：」行写明照哪几条、照哪些维度；没写维度就整体对齐，多条说法冲突时以先列者为准。');
	lines.push('4. 改完逐条自检：T 编号每一处都改到位，「参照：」写到的维度都对齐，R 编号那几处一处没动。');
	// 自检之后追加，不动前面四条：编号是既成契约（提示词、面板、测试都按条号引用）。
	lines.push(
		'5. 带「原文」的是文案改动：只替换该元素里的文字，结构、样式、属性都不动；有「期望文案」就逐字换成它，没有就按改法重写并保持原意与信息量。',
	);

	for (const key of keysOf(references)) {
		const items = references.filter((pick) => keyOf(pick) === key);
		const sharesPage = targets.some((pick) => keyOf(pick) === key);
		lines.push('');
		lines.push(
			'## 参照 ' +
				labelOf(items[0]) +
				' — ' +
				titleOf(items) +
				(sharesPage ? '（本页同时有改动：只改 T 编号那几处，这里只读）' : '（只读参考：不改这处元素，也不改它的代码）'),
		);
		for (const item of items) pushPick(lines, item, code.get(String(item.id)) + '.');
	}

	let nth = 0;
	for (const key of keysOf(targets)) {
		const items = targets.filter((pick) => keyOf(pick) === key);
		const sharesPage = references.some((pick) => keyOf(pick) === key);
		lines.push('');
		lines.push('## 改动 — ' + titleOf(items) + (sharesPage ? '（待修改；本页参照只读）' : '（待修改）'));
		for (const pick of items) {
			pushPick(lines, pick, 'T' + ++nth + '.', { commentLabel: '改法' });
			const pairs = pairIdsOf(pick)
				.map((id) => list.find((item) => String(item.id) === id))
				.filter(Boolean);
			if (!pairs.length) {
				lines.push('   参照：未指定参照标注' + (references.length ? '（可按上面 R 编号的样式对齐）' : ''));
				continue;
			}
			const pairLabels = [];
			const dims = [];
			for (const pair of pairs) {
				const pairCode = code.get(String(pair.id));
				if (pairCode && !pairLabels.includes(pairCode)) pairLabels.push(pairCode);
				for (const dim of normalizeSpec(pair.spec)) if (!dims.includes(dim)) dims.push(dim);
			}
			lines.push(
				'   参照：' +
					pairLabels.join('、') +
					(dims.length ? ' 的' + dims.join('、') : '') +
					'（只改这一处，参照处只读）',
			);
		}
	}
	return lines.join('\n');
}

// PNG 的最小编解码：只做「截整视口 → 裁出元素」这一件事需要的那部分。
// 为什么不引第三方图像库：host 侧不允许第三方运行时依赖（见 AGENTS.md）。
// 为什么要在 Node 侧裁：Page.captureScreenshot 带 clip 时 Chrome 会把合成面换成
// clip 尺寸重渲染一帧再还原（实测约 60ms），肉眼就是一记闪屏；整视口截图不动渲染视口，没有这一帧。
// 支持的子集：bitDepth 8、colorType 0/2/4/6、非隔行 —— Chrome 的截图全部落在这里，其它形态返回 null 让调用方退回原图。

import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}
	return table;
})();

function crc32(buffer) {
	let c = -1;
	for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}

function chunk(type, data) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, 'ascii');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
	return Buffer.concat([head, data, crc]);
}

function parseChunks(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) return null;
	let offset = 8;
	let header = null;
	const idat = [];
	while (offset + 12 <= buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
		const start = offset + 8;
		const end = start + length;
		if (end + 4 > buffer.length) return null;
		const data = buffer.subarray(start, end);
		if (type === 'IHDR') {
			if (length < 13) return null;
			header = {
				width: data.readUInt32BE(0),
				height: data.readUInt32BE(4),
				bitDepth: data[8],
				colorType: data[9],
				interlace: data[12],
			};
		} else if (type === 'IDAT') idat.push(data);
		else if (type === 'IEND') break;
		offset = end + 4;
	}
	if (!header) return null;
	return { header, idat };
}

/** 只读尺寸，用于把 CSS 像素换算成截图里的设备像素（scale = 图像宽 / 视口宽）。 */
export function readPngSize(buffer) {
	const parsed = parseChunks(buffer);
	if (!parsed) return null;
	const { width, height } = parsed.header;
	if (!(width > 0) || !(height > 0)) return null;
	return { width, height };
}

/** 解成 {width, height, channels, data}（8 位，非隔行）；不支持的形态返回 null。 */
export function decodePng(buffer) {
	const parsed = parseChunks(buffer);
	if (!parsed) return null;
	const { width, height, bitDepth, colorType, interlace } = parsed.header;
	const channels = CHANNELS[colorType];
	if (bitDepth !== 8 || !channels || interlace !== 0) return null;
	if (!(width > 0) || !(height > 0) || parsed.idat.length === 0) return null;
	let raw;
	try {
		raw = zlib.inflateSync(Buffer.concat(parsed.idat));
	} catch {
		return null;
	}
	const stride = width * channels;
	if (raw.length < (stride + 1) * height) return null;
	const data = Buffer.alloc(stride * height);
	let prev = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const out = data.subarray(y * stride, (y + 1) * stride);
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? out[x - channels] : 0;
			const up = prev[x];
			const upLeft = x >= channels ? prev[x - channels] : 0;
			let value = line[x];
			if (filter === 1) value += left;
			else if (filter === 2) value += up;
			else if (filter === 3) value += (left + up) >> 1;
			else if (filter === 4) {
				const p = left + up - upLeft;
				const pa = Math.abs(p - left);
				const pb = Math.abs(p - up);
				const pc = Math.abs(p - upLeft);
				value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
			} else if (filter !== 0) return null;
			out[x] = value & 0xff;
		}
		prev = out;
	}
	return { width, height, channels, data };
}

/** 编码 8 位非隔行 PNG（每行 filter 0：够用，且不需要自适应代价）。 */
export function encodePng({ width, height, channels, data }) {
	const colorType = channels === 4 ? 6 : channels === 3 ? 2 : channels === 1 ? 0 : channels === 2 ? 4 : null;
	if (colorType === null) return null;
	if (!(width > 0) || !(height > 0) || !Buffer.isBuffer(data)) return null;
	const stride = width * channels;
	if (data.length < stride * height) return null;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = colorType;
	return Buffer.concat([
		SIGNATURE,
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

/**
 * 按像素矩形裁切。rect 超出画面时自动夹进边界；夹完为空返回 null。
 * 解不出来（非 Chrome 形态）也返回 null，调用方可以退回原图。
 */
export function cropPng(buffer, rect) {
	const image = decodePng(buffer);
	if (!image) return null;
	const rawX = Math.round(rect.x ?? 0);
	const rawY = Math.round(rect.y ?? 0);
	const rawWidth = Math.round(rect.width ?? 0);
	const rawHeight = Math.round(rect.height ?? 0);
	const x = Math.max(0, rawX);
	const y = Math.max(0, rawY);
	const width = Math.min(image.width, rawX + rawWidth) - x;
	const height = Math.min(image.height, rawY + rawHeight) - y;
	// 起点整个落在画面外（rawX >= width）时上面的差会是负数，这里一并挡掉。
	if (width < 1 || height < 1) return null;
	const channels = image.channels;
	const stride = image.width * channels;
	const data = Buffer.alloc(width * height * channels);
	for (let row = 0; row < height; row++) {
		image.data.copy(
			data,
			row * width * channels,
			(y + row) * stride + x * channels,
			(y + row) * stride + (x + width) * channels,
		);
	}
	return encodePng({ width, height, channels, data });
}

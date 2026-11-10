import assert from 'node:assert/strict';
import test from 'node:test';
import { cropPng, decodePng, encodePng, readPngSize } from '../lib/shared/png.js';

/** 造一张 width×height 的 RGBA 图，像素值由 fn(x, y) 决定。 */
function makeImage(width, height, fn) {
	const data = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [r, g, b, a] = fn(x, y);
			const at = (y * width + x) * 4;
			data[at] = r;
			data[at + 1] = g;
			data[at + 2] = b;
			data[at + 3] = a;
		}
	}
	return { width, height, channels: 4, data };
}

test('encodePng / decodePng 往返一致', () => {
	const image = makeImage(5, 3, (x, y) => [x * 40, y * 70, 200 - x * 10, 255]);
	const buffer = encodePng(image);
	assert.ok(Buffer.isBuffer(buffer));
	assert.deepEqual(readPngSize(buffer), { width: 5, height: 3 });
	const decoded = decodePng(buffer);
	assert.equal(decoded.width, 5);
	assert.equal(decoded.height, 3);
	assert.equal(decoded.channels, 4);
	assert.ok(decoded.data.equals(image.data));
});

test('cropPng 取出正确的子矩形', () => {
	const image = makeImage(8, 6, (x, y) => [x, y, x + y, 255]);
	const buffer = encodePng(image);
	const cropped = cropPng(buffer, { x: 2, y: 1, width: 3, height: 2 });
	assert.ok(Buffer.isBuffer(cropped));
	assert.deepEqual(readPngSize(cropped), { width: 3, height: 2 });
	const decoded = decodePng(cropped);
	assert.deepEqual([...decoded.data.subarray(0, 4)], [2, 1, 3, 255]);
	// 第 1 行第 2 列 = 原图 (4, 2)
	assert.deepEqual([...decoded.data.subarray((3 + 2) * 4, (3 + 2) * 4 + 4)], [4, 2, 6, 255]);
});

test('cropPng 把越界矩形夹进画面', () => {
	const buffer = encodePng(makeImage(4, 4, () => [9, 9, 9, 255]));
	const cropped = cropPng(buffer, { x: 3, y: 3, width: 40, height: 40 });
	assert.deepEqual(readPngSize(cropped), { width: 1, height: 1 });
	assert.equal(cropPng(buffer, { x: 99, y: 0, width: 4, height: 4 }), null);
});

test('非 PNG / 截断数据返回 null 而不是抛错', () => {
	assert.equal(decodePng(Buffer.from('not a png at all')), null);
	assert.equal(readPngSize(Buffer.from('not a png at all')), null);
	assert.equal(cropPng(Buffer.alloc(0), { x: 0, y: 0, width: 1, height: 1 }), null);
	const buffer = encodePng(makeImage(2, 2, () => [1, 2, 3, 255]));
	assert.equal(decodePng(buffer.subarray(0, 40)), null);
});

test('能解外部编码器产出的 PNG（1x1，colorType 6）', () => {
	// 标准 1x1 红点 PNG：用来证明解码器不是只认得自己写的文件。
	const external = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
		'base64',
	);
	const decoded = decodePng(external);
	assert.ok(decoded);
	assert.equal(decoded.width, 1);
	assert.equal(decoded.height, 1);
	assert.equal(decoded.channels, 4);
	assert.equal(decoded.data.length, 4);
});

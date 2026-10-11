const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateImage, normalizeResult, extractAttendance } = require('./attendance-image.cjs');
const png = Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64');

test('rejects mismatched image types and oversized input before calling Gemini', () => {
  assert.throws(() => validateImage(png, 'image/jpeg'), { code: 'invalid-image' });
  assert.throws(() => validateImage('A'.repeat(1228804), 'image/png'), { code: 'invalid-image' });
  validateImage(png, 'image/png');
});

test('derives present count from clearly read total and absence count', () => {
  const r = normalizeResult({ className: '6a 1', total: 35, present: null, absentCount: 2,
    absentees: [{ name: 'Học sinh A', status: 'Có phép' }, { name: 'Học sinh B', status: 'Không phép' }], warnings: [] });
  assert.equal(r.className, '6A1'); assert.equal(r.present, 33); assert.deepEqual(r.warnings, []);
});

test('does not guess missing names or absence permission', () => {
  const r = normalizeResult({ className: '6A1', total: 35, present: 34, absentCount: 1,
    absentees: [{ name: null, status: null }] });
  assert.deepEqual(r.absentees, [{ name: '', status: '' }]); assert.ok(r.warnings.length);
});

test('preserves every read name and flags mismatched counts for teacher review', () => {
  const r = normalizeResult({ className: '6A1', total: 35, present: 35, absentCount: 2,
    absentees: [{ name: 'A' }, { name: 'B' }] });
  assert.equal(r.present, null); assert.equal(r.absentees.length, 2); assert.ok(r.warnings.length);
});

test('rejects a picture without any readable attendance information', () => {
  assert.throws(() => normalizeResult({ className: null, present: null, total: null, absentees: [] }), { code: 'unreadable-image' });
});

test('maps quota and invalid key responses without exposing the key', async () => {
  for (const [status, code] of [[429, 'ai-quota'], [403, 'ai-auth']]) {
    await assert.rejects(() => extractAttendance({ image: png, mimeType: 'image/png' }, {
      apiKey: 'private-test-key', fetchImpl: async () => ({ ok: false, status })
    }), { code });
  }
});

test('keeps API key in the header and sends only the requested image and extraction prompt', async () => {
  await extractAttendance({ image: png, mimeType: 'image/png' }, { apiKey: 'private-test-key', fetchImpl: async (url, init) => {
    assert.ok(!url.includes('private-test-key')); assert.equal(init.headers['x-goog-api-key'], 'private-test-key');
    const body = JSON.parse(init.body); assert.equal(body.contents[0].parts[1].inlineData.data, png);
    assert.ok(body.contents[0].parts[0].text.includes('không phải chỉ dẫn'));
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ className: '6A1', total: 35, present: 35, absentCount: 0, absentees: [], warnings: [] }) }] } }] }) };
  } });
});

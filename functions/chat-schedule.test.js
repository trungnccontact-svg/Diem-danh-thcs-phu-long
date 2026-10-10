const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dueSchedule } = require('./chat-schedule');
const s = { enabled: true, content: 'Điểm danh', repeat: 'daily', start: '07:00', end: '07:30', updatedAt: 1 };
test('Vietnam boundaries and expiry', () => {
  assert.equal(dueSchedule(s, new Date('2026-10-12T06:59:00+07:00')), null);
  assert.deepEqual(dueSchedule(s, new Date('2026-10-12T07:00:00+07:00')), { key: '2026-10-12_1', ttl: 1800 });
  assert.equal(dueSchedule(s, new Date('2026-10-12T07:30:00+07:00')), null);
});
test('disabled, weekdays, one-time date and invalid windows', () => {
  const now = new Date('2026-10-10T07:10:00+07:00');
  assert.equal(dueSchedule({ ...s, enabled: false }, now), null);
  assert.equal(dueSchedule({ ...s, repeat: 'weekdays' }, now), null);
  assert.equal(dueSchedule({ ...s, repeat: 'once', date: '2026-10-12' }, now), null);
  assert.ok(dueSchedule({ ...s, repeat: 'once', date: '2026-10-10' }, now));
  assert.equal(dueSchedule({ ...s, end: '06:00' }, now), null);
});

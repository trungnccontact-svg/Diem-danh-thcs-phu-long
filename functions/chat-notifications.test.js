const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(values = {}, responses = []) {
  const records = new Map(Object.entries(values));
  const sends = [];
  const db = { ref(path) { return {
    async get() { return { val: () => records.get(path) || null }; },
    async transaction(fn) { const value = fn(records.get(path) || null); if (value === undefined) return { committed: false }; records.set(path, value); return { committed: true }; },
    async update(value) { records.set(path, { ...records.get(path), ...value }); },
    async set(value) { records.set(path, value); }
  }; } };
  const mockRequire = name => {
    if (name === 'firebase-functions/v2/https') return { onCall: (_, fn) => fn, HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } };
    if (name === 'firebase-functions/v2/database') return { onValueWritten: (_,fn) => fn };
    if (name === 'firebase-functions/v2/scheduler') return { onSchedule: (_,fn) => fn };
    if (name === 'firebase-admin/database') return { getDatabase: () => db };
    if (name === 'firebase-admin/messaging') return { getMessaging: () => ({ async sendEachForMulticast(payload) { sends.push(payload); return { responses: responses.length ? responses : payload.tokens.map(() => ({ success: true, messageId: 'fcm-test' })) }; } }) };
    return require(name);
  };
  const context = { exports: {}, require: mockRequire, console, Date };
  vm.runInNewContext(fs.readFileSync(require.resolve('./chat-notifications'), 'utf8'), context);
  return { records, sends, functions: context.exports, deliver: context.deliver };
}

test('saves real inbox and no-token delivery log; retries after device registers', async () => {
  const h = harness({});
  await h.deliver('teacher', 'reminder-1', { type: 'teacher-reminder', teacherUid: 'teacher', title: 'Nhắc nhở', body: 'Kiểm tra thông báo' });
  assert.equal(h.records.get('userNotifications/teacher/reminder-1').body, 'Kiểm tra thông báo');
  assert.equal(h.records.get('notificationLogs/teacher/reminder-1').status, 'no-token');
  h.records.set('fcmDevices/teacher', { edge: { token: 'edge-token' } });
  await h.deliver('teacher', 'reminder-1', { type: 'teacher-reminder', teacherUid: 'teacher', title: 'Nhắc nhở', body: 'Kiểm tra thông báo' });
  assert.equal(h.sends.length, 1);
  assert.equal(h.records.get('notificationLogs/teacher/reminder-1').status, 'accepted');
  await h.deliver('teacher', 'reminder-1', { type: 'teacher-reminder', teacherUid: 'teacher', title: 'Nhắc nhở', body: 'Kiểm tra thông báo' });
  assert.equal(h.sends.length, 1, 'duplicate event does not send again after accepted');
});

test('targets distinct devices once and records per-device failure', async () => {
  const h = harness({ 'users/admin': { role: 'admin' }, 'fcmDevices/teacher': { edge: { token: 'one' }, chrome: { token: 'two' } }, 'fcmTokens/teacher/token': 'one', 'fcmDevices/teacher/chrome': { token: 'two' } }, [{ success: true, messageId: 'one-ok' }, { success: false, error: { code: 'messaging/registration-token-not-registered' } }]);
  await h.deliver('teacher', 'reminder-1', { type: 'teacher-reminder', teacherUid: 'teacher', title: 'Nhắc nhở', body: 'Kiểm tra thông báo' });
  assert.equal(h.sends[0].tokens.length, 2);
  assert.equal(h.records.get('notificationLogs/teacher/reminder-1').accepted, 1);
  assert.equal(h.records.get('notificationLogs/teacher/reminder-1').failed, 1);
  assert.equal(h.records.get('fcmDevices/teacher/chrome'), null);
});

test('schedule audit persists actor and configuration', async () => {
  const h = harness();
  await h.functions.teacherScheduleAudit({ id: 'audit/event', params: { teacherUid: 'teacher' }, data: { after: { val: () => ({ enabled: false, updatedBy: 'admin', start: '07:00', end: '07:30' }) } } });
  const audit = h.records.get('scheduleLogs/teacher/audit_event');
  assert.equal(audit.actorUid, 'admin');
  assert.equal(audit.action, 'disabled');
});

 test('immediate notification requires admin scope and sends without a schedule', async () => {
  const h = harness({ 'users/admin': { role: 'admin', viewOnlyUids: ['teacher'] }, 'users/teacher': { role: 'teacher' }, 'fcmDevices/teacher': { phone: { token: 'phone-token' } } });
  const request = { auth: { uid: 'admin' }, data: { teacherUid: 'teacher', content: '  Gửi ngay  ', requestId: 'request-1' } };
  await assert.rejects(() => h.functions.sendTeacherNotificationNow({ data: request.data }), error => error.code === 'unauthenticated');
  await assert.rejects(() => h.functions.sendTeacherNotificationNow({ ...request, data: { ...request.data, teacherUid: 'other' } }), error => error.code === 'permission-denied');
  await assert.rejects(() => h.functions.sendTeacherNotificationNow({ ...request, data: { ...request.data, content: ' ' } }), error => error.code === 'invalid-argument');
  const result = await h.functions.sendTeacherNotificationNow(request);
  assert.equal(result.status, 'accepted');
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].notification.body, 'Gửi ngay');
  assert.equal(h.records.get('userNotifications/teacher/immediate_admin_request-1').body, 'Gửi ngay');
  await h.functions.sendTeacherNotificationNow(request);
  assert.equal(h.sends.length, 1);
 });

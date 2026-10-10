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
    if (name === 'firebase-functions/v2/database') return { onValueCreated: (_,fn) => fn, onValueWritten: (_,fn) => fn };
    if (name === 'firebase-functions/v2/scheduler') return { onSchedule: (_,fn) => fn };
    if (name === 'firebase-admin/database') return { getDatabase: () => db };
    if (name === 'firebase-admin/messaging') return { getMessaging: () => ({ async sendEachForMulticast(payload) { sends.push(payload); return { responses: responses.length ? responses : payload.tokens.map(() => ({ success: true, messageId: 'fcm-test' })) }; } }) };
    return require(name);
  };
  const context = { exports: {}, require: mockRequire, console, Date };
  vm.runInNewContext(fs.readFileSync(require.resolve('./chat-notifications'), 'utf8'), context);
  const event = (senderUid = 'admin', messageId = 'message-1') => ({ params: { teacherUid: 'teacher', messageId }, data: { val: () => ({ senderUid, text: 'Kiểm tra chat thật' }) } });
  return { records, sends, functions: context.exports, event };
}

test('saves real inbox and no-token delivery log; retries after device registers', async () => {
  const h = harness({ 'users/admin': { role: 'admin' } });
  await h.functions.teacherChatNotification(h.event());
  assert.equal(h.records.get('userNotifications/teacher/chat_message-1').body, 'Kiểm tra chat thật');
  assert.equal(h.records.get('notificationLogs/teacher/chat_message-1').status, 'no-token');
  h.records.set('fcmDevices/teacher', { edge: { token: 'edge-token' } });
  await h.functions.teacherChatNotification(h.event());
  assert.equal(h.sends.length, 1);
  assert.equal(h.records.get('notificationLogs/teacher/chat_message-1').status, 'accepted');
  await h.functions.teacherChatNotification(h.event());
  assert.equal(h.sends.length, 1, 'duplicate event does not send again after accepted');
});

test('targets distinct devices once and records per-device failure', async () => {
  const h = harness({ 'users/admin': { role: 'admin' }, 'fcmDevices/teacher': { edge: { token: 'one' }, chrome: { token: 'two' } }, 'fcmTokens/teacher/token': 'one', 'fcmDevices/teacher/chrome': { token: 'two' } }, [{ success: true, messageId: 'one-ok' }, { success: false, error: { code: 'messaging/registration-token-not-registered' } }]);
  await h.functions.teacherChatNotification(h.event());
  assert.equal(h.sends[0].tokens.length, 2);
  assert.equal(h.records.get('notificationLogs/teacher/chat_message-1').accepted, 1);
  assert.equal(h.records.get('notificationLogs/teacher/chat_message-1').failed, 1);
  assert.equal(h.records.get('fcmDevices/teacher/chrome'), null);
});

test('test teacher notifies eligible test admin, not production admins', async () => {
  const h = harness({ 'users/teacher': { role: 'teacher', isTestAccount: true, name: 'Teacher test' }, users: { realAdmin: { role: 'admin' }, testAdmin: { role: 'admin', isTestAccount: true, viewOnlyUids: ['teacher'] }, otherAdmin: { role: 'admin', isTestAccount: true, viewOnlyUids: ['other'] } } });
  await h.functions.teacherChatNotification(h.event('teacher'));
  assert.ok(h.records.has('userNotifications/testAdmin/chat_message-1'));
  assert.equal(h.records.has('userNotifications/realAdmin/chat_message-1'), false);
  assert.equal(h.records.has('userNotifications/otherAdmin/chat_message-1'), false);
});

test('schedule audit persists actor and configuration', async () => {
  const h = harness();
  await h.functions.teacherScheduleAudit({ id: 'audit/event', params: { teacherUid: 'teacher' }, data: { after: { val: () => ({ enabled: false, updatedBy: 'admin', start: '07:00', end: '07:30' }) } } });
  const audit = h.records.get('scheduleLogs/teacher/audit_event');
  assert.equal(audit.actorUid, 'admin');
  assert.equal(audit.action, 'disabled');
});

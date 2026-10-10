const { onValueCreated, onValueWritten } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');
const { dueSchedule } = require('./chat-schedule');

const DATABASE_REGION = 'us-central1';
const APP_URL = 'https://du-an-diem-danh-phu-long.web.app';

async function deliver(uid, id, notification, ttl = 3600) {
  const db = getDatabase();
  const inbox = db.ref(`userNotifications/${uid}/${id}`);
  await inbox.transaction(existing => existing || { ...notification, createdAt: Date.now(), readAt: 0 });
  const log = db.ref(`notificationLogs/${uid}/${id}`);
  const now = Date.now();
  const claim = await log.transaction(existing => {
    if (existing?.status === 'accepted' || (existing?.status === 'sending' && now - existing.at < 120000)) return;
    return { type: notification.type, teacherUid: notification.teacherUid, status: 'sending', at: now, attempts: (existing?.attempts || 0) + 1 };
  });
  if (!claim.committed) return;
  try {
    const devices = (await db.ref(`fcmDevices/${uid}`).get()).val() || {};
    const legacy = (await db.ref(`fcmTokens/${uid}/token`).get()).val();
    const tokens = [...new Set([...Object.values(devices).map(device => device.token), legacy].filter(Boolean))];
    if (!tokens.length) { await log.update({ status: 'no-token', at: Date.now(), detail: 'Thông báo đã lưu trong ứng dụng; chưa đăng ký push.' }); return; }
    const results = [];
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const response = await getMessaging().sendEachForMulticast({
        tokens: batch,
        notification: { title: notification.title, body: notification.body },
        data: { type: notification.type, teacherUid: notification.teacherUid, notificationId: id },
        android: { priority: 'high', ttl: ttl * 1000, notification: { channelId: 'attendance-reminders', sound: 'default' } },
        apns: { headers: { 'apns-expiration': String(Math.floor(Date.now() / 1000) + ttl) }, payload: { aps: { sound: 'default' } } },
        webpush: { headers: { TTL: String(ttl) }, fcmOptions: { link: `${APP_URL}/?chat=1&teacher=${encodeURIComponent(notification.teacherUid)}` } }
      });
      for (let n = 0; n < response.responses.length; n++) {
        const r = response.responses[n];
        results.push(r.success ? { status: 'accepted', messageId: r.messageId } : { status: 'failed', code: r.error?.code || 'unknown' });
        if (!r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(r.error?.code)) {
          const token = batch[n];
          for (const [deviceId, device] of Object.entries(devices)) if (device.token === token) await db.ref(`fcmDevices/${uid}/${deviceId}`).transaction(value => value?.token === token ? null : undefined);
          if (legacy === token) await db.ref(`fcmTokens/${uid}`).transaction(value => value?.token === token ? null : undefined);
        }
      }
    }
    const accepted = results.filter(result => result.status === 'accepted').length;
    await log.update({ status: accepted ? 'accepted' : 'failed', accepted, failed: results.length - accepted, results, at: Date.now() });
  } catch (error) { await log.update({ status: 'failed', code: error.code || 'unknown', at: Date.now() }); throw error; }
}

exports.teacherChatNotification = onValueCreated({ ref: '/teacherChats/{teacherUid}/messages/{messageId}', region: DATABASE_REGION, retry: true }, async event => {
  const db = getDatabase();
  const message = event.data.val();
  const teacherUid = event.params.teacherUid;
  const sender = (await db.ref(`users/${message.senderUid}`).get()).val();
  const id = `chat_${event.params.messageId}`;
  const value = { type: 'teacher-chat', teacherUid, messageId: event.params.messageId, title: sender?.role === 'admin' ? 'Tin nhắn từ admin' : `Tin nhắn từ ${sender?.name || 'giáo viên'}`, body: message.text.slice(0, 200) };
  if (sender?.role === 'admin') await deliver(teacherUid, id, value);
  else if (sender?.role === 'teacher' && message.senderUid === teacherUid) {
    const users = (await db.ref('users').get()).val() || {};
    await Promise.all(Object.entries(users).filter(([, user]) => user.role === 'admin' && (!sender.isTestAccount || user.isTestAccount) && (!user.viewOnlyUids?.length || user.viewOnlyUids.includes(teacherUid))).map(([uid]) => deliver(uid, id, value)));
  }
});

exports.teacherScheduleAudit = onValueWritten({ ref: '/teacherSchedules/{teacherUid}', region: DATABASE_REGION }, async event => {
  const schedule = event.data.after.val();
  const key = event.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  await getDatabase().ref(`scheduleLogs/${event.params.teacherUid}/${key}`).set({ action: !schedule ? 'deleted' : schedule.enabled ? 'enabled' : 'disabled', schedule: schedule || null, actorUid: schedule?.updatedBy || null, createdAt: Date.now() });
});

exports.personalTeacherReminders = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Asia/Ho_Chi_Minh', region: 'asia-southeast1' }, async () => {
  const db = getDatabase();
  const schedules = (await db.ref('teacherSchedules').get()).val() || {};
  const results = await Promise.allSettled(Object.entries(schedules).map(async ([uid, schedule]) => {
    const due = dueSchedule(schedule);
    if (!due || (await db.ref(`users/${uid}/role`).get()).val() !== 'teacher') return;
    // Recheck after reading users so a schedule disabled/edited meanwhile does not send.
    const current = (await db.ref(`teacherSchedules/${uid}`).get()).val();
    if (!current?.enabled || current.updatedAt !== schedule.updatedAt) return;
    await deliver(uid, `reminder_${due.key}`, { type: 'teacher-reminder', teacherUid: uid, title: 'Nhắc nhở từ admin', body: schedule.content }, due.ttl);
  }));
  results.forEach(result => { if (result.status === 'rejected') console.error('Personal reminder failed', result.reason); });
});

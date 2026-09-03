const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const { getDatabase } = require('firebase-admin/database');

initializeApp();
const openRouterKey = defineSecret('OPENROUTER_API_KEY');

const reminders = [
  { schedule: '50 6 * * 1-5', title: 'SẮP TỚI GIỜ ĐIỂM DANH TIẾT 1 BUỔI SÁNG', body: 'Vui lòng chuẩn bị điểm danh lớp học.' },
  { schedule: '40 7 * * 1-5', title: 'SẮP HẾT GIỜ ĐIỂM DANH TIẾT 1 BUỔI SÁNG', body: 'Hãy hoàn tất dữ liệu điểm danh.' },
  { schedule: '10 13 * * 1-5', title: 'SẮP TỚI GIỜ ĐIỂM DANH TIẾT 1 BUỔI CHIỀU', body: 'Vui lòng chuẩn bị điểm danh lớp học.' },
  { schedule: '55 13 * * 1-5', title: 'SẮP HẾT GIỜ ĐIỂM DANH TIẾT 1 BUỔI CHIỀU', body: 'Hãy hoàn tất dữ liệu điểm danh.' }
];

async function sendReminder(title, body) {
  // Đọc FCM token từ node 'fcmTokens/<userId>/token' (được lưu bởi NotificationService)
  const db = getDatabase();
  const snapshot = await db.ref('fcmTokens').once('value');

  // Tạo map: token → uid để dọn token hết hạn sau khi gửi
  const tokenMap = {}; // token -> uid
  snapshot.forEach(child => {
    const val = child.val();
    if (val?.token) tokenMap[val.token] = child.key;
  });
  const tokens = Object.keys(tokenMap);

  // Fallback: cũng kiểm tra node 'users' nếu có fcmToken cũ
  if (!tokens.length) {
    const usersSnap = await db.ref('users').orderByChild('fcmToken').once('value');
    usersSnap.forEach(child => { if (child.val()?.fcmToken) tokens.push(child.val().fcmToken); });
  }

  if (!tokens.length) return { sent: 0 };

  // TTL: thông báo tự hủy sau 1 tiếng nếu thiết bị offline (tránh giao trễ hàng loạt)
  const TTL_SECONDS = 3600;
  const response = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: { type: 'attendance-reminder' },
    android: {
      ttl: TTL_SECONDS * 1000, // Android tính bằng milliseconds
      notification: { sound: 'default', channelId: 'attendance-reminders' }
    },
    webpush: {
      headers: { TTL: String(TTL_SECONDS) }, // Web Push tính bằng giây (dạng string)
      notification: {
        sound: '/notification-sound.mp3'
      }
    }
  });

  // Tự động xóa token hết hạn (NotRegistered, InvalidRegistration)
  const INVALID_ERRORS = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'];
  const cleanupPromises = [];
  response.responses.forEach((r, i) => {
    if (!r.success && INVALID_ERRORS.includes(r.error?.code)) {
      const uid = tokenMap[tokens[i]];
      if (uid) {
        console.log(`[FCM] Xóa token hết hạn của uid: ${uid}`);
        cleanupPromises.push(db.ref(`fcmTokens/${uid}`).remove());
      }
    }
  });
  await Promise.all(cleanupPromises);

  return { sent: response.successCount, failed: response.failureCount };
}

reminders.forEach((item, index) => {
  exports[`attendanceReminder${index + 1}`] = onSchedule({ schedule: item.schedule, timeZone: 'Asia/Ho_Chi_Minh' }, async () => sendReminder(item.title, item.body));
});

exports.askAssistant = onRequest({ secrets: [openRouterKey], cors: true }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.body?.message) return res.status(400).json({ error: 'message is required' });
  const key = openRouterKey.value();
  if (!key) return res.status(503).json({ error: 'AI service is not configured' });
  const prompt = `Bạn là trợ lý Phú Long trong môi trường trường THCS. Chỉ trả lời lịch sự, an toàn, phù hợp giáo dục và hỗ trợ nghiệp vụ giáo viên. Câu hỏi: ${String(req.body.message).slice(0, 2000)}`;
  const models = ['openrouter/free', 'meta-llama/llama-3.3-8b-instruct:free'];
  for (const model of models) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://diem-danh-hoc-sinh-thcs-pl.web.app' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.3 }) });
      if (response.ok) {
        const data = await response.json();
        return res.json({ answer: data.choices?.[0]?.message?.content || 'Tôi chưa có câu trả lời phù hợp.', model });
      }
    } catch (_) { /* tiếp tục model fallback */ }
  }
  return res.status(503).json({ error: 'AI providers unavailable' });
});

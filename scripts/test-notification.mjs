/**
 * Script test gửi push notification qua Firebase Cloud Messaging (FCM)
 * Dùng để kiểm tra thông báo trên điện thoại thật (iOS/Android)
 *
 * Cách dùng:
 *   node scripts/test-notification.mjs [--all | --token <FCM_TOKEN> | --topic <topic>] [--type <loai>]
 *
 * Ví dụ:
 *   node scripts/test-notification.mjs --all
 *   node scripts/test-notification.mjs --all --type afternoon
 *   node scripts/test-notification.mjs --token <FCM_TOKEN_CUA_DIEN_THOAI>
 *
 * Biến môi trường cần thiết:
 *   GOOGLE_APPLICATION_CREDENTIALS  : đường dẫn đến file service-account JSON
 *   FIREBASE_DATABASE_URL            : URL Firebase Realtime Database
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { getDatabase } from 'firebase-admin/database';
import fs from 'node:fs';
import process from 'node:process';

// ─── Đọc tham số dòng lệnh ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const has = (flag) => args.includes(flag);

const sendAll     = has('--all');
const tokenArg    = get('--token');
const topicArg    = get('--topic');
const typeArg     = get('--type') || 'morning-start'; // loại thông báo mặc định
const platformArg = get('--platform') || null;        // lọc theo platform: android | ios | web

// IS_TEST_RUN=true → chạy tay (workflow_dispatch) → có prefix [TEST]
// IS_TEST_RUN=false/không set → cron tự động → không có prefix [TEST]
const IS_TEST = process.env.IS_TEST_RUN === 'true';
const PREFIX  = IS_TEST ? '[TEST] ' : '';

// ─── Định nghĩa các loại thông báo ──────────────────────────────────────────
const NOTIFICATION_TYPES = {
  'morning-start': {
    title: 'SẮP TỚI GIỜ ĐIỂM DANH TIẾT 1 BUỔI SÁNG',
    body:  'Vui lòng chuẩn bị điểm danh lớp học.',
  },
  'morning-end': {
    title: 'SẮP HẾT GIỜ ĐIỂM DANH TIẾT 1 BUỔI SÁNG',
    body:  'Hãy hoàn tất dữ liệu điểm danh.',
  },
  'afternoon-start': {
    title: 'SẮP TỚI GIỜ ĐIỂM DANH TIẾT 1 BUỔI CHIỀU',
    body:  'Vui lòng chuẩn bị điểm danh lớp học.',
  },
  'afternoon-end': {
    title: 'SẮP HẾT GIỜ ĐIỂM DANH TIẾT 1 BUỔI CHIỀU',
    body:  'Hãy hoàn tất dữ liệu điểm danh.',
  },
  'custom': {
    title: '🔔 [TEST] Thông báo thử nghiệm',
    body:  `Thông báo gửi lúc ${new Date().toLocaleTimeString('vi-VN')} ngày ${new Date().toLocaleDateString('vi-VN')}`,
  },
};

const notification = NOTIFICATION_TYPES[typeArg] ?? NOTIFICATION_TYPES['custom'];

// ─── Khởi tạo Firebase Admin ─────────────────────────────────────────────────
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const dbUrl    = process.env.FIREBASE_DATABASE_URL;

if (!credPath || !dbUrl) {
  console.error('❌ Thiếu biến môi trường!');
  console.error('   Set-Item Env:GOOGLE_APPLICATION_CREDENTIALS "n:\\SOURCE-diem-danh-phu-long\\diem-danh-thcs-phu-long-firebase-adminsdk-fbsvc-0ce1d27380.json"');
  console.error('   Set-Item Env:FIREBASE_DATABASE_URL "https://diem-danh-thcs-phu-long-default-rtdb.firebaseio.com"');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
initializeApp({ credential: cert(serviceAccount), databaseURL: dbUrl });

const messaging = getMessaging();

// ─── Hàm gửi thông báo ───────────────────────────────────────────────────────
async function buildMessage(target) {
  return {
    ...target,
    notification: {
      title: `${PREFIX}${notification.title}`,
      body: notification.body,
    },
    data: {
      type:      'attendance-reminder',
      timestamp: new Date().toISOString(),
      test:      IS_TEST ? 'true' : 'false',
    },
    apns: {
      headers: { 'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600) }, // TTL 1 giờ
      payload: {
        aps: {
          alert: {
            title: `${PREFIX}${notification.title}`,
            body:  notification.body,
          },
          sound: 'default',
          badge: 1,
        },
      },
    },
    android: {
      ttl: 3600000, // TTL 1 giờ (ms) — tránh thông báo tồn đọng khi thiết bị offline
      notification: {
        sound:     'default',
        channelId: 'attendance-reminders',
        priority:  'high',
      },
    },
    webpush: {
      headers: { TTL: '3600' }, // TTL 1 giờ (giây)
      notification: {
        sound: '/notification-sound.mp3'
      }
    }
  };
}

async function sendToToken(token) {
  try {
    const msg = await buildMessage({ token });
    const result = await messaging.send(msg);
    console.log(`✅ Gửi thành công → ${token.slice(0, 20)}...`);
    console.log(`   Message ID: ${result}`);
    return true;
  } catch (err) {
    console.error(`❌ Gửi thất bại → ${token.slice(0, 20)}...`);
    console.error(`   Lỗi: ${err.message}`);
    return false;
  }
}

async function sendToTopic(topic) {
  const msg = await buildMessage({ topic });
  const result = await messaging.send(msg);
  console.log(`✅ Gửi thành công → topic: ${topic}`);
  console.log(`   Message ID: ${result}`);
}

async function sendToAllUsers() {
  const db = getDatabase();
  console.log('🔍 Đang lấy danh sách FCM token từ Firebase (node: fcmTokens)...');
  const snapshot = await db.ref('fcmTokens').once('value');

  const tokens = [];
  const names  = {};
  if (snapshot.exists()) {
    snapshot.forEach(child => {
      const val = child.val();
      const platform = val?.platform || 'web';
      if (val?.token && (!platformArg || platform === platformArg)) {
        tokens.push(val.token);
        names[val.token] = child.key + ` (${platform})`;
      }
    });
  }

  // Cũng thử đọc từ users node (nếu có fcmToken lưu theo UID cũ)
  const usersSnap = await db.ref('users').orderByChild('fcmToken').once('value');
  usersSnap.forEach(child => {
    const val = child.val();
    if (val?.fcmToken && !tokens.includes(val.fcmToken)) {
      tokens.push(val.fcmToken);
      names[val.fcmToken] = (val.name || child.key) + ' (users node)';
    }
  });

  if (!tokens.length) {
    console.warn('⚠️  Không tìm thấy FCM token nào trong database.');
    console.warn('   Hãy đảm bảo đã đăng nhập app và cấp quyền thông báo trên điện thoại.');
    return;
  }

  console.log(`📱 Tìm thấy ${tokens.length} thiết bị:\n`);
  tokens.forEach((t, i) => console.log(`   ${i + 1}. ${names[t]} — ${t.slice(0, 30)}...`));
  console.log('');

  const result = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: `${PREFIX}${notification.title}`,
      body:  notification.body,
    },
    data: { type: 'attendance-reminder', test: IS_TEST ? 'true' : 'false', timestamp: new Date().toISOString() },
    apns: {
      headers: { 'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600) }, // TTL 1 giờ
      payload: {
        aps: {
          alert: { title: `${PREFIX}${notification.title}`, body: notification.body },
          sound: 'default',
          badge: 1,
        },
      },
    },
    android: {
      ttl: 3600000, // TTL 1 giờ (ms) — tránh thông báo tồn đọng khi thiết bị offline
      notification: { sound: 'default', channelId: 'attendance-reminders', priority: 'high' },
    },
    webpush: {
      headers: { TTL: '3600' }, // TTL 1 giờ (giây)
      notification: {
        sound: '/notification-sound.mp3'
      }
    }
  });

  console.log(`📊 Kết quả: ${result.successCount} thành công / ${result.failureCount} thất bại`);
  result.responses.forEach((r, i) => {
    if (!r.success) {
      console.error(`   ❌ [${names[tokens[i]]}]: ${r.error?.message}`);
    }
  });
}

// ─── Chạy chính ───────────────────────────────────────────────────────────────
console.log('━'.repeat(60));
console.log('🔔 FIREBASE FCM TEST NOTIFICATION TOOL');
console.log('━'.repeat(60));
console.log(`📌 Loại thông báo : ${typeArg}`);
console.log(`📌 Chế độ          : ${IS_TEST ? '🧪 TEST (có prefix [TEST])' : '🚀 PRODUCTION (không có prefix)'}`);
console.log(`📌 Tiêu đề         : ${PREFIX}${notification.title}`);
console.log(`📌 Nội dung        : ${notification.body}`);
console.log('━'.repeat(60));
console.log('');

if (sendAll) {
  await sendToAllUsers();
} else if (tokenArg) {
  await sendToToken(tokenArg);
} else if (topicArg) {
  await sendToTopic(topicArg);
} else {
  console.log('ℹ️  Cách dùng:');
  console.log('');
  console.log('  Gửi đến TẤT CẢ người dùng trong database:');
  console.log('    node scripts/test-notification.mjs --all');
  console.log('');
  console.log('  Gửi đến thiết bị cụ thể (theo FCM token):');
  console.log('    node scripts/test-notification.mjs --token <FCM_TOKEN>');
  console.log('');
  console.log('  Các loại thông báo (--type):');
  Object.keys(NOTIFICATION_TYPES).forEach(k => {
    console.log(`    --type ${k.padEnd(18)} → ${NOTIFICATION_TYPES[k].title}`);
  });
  console.log('');
  console.log('  Ví dụ:');
  console.log('    node scripts/test-notification.mjs --all --type afternoon-start');
  console.log('    node scripts/test-notification.mjs --all --type custom');
  console.log('');
}

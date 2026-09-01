import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

// ─── Cấu hình ───────────────────────────────────────────────────────────────
const saPath = path.resolve('diem-danh-thcs-phu-long-firebase-adminsdk-fbsvc-0ce1d27380.json');
const databaseURL = 'https://diem-danh-thcs-phu-long-default-rtdb.firebaseio.com';

if (!fs.existsSync(saPath)) {
  console.error(`❌ Không tìm thấy file service account tại: ${saPath}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
initializeApp({ credential: cert(serviceAccount), databaseURL });

const auth = getAuth();
const db = getDatabase();

const DEFAULT_PASSWORD = 'Phulong@2026';
const USERS = ['test0', 'test1', 'test2', 'test3'];

// ─── Helper: tạo hoặc cập nhật user trong Firebase Auth ─────────────────────
async function upsertUser(email, password, displayName) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`ℹ️  ${email} đã tồn tại (UID: ${user.uid}). Đang cập nhật...`);
    await auth.updateUser(user.uid, { password, displayName });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      user = await auth.createUser({ email, password, displayName });
      console.log(`✅ Đã tạo Auth user ${email} (UID: ${user.uid})`);
    } else {
      throw err;
    }
  }
  return user;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Tạo 4 tài khoản test cho hệ thống điểm danh Phú Long');
  console.log(`   Mật khẩu mặc định: ${DEFAULT_PASSWORD}\n`);

  for (const username of USERS) {
    const email = `${username}@phulong.edu.vn`;
    const name = `Tài khoản ${username.toUpperCase()}`;
    const phone = '0000000000'; // Default phone placeholder
    
    console.log(`🧪 Đang tạo tài khoản ${username}...`);
    const user = await upsertUser(email, DEFAULT_PASSWORD, name);

    // Thiết lập custom claims (mặc định là vai trò giáo viên / teacher)
    await auth.setCustomUserClaims(user.uid, { role: 'teacher', isTestAccount: true });

    // Lưu vào Realtime Database
    await db.ref(`users/${user.uid}`).set({
      name,
      phone,
      role: 'teacher',
      email,
      isTestAccount: true,
      createdAt: new Date().toISOString()
    });

    console.log(`✅ Đã lưu profile ${username} vào Database (users/${user.uid})`);
    console.log(`   👉 Tên đăng nhập: ${username}`);
    console.log(`   👉 Mật khẩu: ${DEFAULT_PASSWORD}\n`);
  }

  console.log('🎉 HOÀN TẤT!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Lỗi:', err);
  process.exit(1);
});

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

// ─── 1. Tài khoản giáo viên test: testuser ──────────────────────────────────
async function createTestTeacher() {
  const email = 'testuser@phulong.edu.vn';
  const name = 'Test Teacher';
  const phone = '0000000001';

  console.log('\n🧪 Đang tạo tài khoản giáo viên test...');
  const user = await upsertUser(email, DEFAULT_PASSWORD, name);

  // Custom claims: role = teacher, isTestAccount = true (để bypass ràng buộc thời gian)
  await auth.setCustomUserClaims(user.uid, { role: 'teacher', isTestAccount: true });

  // Lưu vào Realtime Database với flag isTestAccount
  await db.ref(`users/${user.uid}`).set({
    name,
    phone,
    role: 'teacher',
    email,
    isTestAccount: true,   // ← flag này giúp frontend bỏ qua kiểm tra giờ điểm danh
    createdAt: new Date().toISOString()
  });

  console.log(`✅ Đã lưu profile testuser vào Database (users/${user.uid})`);
  console.log(`   👉 Tên đăng nhập: testuser`);
  console.log(`   👉 Mật khẩu: ${DEFAULT_PASSWORD}`);
  return user.uid;
}

// ─── 2. Tài khoản admin test: testadmin ─────────────────────────────────────
async function createTestAdmin(testTeacherUid) {
  const email = 'testadmin@phulong.edu.vn';
  const name = 'Test Admin';
  const phone = '0000000002';

  console.log('\n🧪 Đang tạo tài khoản admin test...');
  const user = await upsertUser(email, DEFAULT_PASSWORD, name);

  // Custom claims: role = admin, isTestAccount = true
  await auth.setCustomUserClaims(user.uid, {
    role: 'admin',
    isTestAccount: true
  });

  // Lưu vào Realtime Database với viewOnlyUids = [testTeacherUid]
  await db.ref(`users/${user.uid}`).set({
    name,
    phone,
    role: 'admin',
    email,
    isTestAccount: true,
    viewOnlyUids: [testTeacherUid],  // ← mảng UID mà admin test này được phép xem
    createdAt: new Date().toISOString()
  });

  console.log(`✅ Đã lưu profile testadmin vào Database (users/${user.uid})`);
  console.log(`   👉 Tên đăng nhập: testadmin`);
  console.log(`   👉 Mật khẩu: ${DEFAULT_PASSWORD}`);
  console.log(`   👉 Chỉ xem dữ liệu của testuser (UID: ${testTeacherUid})`);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Tạo tài khoản test cho hệ thống điểm danh Phú Long');
  console.log(`   Mật khẩu mặc định: ${DEFAULT_PASSWORD}\n`);

  const testTeacherUid = await createTestTeacher();
  await createTestAdmin(testTeacherUid);

  console.log('\n🎉 HOÀN TẤT! Các tài khoản test đã sẵn sàng:');
  console.log('   testuser  → Giáo viên (không bị ràng buộc thời gian điểm danh)');
  console.log('   testadmin → Admin (chỉ thấy dữ liệu của testuser)');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Lỗi:', err);
  process.exit(1);
});

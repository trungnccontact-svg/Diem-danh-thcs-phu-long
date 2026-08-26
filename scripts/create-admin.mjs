import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

// 1. Cấu hình service account và database URL
const saPath = path.resolve('diem-danh-thcs-phu-long-firebase-adminsdk-fbsvc-0ce1d27380.json');
const databaseURL = 'https://diem-danh-thcs-phu-long-default-rtdb.firebaseio.com';

if (!fs.existsSync(saPath)) {
  console.error(`❌ Không tìm thấy file service account tại: ${saPath}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));

initializeApp({
  credential: cert(serviceAccount),
  databaseURL: databaseURL
});

const auth = getAuth();
const db = getDatabase();

async function createAdmin() {
  const email = 'admin@phulong.edu.vn'; // Khi gõ tên đăng nhập "admin", hệ thống sẽ tự động ghép thành admin@phulong.edu.vn
  const password = process.argv[2] || 'Phulong@2026';
  const name = 'Quản Trị Viên';
  const phone = '0900000000';

  console.log(`🚀 Đang khởi tạo tài khoản Admin:`);
  console.log(`   - Tên đăng nhập: admin (hoặc ${email})`);
  console.log(`   - Mật khẩu: ${password}`);

  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`ℹ️ Tài khoản ${email} đã tồn tại trong Auth (UID: ${user.uid}). Đang cập nhật mật khẩu và thông tin...`);
    await auth.updateUser(user.uid, {
      password: password,
      displayName: name
    });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      user = await auth.createUser({
        email: email,
        password: password,
        displayName: name
      });
      console.log(`✅ Đã tạo tài khoản trong Firebase Auth (UID: ${user.uid})`);
    } else {
      throw err;
    }
  }

  // Set Custom Claims role = admin
  await auth.setCustomUserClaims(user.uid, { role: 'admin' });

  // Lưu thông tin vào Realtime Database tại node users/{uid}
  await db.ref(`users/${user.uid}`).set({
    name: name,
    phone: phone,
    role: 'admin',
    email: email,
    createdAt: new Date().toISOString()
  });

  console.log(`✅ Đã lưu profile Admin vào Realtime Database: users/${user.uid}`);
  console.log(`🎉 HOÀN TẤT! Bạn có thể đăng nhập bằng:`);
  console.log(`   👉 Tên đăng nhập: admin`);
  console.log(`   👉 Mật khẩu: ${password}`);
  process.exit(0);
}

createAdmin().catch(err => {
  console.error('❌ Lỗi khi tạo tài khoản Admin:', err);
  process.exit(1);
});

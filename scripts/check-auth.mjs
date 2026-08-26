import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'node:fs';
import process from 'node:process';

const sa = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
initializeApp({ credential: cert(sa) });
const auth = getAuth();

try {
  console.log('🔍 Đang kiểm tra danh sách tài khoản trên Firebase Auth...');
  const listUsers = await auth.listUsers(10);
  if (listUsers.users.length === 0) {
    console.log('⚠️  Firebase Authentication chưa có tài khoản nào! Hãy chạy script import giáo viên.');
  } else {
    console.log(`📱 Tìm thấy ${listUsers.users.length} tài khoản trong Auth:`);
    listUsers.users.forEach(user => {
      console.log(`  - Email: ${user.email} | DisplayName: ${user.displayName} | UID: ${user.uid}`);
    });
  }
} catch (error) {
  console.error('❌ Lỗi khi lấy danh sách auth:', error.message);
}

import fs from 'node:fs';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

const projectId = 'du-an-phu-long';
const databaseURL = 'https://du-an-phu-long-default-rtdb.asia-southeast1.firebasedatabase.app';
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const password = process.env.CHAT_TEST_PASSWORD;
if (!keyPath || !password || password.length < 6) {
  console.error('Cần GOOGLE_APPLICATION_CREDENTIALS (file service account đúng dự án) và CHAT_TEST_PASSWORD (ít nhất 6 ký tự).');
  process.exit(1);
}
const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (key.project_id !== projectId) throw new Error('Service account thuộc dự án khác; dừng để tránh ghi nhầm.');
const app = initializeApp({ credential: cert(key), projectId, databaseURL });
const auth = getAuth(app);
const db = getDatabase(app);

async function provision(username, role, name, extra = {}) {
  const email = `${username}@phulong.edu.vn`;
  let user;
  try { user = await auth.getUserByEmail(email); }
  catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  if (user) {
    const profile = (await db.ref(`users/${user.uid}`).get()).val();
    if (!profile?.isTestAccount || profile.role !== role) throw new Error(`Không sửa tài khoản có sẵn chưa được xác nhận là test: ${email}`);
    if (user.disabled) throw new Error(`Tài khoản test đang bị khóa: ${email}`);
    console.log(`${username}: đã tồn tại, giữ nguyên mật khẩu.`);
  } else {
    user = await auth.createUser({ email, password, displayName: name });
    await db.ref(`users/${user.uid}`).set({ name, email, role, isTestAccount: true, createdAt: new Date().toISOString(), ...extra });
    console.log(`${username}: đã tạo.`);
  }
  await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role, isTestAccount: true });
  if (role === 'admin') await db.ref(`users/${user.uid}/viewOnlyUids`).set(extra.viewOnlyUids);
  console.log(`Profile: users/${user.uid}`);
  return user.uid;
}

try {
  const uid = await provision('testuser', 'teacher', 'Giáo viên thử nghiệm', { className: '6A1', phone: '0000000001' });
  await provision('testadmin', 'admin', 'Admin thử nghiệm', { phone: '0000000002', viewOnlyUids: [uid] });
  console.log('Mở http://localhost:4200/ → đăng nhập testadmin hoặc testuser → Chat & thông báo. Mật khẩu tài khoản mới là CHAT_TEST_PASSWORD bạn đã đặt.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await deleteApp(app); }

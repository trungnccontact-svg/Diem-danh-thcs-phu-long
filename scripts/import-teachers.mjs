import fs from 'node:fs';
import process from 'node:process';
import XLSX from 'xlsx';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

const input = process.argv[2] || '../DSGiáoviênthcsPhúLong.xlsx';
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const databaseURL = process.env.FIREBASE_DATABASE_URL;
if (!serviceAccountPath || !databaseURL) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS and FIREBASE_DATABASE_URL before running.');

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
initializeApp({ credential: cert(serviceAccount), databaseURL });
const workbook = XLSX.readFile(input);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
const auth = getAuth();
const db = getDatabase();
const defaultPassword = process.env.DEFAULT_TEACHER_PASSWORD;
if (!defaultPassword) throw new Error('Set DEFAULT_TEACHER_PASSWORD explicitly; it is intentionally not hardcoded.');

const slug = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
for (const row of rows) {
  const name = String(row['Họ tên'] || row['Họ tên'] || row['Họ và tên'] || row['Tên'] || row['__EMPTY'] || '').trim();
  if (!name || name === 'Họ tên' || name === 'Họ và tên' || name === 'Tên') continue;
  let phone = String(row['Điện thoại'] || row['Số điện thoại'] || row['Điện Thoại'] || row['__EMPTY_2'] || '').trim();
  if (phone === 'Điện thoại' || phone === 'Số điện thoại' || phone === 'Điện Thoại') phone = '';
  const email = `${slug(name)}@phulong.edu.vn`;
  let user;
  try { user = await auth.getUserByEmail(email); }
  catch (_) { user = await auth.createUser({ email, displayName: name, password: defaultPassword }); }
  await auth.setCustomUserClaims(user.uid, { role: 'teacher', mustChangePassword: true });
  await db.ref(`users/${user.uid}`).set({ name, phone, role: 'teacher', email, mustChangePassword: true, importedAt: new Date().toISOString() });
  console.log(`Imported ${name} (${email})`);
}

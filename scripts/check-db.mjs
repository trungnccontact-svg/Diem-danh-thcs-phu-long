import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import fs from 'node:fs';
import process from 'node:process';

const sa = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: process.env.FIREBASE_DATABASE_URL });
const db = getDatabase();

const snap = await db.ref('users').once('value');
console.log('users tồn tại:', snap.exists());

if (snap.exists()) {
  snap.forEach(child => {
    const v = child.val();
    console.log(`  [${child.key}] name="${v.name || 'N/A'}" | fcmToken=${v.fcmToken ? v.fcmToken.slice(0, 30) + '...' : 'KHÔNG CÓ'} | platform=${v.platform || 'N/A'}`);
  });
} else {
  console.log('  ⚠️  Không có user nào trong database');
}

import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';
import fs from 'node:fs';
import process from 'node:process';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const confirmDelete = has('--confirm');
const invalidOnly   = has('--invalid-only');

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const dbUrl    = process.env.FIREBASE_DATABASE_URL;

if (!credPath || !dbUrl) {
  console.error('Thieu bien moi truong GOOGLE_APPLICATION_CREDENTIALS va FIREBASE_DATABASE_URL');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
initializeApp({ credential: cert(serviceAccount), databaseURL: dbUrl });

const db        = getDatabase();
const messaging = getMessaging();

console.log('='.repeat(60));
console.log('FIREBASE FCM TOKEN RESET TOOL');
console.log('='.repeat(60));

const snapshot = await db.ref('fcmTokens').once('value');
if (!snapshot.exists()) {
  console.log('Khong co token nao trong database.');
  process.exit(0);
}

const entries = [];
snapshot.forEach(child => {
  const val = child.val();
  if (val && val.token) {
    entries.push({ uid: child.key, token: val.token, platform: val.platform || 'web', updatedAt: val.updatedAt || 'N/A' });
  }
});

console.log('Tim thay ' + entries.length + ' thiet bi:\n');
entries.forEach((e, i) => {
  console.log('  ' + (i + 1) + '. [' + e.uid + '] (' + e.platform + ') - ' + e.token.slice(0, 30) + '...');
  console.log('     Cap nhat luc: ' + e.updatedAt);
});
console.log('');

if (invalidOnly) {
  console.log('Dang kiem tra trang thai tung token voi FCM (dry-run)...');
  const invalidUids = [];

  for (const e of entries) {
    try {
      await messaging.send({ token: e.token, data: { ping: 'true' } }, true);
      console.log('  OK  [' + e.uid + ' (' + e.platform + ')] token hop le');
    } catch (err) {
      const code = (err.errorInfo && err.errorInfo.code) || err.code || err.message || '';
      const isInvalid = code.includes('registration-token-not-registered') || code.includes('NotRegistered');
      if (isInvalid) {
        console.log('  XX  [' + e.uid + ' (' + e.platform + ')] token HET HAN');
        invalidUids.push(e.uid);
      } else {
        console.log('  ??  [' + e.uid + ' (' + e.platform + ')] loi khac: ' + code);
      }
    }
  }

  console.log('');
  if (!invalidUids.length) {
    console.log('Khong co token nao het han.');
    process.exit(0);
  }

  console.log('Tim thay ' + invalidUids.length + ' token het han.');

  if (confirmDelete) {
    for (const uid of invalidUids) {
      await db.ref('fcmTokens/' + uid).remove();
      console.log('  Xoa token [' + uid + ']');
    }
    console.log('\nDa xoa ' + invalidUids.length + ' token het han.');
    console.log('Yeu cau cac thiet bi dang nhap lai de lay token moi.');
  } else {
    console.log('Them --confirm de xoa that su.');
  }

} else if (confirmDelete) {
  console.log('Dang xoa TAT CA ' + entries.length + ' FCM token...');
  for (const e of entries) {
    await db.ref('fcmTokens/' + e.uid).remove();
    console.log('  Xoa [' + e.uid + '] (' + e.platform + ')');
  }
  console.log('\nDa xoa ' + entries.length + ' token.');
  console.log('Yeu cau cac thiet bi dang nhap lai de lay token moi.');

} else {
  console.log('Cach dung:');
  console.log('  Xem danh sach: node scripts/reset-fcm-tokens.mjs');
  console.log('  Xoa chi token het han: node scripts/reset-fcm-tokens.mjs --invalid-only --confirm');
  console.log('  Xoa TAT CA: node scripts/reset-fcm-tokens.mjs --confirm');
}
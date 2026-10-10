// Two independent authenticated Firebase clients. Only runs against existing test accounts.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getDatabase, ref, get, set, push, onValue, serverTimestamp } from 'firebase/database';

const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/environments/environment.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const config = context.exports.environment.firebase;
if (!config.databaseURL) throw new Error('Chưa có databaseURL của dự án mới.');
for (const name of ['CHAT_TEST_ADMIN_EMAIL', 'CHAT_TEST_ADMIN_PASSWORD', 'CHAT_TEST_TEACHER_EMAIL', 'CHAT_TEST_TEACHER_PASSWORD']) if (!process.env[name]) throw new Error(`Thiếu biến môi trường ${name}`);
const apps = [initializeApp(config, 'chat-test-admin'), initializeApp(config, 'chat-test-teacher')];
const auths = apps.map(getAuth);
const dbs = apps.map(app => getDatabase(app, config.databaseURL));
function waitFor(db, path, predicate) {
  return new Promise((resolve, reject) => {
    let stop = () => {};
    const timeout = setTimeout(() => { stop(); reject(new Error(`Timeout chờ ${path}`)); }, 60000);
    stop = onValue(ref(db, path), snapshot => { if (predicate(snapshot.val())) { clearTimeout(timeout); stop(); resolve(snapshot.val()); } }, error => { clearTimeout(timeout); stop(); reject(error); });
  });
}
try {
  const actors = await Promise.all([
    signInWithEmailAndPassword(auths[0], process.env['CHAT_TEST_ADMIN_EMAIL'], process.env['CHAT_TEST_ADMIN_PASSWORD']),
    signInWithEmailAndPassword(auths[1], process.env['CHAT_TEST_TEACHER_EMAIL'], process.env['CHAT_TEST_TEACHER_PASSWORD'])
  ]);
  const profiles = await Promise.all(actors.map((actor, i) => get(ref(dbs[i], `users/${actor.user.uid}`)).then(snapshot => snapshot.val())));
  assert.equal(profiles[0]?.role, 'admin'); assert.equal(profiles[1]?.role, 'teacher');
  assert.equal(profiles[0]?.isTestAccount, true); assert.equal(profiles[1]?.isTestAccount, true);
  const teacherUid = actors[1].user.uid;
  assert.ok(!profiles[0].viewOnlyUids?.length || profiles[0].viewOnlyUids.includes(teacherUid));
  for (const senderIndex of [0, 1]) {
    const receiverIndex = 1 - senderIndex;
    const messageRef = push(ref(dbs[senderIndex], `teacherChats/${teacherUid}/messages`));
    const receiverUid = actors[receiverIndex].user.uid;
    const observed = waitFor(dbs[receiverIndex], `teacherChats/${teacherUid}/messages/${messageRef.key}`, value => value?.senderUid === actors[senderIndex].user.uid);
    const inbox = waitFor(dbs[receiverIndex], `userNotifications/${receiverUid}/chat_${messageRef.key}`, value => value?.messageId === messageRef.key);
    // Attach error handlers before writes so failures cannot create unhandled rejections.
    const pending = Promise.all([observed, inbox]); pending.catch(() => {});
    await set(messageRef, { senderUid: actors[senderIndex].user.uid, senderName: profiles[senderIndex].name, text: `[Kiểm thử hai actor] ${senderIndex === 0 ? 'Admin gửi giáo viên' : 'Giáo viên trả lời admin'} · ${new Date().toISOString()}`, createdAt: serverTimestamp() });
    await pending;
    const logPath = `notificationLogs/${receiverUid}/chat_${messageRef.key}`;
    const log = await waitFor(dbs[receiverIndex], logPath, value => value && value.status !== 'sending');
    console.log(JSON.stringify({ direction: senderIndex === 0 ? 'admin-to-teacher' : 'teacher-to-admin', messagePath: `teacherChats/${teacherUid}/messages/${messageRef.key}`, inboxPersisted: true, pushStatus: log.status, accepted: log.accepted || 0 }));
  }
} finally {
  await Promise.all(auths.map(auth => signOut(auth).catch(() => {})));
  await Promise.all(apps.map(deleteApp));
}

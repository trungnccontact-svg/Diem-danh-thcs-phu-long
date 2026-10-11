// Local authenticated backend. Credentials stay on this computer.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'));
const { initializeApp, cert, refreshToken, applicationDefault } = requireFunctions('firebase-admin/app');
const { getAuth } = requireFunctions('firebase-admin/auth');
const { getDatabase } = requireFunctions('firebase-admin/database');
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.resolve(__dirname, '../tmp/firebase-migration/target-credentials.json');
const key = fs.existsSync(credentialPath) ? JSON.parse(fs.readFileSync(credentialPath, 'utf8')) : null;
if (key?.project_id && key.project_id !== 'du-an-phu-long') throw new Error('Credentials belong to another Firebase project.');
const credential = key ? (key.type === 'authorized_user' ? refreshToken(key) : cert(key)) : applicationDefault();
initializeApp({ credential, projectId: 'du-an-phu-long', databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://du-an-phu-long-default-rtdb.asia-southeast1.firebasedatabase.app' });
const send = require('../functions/chat-notifications').sendTeacherNotificationNow;
const requests = getDatabase().ref('notificationRequests');
async function processRequest(snapshot) {
  if (snapshot.val()?.status !== 'pending') return;
  const request = snapshot.ref;
  try {
    const claim = await request.transaction(value => value?.status === 'pending' ? { ...value, status: 'processing', startedAt: Date.now() } : undefined);
    if (!claim.committed) return;
    const value = claim.snapshot.val();
    const result = await send.run({ auth: { uid: value.actorUid }, data: { teacherUid: value.teacherUid, content: value.content, requestId: value.requestId } });
    await request.update({ status: 'done', result, completedAt: Date.now() });
  } catch (error) {
    await request.update({ status: 'error', code: error.code || 'internal', completedAt: Date.now() }).catch(() => {});
    console.error('Notification request failed:', error.code || 'internal');
  }
}
requests.on('child_added', snapshot => { void processRequest(snapshot); }, error => console.error('Notification queue unavailable:', error.code));
http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const reply = (status, data) => { res.writeHead(status); res.end(JSON.stringify(data)); };
  if (req.url !== '/api/notifications/send' || req.method !== 'POST') return reply(404, { code: 'not-found' });
  if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { code: 'invalid-argument' });
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return reply(401, { code: 'unauthenticated' });
  let auth;
  try { auth = await getAuth().verifyIdToken(token, true); }
  catch { return reply(401, { code: 'unauthenticated' }); }
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) return reply(413, { code: 'invalid-argument' });
    }
    const data = JSON.parse(body);
    const result = await send.run({ auth: { uid: auth.uid, token: auth }, data });
    reply(200, result);
  } catch (error) {
    const code = error.code || 'internal';
    reply(code === 'permission-denied' ? 403 : code === 'invalid-argument' || error instanceof SyntaxError ? 400 : 500, { code });
  }
}).listen(4201, '127.0.0.1', () => console.log('Local notification backend: 127.0.0.1:4201'));

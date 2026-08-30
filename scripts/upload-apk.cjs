/**
 * Script upload file APK/IPA lên Firebase Storage và lấy URL công khai
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccount = require(path.join(__dirname, '..', 'diem-danh-thcs-phu-long-firebase-adminsdk-fbsvc-0ce1d27380.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'diem-danh-thcs-phu-long.appspot.com'
});

const bucket = admin.storage().bucket();

async function uploadFile(localPath, remotePath) {
  console.log(`Uploading ${path.basename(localPath)} -> gs://${bucket.name}/${remotePath} ...`);
  
  const fileSize = fs.statSync(localPath).size;
  console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

  await bucket.upload(localPath, {
    destination: remotePath,
    metadata: {
      contentType: localPath.endsWith('.apk')
        ? 'application/vnd.android.package-archive'
        : 'application/octet-stream',
      cacheControl: 'public, max-age=3600',
    },
  });

  // Make file publicly accessible
  const file = bucket.file(remotePath);
  await file.makePublic();

  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${remotePath}`;
  console.log(`\n✅ Upload successful!`);
  console.log(`📥 Public URL: ${publicUrl}\n`);
  return publicUrl;
}

async function main() {
  const apkPath = path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

  if (!fs.existsSync(apkPath)) {
    console.error('❌ APK file not found at:', apkPath);
    process.exit(1);
  }

  try {
    const apkUrl = await uploadFile(apkPath, 'downloads/diem-danh-phu-long.apk');
    
    console.log('='.repeat(60));
    console.log('Cập nhật link sau vào public/app/index.html:');
    console.log('APK URL:', apkUrl);
    console.log('='.repeat(60));
  } catch (err) {
    console.error('❌ Upload failed:', err.message);
    process.exit(1);
  }
}

main();

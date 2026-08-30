import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'public', 'school-logo.jpg');
const white = { r: 255, g: 255, b: 255, alpha: 1 };
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

async function makeSquareIcon(size, paddingRatio = 0.08) {
  const padding = Math.round(size * paddingRatio);
  const inner = size - padding * 2;

  return sharp(source)
    .resize(inner, inner, { fit: 'contain', background: white })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: white
    })
    .png()
    .toBuffer();
}

async function makeForeground(size) {
  const inner = Math.round(size * 0.62);
  const padding = Math.round((size - inner) / 2);

  return sharp(source)
    .resize(inner, inner, { fit: 'contain', background: transparent })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: transparent
    })
    .png()
    .toBuffer();
}

async function makeSplash(width, height) {
  const logoSize = Math.round(Math.min(width, height) * 0.38);

  const logo = await sharp(source)
    .resize(logoSize, logoSize, { fit: 'contain', background: transparent })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: white
    }
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function writeIconSet(baseDir, size, { launcher = true, round = true, foreground = true } = {}) {
  await mkdir(baseDir, { recursive: true });

  if (launcher) {
    await sharp(await makeSquareIcon(size)).toFile(path.join(baseDir, 'ic_launcher.png'));
  }

  if (round) {
    await sharp(await makeSquareIcon(size)).toFile(path.join(baseDir, 'ic_launcher_round.png'));
  }

  if (foreground) {
    await sharp(await makeForeground(size)).toFile(path.join(baseDir, 'ic_launcher_foreground.png'));
  }
}

const androidRes = path.join(root, 'android', 'app', 'src', 'main', 'res');
const iosAssets = path.join(root, 'ios', 'App', 'App', 'Assets.xcassets');

const launcherSizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192
};

const foregroundSizes = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432
};

for (const [folder, size] of Object.entries(launcherSizes)) {
  await writeIconSet(path.join(androidRes, folder), size, { foreground: false });
}

for (const [folder, size] of Object.entries(foregroundSizes)) {
  await sharp(await makeForeground(size)).toFile(path.join(androidRes, folder, 'ic_launcher_foreground.png'));
}

const splashTargets = [
  ['drawable', 480, 320],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280]
];

for (const [folder, width, height] of splashTargets) {
  const dir = path.join(androidRes, folder);
  await mkdir(dir, { recursive: true });
  await sharp(await makeSplash(width, height)).toFile(path.join(dir, 'splash.png'));
}

const valuesV31Dir = path.join(androidRes, 'values-v31');
await mkdir(valuesV31Dir, { recursive: true });
await writeFile(
  path.join(valuesV31Dir, 'styles.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <item name="android:windowSplashScreenBackground">#FFFFFF</item>
    </style>
</resources>
`
);

const appIconDir = path.join(iosAssets, 'AppIcon.appiconset');
await mkdir(appIconDir, { recursive: true });
await sharp(await makeSquareIcon(1024)).toFile(path.join(appIconDir, 'AppIcon-512@2x.png'));

const splashDir = path.join(iosAssets, 'Splash.imageset');
await mkdir(splashDir, { recursive: true });
const iosSplash = await makeSplash(2732, 2732);
for (const filename of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await sharp(iosSplash).toFile(path.join(splashDir, filename));
}

console.log('Generated Android/iOS app icons and splash screens from public/school-logo.jpg');

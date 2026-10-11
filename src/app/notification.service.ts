import { Injectable, signal } from '@angular/core';
import { getApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { getDatabase, ref, set, onValue, query, limitToLast, orderByChild, update, get, remove } from 'firebase/database';
import { environment } from '../environments/environment';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly inbox = signal<{ id: string; title: string; body: string; teacherUid: string; type: string; createdAt: number; readAt: number }[]>([]);
  readonly latest = signal<{ id: string; title: string; body: string; teacherUid: string } | null>(null);
  readonly pushStatus = signal('Chưa đăng ký push');
  private inboxStop?: () => void;
  private foregroundStop?: () => void;
  private userId = '';
  private deviceId = localStorage.getItem('phulong-device-id') || this.createDeviceId();
  private token = '';
  private nativeListenersAttached = false;

  private createDeviceId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // HTTP over the local network does not expose randomUUID, but allows getRandomValues.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  watchInbox(userId: string) {
    if (this.userId === userId && this.inboxStop) return;
    this.inboxStop?.(); this.foregroundStop?.(); this.userId = userId;
    localStorage.setItem('phulong-device-id', this.deviceId);
    let initialized = false; const seen = new Set<string>();
    this.inboxStop = onValue(query(ref(getDatabase(getApp()), `userNotifications/${userId}`), orderByChild('createdAt'), limitToLast(100)), snap => {
      const list = Object.entries(snap.val() || {}).map(([id, value]) => ({ ...(value as any), id })).sort((a,b) => b.createdAt - a.createdAt);
      if (initialized) { const fresh = list.find(item => !seen.has(item.id)); if (fresh) this.latest.set(fresh); }
      list.forEach(item => seen.add(item.id)); initialized = true; this.inbox.set(list);
    }, () => this.pushStatus.set('Không thể tải thông báo từ database'));
  }
  async openNotification(id: string, teacherUid: string) {
    if (this.userId) await update(ref(getDatabase(getApp()), `userNotifications/${this.userId}/${id}`), { readAt: Date.now() });
    window.location.assign('/?notifications=1&teacher=' + encodeURIComponent(teacherUid));
  }
  async disconnect() {
    this.inboxStop?.(); this.foregroundStop?.(); this.inboxStop = undefined; this.foregroundStop = undefined;
    if (this.userId) {
      const db = getDatabase(getApp());
      await remove(ref(db, `fcmDevices/${this.userId}/${this.deviceId}`)).catch(() => {});
      const legacy = ref(db, `fcmTokens/${this.userId}`);
      const saved = await get(legacy).catch(() => null);
      if (this.token && saved?.val()?.token === this.token) await remove(legacy).catch(() => {});
    }
    this.userId = ''; this.token = ''; this.inbox.set([]); this.latest.set(null);
    if (Capacitor.isNativePlatform()) { await PushNotifications.removeAllListeners(); this.nativeListenersAttached = false; }
  }

  /** Khởi tạo FCM — gọi sau khi user đăng nhập (Firebase đã initializeApp rồi) */
  async init(userId: string): Promise<void> {
    this.watchInbox(userId);
    const app = getApp();
    const db = getDatabase(app);

    if (Capacitor.isNativePlatform()) {
      await this.initNativePush(userId, db);
      return;
    }

    if (!window.isSecureContext) {
      this.pushStatus.set('Địa chỉ HTTP qua Wi-Fi không hỗ trợ push. Mở https://du-an-phu-long.web.app trên thiết bị nhận và bật thông báo.');
      return;
    }
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      this.pushStatus.set('Trình duyệt không hỗ trợ push; vẫn nhận thông báo trong ứng dụng.');
      console.warn('[FCM Web] Trình duyệt không hỗ trợ thông báo.');
      return;
    }

    try {
      if (!environment.firebase.vapidKey) { this.pushStatus.set('Chưa cấu hình VAPID key cho dự án mới; vẫn nhận thông báo trong ứng dụng.'); return; }
      if (!await isSupported()) { this.pushStatus.set('Trình duyệt không hỗ trợ push; vẫn nhận thông báo trong ứng dụng.'); return; }
      const messaging = getMessaging(app);
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this.pushStatus.set('Chưa cấp quyền push; vẫn nhận thông báo trong ứng dụng.');
        console.warn('[FCM Web] Người dùng từ chối quyền thông báo.');
        return;
      }

      const token = await getToken(messaging, {
        vapidKey: environment.firebase.vapidKey,
        serviceWorkerRegistration: registration,
      });

      if (token) {
        this.token = token;
        await set(ref(db, `fcmDevices/${userId}/${this.deviceId}`), { token, updatedAt: Date.now(), platform: this.getPlatform() });
        this.pushStatus.set('Đã đăng ký push trên trình duyệt này');
        console.log('[FCM Web] Token lấy thành công:', token.slice(0, 30) + '...');
        await set(ref(db, `fcmTokens/${userId}`), {
          token,
          updatedAt: new Date().toISOString(),
          platform: this.getPlatform(),
          userAgent: navigator.userAgent.slice(0, 100),
        });
        console.log('[FCM Web] Token đã lưu vào fcmTokens/' + userId);
      } else {
        this.pushStatus.set('Chưa lấy được token push. Vui lòng thử bật thông báo lại.');
        console.warn('[FCM Web] Không lấy được token. Kiểm tra cấu hình VAPID key.');
      }

      this.foregroundStop?.();
      this.foregroundStop = onMessage(messaging, (payload) => {
        console.log('[FCM Web] Foreground message:', payload);
        const { title, body } = payload.notification ?? {};
        if (title && 'Notification' in window) {
          const notification = new Notification(title, {
            body: body ?? '',
            icon: '/school-logo.jpg',
            tag: 'attendance-reminder',
          });
          notification.onclick = () => { window.focus(); if (payload.data?.['notificationId']) void this.openNotification(payload.data['notificationId'], payload.data['teacherUid']); notification.close(); };
        }
      });
    } catch (err) {
      this.pushStatus.set('Đăng ký push thất bại; vẫn nhận thông báo trong ứng dụng.');
      console.error('[FCM Web] Lỗi khởi tạo:', err);
    }
  }

  async getNativePermissionStatus(): Promise<'granted' | 'denied' | 'prompt'> {
    if (!Capacitor.isNativePlatform()) {
      return 'prompt';
    }

    const permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive === 'granted') {
      return 'granted';
    }
    if (permStatus.receive === 'denied') {
      return 'denied';
    }
    return 'prompt';
  }

  private async initNativePush(userId: string, db: ReturnType<typeof getDatabase>): Promise<void> {
    if (!environment.firebase.enableNativePush) {
      console.warn(
        '[FCM Native] Chưa bật push native. Thêm google-services.json vào android/app rồi đặt enableNativePush = true.'
      );
      return;
    }

    try {
      console.log('[FCM Native] Đang cấu hình thông báo native...');

      let permStatus;
      try {
        permStatus = await PushNotifications.checkPermissions();
      } catch (checkErr) {
        console.error('[FCM Native] Thiết bị không hỗ trợ API PushNotifications hoặc chưa cài đặt Google Services SDK.', checkErr);
        return;
      }

      if (permStatus.receive === 'prompt') {
        try {
          permStatus = await PushNotifications.requestPermissions();
        } catch (reqErr) {
          console.error('[FCM Native] Không thể yêu cầu quyền thông báo từ hệ thống:', reqErr);
          return;
        }
      }

      if (permStatus.receive !== 'granted') {
        console.warn('[FCM Native] Quyền thông báo bị từ chối bởi người dùng.');
        return;
      }

      this.attachNativeListeners(userId, db);

      // Tạo Notification Channel (bắt buộc cho Android 8+/API 26+)
      // channelId phải khớp với 'channelId' gửi từ Cloud Function
      try {
        await PushNotifications.createChannel({
          id: 'attendance-reminders',
          name: 'Nhắc nhở điểm danh',
          description: 'Thông báo nhắc nhở điểm danh học sinh',
          importance: 5, // IMPORTANCE_HIGH
          sound: 'default',
          vibration: true,
          visibility: 1, // VISIBILITY_PUBLIC
        });
        console.log('[FCM Native] Đã tạo notification channel: attendance-reminders');
      } catch (chanErr) {
        console.warn('[FCM Native] Không tạo được notification channel (có thể thiết bị cũ không hỗ trợ):', chanErr);
      }

      try {
        await PushNotifications.register();
        console.log('[FCM Native] Đã đăng ký lắng nghe FCM token thành công.');
      } catch (regErr) {
        console.error('[FCM Native] Lỗi khi gọi PushNotifications.register(). Hãy đảm bảo google-services.json hợp lệ và Google Play Services hoạt động.', regErr);
      }
    } catch (err) {
      console.error('[FCM Native] Lỗi thiết lập hệ thống native không xác định:', err);
    }
  }

  private attachNativeListeners(userId: string, db: ReturnType<typeof getDatabase>): void {
    if (this.nativeListenersAttached) {
      return;
    }

    PushNotifications.addListener('registration', async (tokenData) => {
      const token = tokenData.value;
      this.token = token;
      await set(ref(db, `fcmDevices/${userId}/${this.deviceId}`), { token, updatedAt: Date.now(), platform: Capacitor.getPlatform() });
      console.log('[FCM Native] Lấy token native thành công:', token.slice(0, 30) + '...');

      await set(ref(db, `fcmTokens/${userId}`), {
        token,
        updatedAt: new Date().toISOString(),
        platform: Capacitor.getPlatform(),
        userAgent: 'native-app',
      });
      console.log('[FCM Native] Token đã lưu vào fcmTokens/' + userId);
    });

    PushNotifications.addListener('registrationError', (error) => {
      console.error('[FCM Native] Lỗi đăng ký nhận token:', error);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[FCM Native] Nhận thông báo trong foreground:', notification);
    });

    this.nativeListenersAttached = true;
  }

  private getPlatform(): string {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'web';
  }
}

import { Injectable } from '@angular/core';
import { getApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { getDatabase, ref, set } from 'firebase/database';
import { environment } from '../environments/environment';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private nativeListenersAttached = false;

  /** Khởi tạo FCM — gọi sau khi user đăng nhập (Firebase đã initializeApp rồi) */
  async init(userId: string): Promise<void> {
    const app = getApp();
    const db = getDatabase(app);

    if (Capacitor.isNativePlatform()) {
      await this.initNativePush(userId, db);
      return;
    }

    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      console.warn('[FCM Web] Trình duyệt không hỗ trợ thông báo.');
      return;
    }

    try {
      const messaging = getMessaging(app);
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('[FCM Web] Người dùng từ chối quyền thông báo.');
        return;
      }

      const token = await getToken(messaging, {
        vapidKey: environment.firebase.vapidKey,
        serviceWorkerRegistration: registration,
      });

      if (token) {
        console.log('[FCM Web] Token lấy thành công:', token.slice(0, 30) + '...');
        await set(ref(db, `fcmTokens/${userId}`), {
          token,
          updatedAt: new Date().toISOString(),
          platform: this.getPlatform(),
          userAgent: navigator.userAgent.slice(0, 100),
        });
        console.log('[FCM Web] Token đã lưu vào fcmTokens/' + userId);
      } else {
        console.warn('[FCM Web] Không lấy được token. Kiểm tra cấu hình VAPID key.');
      }

      onMessage(messaging, (payload) => {
        console.log('[FCM Web] Foreground message:', payload);
        const { title, body } = payload.notification ?? {};
        if (title && 'Notification' in window) {
          new Notification(title, {
            body: body ?? '',
            icon: '/school-logo.jpg',
            tag: 'attendance-reminder',
          });
        }
      });
    } catch (err) {
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

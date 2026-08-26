import { Injectable } from '@angular/core';
import { getApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { getDatabase, ref, set } from 'firebase/database';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  /** Khởi tạo FCM — gọi sau khi user đăng nhập (Firebase đã initializeApp rồi) */
  async init(userId: string): Promise<void> {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      console.warn('[FCM] Trình duyệt không hỗ trợ thông báo.');
      return;
    }

    try {
      // Lazy-get Firebase instances (lúc này initializeApp() đã chạy rồi)
      const app = getApp();
      const messaging = getMessaging(app);
      const db = getDatabase(app);

      // Đăng ký firebase-messaging-sw.js
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

      // Xin quyền thông báo
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('[FCM] Người dùng từ chối quyền thông báo.');
        return;
      }

      // Lấy FCM token
      const token = await getToken(messaging, {
        vapidKey: environment.firebase.vapidKey,
        serviceWorkerRegistration: registration,
      });

      if (token) {
        console.log('[FCM] Token lấy thành công:', token.slice(0, 30) + '...');
        // Lưu token vào node "fcmTokens/<userId>" (tách biệt với users/<uid>)
        await set(ref(db, `fcmTokens/${userId}`), {
          token,
          updatedAt: new Date().toISOString(),
          platform: this.getPlatform(),
          userAgent: navigator.userAgent.slice(0, 100),
        });
        console.log('[FCM] Token đã lưu vào fcmTokens/' + userId);
      } else {
        console.warn('[FCM] Không lấy được token. Kiểm tra cấu hình VAPID key.');
      }

      // Nhận thông báo khi app đang mở (foreground)
      onMessage(messaging, (payload) => {
        console.log('[FCM] Foreground message:', payload);
        const { title, body } = payload.notification ?? {};
        if (title && 'Notification' in window) {
          new Notification(title, {
            body: body ?? '',
            icon: '/favicon.ico',
            tag: 'attendance-reminder',
          });
        }
      });

    } catch (err) {
      console.error('[FCM] Lỗi khởi tạo:', err);
    }
  }

  private getPlatform(): string {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'web';
  }
}

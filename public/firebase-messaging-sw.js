// Click vào thông báo → mở app
self.addEventListener('notificationclick', (event) => {
  event.stopImmediatePropagation();
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const data = event.notification.data?.FCM_MSG?.data || event.notification.data || {};
      const url = data.type?.startsWith('teacher-') ? '/?chat=1&teacher=' + encodeURIComponent(data.teacherUid || '') : '/';
      if (clientList.length > 0) return clientList[0].navigate(url).then(client => client.focus());
      return clients.openWindow(url);
    })
  );
});

// Firebase Messaging Service Worker
// File này PHẢI nằm tại /firebase-messaging-sw.js (public root)
// iOS Safari yêu cầu file này để nhận push notification khi app ở background

importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

importScripts('/firebase-config.js');
firebase.initializeApp(self.PHULONG_FIREBASE_CONFIG);

const messaging = firebase.messaging();

// Xử lý thông báo khi app ở background
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM SW] Background message received:', payload);
  // FCM tự hiển thị notification payload ở background; tránh hiện hai lần.
  if (payload.notification) return;
  const { title, body } = payload.data ?? {};
  if (title) {
    self.registration.showNotification(title, {
      body: body ?? '',
      icon: '/school-logo.jpg',
      badge: '/school-logo.jpg',
      sound: '/notification-sound.mp3', // Thiết lập âm thanh tùy chỉnh cho trình duyệt hỗ trợ
      data: payload.data,
      tag: 'attendance-reminder',
      requireInteraction: false,
    });
  }
});

// Firebase Messaging Service Worker
// File này PHẢI nằm tại /firebase-messaging-sw.js (public root)
// iOS Safari yêu cầu file này để nhận push notification khi app ở background

importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyDHrmu918VhRWnFmGdt7DsrgF2MDFdZszU',
  authDomain:        'diem-danh-thcs-phu-long.firebaseapp.com',
  projectId:         'diem-danh-thcs-phu-long',
  storageBucket:     'diem-danh-thcs-phu-long.firebasestorage.app',
  messagingSenderId: '173707383479',
  appId:             '1:173707383479:web:2f9b7c89d1c2f75a917332',
});

const messaging = firebase.messaging();

// Xử lý thông báo khi app ở background
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM SW] Background message received:', payload);
  const { title, body } = payload.notification ?? {};
  if (title) {
    self.registration.showNotification(title, {
      body: body ?? '',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: payload.data,
      tag: 'attendance-reminder',
      requireInteraction: false,
    });
  }
});

// Click vào thông báo → mở app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) return clientList[0].focus();
      return clients.openWindow('/');
    })
  );
});

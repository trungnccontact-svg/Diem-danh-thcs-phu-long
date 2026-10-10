# Chat thực tế – du-an-diem-danh-phu-long

## Trạng thái

Đã cập nhật cấu hình web/VAPID và URL Realtime Database `https://du-an-diem-danh-phu-long-default-rtdb.firebaseio.com`. Build production và 6 unit tests đã đạt. Đã tạo testadmin/testuser, triển khai database rules bằng service account, đăng nhập admin từ Home và xác nhận tin nhắn vẫn còn sau khi tải lại. Chưa triển khai Hosting/Cloud Functions, chưa kiểm tra đồng thời hai trình duyệt hoặc push thực tế; chưa xác nhận nâng cấp Blaze.

## Database

| Đường dẫn | Nội dung |
|---|---|
| teacherChats/{teacherUid}/messages/{messageId} | Tin nhắn bất biến, người gửi, thời điểm server |
| teacherSchedules/{teacherUid} | Lịch đang áp dụng, người sửa, thời điểm sửa |
| scheduleLogs/{teacherUid}/{eventId} | Lịch sử bật/tắt/sửa lịch do server ghi |
| userNotifications/{recipientUid}/{notificationId} | Thông báo trong app và thời điểm người nhận mở |
| notificationLogs/{recipientUid}/{notificationId} | Trạng thái gửi, số lần thử, số thiết bị thành công/thất bại, mã lỗi FCM |
| fcmDevices/{uid}/{deviceId} | Token riêng từng trình duyệt/thiết bị, chỉ chủ tài khoản được ghi |

`accepted` có nghĩa FCM tiếp nhận yêu cầu; không chứng minh hệ điều hành đã hiển thị thông báo. `no-token` vẫn lưu thông báo trong app. User không được ghi log server hoặc sửa tin nhắn đã lưu. Tài khoản test chỉ gửi thông báo trả lời đến admin test đủ điều kiện.

## Điều kiện triển khai

1. Firebase CLI đăng nhập tài khoản có quyền dự án. CLI đã cài cục bộ tại `%TEMP%/phulong-firebase-cli/node_modules/firebase-tools/lib/bin/firebase.js` và có thể gọi bằng Node.
2. Dự án bật Authentication → Email/Password và có Realtime Database. Copy chính xác URL vào `src/environments/environment.ts`. Không dùng Firestore thay URL Realtime Database.
3. Cloud Functions/Scheduler cần Blaze. Việc liên kết billing phải do chủ dự án hoàn tất.
4. Kiểm tra vùng Realtime Database trước triển khai: `functions/chat-notifications.js` hiện đặt trigger database tại `us-central1`; nếu DB mới ở Singapore thì đổi thành `asia-southeast1`, nếu Belgium thì `europe-west1`.
5. Cần hai tài khoản test có profile `users/{uid}`: role `admin`/`teacher`, `name`, `email`, `isTestAccount:true`. Profile admin test có `viewOnlyUids:[teacherUid]`. Không dùng script cũ `create-test-accounts.mjs` nguyên trạng vì nó đang trỏ dự án cũ và có thao tác reset mật khẩu.

## Triển khai sau khi cấu hình đủ

```powershell
node scripts/build-firebase-config.cjs
pnpm exec ng build
pnpm --dir functions install --ignore-workspace
node --test functions/chat-schedule.test.js functions/chat-notifications.test.js
$taskFirebaseCli = Join-Path $env:TEMP 'phulong-firebase-cli/node_modules/firebase-tools/lib/bin/firebase.js'
node $taskFirebaseCli deploy --project du-an-diem-danh-phu-long --only "database,hosting,functions:teacherChatNotification,functions:teacherScheduleAudit,functions:personalTeacherReminders"
```

Chỉ triển khai 3 function chat/lịch, tránh các function AI cũ cần secret của dự án cũ.

## Kiểm tra hai trình duyệt

Mở https://du-an-diem-danh-phu-long.web.app/?chat=1 bằng Edge (admin test) và một trình duyệt độc lập (giáo viên test). Không dùng `?demo=chat`. Cho phép thông báo ở cả hai trình duyệt. Gửi tin admin → giáo viên và giáo viên → admin, kiểm tra hộp thông báo và log. Tải lại để xác nhận lịch sử lấy từ database. Thử lịch một lần vài phút sau hiện tại, rồi tắt sau khi kiểm tra.

`scripts/verify-chat-live.mjs` kiểm tra thêm hai Firebase client độc lập bằng các biến môi trường `CHAT_TEST_ADMIN_EMAIL`, `CHAT_TEST_ADMIN_PASSWORD`, `CHAT_TEST_TEACHER_EMAIL`, `CHAT_TEST_TEACHER_PASSWORD`. Script chỉ chấp nhận profile test, lưu tin kiểm thử thật và in đường dẫn database/trạng thái push, không in mật khẩu/token.

Web worker được sinh từ cùng cấu hình frontend để tránh gửi/nhận push nhầm dự án. Native push tạm tắt vì chưa có google-services mới tương ứng; phiên này chỉ triển khai web.

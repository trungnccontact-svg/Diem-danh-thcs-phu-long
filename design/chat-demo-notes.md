# Chat giáo viên – admin và lịch thông báo

- Chạy: `pnpm start --host 127.0.0.1 --port 4200`.
- Demo: http://localhost:4200/?demo=chat (chỉ localhost). Chuyển Admin/Giáo viên để thử chat hai chiều. Dữ liệu demo lưu riêng trong localStorage.
- Sau đăng nhập thật, chọn **Chat & thông báo** ở menu. Giáo viên chỉ truy cập cuộc chat của mình; admin chọn giáo viên và lưu một lịch cho từng người.
- Lịch hỗ trợ hằng ngày, thứ Hai–thứ Sáu, một lần. Giờ Việt Nam; giờ kết thúc sau giờ bắt đầu, không qua đêm. Scheduler kiểm tra mỗi phút và gửi một lần trong cửa sổ, không gửi bù khi hết cửa sổ. Thiết bị cần đăng ký token và cho phép thông báo.
- Cần triển khai `database.rules.json` và các function `teacherChatNotification`, `personalTeacherReminders` trước khi dùng thật. Chưa triển khai lên Firebase trong phiên này. Scheduled functions cần cấu hình Cloud Scheduler/billing theo tài liệu Firebase.
- Server giữ bản ghi giao hàng ở `teacherReminderDeliveries` để tránh gửi lặp giữa các lần scheduler chạy. Push phụ thuộc mạng, token, thiết bị; không đảm bảo đúng giây. Cần chính sách lưu trữ/dọn lịch sử khi vận hành lâu dài.
- Kiểm tra: `node --test functions/chat-schedule.test.js`, `node --check functions/index.js`, `pnpm exec ng build --configuration development`.
- Môi trường Windows hiện tại cần khôi phục junction `node_modules/@firebase` trỏ tới `node_modules/.pnpm/firebase@12.18.0/node_modules/@firebase` vì TypeScript không tìm dependency thông qua junction Firebase hiện có. Đây là sửa dependency cục bộ, không thay phiên bản package.

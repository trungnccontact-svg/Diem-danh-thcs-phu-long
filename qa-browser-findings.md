# QA browser findings — 26/08/2026

## Màn hình đăng nhập

Ứng dụng render thành công tại `http://localhost:4200/`, dùng ảnh cổng THCS Phú Long làm nền, hiển thị hai vai trò Giáo viên/Quản trị viên, trường tên đăng nhập, mật khẩu, checkbox ghi nhớ, nút đăng nhập và hai lối vào demo.

## Màn hình Admin

Lối vào demo Admin render thành công. Bảng hiển thị các cột giáo viên, lớp, tỉ số điểm danh, số vắng, tên học sinh vắng, liên hệ và trạng thái. Bộ lọc trạng thái, nút xuất dữ liệu, nút gọi điện và menu Trợ lý AI đều hiển thị. Dữ liệu mẫu có các dòng đã điểm danh và chưa điểm danh, đúng tinh thần đặc tả.

## Lưu ý

Đây là build giao diện/state demo để bàn giao source chạy được. Firebase Realtime Database, Authentication, FCM Cloud Functions và OpenRouter cần được nối ở bước cấu hình production theo README; khóa API không đưa vào frontend.

## Kiểm tra tương tác bổ sung

Bộ lọc **Chưa điểm danh** chỉ còn lại hai bản ghi chưa hoàn tất; thao tác đăng xuất đưa người dùng trở lại màn hình đăng nhập đúng trạng thái. Không ghi nhận lỗi render trong hai thao tác này.

## Luồng giáo viên

Sau khi đăng nhập demo giáo viên, màn hình hiển thị đúng lời chào, nhắc giờ 06:50, gợi ý lớp 7A1/8A2/9A1, trường nhập lớp, các trường **Có mặt**, **Tổng sĩ số**, **Số học sinh vắng** và hai ô tên học sinh vắng. Với dữ liệu mặc định 36/38, hệ thống hiển thị hai ô tên vắng và nút tiếp tục.

## Gửi điểm danh

Bấm **Tiếp tục** chuyển sang bước 2/2, hiển thị xác nhận “Điểm danh lớp 7A1 hoàn tất”, số có mặt 36/38, vắng mặt 2 và cập nhật các thẻ thống kê thành 1 lớp đã điểm danh, 0 lớp chưa điểm danh, tỉ lệ 95%.

## PWA reload

Sau khi bật service worker và reload dev server, title trang đã cập nhật thành **Phú Long — Điểm danh**, màn hình đăng nhập vẫn hoạt động và đăng nhập lại demo giáo viên vẫn hiển thị đầy đủ trường dữ liệu điểm danh.

## Vấn đề đã xử lý

Snapshot tương tác cũ bị stale sau hot reload; lấy lại snapshot mới đã xử lý được. Đây là hành vi kiểm thử của trình duyệt, không phải lỗi ứng dụng.

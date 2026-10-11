# Đọc bảng điểm danh bằng Gemini

Giáo viên chọn **Chụp ảnh** hoặc **Chọn ảnh**, xem ảnh rồi nhấn **Đọc ảnh và điền thông tin**. Kết quả chỉ điền biểu mẫu; giáo viên kiểm tra, bổ sung tên/trạng thái chưa rõ và nhấn Lưu. Khung giờ điểm danh và việc xem lại lớp đã được giáo viên khác điểm danh vẫn được áp dụng.

## Xem demo

Mở `/?demo=attendance-photo`, chọn **Dùng ảnh mẫu** rồi **Đọc ảnh và điền thông tin**. Demo không cần đăng nhập, sử dụng kết quả mô phỏng và không tạo yêu cầu Gemini hay ghi dữ liệu điểm danh lên Firebase. Tài khoản admin có liên kết **Xem demo chụp ảnh bảng điểm danh** ở bảng điều hành.

Nút chụp thật thuộc biểu mẫu giáo viên. Khi giáo viên đã nộp điểm danh, chọn **Chỉnh sửa điểm danh** để mở lại biểu mẫu. Ngoài khung giờ quy định, biểu mẫu bị khóa; tài khoản thử nghiệm vẫn có thể dùng.

## Chạy dịch vụ

Thêm `GEMINI_API_KEY` vào file `.env` ở thư mục gốc. File được Git bỏ qua. Có thể đặt `GEMINI_MODEL` để chọn model; mặc định `gemini-3.8-flash`. Khóa được đọc bởi backend, không nằm trong mã web.

Chạy bằng Node.js hỗ trợ `process.loadEnvFile` (máy hiện tại dùng Node 24):

```sh
pnpm start:notifications
```

Backend này dùng chung dịch vụ gửi thông báo: lắng nghe `attendanceImageRequests/<uid>/<requestId>` trên Realtime Database. Máy chạy backend cần giữ kết nối mạng và hoạt động để đọc ảnh trên website đã triển khai. Firebase Hosting chỉ phục vụ giao diện.

Giáo viên chỉ tạo và đọc yêu cầu của mình. Backend kiểm tra vai trò, loại/kích thước ảnh, thời hạn yêu cầu; giới hạn hai ảnh xử lý đồng thời và mỗi tài khoản cách nhau ít nhất 20 giây. Ảnh được nén dưới 900 KiB và chỉ được gửi Gemini khi nhấn nút đọc. Backend xóa nội dung ảnh khỏi hàng đợi sau khi xử lý thành công hoặc lỗi; kết quả văn bản vẫn thuộc tài khoản giáo viên.

Khi backend chưa hoạt động, ảnh đang chờ nằm trong hàng đợi riêng của giáo viên. Sau khi khởi động lại, yêu cầu quá 3 phút sẽ báo hết hạn và xóa nội dung ảnh. Cần cấu hình dịch vụ chạy liên tục nếu sử dụng thường xuyên; đây chưa phải backend hoạt động 24/7 trên cloud.

## Kiểm tra

```sh
node --test scripts/attendance-image.test.cjs
pnpm exec ng test --watch=false --include=src/app/attendance-photo.spec.ts --include=src/app/attendance-time.spec.ts --include=src/app/attendance-conflict.spec.ts
```

Khả năng đọc bảng viết phấn thực tế cần đánh giá bằng ảnh thực tế. Chữ mờ, ảnh nghiêng hoặc thông tin thiếu có thể cần nhập lại. Khi thử nghiệm Gemini, dùng ảnh mẫu không chứa dữ liệu học sinh thật.

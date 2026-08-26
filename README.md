# Hệ thống điểm danh học sinh — THCS Phú Long

Ứng dụng PWA Angular cho giáo viên thực hiện điểm danh trên điện thoại và quản trị viên theo dõi dữ liệu toàn trường. Giao diện sử dụng ảnh cổng trường được cung cấp, có luồng đăng nhập, khu vực giáo viên, bảng Admin, lọc trạng thái, xuất CSV tương thích Excel và chatbox trợ lý.

## Chạy local

```bash
pnpm install
pnpm start
```

Mở `http://localhost:4200/`. Đăng nhập bằng số điện thoại/email và mật khẩu của trường để tiếp tục.

## Build production

```bash
pnpm exec ng build
```

Bundle được tạo trong `dist/diem-danh-phu-long/`.

## Cấu trúc chính

| Khu vực | Tệp | Vai trò |
|---|---|---|
| Giao diện và state demo | `src/app/app.ts` | Luồng đăng nhập, điểm danh, Admin, lọc, xuất file và chat |
| Template | `src/app/app.html` | Bố cục responsive của PWA |
| Nhận diện giao diện | `src/app/app.scss` | Màu sắc, layout, trạng thái và responsive |
| Ảnh nền | `public/school-gate.jpg` | Ảnh cổng THCS Phú Long do khách hàng cung cấp |

## Kết nối Firebase khi đưa vào vận hành

Tệp `google-services.json` được cung cấp là cấu hình Android native. Với PWA Angular, cần tạo **Web App** trong Firebase Console và đưa cấu hình Web SDK vào biến môi trường, không commit API key hoặc khóa OpenRouter vào mã nguồn. Dữ liệu điểm danh nên lưu tại Realtime Database với mô hình đề xuất:

```text
attendance/{yyyy-mm-dd}/{teacherUid}
  teacherName
  phone
  className
  present
  total
  absentNames[]
  checkedAt
```

Firebase Functions nên đảm nhiệm lịch nhắc 06:50, 07:40, 13:10 và 13:55, gửi FCM; không nên dựa vào timer phía trình duyệt vì trình duyệt có thể bị hệ điều hành tạm dừng. Khóa OpenRouter cần đặt trong Secret Manager hoặc biến môi trường phía Functions và dùng cơ chế fallback model ở server.

## Dữ liệu giáo viên

File Excel danh sách giáo viên cần được xử lý bằng một script import riêng sử dụng Firebase Admin SDK. Không đưa mật khẩu mặc định vào UI hoặc log; sau khi tạo tài khoản nên buộc đổi mật khẩu ở lần đăng nhập đầu tiên theo quyết định cuối cùng của nhà trường.

## Các điểm cần xác nhận trước production

Nhà trường cần xác nhận nội dung thông báo 13:55, định dạng tỉ số có mặt/tổng sĩ số, trạng thái hiển thị cho lớp chưa điểm danh, danh sách model OpenRouter fallback, mascot chính thức, chính sách đổi mật khẩu lần đầu và phạm vi câu hỏi được phép của trợ lý AI.

# Tạo tài khoản đăng nhập từ Home

Script dùng Firebase Admin, cần file service account của chính dự án `du-an-diem-danh-phu-long`. Không dùng key dự án cũ. Không commit key hoặc mật khẩu.

Chạy tại thư mục dự án bằng PowerShell:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\duong-dan\service-account.json'
$taskPassword = Read-Host 'Mật khẩu test mới (ít nhất 6 ký tự)' -AsSecureString
$env:CHAT_TEST_PASSWORD = [System.Net.NetworkCredential]::new('', $taskPassword).Password
try { node scripts/create-chat-test-accounts.mjs }
finally { Remove-Item Env:CHAT_TEST_PASSWORD }
```

Script tạo `testadmin@phulong.edu.vn` và `testuser@phulong.edu.vn`, profile và custom claims. Admin test chỉ xem giáo viên test. Nếu đã có tài khoản test, giữ mật khẩu cũ; nếu tài khoản có sẵn không phải test, script dừng. Nếu tạo Auth thành công nhưng ghi profile thất bại, kiểm tra và khôi phục profile trong console trước khi chạy lại; script không tự xóa tài khoản.

Mở `http://localhost:4200/` trên hai trình duyệt độc lập. Đăng nhập `testadmin` và `testuser` (hoặc email đầy đủ), nhập mật khẩu đã đặt, chọn `Chat & thông báo`. Không dùng `?demo=chat` khi kiểm tra dữ liệu thật. Chat lưu vào Realtime Database; push và log server cần deploy các Cloud Functions cùng rules theo `chat-production.md`.

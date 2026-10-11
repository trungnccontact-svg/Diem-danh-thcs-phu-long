import { Component, EventEmitter, Input, Output, OnDestroy, inject, signal } from '@angular/core';
import { AttendancePhotoData, AttendancePhotoService, BoardAttendance } from './attendance-photo.service';

@Component({
  selector: 'app-attendance-photo', standalone: true,
  template: `
    <section class="photo-card" aria-label="Nhập điểm danh từ ảnh">
      <strong>Chụp ảnh bảng điểm danh</strong>
      @if (demo) { <p>Dùng ảnh bảng mẫu để xem thao tác tự điền thông tin. Kết quả trong bản demo là dữ liệu mô phỏng.</p> }
      @else { <p>Chụp rõ tên lớp, sĩ số và danh sách học sinh vắng. Ảnh được gửi đến Google Gemini khi thầy cô nhấn Đọc ảnh.</p> }
      <input #camera hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" (change)="choosePhoto($event)">
      <input #gallery hidden type="file" accept="image/jpeg,image/png,image/webp" (change)="choosePhoto($event)">
      <div class="photo-actions">
        @if (demo) { <button type="button" [disabled]="busy()" (click)="useDemoImage()">📷 Dùng ảnh mẫu</button> }
        @else {
        <button type="button" [disabled]="disabled || busy()" (click)="camera.click()">📷 Chụp ảnh</button>
        <button type="button" [disabled]="disabled || busy()" (click)="gallery.click()">Chọn ảnh</button>
        }
      </div>
      @if (photo(); as selected) {
        <img [src]="selected.preview" alt="Ảnh bảng điểm danh đã chọn">
        <div class="photo-actions">
          <button class="read-photo" type="button" [disabled]="disabled || busy()" (click)="readPhoto()">{{ busy() ? 'Đang đọc ảnh…' : 'Đọc ảnh và điền thông tin' }}</button>
          <button type="button" [disabled]="busy()" (click)="clearPhoto()">Bỏ ảnh</button>
        </div>
      }
      @if (notice()) { <p role="status" [class.error]="error()">{{ notice() }}</p> }
    </section>`,
  styles: [`
    :host { display: block; margin: 18px 0; }
    .photo-card { padding: 18px; border: 1px solid #b9ded8; border-radius: 14px; background: #f2faf9; }
    strong { color: #087d80; } p { font-size: 13px; line-height: 1.6; margin: 10px 0; }
    .photo-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    button { padding: 12px 16px; font: inherit; border-radius: 10px; border: 1px solid #b9ded8; color: #087d80; background: white; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; } .read-photo { background: #0c9295; color: white; }
    img { display: block; width: 100%; max-height: 320px; object-fit: contain; margin: 14px 0; border-radius: 10px; }
    .error { color: #c5424e; }
  `]
})
export class AttendancePhoto implements OnDestroy {
  @Input() disabled = false;
  @Input() demo = false;
  @Output() recognized = new EventEmitter<BoardAttendance>();
  @Output() busyChange = new EventEmitter<boolean>();
  protected readonly service = inject(AttendancePhotoService);
  protected readonly photo = signal<AttendancePhotoData | null>(null);
  protected readonly busy = signal(false);
  protected readonly notice = signal('');
  protected readonly error = signal(false);
  private destroyed = false;

  async useDemoImage() {
    if (!this.demo || this.busy()) return;
    this.setBusy(true); this.error.set(false);
    try {
      const response = await fetch('/attendance-board-demo.jpg');
      if (!response.ok) throw { code: 'invalid-image' };
      const photo = await this.service.prepare(new File([await response.blob()], 'bang-diem-danh-mau.jpg', { type: 'image/jpeg' }));
      if (!this.destroyed) { this.photo.set(photo); this.notice.set('Ảnh mẫu đã sẵn sàng. Nhấn Đọc ảnh để xem thông tin được điền.'); }
    } catch (error) { this.showError(error); }
    finally { this.setBusy(false); }
  }

  async choosePhoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    if (!file || this.disabled || this.busy()) return;
    this.photo.set(null); this.setBusy(true); this.notice.set('Đang chuẩn bị ảnh…'); this.error.set(false);
    try { const photo = await this.service.prepare(file); if (!this.destroyed) { this.photo.set(photo); this.notice.set('Ảnh đã sẵn sàng. Nhấn Đọc ảnh để điền biểu mẫu.'); } }
    catch (error) { this.showError(error); }
    finally { this.setBusy(false); }
  }

  async readPhoto() {
    const photo = this.photo();
    if (!photo || this.disabled || this.busy()) return;
    this.setBusy(true); this.error.set(false); this.notice.set(this.demo ? 'Đang mô phỏng đọc ảnh mẫu…' : 'Gemini đang đọc bảng điểm danh…');
    try {
      const result = this.demo ? await this.demoResult() : await this.service.recognize(photo);
      if (!this.destroyed) { this.recognized.emit(result); this.notice.set('Đã điền dữ liệu đọc được. Thầy cô kiểm tra và bổ sung trước khi lưu.'); }
    } catch (error) { this.showError(error); }
    finally { this.setBusy(false); }
  }

  private async demoResult(): Promise<BoardAttendance> {
    await new Promise(resolve => setTimeout(resolve, 650));
    return { className: '6A1', total: 35, present: 33, absentCount: 2,
      absentees: [{ name: 'Hoc sinh A', status: 'Có phép' }, { name: 'Hoc sinh B', status: 'Không phép' }], warnings: [] };
  }

  clearPhoto() { this.photo.set(null); this.notice.set(''); this.error.set(false); }
  private setBusy(value: boolean) { this.busy.set(value); if (!this.destroyed) this.busyChange.emit(value); }
  private showError(error: any) {
    if (this.destroyed) return;
    const messages: Record<string, string> = {
      'unsupported-image': 'Chọn ảnh JPG, PNG hoặc WebP.', 'large-image': 'Ảnh quá lớn. Chụp lại hoặc chọn ảnh dưới 12 MB.',
      'invalid-image': 'Không đọc được file ảnh. Vui lòng chọn ảnh khác.', 'unreadable-image': 'Ảnh chưa rõ thông tin điểm danh. Chụp gần và rõ hơn rồi thử lại.',
      'not-configured': 'Dịch vụ đọc ảnh chưa được cấu hình Gemini.', 'ai-auth': 'Khóa Gemini chưa được cấp quyền đọc ảnh. Liên hệ quản trị viên.',
      'ai-quota': 'Gemini đã hết hạn mức. Chờ rồi thử lại hoặc liên hệ quản trị viên.', 'too-many-requests': 'Vui lòng chờ 20 giây trước khi đọc ảnh tiếp.',
      'worker-timeout': 'Chưa nhận được kết quả. Kiểm tra dịch vụ đọc ảnh trên máy quản trị rồi thử lại.',
      'ai-timeout': 'Gemini xử lý quá lâu. Vui lòng thử lại.', 'expired-request': 'Yêu cầu đã hết thời gian. Nhấn Đọc ảnh để thử lại.'
    };
    this.error.set(true); this.notice.set(messages[error?.code] || 'Đọc ảnh chưa thành công. Vui lòng thử lại.');
  }
  ngOnDestroy() { this.destroyed = true; this.photo.set(null); this.busyChange.emit(false); }
}

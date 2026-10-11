import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AttendancePhoto } from './attendance-photo';
import { BoardAttendance } from './attendance-photo.service';

@Component({
  selector: 'app-attendance-photo-demo', standalone: true, imports: [FormsModule, AttendancePhoto],
  template: `
    <main class="demo-page">
      <header><a href="/">← Về ứng dụng</a><span>THCS PHÚ LONG</span></header>
      <div class="demo-heading"><span class="badge">BẢN DEMO · DỮ LIỆU MẪU</span><h1>Chụp ảnh bảng, điền điểm danh</h1>
        <p>Nhấn <strong>Dùng ảnh mẫu</strong>, sau đó <strong>Đọc ảnh và điền thông tin</strong> để xem kết quả ở biểu mẫu.</p></div>
      <div class="demo-grid">
        <section class="demo-section"><h2>1. Ảnh bảng điểm danh</h2><app-attendance-photo [demo]="true" (recognized)="fill($event)" /></section>
        <section class="demo-section"><h2>2. Thông tin tự điền</h2>
          <p class="hint" role="status">{{ filled() ? 'Đã điền dữ liệu từ ảnh mẫu. Bạn có thể chỉnh sửa các ô bên dưới.' : 'Thông tin sẽ xuất hiện sau khi nhấn Đọc ảnh.' }}</p>
          <label>Tên lớp<input [(ngModel)]="className" placeholder="Chưa đọc ảnh"></label>
          <div class="counts"><label>Tổng sĩ số<input type="number" [(ngModel)]="total" placeholder="—"></label><label>Có mặt<input type="number" [(ngModel)]="present" placeholder="—"></label><label>Số vắng<input type="number" [value]="absentCount ?? ''" readonly placeholder="—"></label></div>
          @if (filled()) {<h3>Học sinh vắng</h3>@for (student of absentees; track $index) {<div class="absence"><label>Tên học sinh<input [(ngModel)]="student.name"></label><label>Trạng thái<select [(ngModel)]="student.status"><option>Có phép</option><option>Không phép</option><option>Đi trễ</option></select></label></div>}
            <button type="button" (click)="saved.set(true)">Lưu thử điểm danh</button>
            @if (saved()) {<p class="hint" role="status">Đã lưu thử {{ className }} trong bản demo.</p>}}
          <p class="demo-note">Bản demo dùng ảnh và kết quả mẫu. Dữ liệu không được lưu vào hệ thống điểm danh của trường.</p>
        </section>
      </div>
      <p class="where">Trong ứng dụng thật, đăng nhập giáo viên → Điểm danh hôm nay. Nếu đã nộp, chọn Chỉnh sửa điểm danh để thấy nút Chụp ảnh.</p>
    </main>`,
  styles: [`
    :host { display: block; color: #19334c; background: #f3f8fa; min-height: 100vh; }
    .demo-page { max-width: 1120px; margin: auto; padding: 24px; }
    header { display: flex; justify-content: space-between; align-items: center; font-size: 13px; margin-bottom: 38px; }
    a { color: #087d80; text-decoration: none; } header span { font-weight: 700; letter-spacing: .08em; }
    .badge { display: inline-block; padding: 7px 11px; border-radius: 8px; background: #dff1ec; color: #087d80; font-size: 11px; font-weight: 700; }
    h1 { font-size: clamp(26px, 4vw, 38px); margin: 16px 0 10px; } .demo-heading p { color: #62768a; line-height: 1.7; }
    .demo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 26px; }
    .demo-section { background: white; padding: 24px; border-radius: 18px; border: 1px solid #dae7eb; }
    h2 { font-size: 19px; margin: 0 0 18px; } h3 { font-size: 15px; margin-top: 24px; }
    label { display: block; margin: 16px 0; font-size: 13px; font-weight: 600; }
    input, select { box-sizing: border-box; display: block; width: 100%; padding: 12px; border: 1px solid #ccdce4; border-radius: 9px; font: inherit; margin-top: 8px; background: white; color: #19334c; }
    input:focus, select:focus { outline: 2px solid #0c9295; outline-offset: 1px; }
    .counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; } .absence { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .hint { color: #087d80; font-size: 13px; line-height: 1.6; padding: 12px; border-radius: 9px; background: #edf8f5; }
    button { background: #0c9295; color: white; border: 0; border-radius: 10px; padding: 14px 20px; cursor: pointer; font: inherit; }
    .demo-note, .where { font-size: 13px; color: #62768a; line-height: 1.7; } .demo-note { border-top: 1px solid #e5eef1; padding-top: 18px; margin-top: 24px; }
    .where { margin: 22px 0; }
    @media(max-width: 740px) { .demo-page { padding: 16px; } .demo-grid { grid-template-columns: 1fr; } .demo-section { padding: 18px; } header { margin-bottom: 25px; } }
  `]
})
export class AttendancePhotoDemo {
  protected readonly filled = signal(false);
  protected readonly saved = signal(false);
  protected className = '';
  protected present: number | null = null;
  protected total: number | null = null;
  protected absentCount: number | null = null;
  protected absentees: BoardAttendance['absentees'] = [];
  protected fill(value: BoardAttendance) {
    this.className = value.className || ''; this.present = value.present; this.total = value.total;
    this.absentCount = value.absentCount; this.absentees = value.absentees.map(student => ({ ...student }));
    this.filled.set(true); this.saved.set(false);
  }
}

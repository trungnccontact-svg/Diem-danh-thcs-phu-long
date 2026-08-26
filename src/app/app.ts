import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as XLSX from 'xlsx';

type Role = 'admin' | 'teacher';
type AttendanceStatus = 'Đã điểm danh' | 'Chưa điểm danh';

interface Teacher {
  name: string;
  phone: string;
  className: string;
  present: number | null;
  total: number | null;
  absentNames: string[];
  checkedAt: string | null;
  status: AttendanceStatus;
}

interface ChatMessage {
  from: 'assistant' | 'teacher';
  text: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly today = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'full' }).format(new Date());
  protected readonly activeRole = signal<Role>('teacher');
  protected readonly loggedIn = signal(false);
  protected readonly showLogin = signal(true);
  protected readonly loginError = signal('');
  protected readonly rememberPassword = signal(false);
  protected readonly selectedNav = signal('Tổng quan');
  protected readonly filter = signal('Tất cả');
  protected readonly submitted = signal(false);
  protected readonly showChat = signal(false);

  protected username = '';
  protected password = '';
  protected className = '7A1';
  protected present = 36;
  protected total = 38;
  protected absentCount = 2;
  protected absentNames = ['Nguyễn Minh Anh', 'Trần Gia Bảo'];
  protected chatInput = '';

  protected teachers = signal<Teacher[]>([
    { name: 'Nguyễn Thị Minh', phone: '0908123456', className: '7A1', present: 36, total: 38, absentNames: ['Nguyễn Minh Anh', 'Trần Gia Bảo'], checkedAt: '07:18', status: 'Đã điểm danh' },
    { name: 'Trần Văn Hùng', phone: '0912345678', className: '8A2', present: 40, total: 40, absentNames: [], checkedAt: '07:20', status: 'Đã điểm danh' },
    { name: 'Lê Thị Hương', phone: '0987654321', className: '6A3', present: null, total: null, absentNames: [], checkedAt: null, status: 'Chưa điểm danh' },
    { name: 'Phạm Quốc Toàn', phone: '0934567890', className: '9A1', present: 32, total: 35, absentNames: ['Võ Thành Đạt', 'Đỗ Khánh Linh', 'Mai Hoàng Nam'], checkedAt: '07:32', status: 'Đã điểm danh' },
    { name: 'Đặng Ngọc Lan', phone: '0971122334', className: '6A1', present: null, total: null, absentNames: [], checkedAt: null, status: 'Chưa điểm danh' },
  ]);

  protected chatMessages = signal<ChatMessage[]>([
    { from: 'assistant', text: 'Chào cô Minh. Tôi có thể hỗ trợ tra cứu lịch điểm danh, gợi ý lớp thường dạy hoặc giải đáp nhanh các câu hỏi nghiệp vụ.' }
  ]);

  protected filteredTeachers = computed(() => {
    const value = this.filter();
    if (value === 'Đã điểm danh') return this.teachers().filter(t => t.status === 'Đã điểm danh');
    if (value === 'Chưa điểm danh') return this.teachers().filter(t => t.status === 'Chưa điểm danh');
    return this.teachers();
  });

  protected totalPresent = computed(() => this.teachers().reduce((sum, t) => sum + (t.present ?? 0), 0));
  protected checkedCount = computed(() => this.teachers().filter(t => t.status === 'Đã điểm danh').length);
  protected absentTotal = computed(() => this.teachers().reduce((sum, t) => sum + t.absentNames.length, 0));

  login(role: Role = this.activeRole()) {
    if (!this.username.trim() || !this.password.trim()) {
      this.loginError.set('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }
    this.activeRole.set(role);
    this.loggedIn.set(true);
    this.showLogin.set(false);
    this.loginError.set('');
  }

  useDemo(role: Role) {
    this.username = role === 'admin' ? 'admin' : 'nguyen.thi.minh';
    this.password = 'Phulong@2026';
    this.login(role);
  }

  logout() {
    this.loggedIn.set(false);
    this.showLogin.set(true);
    this.username = '';
    this.password = '';
  }

  selectRole(role: Role) {
    this.activeRole.set(role);
    this.loginError.set('');
  }

  submitAttendance() {
    const safeTotal = Math.max(Number(this.total) || 0, 0);
    const safePresent = Math.min(Math.max(Number(this.present) || 0, 0), safeTotal);
    this.total = safeTotal;
    this.present = safePresent;
    this.absentCount = Math.max(safeTotal - safePresent, 0);
    while (this.absentNames.length < this.absentCount) this.absentNames.push('');
    this.absentNames = this.absentNames.slice(0, this.absentCount);
    this.submitted.set(true);
    this.teachers.update(list => list.map(t => t.name === 'Nguyễn Thị Minh' ? {
      ...t, className: this.className, present: this.present, total: this.total,
      absentNames: this.absentNames.filter(Boolean), checkedAt: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }), status: 'Đã điểm danh'
    } : t));
  }

  updateAbsentCount() {
    this.absentCount = Math.max((Number(this.total) || 0) - (Number(this.present) || 0), 0);
    while (this.absentNames.length < this.absentCount) this.absentNames.push('');
    this.absentNames = this.absentNames.slice(0, this.absentCount);
  }

  exportCsv() {
    const rows = this.filteredTeachers().map(t => ({
      'Tên giáo viên': t.name,
      'Lớp': t.status === 'Chưa điểm danh' ? 'Chưa điểm danh' : t.className,
      'Tỉ số điểm danh': t.status === 'Chưa điểm danh' ? 'Chưa điểm danh' : `${t.present}/${t.total}`,
      'Số học sinh vắng': t.status === 'Chưa điểm danh' ? '' : t.absentNames.length,
      'Tên học sinh vắng': t.absentNames.join('; '),
      'Số điện thoại': t.phone,
      'Trạng thái': t.status,
      'Thời gian': t.checkedAt || ''
    }));
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 34 }, { wch: 17 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Điểm danh');
    XLSX.writeFile(workbook, `diem-danh-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  sendChat() {
    const message = this.chatInput.trim();
    if (!message) return;
    this.chatMessages.update(items => [...items, { from: 'teacher', text: message }, { from: 'assistant', text: 'Tôi đã ghi nhận câu hỏi. Trong phiên bản kết nối Firebase Functions/OpenRouter, câu trả lời sẽ được tạo theo lịch sử và quyền truy cập của giáo viên.' }]);
    this.chatInput = '';
  }

  setClassSuggestion(value: string) { this.className = value; }
  callTeacher(phone: string) { window.location.href = `tel:${phone}`; }
}

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as XLSX from 'xlsx';
import { getApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { getDatabase, ref, onValue, off, set, get } from 'firebase/database';
import { NotificationService } from './notification.service';
import { app as firebaseApp } from '../firebase'; // Đảm bảo Firebase được import để chạy initializeApp() trước

type Role = 'admin' | 'teacher';
type AttendanceStatus = 'Đã điểm danh' | 'Chưa điểm danh';

interface TeacherData {
  uid: string;
  name: string;
  phone: string;
  className?: string;
  email: string;
  role: Role;
}

interface AttendanceRecord {
  teacherUid: string;
  teacherName: string;
  className: string;
  present: number;
  total: number;
  absentNames: string[];
  checkedAt: string;
}

interface TeacherUIModel {
  uid: string;
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
export class App implements OnInit, OnDestroy {
  private readonly notificationSvc = inject(NotificationService);
  
  // Trạng thái chung
  protected readonly today = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'full' }).format(new Date());
  protected readonly todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  protected readonly selectedDay = signal(String(new Date().getDate()).padStart(2, '0'));
  protected readonly selectedMonth = signal(String(new Date().getMonth() + 1).padStart(2, '0'));
  protected readonly selectedYear = signal(String(new Date().getFullYear()));
  protected readonly selectedDateStr = computed(() => `${this.selectedYear()}-${this.selectedMonth()}-${this.selectedDay()}`);
  
  protected readonly days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
  protected readonly months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  protected readonly years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i));

  protected readonly activeRole = signal<Role>('teacher');
  protected readonly selectedSession = signal<'morning' | 'afternoon'>('morning');
  protected readonly loggedIn = signal(false);
  protected readonly showLogin = signal(true);
  protected readonly loginError = signal('');
  protected readonly selectedNav = signal('Tổng quan');
  protected readonly filter = signal('Tất cả');
  protected readonly submitted = signal(false);
  protected readonly showChat = signal(false);
  protected readonly loading = signal(true);

  // Thông tin User đăng nhập
  protected currentUser = signal<User | null>(null);
  protected currentUserProfile = signal<TeacherData | null>(null);

  // Form đăng nhập & điểm danh
  protected phone = '';
  protected email = '';
  protected password = '';
  protected rememberMe = false;
  protected showPassword = false;
  protected className = '7A1';
  protected present = 35;
  protected total = 35;
  protected absentCount = 0;
  protected absentNames: string[] = [];
  protected chatInput = '';

  // Dữ liệu Realtime (Lazy initialization)
  private get db() { return getDatabase(firebaseApp); }
  private get auth() { return getAuth(firebaseApp); }
  private dbListeners: { path: string; cb: any }[] = [];

  // Dữ liệu đồng bộ
  protected readonly dbTeachers = signal<TeacherData[]>([]);
  protected readonly dbAttendance = signal<Record<string, AttendanceRecord>>({});

  // Model hiển thị cho bảng quản lý của Admin
  protected teachers = computed<TeacherUIModel[]>(() => {
    const list = this.dbTeachers();
    const attendanceMap = this.dbAttendance();
    
    return list.map(t => {
      const att = attendanceMap[t.uid];
      if (att) {
        return {
          uid: t.uid,
          name: t.name,
          phone: t.phone,
          className: att.className,
          present: att.present,
          total: att.total,
          absentNames: att.absentNames || [],
          checkedAt: att.checkedAt,
          status: 'Đã điểm danh' as AttendanceStatus
        };
      } else {
        return {
          uid: t.uid,
          name: t.name,
          phone: t.phone,
          className: '',
          present: null,
          total: null,
          absentNames: [],
          checkedAt: null,
          status: 'Chưa điểm danh' as AttendanceStatus
        };
      }
    });
  });

  protected filteredTeachers = computed(() => {
    const value = this.filter();
    if (value === 'Đã điểm danh') return this.teachers().filter(t => t.status === 'Đã điểm danh');
    if (value === 'Chưa điểm danh') return this.teachers().filter(t => t.status === 'Chưa điểm danh');
    return this.teachers();
  });

  // Thống kê
  protected totalPresent = computed(() => this.teachers().reduce((sum, t) => sum + (t.present ?? 0), 0));
  protected checkedCount = computed(() => this.teachers().filter(t => t.status === 'Đã điểm danh').length);
  protected absentTotal = computed(() => this.teachers().reduce((sum, t) => sum + t.absentNames.length, 0));

  protected chatMessages = signal<ChatMessage[]>([
    { from: 'assistant', text: 'Chào thầy cô. Tôi là Trợ lý Phú Long hỗ trợ theo dõi điểm danh lớp học.' }
  ]);

  ngOnInit() {
    // Tự động chọn phiên dựa trên giờ hiện tại
    const currentHour = new Date().getHours();
    this.selectedSession.set(currentHour < 12 ? 'morning' : 'afternoon');

    // Đọc thông tin đăng nhập đã lưu (nếu user chọn "Ghi nhớ mật khẩu")
    const saved = localStorage.getItem('phulong_remember');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        this.phone = data.phone || '';
        this.password = data.password || '';
        this.rememberMe = true;
      } catch { /* ignore */ }
    }

    // Lắng nghe trạng thái đăng nhập Firebase Auth
    onAuthStateChanged(this.auth, async (user) => {
      this.loading.set(true);
      if (user) {
        this.currentUser.set(user);
        // Lấy profile từ Database
        const userRef = ref(this.db, `users/${user.uid}`);
        const snapshot = await get(userRef);
        if (snapshot.exists()) {
          const profile = snapshot.val() as TeacherData;
          profile.uid = user.uid;
          this.currentUserProfile.set(profile);
          this.activeRole.set(profile.role || 'teacher');
          
          this.loggedIn.set(true);
          this.showLogin.set(false);

          // Khởi động FCM Service Worker nhận notification
          this.notificationSvc.init(user.uid).catch(console.error);
          
          // Đăng ký realtime listeners
          this.setupRealtimeSync();
          
          // Kiểm tra xem giáo viên này đã nộp điểm danh hôm nay chưa
          if (profile.role !== 'admin') {
            this.checkSelfAttendance(user.uid);
          }
        } else {
          this.loginError.set('Tài khoản không tồn tại trên hệ thống dữ liệu.');
          this.logout();
        }
      } else {
        this.currentUser.set(null);
        this.currentUserProfile.set(null);
        this.loggedIn.set(false);
        this.showLogin.set(true);
        this.clearListeners();
      }
      this.loading.set(false);
    });
  }

  ngOnDestroy() {
    this.clearListeners();
  }

  protected changeSession(session: 'morning' | 'afternoon') {
    this.selectedSession.set(session);
    if (this.loggedIn()) {
      this.setupRealtimeSync();
      const profile = this.currentUserProfile();
      if (profile && profile.role !== 'admin') {
        this.checkSelfAttendance(profile.uid);
      }
    }
  }

  protected getTimeStatus(session: 'morning' | 'afternoon'): { allowed: boolean; message: string } {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentMinutes = hours * 60 + minutes;

    if (session === 'morning') {
      const start = 6 * 60 + 50; // 06:50
      const end = 8 * 60;       // 08:00
      if (currentMinutes < start) {
        return { allowed: false, message: 'Chưa đến giờ điểm danh buổi sáng (chỉ mở từ 06:50 đến 08:00).' };
      }
      if (currentMinutes > end) {
        return { allowed: false, message: 'Đã hết giờ điểm danh buổi sáng (hạn chót là 08:00).' };
      }
      return { allowed: true, message: 'Trong khung giờ điểm danh buổi sáng (06:50 - 08:00).' };
    } else {
      const start = 13 * 60 + 10; // 13:10 (01:10 PM)
      const end = 14 * 60;        // 14:00 (02:00 PM)
      if (currentMinutes < start) {
        return { allowed: false, message: 'Chưa đến giờ điểm danh buổi chiều (chỉ mở từ 13:10 đến 14:00).' };
      }
      if (currentMinutes > end) {
        return { allowed: false, message: 'Đã hết giờ điểm danh buổi chiều (hạn chót là 14:00).' };
      }
      return { allowed: true, message: 'Trong khung giờ điểm danh buổi chiều (13:10 - 14:00).' };
    }
  }

  protected updateSelectedDate(type: 'day' | 'month' | 'year', value: string) {
    if (type === 'day') this.selectedDay.set(value);
    if (type === 'month') this.selectedMonth.set(value);
    if (type === 'year') this.selectedYear.set(value);
    this.setupRealtimeSync();
  }

  private setupRealtimeSync() {
    this.clearListeners();

    // 1. Đồng bộ danh sách tất cả giáo viên (chỉ lấy role teacher để hiển thị tại admin)
    const usersRef = ref(this.db, 'users');
    const usersCallback = onValue(usersRef, (snapshot) => {
      const teachersList: TeacherData[] = [];
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const val = child.val();
          if (val.role === 'teacher') {
            teachersList.push({
              uid: child.key!,
              name: val.name,
              phone: val.phone,
              email: val.email,
              role: val.role
            });
          }
        });
      }
      this.dbTeachers.set(teachersList);
    });
    this.dbListeners.push({ path: 'users', cb: usersCallback });

    // 2. Đồng bộ kết quả điểm danh của ngày hôm nay theo phiên
    const sessionSuffix = this.selectedSession();
    const attPath = `attendance/${this.selectedDateStr()}_${sessionSuffix}`;
    const attRef = ref(this.db, attPath);
    const attCallback = onValue(attRef, (snapshot) => {
      const records: Record<string, AttendanceRecord> = {};
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          records[child.key!] = child.val() as AttendanceRecord;
        });
      }
      this.dbAttendance.set(records);
      
      // Cập nhật lại UI cá nhân nếu giáo viên thay đổi dữ liệu điểm danh trên thiết bị khác
      const profile = this.currentUserProfile();
      if (profile && profile.uid) {
        const myRecord = records[profile.uid];
        if (myRecord) {
          this.className = myRecord.className;
          this.present = myRecord.present;
          this.total = myRecord.total;
          this.absentNames = myRecord.absentNames || [];
          this.absentCount = myRecord.total - myRecord.present;
          this.submitted.set(true);
        } else {
          this.submitted.set(false);
        }
      }
    });
    this.dbListeners.push({ path: attPath, cb: attCallback });
  }

  private async checkSelfAttendance(uid: string) {
    const sessionSuffix = this.selectedSession();
    const selfAttRef = ref(this.db, `attendance/${this.todayStr}_${sessionSuffix}/${uid}`);
    const snapshot = await get(selfAttRef);
    if (snapshot.exists()) {
      const data = snapshot.val();
      this.className = data.className;
      this.present = data.present;
      this.total = data.total;
      this.absentNames = data.absentNames || [];
      this.absentCount = data.total - data.present;
      this.submitted.set(true);
    } else {
      this.submitted.set(false);
    }
  }

  private clearListeners() {
    this.dbListeners.forEach(listener => {
      const listenerRef = ref(this.db, listener.path);
      off(listenerRef, 'value', listener.cb);
    });
    this.dbListeners = [];
  }

  async login() {
    const inputVal = this.phone.trim();
    if (!inputVal || !this.password.trim()) {
      this.loginError.set('Vui lòng nhập đầy đủ thông tin đăng nhập và mật khẩu.');
      return;
    }
    
    try {
      this.loading.set(true);
      this.loginError.set('');
      
      let loginEmail = '';
      
      // Nếu là số điện thoại (chỉ chứa số hoặc dấu cộng)
      if (/^\+?[0-9]{9,15}$/.test(inputVal)) {
        // Tra cứu số điện thoại trong Firebase Database để lấy Email
        const usersRef = ref(this.db, 'users');
        const snapshot = await get(usersRef);
        let foundEmail = '';
        
        if (snapshot.exists()) {
          snapshot.forEach((child) => {
            const val = child.val();
            const dbPhone = String(val.phone || '').replace(/\s+/g, '');
            const searchPhone = inputVal.replace(/\s+/g, '');
            if (dbPhone && (dbPhone === searchPhone || dbPhone.endsWith(searchPhone) || searchPhone.endsWith(dbPhone))) {
              foundEmail = val.email;
              return true; // dừng vòng lặp
            }
            return false; // tiếp tục vòng lặp
          });
        }
        
        if (!foundEmail) {
          this.loginError.set('Số điện thoại không khớp với giáo viên nào trên hệ thống.');
          this.loading.set(false);
          return;
        }
        loginEmail = foundEmail;
      } else {
        // Nếu là email hoặc username bình thường (cho Admin hoặc Demo)
        loginEmail = inputVal.includes('@') ? inputVal : `${inputVal.toLowerCase()}@phulong.edu.vn`;
      }

      await signInWithEmailAndPassword(this.auth, loginEmail, this.password);

      // Lưu hoặc xóa thông tin đăng nhập theo lựa chọn
      if (this.rememberMe) {
        localStorage.setItem('phulong_remember', JSON.stringify({ phone: this.phone, password: this.password }));
      } else {
        localStorage.removeItem('phulong_remember');
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        this.loginError.set('Tài khoản hoặc mật khẩu không chính xác.');
      } else {
        this.loginError.set('Đăng nhập thất bại: ' + err.message);
      }
    }
  }

  async logout() {
    this.loading.set(true);
    await signOut(this.auth);
    this.loggedIn.set(false);
    this.showLogin.set(true);
    this.submitted.set(false);
    this.loading.set(false);
  }

  selectRole(role: Role) {
    this.activeRole.set(role);
    this.loginError.set('');
  }

  async submitAttendance() {
    const profile = this.currentUserProfile();
    if (!profile) return;

    const timeCheck = this.getTimeStatus(this.selectedSession());
    if (!timeCheck.allowed) {
      alert('Không thể điểm danh: ' + timeCheck.message);
      return;
    }

    const safeTotal = Math.max(Number(this.total) || 0, 0);
    const safePresent = Math.min(Math.max(Number(this.present) || 0, 0), safeTotal);
    this.total = safeTotal;
    this.present = safePresent;
    this.absentCount = Math.max(safeTotal - safePresent, 0);
    
    const record: AttendanceRecord = {
      teacherUid: profile.uid,
      teacherName: profile.name,
      className: this.className,
      present: this.present,
      total: this.total,
      absentNames: this.absentNames.filter(Boolean),
      checkedAt: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    };

    try {
      // Lưu kết quả điểm danh vào Firebase Realtime Database theo phiên
      const sessionSuffix = this.selectedSession();
      const attendanceRef = ref(this.db, `attendance/${this.todayStr}_${sessionSuffix}/${profile.uid}`);
      await set(attendanceRef, record);
      this.submitted.set(true);
    } catch (err: any) {
      alert('Không thể nộp điểm danh: ' + err.message);
    }
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
    XLSX.writeFile(workbook, `diem-danh-${this.selectedDateStr()}.xlsx`);
  }

  sendChat() {
    const message = this.chatInput.trim();
    if (!message) return;
    
    // Gửi chat lên assistant endpoint của bạn
    this.chatMessages.update(items => [...items, { from: 'teacher', text: message }]);
    
    fetch('https://askassistant-228723528249.asia-east2.run.app', { // API gateway của Firebase Cloud Function
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    }).then(res => res.json())
      .then(data => {
        this.chatMessages.update(items => [...items, { from: 'assistant', text: data.answer || 'Xin lỗi, tôi gặp sự cố kết nối.' }]);
      }).catch(() => {
        this.chatMessages.update(items => [...items, { from: 'assistant', text: 'Không thể kết nối đến Trợ lý AI lúc này.' }]);
      });

    this.chatInput = '';
  }

  setClassSuggestion(value: string) { this.className = value; }
  callTeacher(phone: string) { window.location.href = `tel:${phone}`; }

  getAttendanceRate(): number {
    const tot = Number(this.total) || 0;
    const pres = Number(this.present) || 0;
    return tot > 0 ? Math.round((pres / tot) * 100) : 0;
  }

  getCheckedRate(): number {
    const len = this.teachers().length;
    const checked = this.checkedCount();
    return len > 0 ? Math.round((checked / len) * 100) : 0;
  }
}

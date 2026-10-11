import { CommonModule } from '@angular/common';
import { TeacherNotifications } from './teacher-notifications';
import { environment } from '../environments/environment';
import { Component, computed, inject, signal, OnInit, OnDestroy, HostListener, NgZone } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as XLSX from 'xlsx-js-style';
import { getApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { getDatabase, ref, onValue, get, push, runTransaction } from 'firebase/database';
import { AbsenteeDetail, AttendanceRecord, attendanceClassKey, attendanceVersion, findClassRecord, mergeAttendanceRecords, canSaveAttendance } from './attendance-record';
import { ATTENDANCE_WINDOWS, attendanceTimeStatus } from './attendance-time';
import { AttendancePhoto } from './attendance-photo';
import { BoardAttendance } from './attendance-photo.service';
import { NotificationService } from './notification.service';
import { Capacitor } from '@capacitor/core';
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
  isTestAccount?: boolean;  // tài khoản test: bỏ qua ràng buộc thời gian điểm danh
  viewOnlyUids?: string[];  // admin test: chỉ hiển thị các teacher trong danh sách này
}

interface TeacherUIModel {
  uid: string;
  name: string;
  phone: string;
  className: string;
  present: number | null;
  total: number | null;
  absentNames: string[];
  absentees: AbsenteeDetail[];
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
  imports: [CommonModule, FormsModule, TeacherNotifications, AttendancePhoto],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  protected readonly notificationDemo = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('demo') === 'notifications';
  protected readonly notificationSvc = inject(NotificationService);
  private readonly zone = inject(NgZone);
  
  // Trạng thái chung
  protected readonly today = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'full' }).format(new Date());
  protected readonly todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  protected readonly selectedDay = signal(String(new Date().getDate()).padStart(2, '0'));
  protected readonly selectedMonth = signal(String(new Date().getMonth() + 1).padStart(2, '0'));
  protected readonly selectedYear = signal(String(new Date().getFullYear()));
  protected readonly selectedDateStr = computed(() => `${this.selectedYear()}-${this.selectedMonth()}-${this.selectedDay()}`);
  
  protected readonly days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
  protected readonly months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  protected readonly years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i));

  protected readonly activeRole = signal<Role>('teacher');
  protected readonly selectedSession = signal<'morning' | 'afternoon'>('morning');
  protected readonly attendanceWindows = ATTENDANCE_WINDOWS;
  private readonly attendanceClock = signal(Date.now());
  private attendanceClockTimer?: ReturnType<typeof setInterval>;
  protected readonly loggedIn = signal(false);
  protected readonly showLogin = signal(true);
  protected readonly loginError = signal('');
  protected readonly selectedNav = signal(new URLSearchParams(location.search).has('notifications') ? 'Thông báo' : 'Tổng quan');
  protected readonly mobileMenuOpen = signal(false);

  protected navigateTo(section: string) {
    this.selectedNav.set(section);
    this.closeMobileMenu();
  }

  @HostListener('document:keydown.escape')
  protected closeMobileMenu() {
    if (this.mobileMenuOpen()) {
      this.mobileMenuOpen.set(false);
      document.getElementById('mobile-menu-toggle')?.focus();
    }
  }
  protected readonly filter = signal('Tất cả');
  protected readonly submitted = signal(false);
  protected readonly attendanceSaving = signal(false);
  protected readonly attendancePhotoBusy = signal(false);
  protected readonly attendancePhotoWarnings = signal<string[]>([]);
  protected readonly attendanceEditing = signal(false);
  protected readonly attendanceNotice = signal('');
  protected readonly attendanceConflict = signal<AttendanceRecord | null>(null);
  private reviewedAttendance: { classKey: string; version: string } | null = null;
  private legacyAttendance: Record<string, AttendanceRecord> = {};
  private classAttendance: Record<string, AttendanceRecord> = {};
  protected readonly showChat = signal(false);
  protected readonly loading = signal(true);
  protected readonly cooldownTime = signal(0);
  private failedAttempts = 0;
  private cooldownInterval: any = null;

  // Thông tin User đăng nhập
  protected currentUser = signal<User | null>(null);
  protected currentUserProfile = signal<TeacherData | null>(null);

  // Lớp gợi ý
  protected readonly gradeList = ['6', '7', '8', '9'];
  protected readonly classSuggestions = [
    '6A1', '6A2', '6A3', '6A4', '6A5', '6A6', '6A7', '6A8', '6A9',
    '7A1', '7A2', '7A3', '7A4', '7A5', '7A6', '7A7', '7A8', '7A9',
    '8A1', '8A2', '8A3', '8A4', '8A5', '8A6', '8A7', '8A8', '8A9',
    '9A1', '9A2', '9A3', '9A4', '9A5', '9A6', '9A7', '9A8', '9A9'
  ];

  // Form đăng nhập & điểm danh
  protected phone = '';
  protected email = '';
  protected password = '';
  protected rememberMe = false;
  protected showPassword = false;
  protected className = '7A1';
  protected present: number | null = 35;
  protected total: number | null = 35;
  protected absentCount = 0;
  protected absentNames: string[] = [];
  protected absentees: AbsenteeDetail[] = [];
  protected chatInput = '';
  protected errors: { className?: string; present?: string; total?: string; absentees?: string } = {};

  // Dữ liệu Realtime (Lazy initialization)
  private get db() { return getDatabase(firebaseApp); }
  private get auth() { return getAuth(firebaseApp); }
  private dbListeners: (() => void)[] = [];

  // Dữ liệu đồng bộ
  protected readonly dbTeachers = signal<TeacherData[]>([]);
  protected readonly dbAttendance = signal<Record<string, AttendanceRecord>>({});

  // Bộ lọc admin theo khối lớp
  protected readonly adminGradeFilter = signal<string>('Tất cả');

  // Hàm helper để so sánh tự nhiên tên lớp (ví dụ: 6A1 < 6A2, 6A9 < 6A10, 6A < 7A)
  private compareClassNames(a: string, b: string): number {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  // Model hiển thị cho bảng quản lý của Admin
  protected teachers = computed<TeacherUIModel[]>(() => {
    const list = this.dbTeachers();
    const attendanceMap = this.dbAttendance();
    
    const uiList = list.map(t => {
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
          absentees: att.absentees || (att.absentNames ? att.absentNames.map(name => ({ name, status: 'Không phép' as const })) : []),
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
          absentees: [],
          checkedAt: null,
          status: 'Chưa điểm danh' as AttendanceStatus
        };
      }
    });

    // Sắp xếp tăng dần theo thứ tự tên lớp
    // Lớp chưa điểm danh (className rỗng) sẽ được xếp xuống dưới cùng hoặc theo tên giáo viên
    return uiList.sort((a, b) => {
      if (a.status === 'Chưa điểm danh' && b.status === 'Đã điểm danh') return 1;
      if (a.status === 'Đã điểm danh' && b.status === 'Chưa điểm danh') return -1;
      if (a.status === 'Đã điểm danh' && b.status === 'Đã điểm danh') {
        return this.compareClassNames(a.className, b.className);
      }
      // Cả hai chưa điểm danh thì xếp theo tên giáo viên
      return a.name.localeCompare(b.name, 'vi');
    });
  });

  protected filteredTeachers = computed(() => {
    const statusVal = this.filter();
    const gradeVal = this.adminGradeFilter();
    let result = this.teachers();

    // Lọc theo trạng thái điểm danh
    if (statusVal === 'Đã điểm danh') {
      result = result.filter(t => t.status === 'Đã điểm danh');
    } else if (statusVal === 'Chưa điểm danh') {
      result = result.filter(t => t.status === 'Chưa điểm danh');
    }

    // Lọc theo khối lớp
    if (gradeVal !== 'Tất cả') {
      result = result.filter(t => {
        if (t.status === 'Chưa điểm danh') {
          // Giáo viên chưa điểm danh nhưng có thể lọc theo gợi ý khối nếu lớp mặc định của họ thuộc khối đó.
          // Hoặc đơn giản là nếu họ chưa điểm danh, ta kiểm tra xem lớp mặc định hoặc tên lớp bắt đầu bằng số khối
          // Ở đây ta xem xét className của họ. Nếu chưa điểm danh thì lớp trống, nên không thuộc khối cụ thể nào,
          // Tuy nhiên để tiện theo dõi, nếu lọc khối, ta chỉ hiển thị những giáo viên thuộc khối đó đã điểm danh,
          // hoặc kiểm tra email/tên để suy đoán. Phù hợp nhất là lọc theo lớp thực tế đã điểm danh.
          return false; 
        }
        // Ví dụ lớp: 6A1 -> bắt đầu bằng kí tự của gradeVal
        return t.className.trim().startsWith(gradeVal);
      });
    }

    return result;
  });

  // Thống kê
  protected totalPresent = computed(() => this.teachers().reduce((sum, t) => sum + (t.present ?? 0), 0));
  protected checkedCount = computed(() => this.teachers().filter(t => t.status === 'Đã điểm danh').length);
  protected absentTotal = computed(() => this.teachers().reduce((sum, t) => sum + t.absentNames.length, 0));

  protected chatMessages = signal<ChatMessage[]>([
    { from: 'assistant', text: 'Chào thầy cô. Tôi là Trợ lý Phú Long hỗ trợ theo dõi điểm danh lớp học.' }
  ]);

  ngOnInit() {
    this.zone.runOutsideAngular(() => {
      this.attendanceClockTimer = setInterval(() => {
        const now = Date.now();
        if (Math.floor(now / 60000) !== Math.floor(this.attendanceClock() / 60000)) {
          this.zone.run(() => this.attendanceClock.set(now));
        }
      }, 1000);
    });
    if (this.notificationDemo) { this.loading.set(false); return; }
    // Tự động chọn phiên dựa trên giờ hiện tại
    const currentHour = (new Date().getUTCHours() + 7) % 24;
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

          // Tự động khởi tạo thông báo trên cả Web và Mobile App Native
          this.notificationSvc.init(user.uid).catch(console.error);
          this.updateNotificationPermissionStatus();
          
          // Đăng ký realtime listeners
          this.setupRealtimeSync();
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

  // Quản lý quyền thông báo tự động
  protected readonly notificationPermission = signal<'granted' | 'denied' | 'default'>('default');

  protected async updateNotificationPermissionStatus() {
    if (Capacitor.isNativePlatform()) {
      const status = await this.notificationSvc.getNativePermissionStatus();
      this.notificationPermission.set(status === 'prompt' ? 'default' : status);
      return;
    }

    if ('Notification' in window) {
      this.notificationPermission.set(Notification.permission);
    }
  }

  protected async requestNotificationPermission() {
    const user = this.currentUser();
    if (!user) return;

    await this.notificationSvc.init(user.uid);
    await this.updateNotificationPermissionStatus();

    const permission = this.notificationPermission();
    if (permission === 'denied') {
      alert('Quyền thông báo hiện đang bị TỪ CHỐI trên thiết bị này. Vui lòng vào Cài đặt -> Thông báo -> Phú Long trên điện thoại của bạn để bật lại.');
    } else if (permission === 'granted') {
      alert(this.notificationSvc.pushStatus());
    } else if (Capacitor.isNativePlatform()) {
      alert('Chưa bật được thông báo native. Kiểm tra file google-services.json trong android/app.');
    } else {
      alert(this.notificationSvc.pushStatus());
    }
  }

  ngOnDestroy() {
    if (this.attendanceClockTimer) clearInterval(this.attendanceClockTimer);
    this.clearListeners();
    if (this.cooldownInterval) {
      clearInterval(this.cooldownInterval);
    }
  }

  protected changeSession(session: 'morning' | 'afternoon') {
    if (this.attendanceSaving() || this.attendancePhotoBusy()) return;
    this.attendancePhotoWarnings.set([]);
    this.attendanceEditing.set(false);
    this.reviewedAttendance = null;
    this.attendanceNotice.set('');
    this.attendanceConflict.set(null);
    this.submitted.set(false);
    this.selectedSession.set(session);
    if (this.loggedIn()) {
      this.setupRealtimeSync();
    }
  }

  protected getTimeStatus(session: 'morning' | 'afternoon'): { allowed: boolean; message: string } {
    // Refresh the open page automatically; always recheck the exact time when saving.
    this.attendanceClock();
    return attendanceTimeStatus(session, new Date(), !!this.currentUserProfile()?.isTestAccount);
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
    //    Nếu admin có viewOnlyUids thì chỉ lấy các teacher trong danh sách đó
    const adminProfile = this.currentUserProfile();
    const viewOnlyUids: string[] | undefined = adminProfile?.viewOnlyUids;

    const usersRef = ref(this.db, 'users');
    const usersCallback = onValue(usersRef, (snapshot) => {
      const teachersList: TeacherData[] = [];
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const val = child.val();
          if (val.role === 'teacher') {
            // Nếu admin có viewOnlyUids, chỉ hiển thị teacher nằm trong danh sách đó
            if (viewOnlyUids && viewOnlyUids.length > 0 && !viewOnlyUids.includes(child.key!)) {
              return;
            }
            teachersList.push({
              uid: child.key!,
              name: val.name,
              phone: val.phone,
              email: val.email,
              role: val.role,
              isTestAccount: val.isTestAccount ?? false
            });
          }
        });
      }
      this.dbTeachers.set(teachersList);
    });
    this.dbListeners.push(usersCallback);

    // 2. Đồng bộ kết quả điểm danh của ngày hôm nay theo phiên
    const sessionSuffix = this.selectedSession();
    const date = this.activeRole() === 'teacher' ? this.todayStr : this.selectedDateStr();
    const attPath = `attendance/${date}_${sessionSuffix}`;
    const classPath = `classAttendance/${date}_${sessionSuffix}`;
    this.legacyAttendance = {};
    this.classAttendance = {};
    let legacyLoaded = false;
    let classesLoaded = false;
    const syncAttendance = () => {
      if (!legacyLoaded || !classesLoaded) return;
      const records = mergeAttendanceRecords(this.legacyAttendance, this.classAttendance);
      this.dbAttendance.set(records);
      const profile = this.currentUserProfile();
      if (profile?.role === 'teacher' && !this.attendanceEditing() && !this.attendanceSaving()) {
        const myRecord = records[profile.uid];
        if (myRecord) this.loadAttendanceForm(myRecord);
        this.submitted.set(!!myRecord);
      }
    };
    const attRef = ref(this.db, attPath);
    const attCallback = onValue(attRef, (snapshot) => {
      const records: Record<string, AttendanceRecord> = {};
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          records[child.key!] = child.val() as AttendanceRecord;
        });
      }
      this.legacyAttendance = records;
      legacyLoaded = true;
      syncAttendance();
    });
    this.dbListeners.push(attCallback);
    const classCallback = onValue(ref(this.db, classPath), snapshot => {
      this.classAttendance = snapshot.val() || {};
      classesLoaded = true;
      syncAttendance();
    });
    this.dbListeners.push(classCallback);
  }

  private loadAttendanceForm(record: AttendanceRecord) {
    this.className = record.className;
    this.present = record.present;
    this.total = record.total;
    this.absentNames = [...(record.absentNames || [])];
    this.absentees = record.absentees?.map(abs => ({ ...abs })) || this.absentNames.map(name => ({ name, status: 'Không phép' }));
    this.absentCount = record.total - record.present;
  }

  protected get duplicateAttendance(): AttendanceRecord | null {
    const record = this.classAttendance[attendanceClassKey(this.className)] || findClassRecord(this.legacyAttendance, this.className);
    return record && record.teacherUid !== this.currentUserProfile()?.uid ? record : null;
  }

  protected get hasReviewedDuplicate(): boolean {
    const record = this.duplicateAttendance;
    return !!record && this.reviewedAttendance?.classKey === attendanceClassKey(this.className) && this.reviewedAttendance.version === attendanceVersion(record);
  }

  protected onAttendanceClassChange() {
    this.clearError('className');
    this.reviewedAttendance = null;
    this.attendanceNotice.set('');
    this.attendanceConflict.set(null);
    this.attendanceEditing.set(true);
  }

  protected editClassAttendance(record = this.duplicateAttendance) {
    if (!record || this.attendanceSaving() || !this.getTimeStatus(this.selectedSession()).allowed) return;
    this.loadAttendanceForm(record);
    this.reviewedAttendance = { classKey: attendanceClassKey(record.className), version: attendanceVersion(record) };
    this.attendanceEditing.set(true);
    this.submitted.set(false);
    this.errors = {};
    this.attendanceConflict.set(null);
    this.attendanceNotice.set('Đã tải dữ liệu điểm danh. Khi lưu, bản điểm danh của lớp sẽ được cập nhật theo thông tin thầy cô nhập.');
  }

  protected editSelfAttendance() {
    this.editClassAttendance(this.dbAttendance()[this.currentUserProfile()!.uid]);
  }

  protected applyAttendancePhoto(result: BoardAttendance) {
    if (!this.getTimeStatus(this.selectedSession()).allowed) {
      this.attendanceNotice.set('Đã hết giờ điểm danh. Dữ liệu đọc từ ảnh chưa được áp dụng.');
      return;
    }
    const reviewed = this.reviewedAttendance;
    this.className = result.className || '';
    this.onAttendanceClassChange();
    if (reviewed?.classKey === attendanceClassKey(this.className)) this.reviewedAttendance = reviewed;
    this.total = result.total;
    this.present = result.present;
    this.absentees = (result.absentees || []).map(item => ({ ...item }));
    this.absentCount = result.total !== null && result.present !== null ? result.total - result.present : (result.absentCount ?? this.absentees.length);
    while (this.absentees.length < this.absentCount) this.absentees.push({ name: '', status: '' });
    // Preserve every name read from the board; ask the teacher to fix any count mismatch.
    this.absentNames = this.absentees.map(item => item.name);
    this.attendancePhotoWarnings.set(result.warnings || []);
    this.errors = {};
    this.attendanceNotice.set('Đã điền dữ liệu từ ảnh. Thầy cô kiểm tra tên lớp, sĩ số và học sinh vắng trước khi lưu.');
  }

  private clearListeners() {
    this.dbListeners.forEach(stop => stop());
    this.dbListeners = [];
  }

  private startCooldown(seconds: number) {
    this.cooldownTime.set(seconds);
    if (this.cooldownInterval) {
      clearInterval(this.cooldownInterval);
    }
    this.cooldownInterval = setInterval(() => {
      const current = this.cooldownTime();
      if (current <= 1) {
        this.cooldownTime.set(0);
        clearInterval(this.cooldownInterval);
        this.cooldownInterval = null;
      } else {
        this.cooldownTime.set(current - 1);
      }
    }, 1000);
  }

  async login() {
    if (!environment.firebase.databaseURL) {
      this.loginError.set('Hệ thống chưa được cấu hình cơ sở dữ liệu của trường. Vui lòng liên hệ quản trị viên.');
      return;
    }
    if (this.cooldownTime() > 0) {
      this.loginError.set(`Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${this.cooldownTime()} giây.`);
      return;
    }

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

      this.failedAttempts = 0;

      // Lưu hoặc xóa thông tin đăng nhập theo lựa chọn
      if (this.rememberMe) {
        localStorage.setItem('phulong_remember', JSON.stringify({ phone: this.phone, password: this.password }));
      } else {
        localStorage.removeItem('phulong_remember');
      }
    } catch (err: any) {
      console.error(err);
      this.failedAttempts++;

      if (err.code === 'auth/too-many-requests' || this.failedAttempts >= 5) {
        const waitTime = err.code === 'auth/too-many-requests' ? 60 : 30;
        this.startCooldown(waitTime);
        this.loginError.set(`Đăng nhập thất bại quá nhiều lần. Vui lòng thử lại sau ${waitTime} giây.`);
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        this.loginError.set('Tài khoản hoặc mật khẩu không chính xác.');
      } else {
        this.loginError.set('Đăng nhập thất bại: ' + err.message);
      }
      this.loading.set(false);
    }
  }

  async logout() {
    this.loading.set(true);
    await this.notificationSvc.disconnect();
    await signOut(this.auth);
    this.loggedIn.set(false);
    this.showLogin.set(true);
    this.submitted.set(false);
    this.attendanceEditing.set(false);
    this.reviewedAttendance = null;
    this.loading.set(false);
  }

  selectRole(role: Role) {
    this.activeRole.set(role);
    this.loginError.set('');
  }

  protected clearError(field: 'className' | 'present' | 'total') {
    this.errors[field] = undefined;
  }

  protected validateForm(): boolean {
    let isValid = true;
    this.errors = {};

    if (!this.className || !this.className.trim()) {
      this.errors.className = 'Không được để trống tên lớp';
      isValid = false;
    }

    if (this.present === null || this.present === undefined || String(this.present).trim() === '') {
      this.errors.present = 'Không được để trống số lượng có mặt';
      isValid = false;
    } else if (!Number.isInteger(Number(this.present)) || Number(this.present) < 0 || (this.total !== null && Number(this.present) > Number(this.total))) {
      this.errors.present = 'Số có mặt phải là số nguyên từ 0 đến tổng sĩ số';
      isValid = false;
    }

    if (this.total === null || this.total === undefined || String(this.total).trim() === '') {
      this.errors.total = 'Không được để trống tổng sĩ số';
      isValid = false;
    } else if (!Number.isInteger(Number(this.total)) || Number(this.total) <= 0) {
      this.errors.total = 'Tổng sĩ số phải là số nguyên lớn hơn 0';
      isValid = false;
    }

    // Validation bổ sung: bắt buộc nhập tên cho toàn bộ học sinh vắng
    if (this.absentCount > 0) {
      const missingNames = this.absentees.some(abs => !abs.name || !abs.name.trim());
      if (missingNames) {
        this.errors.absentees = 'Vui lòng nhập tên cho tất cả học sinh vắng';
        isValid = false;
      }
    }
    if (this.absentees.length !== this.absentCount || this.absentees.some(abs => !abs.status)) {
      this.errors.absentees = 'Kiểm tra số học sinh vắng và chọn trạng thái cho từng học sinh.';
      isValid = false;
    }

    return isValid;
  }

  async submitAttendance() {
    const profile = this.currentUserProfile();
    if (!profile || this.attendanceSaving() || this.attendancePhotoBusy()) return;

    const timeCheck = this.getTimeStatus(this.selectedSession());
    if (!timeCheck.allowed) {
      alert('Không thể điểm danh: ' + timeCheck.message);
      return;
    }

    const classKey = attendanceClassKey(this.className);
    if (!/^[6-9]A[1-9][0-9]*$/.test(classKey)) {
      this.errors.className = 'Tên lớp không hợp lệ. Ví dụ: 6A1, 7A2.';
      return;
    }

    if (!this.validateForm()) {
      if (this.errors.absentees) {
        alert(this.errors.absentees);
      }
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
      className: classKey,
      present: this.present!,
      total: this.total!,
      absentNames: this.absentees.map(abs => abs.name.trim()),
      absentees: this.absentees.map(abs => ({ name: abs.name.trim(), status: abs.status })),
      checkedAt: new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }),
      revision: push(ref(this.db, 'classAttendance')).key!,
      updatedAt: Date.now()
    };

    this.attendanceSaving.set(true);
    this.attendanceNotice.set('');
    try {
      const sessionKey = `${this.todayStr}_${this.selectedSession()}`;
      const attendanceRef = ref(this.db, `classAttendance/${sessionKey}/${classKey}`);
      const initial = (await get(attendanceRef)).val() as AttendanceRecord | null;
      const legacySnapshot = await get(ref(this.db, `attendance/${sessionKey}`));
      const legacyRecord = findClassRecord(legacySnapshot.val() || {}, classKey);
      const reviewed = this.reviewedAttendance?.classKey === classKey ? this.reviewedAttendance.version : null;
      const result = await runTransaction(attendanceRef, current => {
        const existing = (current || initial || legacyRecord) as AttendanceRecord | null;
        if (!canSaveAttendance(existing, profile.uid, reviewed)) {
          return;
        }
        return record;
      }, { applyLocally: false });
      if (!result.committed) {
        // Refresh the warning even when another device saved after the form was opened.
        const latest = await get(attendanceRef);
        const conflict = (latest.val() || initial || legacyRecord) as AttendanceRecord | null;
        if (latest.exists()) this.classAttendance[classKey] = latest.val();
        else if (conflict) this.legacyAttendance[conflict.teacherUid] = conflict;
        this.reviewedAttendance = null;
        this.attendanceConflict.set(latest.val() || conflict);
        this.attendanceEditing.set(true);
        this.attendanceNotice.set(conflict?.teacherUid !== profile.uid
          ? 'Lớp này đã được giáo viên khác điểm danh. Nhấn Chỉnh sửa để xem và nhập lại.'
          : 'Dữ liệu đã thay đổi trên thiết bị khác. Nhấn Chỉnh sửa để xem lại trước khi lưu.');
        return;
      }
      this.classAttendance[classKey] = record;
      this.dbAttendance.set(mergeAttendanceRecords(this.legacyAttendance, this.classAttendance));
      this.loadAttendanceForm(record);
      this.attendanceEditing.set(false);
      this.reviewedAttendance = null;
      this.attendanceConflict.set(null);
      this.submitted.set(true);
    } catch (err: any) {
      alert('Không thể nộp điểm danh: ' + err.message);
    } finally {
      this.attendanceSaving.set(false);
    }
  }

  updateAbsentCount() {
    this.absentCount = Math.max((Number(this.total) || 0) - (Number(this.present) || 0), 0);
    while (this.absentees.length < this.absentCount) {
      this.absentees.push({ name: '', status: 'Không phép' });
    }
    this.absentees = this.absentees.slice(0, this.absentCount);
    this.absentNames = this.absentees.map(a => a.name);
  }

  exportCsv() {
    const formattedDate = `${this.selectedDay()}/${this.selectedMonth()}/${this.selectedYear()}`;
    const sessionText = this.selectedSession() === 'morning' ? 'buổi sáng' : 'buổi chiều';
    const headerTitle = `Danh sách điểm danh học sinh THCS Phú Long – Ngày ${formattedDate} ${sessionText}`;

    // Tạo mảng dữ liệu với hàng đầu tiên là tiêu đề trống để chèn tiêu đề
    const rows = this.filteredTeachers().map(t => {
      // Tạo danh sách học sinh vắng có kèm trạng thái xuống dòng dễ nhìn
      const formattedAbsentees = t.status === 'Chưa điểm danh' 
        ? '' 
        : t.absentees.map(abs => `- ${abs.name} (${abs.status})`).join('\n');

      return {
        'Tên giáo viên': t.name,
        'Lớp': t.status === 'Chưa điểm danh' ? 'Chưa điểm danh' : t.className,
        'Tỉ số điểm danh': t.status === 'Chưa điểm danh' ? 'Chưa điểm danh' : `${t.present}/${t.total}`,
        'Số học sinh vắng': t.status === 'Chưa điểm danh' ? '' : t.absentNames.length,
        'Tên học sinh vắng': formattedAbsentees,
        'Số điện thoại': t.phone,
        'Trạng thái': t.status,
        'Thời gian': t.checkedAt || ''
      };
    });

    const workbook = XLSX.utils.book_new();
    
    // Tạo sheet từ dữ liệu
    const worksheet = XLSX.utils.json_to_sheet([]);
    
    // Ghi tiêu đề vào dòng đầu tiên (A1)
    XLSX.utils.sheet_add_aoa(worksheet, [[headerTitle]], { origin: 'A1' });
    
    // Ghi tiêu đề các cột ở dòng thứ 3 (chừa dòng 2 trống cho thoáng hoặc merge dòng 1-2)
    const headers = ['Tên giáo viên', 'Lớp', 'Tỉ số điểm danh', 'Số học sinh vắng', 'Tên học sinh vắng', 'Số điện thoại', 'Trạng thái', 'Thời gian'];
    XLSX.utils.sheet_add_aoa(worksheet, [headers], { origin: 'A3' });
    
    // Ghi dữ liệu từ dòng thứ 4
    XLSX.utils.sheet_add_json(worksheet, rows, { origin: 'A4', skipHeader: true });

    // Định dạng chiều rộng các cột và kích hoạt thuộc tính tự động xuống dòng (wrap text)
    worksheet['!cols'] = [
      { wch: 24 }, // Tên giáo viên
      { wch: 14 }, // Lớp
      { wch: 20 }, // Tỉ số điểm danh
      { wch: 18 }, // Số học sinh vắng
      { wch: 40 }, // Tên học sinh vắng (rộng hơn vì có kèm chi tiết trạng thái)
      { wch: 17 }, // Số điện thoại
      { wch: 18 }, // Trạng thái
      { wch: 14 }  // Thời gian
    ];

    // Duyệt qua tất cả các ô trong cột E (cột thứ 5 - Tên học sinh vắng) để thiết lập wrap text
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:H100');
    for (let R = range.s.r; R <= range.e.r; ++R) {
      const cell_ref = XLSX.utils.encode_cell({ c: 4, r: R }); // c=4 là cột E
      if (worksheet[cell_ref]) {
        if (!worksheet[cell_ref].s) worksheet[cell_ref].s = {};
        worksheet[cell_ref].s.alignment = { wrapText: true, vertical: 'top' };
      }
    }

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

import { Component, Input, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { NotificationService } from './notification.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getDatabase, ref, onValue, set, query, orderByChild, limitToLast } from 'firebase/database';
import { app } from '../firebase';
import { push } from 'firebase/database';

interface Profile { uid: string; name: string; role: 'admin' | 'teacher'; className?: string; viewOnlyUids?: string[] }
interface Schedule { enabled: boolean; content: string; repeat: string; date: string; start: string; end: string; updatedAt: number; updatedBy?: string }
@Component({ selector: 'app-teacher-notifications', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './teacher-notifications.html', styleUrl: './teacher-notifications.scss' })
export class TeacherNotifications implements OnInit, OnDestroy {
  protected readonly notifications = inject(NotificationService);
  notificationLogs = signal<{id: string; status: string; at: number; accepted?: number; failed?: number}[]>([]);
  @Input() profile!: Profile;
  @Input() demo = false;
  teachers = signal<Profile[]>([]);
  selected = signal('');
  status = signal('');
  notice = signal('');
  busy = signal(false);
  scheduleLoading = signal(false);
  scheduleLoadFailed = signal(false);
  savedSchedule = signal<Schedule | null>(null);
  schedule: Schedule = this.defaults();
  private stops: (() => void)[] = [];
  private selectionStops: (() => void)[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private demoSchedules: Record<string, Schedule> = {};
  private demoDelivered: Record<string, string> = {};
  get admin() { return this.profile.role === 'admin'; }
  get teacherName() { return this.teachers().find(t => t.uid === this.selected())?.name || this.profile.name; }
  private defaults(): Schedule { return { enabled: true, content: 'Nhắc thầy cô hoàn tất điểm danh hôm nay.', repeat: 'daily', date: '', start: '07:00', end: '07:30', updatedAt: 0 }; }
  ngOnInit() {
    if (this.demo) {
      this.profile = { uid: 'demo-admin', name: 'Quản trị viên', role: 'admin' };
      this.teachers.set([{ uid: 'demo-lan', name: 'Nguyễn Thị Lan', role: 'teacher', className: '6A1' }, { uid: 'demo-mai', name: 'Trần Thị Mai', role: 'teacher', className: '7A2' }, { uid: 'demo-minh', name: 'Lê Văn Minh', role: 'teacher', className: '8A1' }]);
      try { const saved = JSON.parse(localStorage.getItem('phulong-notifications-demo') || '{}'); this.demoSchedules = saved.schedules || {}; } catch { /* start with empty demo */ }
      this.choose('demo-lan');
      this.timer = setInterval(() => this.checkDemoSchedule(), 1000);
    } else if (this.admin) {
      this.stops.push(onValue(ref(getDatabase(app), 'users'), snap => {
        this.teachers.set(Object.entries(snap.val() || {}).map(([uid, value]) => ({ ...(value as Profile), uid })).filter(t => t.role === 'teacher' && (!this.profile.viewOnlyUids?.length || this.profile.viewOnlyUids.includes(t.uid))));
        if (!this.selected() && this.teachers().length) { const requested = new URLSearchParams(location.search).get('teacher'); this.choose(this.teachers().find(t => t.uid === requested)?.uid || this.teachers()[0].uid); }
      }, () => this.status.set('Không thể tải danh sách giáo viên.')));
    } else { this.teachers.set([this.profile]); this.choose(this.profile.uid); }
  }
  choose(uid: string) {
    if (this.busy()) return;
    this.selectionStops.forEach(stop => stop()); this.selectionStops = [];
    this.selected.set(uid); this.notificationLogs.set([]); this.status.set(''); this.schedule = this.defaults();
    this.savedSchedule.set(null); this.scheduleLoadFailed.set(false);
    this.scheduleLoading.set(!this.demo);
    if (this.demo) { this.savedSchedule.set(this.demoSchedules[uid] || null); this.schedule = { ...(this.demoSchedules[uid] || this.defaults()) }; return; }
    const db = getDatabase(app);
    if (!this.demo) this.selectionStops.push(onValue(query(ref(db, `notificationLogs/${this.admin ? uid : this.profile.uid}`), orderByChild('at'), limitToLast(20)), snap => this.notificationLogs.set(Object.entries(snap.val() || {}).map(([id,value]) => ({...(value as any),id})).sort((a,b) => b.at-a.at)), () => this.notificationLogs.set([])));
    this.selectionStops.push(onValue(ref(db, `teacherSchedules/${uid}`), snap => {
      if (this.selected() !== uid) return;
      const saved = snap.val() as Schedule | null;
      this.savedSchedule.set(saved);
      if (this.scheduleLoading()) this.schedule = { ...(saved || this.defaults()) };
      this.scheduleLoading.set(false);
    }, () => {
      if (this.selected() !== uid) return;
      this.scheduleLoading.set(false); this.scheduleLoadFailed.set(true);
      this.status.set('Không thể tải lịch thông báo. Chọn lại giáo viên để thử lại.');
    }));
  }
  private pendingSend?: { uid: string; content: string; requestId: string };
  async sendNow() {
    if (this.busy()) return;
    const uid = this.selected();
    const teacher = this.teachers().find(t => t.uid === uid);
    if (!this.admin || !teacher) { this.status.set('Vui lòng chọn giáo viên để gửi thông báo.'); return; }
    const content = this.schedule.content.trim();
    if (!content || content.length > 500) { this.status.set('Nội dung thông báo phải có từ 1 đến 500 ký tự.'); return; }
    this.busy.set(true); this.status.set('Đang gửi thông báo…');
    try {
      if (this.demo) {
        this.notice.set('Thông báo đến ' + teacher.name + ': ' + content);
        this.status.set('Đã mô phỏng gửi thông báo cho ' + teacher.name + '.');
        return;
      }
      if (!this.pendingSend || this.pendingSend.uid !== uid || this.pendingSend.content !== content) {
        this.pendingSend = { uid, content, requestId: push(ref(getDatabase(app), 'notificationRequests')).key! };
      }
      const request = push(ref(getDatabase(app), 'notificationRequests'));
      await set(request, { actorUid: this.profile.uid, teacherUid: uid, content, requestId: this.pendingSend.requestId, status: 'pending', createdAt: Date.now() });
      const result = await new Promise<{ data: { status: string; accepted: number; codes?: string[] } }>((resolve, reject) => {
        let stop: (() => void) | undefined;
        const timer = setTimeout(() => { stop?.(); reject({ code: 'worker-timeout' }); }, 45000);
        stop = onValue(request, snapshot => {
          const value = snapshot.val();
          if (value?.status === 'done' || value?.status === 'error') {
            clearTimeout(timer); stop?.();
            if (value.status === 'error') reject({ code: value.code });
            else resolve({ data: value.result });
          }
        }, error => { clearTimeout(timer); stop?.(); reject(error); });
      });
      const outcome = result.data.status;
      if (result.data.codes?.includes('messaging/mismatched-credential')) {
        this.status.set('Đã lưu thông báo, nhưng thiết bị đang dùng token của dự án Firebase cũ. Cần cập nhật cấu hình Firebase của ứng dụng và đăng ký lại thông báo trên thiết bị.');
        return;
      }
      this.status.set(outcome === 'accepted' ? 'Đã gửi thông báo cho ' + teacher.name + '.' : outcome === 'no-token' ? 'Đã lưu thông báo cho ' + teacher.name + '. Thiết bị chưa đăng ký nhận push.' : outcome === 'sending' ? 'Thông báo đang được xử lý.' : 'Đã lưu trong ứng dụng nhưng gửi push thất bại. Nhấn gửi để thử lại.');
      if (outcome === 'accepted' || outcome === 'no-token') this.pendingSend = undefined;
    } catch (error) {
      const code = (error as { code?: string }).code || '';
      this.status.set(code.includes('permission-denied') ? 'Không có quyền gửi thông báo cho giáo viên này.' : code.includes('worker-timeout') ? 'Yêu cầu đã lưu nhưng máy chủ gửi chưa phản hồi. Cần bật dịch vụ gửi thông báo trên máy quản trị.' : code.includes('unauthenticated') ? 'Vui lòng đăng nhập lại để gửi thông báo.' : 'Gửi chưa thành công. Kiểm tra kết nối hoặc dịch vụ gửi thông báo rồi thử lại.');
    } finally { this.busy.set(false); }
  }
  async save() {
    if (this.busy() || this.scheduleLoading() || this.scheduleLoadFailed()) return;
    const uid = this.selected();
    const teacher = this.teachers().find(t => t.uid === uid);
    if (!this.admin || !teacher || (this.profile.viewOnlyUids?.length && !this.profile.viewOnlyUids.includes(uid))) {
      this.status.set('Vui lòng chọn giáo viên thuộc phạm vi quản lý để lưu lịch.'); return;
    }
    const s = { ...this.schedule, content: this.schedule.content.trim() };
    if (!s.content || s.content.length > 500) { this.status.set('Nội dung thông báo phải có từ 1 đến 500 ký tự.'); return; }
    if (!['daily', 'weekdays', 'once'].includes(s.repeat)) { this.status.set('Vui lòng chọn kiểu lặp lại hợp lệ.'); return; }
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(s.start) || !timePattern.test(s.end) || s.end <= s.start) { this.status.set('Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.'); return; }
    if (s.repeat === 'once') {
      const end = new Date(`${s.date}T${s.end}:00+07:00`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !Number.isFinite(end.getTime()) || new Date(`${s.date}T00:00:00Z`).toISOString().slice(0, 10) !== s.date) { this.status.set('Vui lòng chọn ngày gửi hợp lệ.'); return; }
      if (s.enabled && end.getTime() <= Date.now()) { this.status.set('Vui lòng chọn khung giờ trong tương lai.'); return; }
    }
    this.busy.set(true); this.status.set('Đang lưu lịch…');
    try {
      const value: Schedule = { enabled: s.enabled, content: s.content, repeat: s.repeat, date: s.repeat === 'once' ? s.date : '', start: s.start, end: s.end, updatedAt: Date.now(), updatedBy: this.profile.uid };
      if (this.demo) {
        const schedules = { ...this.demoSchedules, [uid]: value };
        localStorage.setItem('phulong-notifications-demo', JSON.stringify({ schedules }));
        this.demoSchedules = schedules;
      } else await set(ref(getDatabase(app), `teacherSchedules/${uid}`), value);
      this.schedule = { ...value }; this.savedSchedule.set(value);
      this.status.set(`Đã ${value.enabled ? 'lưu' : 'tắt'} lịch cho ${teacher.name}${this.demo ? ' (demo)' : ''}.`);
    } catch (error) {
      const code = (error as { code?: string }).code || '';
      this.status.set(code.toLowerCase().includes('permission') ? 'Không có quyền lưu lịch. Vui lòng đăng nhập bằng tài khoản quản trị viên.' : 'Lưu lịch thất bại. Kiểm tra kết nối rồi thử lại.');
    } finally { this.busy.set(false); }
  }
  switchRole(role: 'admin' | 'teacher') { if (!this.demo) return; this.profile = role === 'admin' ? { uid: 'demo-admin', name: 'Quản trị viên', role } : { ...this.teachers().find(t => t.uid === this.selected())! }; this.choose(this.selected()); }
  demoNotify() { if (this.demo) this.notice.set('Thông báo đến ' + this.teacherName + ': ' + this.schedule.content); }
  logLabel(status: string) { return ({ accepted: 'FCM đã tiếp nhận', failed: 'Gửi push thất bại', 'no-token': 'Đã lưu thông báo, chưa có token push', sending: 'Đang gửi push' } as Record<string,string>)[status] || status; }
  private checkDemoSchedule() {
    const now = new Date(); const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(now).split(' ');
    for (const [uid,s] of Object.entries(this.demoSchedules)) { const day = new Date(parts[0] + 'T12:00:00+07:00').getUTCDay(); const key = parts[0] + ':' + s.updatedAt; if (s.enabled && parts[1] >= s.start && parts[1] < s.end && (s.repeat !== 'once' || s.date === parts[0]) && (s.repeat !== 'weekdays' || (day >= 1 && day <= 5)) && this.demoDelivered[uid] !== key) { this.demoDelivered[uid] = key; this.notice.set('Thông báo đến ' + this.teachers().find(t=>t.uid===uid)?.name + ': ' + s.content); } }
  }
  ngOnDestroy() { [...this.stops, ...this.selectionStops].forEach(stop => stop()); if (this.timer) clearInterval(this.timer); }
}

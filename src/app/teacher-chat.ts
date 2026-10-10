import { Component, Input, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { NotificationService } from './notification.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getDatabase, ref, onValue, push, set, query, orderByChild, limitToLast, serverTimestamp } from 'firebase/database';
import { app } from '../firebase';

interface Profile { uid: string; name: string; role: 'admin' | 'teacher'; className?: string; viewOnlyUids?: string[] }
interface Message { id: string; senderUid: string; senderName: string; text: string; createdAt: number }
interface Schedule { enabled: boolean; content: string; repeat: string; date: string; start: string; end: string; updatedAt: number; updatedBy?: string }
@Component({ selector: 'app-teacher-chat', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './teacher-chat.html', styleUrl: './teacher-chat.scss' })
export class TeacherChat implements OnInit, OnDestroy {
  protected readonly notifications = inject(NotificationService);
  notificationLogs = signal<{id: string; status: string; at: number; accepted?: number; failed?: number}[]>([]);
  @Input() profile!: Profile;
  @Input() demo = false;
  teachers = signal<Profile[]>([]);
  messages = signal<Message[]>([]);
  selected = signal('');
  status = signal('');
  notice = signal('');
  busy = signal(false);
  text = '';
  schedule: Schedule = this.defaults();
  private stops: (() => void)[] = [];
  private conversationStops: (() => void)[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private demoMessages: Record<string, Message[]> = {};
  private demoSchedules: Record<string, Schedule> = {};
  private demoDelivered: Record<string, string> = {};
  get admin() { return this.profile.role === 'admin'; }
  get teacherName() { return this.teachers().find(t => t.uid === this.selected())?.name || this.profile.name; }
  private defaults(): Schedule { return { enabled: true, content: 'Nhắc thầy cô hoàn tất điểm danh hôm nay.', repeat: 'daily', date: '', start: '07:00', end: '07:30', updatedAt: 0 }; }
  ngOnInit() {
    if (this.demo) {
      this.profile = { uid: 'demo-admin', name: 'Quản trị viên', role: 'admin' };
      this.teachers.set([{ uid: 'demo-lan', name: 'Nguyễn Thị Lan', role: 'teacher', className: '6A1' }, { uid: 'demo-mai', name: 'Trần Thị Mai', role: 'teacher', className: '7A2' }, { uid: 'demo-minh', name: 'Lê Văn Minh', role: 'teacher', className: '8A1' }]);
      try { const saved = JSON.parse(localStorage.getItem('phulong-chat-demo') || '{}'); this.demoMessages = saved.messages || {}; this.demoSchedules = saved.schedules || {}; } catch { /* start with empty demo */ }
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
    this.conversationStops.forEach(stop => stop()); this.conversationStops = [];
    this.selected.set(uid); this.messages.set([]); this.notificationLogs.set([]); this.text = ''; this.status.set(''); this.schedule = this.defaults();
    if (this.demo) { this.messages.set(this.demoMessages[uid] || []); this.schedule = { ...(this.demoSchedules[uid] || this.defaults()) }; return; }
    const db = getDatabase(app);
    if (!this.demo) this.conversationStops.push(onValue(query(ref(db, `notificationLogs/${this.admin ? uid : this.profile.uid}`), orderByChild('at'), limitToLast(20)), snap => this.notificationLogs.set(Object.entries(snap.val() || {}).map(([id,value]) => ({...(value as any),id})).sort((a,b) => b.at-a.at)), () => this.notificationLogs.set([])));
    this.conversationStops.push(onValue(query(ref(db, `teacherChats/${uid}/messages`), orderByChild('createdAt'), limitToLast(100)), snap => {
      this.messages.set(Object.entries(snap.val() || {}).map(([id, value]) => ({ ...(value as Message), id })).sort((a,b) => a.createdAt - b.createdAt));
    }, () => this.status.set('Không thể tải cuộc trò chuyện.')));
    this.conversationStops.push(onValue(ref(db, `teacherSchedules/${uid}`), snap => this.schedule = { ...(snap.val() || this.defaults()) }, () => this.status.set('Không thể tải lịch thông báo.')));
  }
  async send() {
    const text = this.text.trim(); if (!text || text.length > 2000 || !this.selected() || this.busy()) return;
    this.busy.set(true); this.status.set('');
    try {
      const message = { senderUid: this.profile.uid, senderName: this.profile.name, text, createdAt: Date.now() };
      if (this.demo) { this.demoMessages[this.selected()] = [...this.messages(), { ...message, id: crypto.randomUUID() }]; this.messages.set(this.demoMessages[this.selected()]); this.persist(); }
      else await set(push(ref(getDatabase(app), `teacherChats/${this.selected()}/messages`)), { ...message, createdAt: serverTimestamp() });
      this.text = '';
    } catch { this.status.set('Gửi tin thất bại. Vui lòng thử lại.'); } finally { this.busy.set(false); }
  }
  async save() {
    if (!this.admin || !this.selected() || this.busy()) return;
    const s = this.schedule;
    if (!s.content.trim() || s.content.length > 500 || !s.start || !s.end || s.end <= s.start || (s.repeat === 'once' && !s.date)) { this.status.set('Nhập nội dung, ngày (nếu gửi một lần) và giờ kết thúc sau giờ bắt đầu.'); return; }
    if (s.repeat === 'once' && new Date(`${s.date}T${s.end}:00+07:00`).getTime() <= Date.now()) { this.status.set('Vui lòng chọn khung giờ trong tương lai.'); return; }
    this.busy.set(true);
    try { const value = { ...s, content: s.content.trim(), updatedAt: Date.now(), updatedBy: this.profile.uid }; if (this.demo) { this.demoSchedules[this.selected()] = value; this.persist(); } else await set(ref(getDatabase(app), `teacherSchedules/${this.selected()}`), value); this.schedule = value; this.status.set('Đã lưu lịch cho ' + this.teacherName + '.'); }
    catch { this.status.set('Lưu lịch thất bại. Vui lòng thử lại.'); } finally { this.busy.set(false); }
  }
  switchRole(role: 'admin' | 'teacher') { if (!this.demo) return; this.profile = role === 'admin' ? { uid: 'demo-admin', name: 'Quản trị viên', role } : { ...this.teachers().find(t => t.uid === this.selected())! }; this.choose(this.selected()); }
  demoNotify() { if (this.demo) this.notice.set('Thông báo đến ' + this.teacherName + ': ' + this.schedule.content); }
  logLabel(status: string) { return ({ accepted: 'FCM đã tiếp nhận', failed: 'Gửi push thất bại', 'no-token': 'Đã lưu thông báo, chưa có token push', sending: 'Đang gửi push' } as Record<string,string>)[status] || status; }
  private checkDemoSchedule() {
    const now = new Date(); const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(now).split(' ');
    for (const [uid,s] of Object.entries(this.demoSchedules)) { const day = new Date(parts[0] + 'T12:00:00+07:00').getUTCDay(); const key = parts[0] + ':' + s.updatedAt; if (s.enabled && parts[1] >= s.start && parts[1] < s.end && (s.repeat !== 'once' || s.date === parts[0]) && (s.repeat !== 'weekdays' || (day >= 1 && day <= 5)) && this.demoDelivered[uid] !== key) { this.demoDelivered[uid] = key; this.notice.set('Thông báo đến ' + this.teachers().find(t=>t.uid===uid)?.name + ': ' + s.content); } }
  }
  private persist() { localStorage.setItem('phulong-chat-demo', JSON.stringify({ messages: this.demoMessages, schedules: this.demoSchedules })); }
  ngOnDestroy() { [...this.stops, ...this.conversationStops].forEach(stop => stop()); if (this.timer) clearInterval(this.timer); }
}

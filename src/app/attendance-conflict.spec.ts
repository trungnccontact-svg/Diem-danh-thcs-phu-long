import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { NotificationService } from './notification.service';
import { AttendanceRecord, attendanceClassKey, attendanceVersion, canSaveAttendance, findClassRecord, mergeAttendanceRecords } from './attendance-record';

const saved: AttendanceRecord = {
  teacherUid: 'teacher-a', teacherName: 'Giáo viên A', className: '6A1',
  present: 33, total: 35, absentNames: ['Học sinh 1', 'Học sinh 2'],
  absentees: [{ name: 'Học sinh 1', status: 'Có phép' }, { name: 'Học sinh 2', status: 'Đi trễ' }],
  checkedAt: '07:15', updatedAt: 1000, revision: 'first'
};

describe('Điểm danh trùng lớp', () => {
  it('normalizes class names and finds a legacy record', () => {
    expect(attendanceClassKey(' 6a 1 ')).toBe('6A1');
    expect(findClassRecord({ a: saved }, '6a1')).toBe(saved);
    expect(findClassRecord({ a: saved }, '7A1')).toBeNull();
  });

  it('requires another teacher to review before overwriting', () => {
    expect(canSaveAttendance(null, 'teacher-b', null)).toBeTrue();
    expect(canSaveAttendance(saved, 'teacher-b', null)).toBeFalse();
    expect(canSaveAttendance(saved, 'teacher-b', attendanceVersion(saved))).toBeTrue();
    expect(canSaveAttendance(saved, 'teacher-a', null)).toBeTrue();
  });

  it('rejects a stale review if another teacher wins the save race', () => {
    const version = attendanceVersion(saved);
    const changed = { ...saved, teacherUid: 'teacher-c', present: 34, revision: 'second' };
    expect(canSaveAttendance(changed, 'teacher-b', version)).toBeFalse();
    expect(canSaveAttendance(changed, 'teacher-b', null)).toBeFalse();
  });

  it('does not depend on Firebase object property order or omitted empty arrays', () => {
    const reordered = Object.fromEntries(Object.entries(saved).reverse()) as unknown as AttendanceRecord;
    expect(attendanceVersion(reordered)).toBe(attendanceVersion(saved));
    const empty = { ...saved, absentNames: [], absentees: [] };
    const fromFirebase = { ...empty, absentNames: undefined, absentees: undefined } as unknown as AttendanceRecord;
    expect(attendanceVersion(empty)).toBe(attendanceVersion(fromFirebase));
  });

  it('replaces old same-class records in reports without removing other classes', () => {
    const other = { ...saved, className: '7A1', teacherUid: 'teacher-c' };
    const edited = { ...saved, teacherUid: 'teacher-b', teacherName: 'Giáo viên B', present: 34 };
    const merged = mergeAttendanceRecords({ 'teacher-a': saved, 'teacher-c': other }, { '6A1': edited });
    expect(Object.keys(merged).sort()).toEqual(['teacher-b', 'teacher-c']);
    expect(merged['teacher-b'].present).toBe(34);
    expect(merged['teacher-c']).toBe(other);
  });
});

describe('Biểu mẫu chỉnh sửa lớp của giáo viên khác', () => {
  beforeEach(async () => {
    spyOn(App.prototype, 'ngOnInit').and.stub();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: NotificationService, useValue: { latest: () => null } }]
    }).compileComponents();
  });

  function createForm() {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    app.loading.set(false);
    app.loggedIn.set(true);
    app.showLogin.set(false);
    app.currentUserProfile.set({ uid: 'teacher-b', name: 'Giáo viên B', role: 'teacher', isTestAccount: true });
    app.className = '6A1';
    app.legacyAttendance = { 'teacher-a': saved };
    fixture.detectChanges();
    return { fixture, app, element: fixture.nativeElement as HTMLElement };
  }

  it('shows the warning and edit button, and blocks direct duplicate submission', () => {
    const { element } = createForm();
    expect(element.querySelector('.duplicate-attendance')?.textContent).toContain('Lớp này đã được giáo viên khác điểm danh');
    expect(element.querySelector('.duplicate-attendance button')?.textContent).toContain('Chỉnh sửa');
    expect((element.querySelector('.card-actions button') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('loads saved absences into an editable copy and enables saving', () => {
    const { fixture, app, element } = createForm();
    (element.querySelector('.duplicate-attendance button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(app.present).toBe(33);
    expect(app.total).toBe(35);
    expect(app.absentees).toEqual(saved.absentees);
    expect(app.hasReviewedDuplicate).toBeTrue();
    expect((element.querySelector('.card-actions button') as HTMLButtonElement).disabled).toBeFalse();
    app.absentees[0].name = 'Tên đã sửa';
    expect(saved.absentees![0].name).toBe('Học sinh 1');
  });

  it('requires review again when the stored record changes during editing', () => {
    const { fixture, app, element } = createForm();
    app.editClassAttendance();
    app.classAttendance = { '6A1': { ...saved, revision: 'new-version', present: 34 } };
    fixture.detectChanges();
    expect(app.hasReviewedDuplicate).toBeFalse();
    expect((element.querySelector('.card-actions button') as HTMLButtonElement).disabled).toBeTrue();
    app.onAttendanceClassChange();
    expect(app.reviewedAttendance).toBeNull();
  });
});

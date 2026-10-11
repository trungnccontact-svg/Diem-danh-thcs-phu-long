import { TestBed } from '@angular/core/testing';
import { AttendancePhoto } from './attendance-photo';
import { AttendancePhotoService, boardAttendanceFromDatabase } from './attendance-photo.service';
import { NotificationService } from './notification.service';
import { App } from './app';

describe('Đọc ảnh bảng điểm danh', () => {
  it('restores omitted null fields and empty arrays from Firebase', () => {
    expect(boardAttendanceFromDatabase({ className: '6A1' })).toEqual({ className: '6A1', total: null, present: null, absentCount: null, absentees: [], warnings: [] });
  });

  it('requires an explicit read click before uploading an image', async () => {
    const service = { prepare: jasmine.createSpy().and.resolveTo({ image: 'test', mimeType: 'image/jpeg', preview: 'data:image/jpeg;base64,test' }), recognize: jasmine.createSpy() };
    await TestBed.configureTestingModule({ imports: [AttendancePhoto], providers: [{ provide: AttendancePhotoService, useValue: service }] }).compileComponents();
    const fixture = TestBed.createComponent(AttendancePhoto);
    const input = { files: [new File(['test'], 'board.jpg', { type: 'image/jpeg' })], value: 'board.jpg' };
    await fixture.componentInstance.choosePhoto({ target: input } as unknown as Event);
    fixture.detectChanges();
    expect(service.recognize).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Đọc ảnh và điền thông tin');
    expect(input.value).toBe('');
  });

  it('uses sample results in demo mode without uploading to Gemini or Firebase', async () => {
    const service = { recognize: jasmine.createSpy() };
    await TestBed.configureTestingModule({ imports: [AttendancePhoto], providers: [{ provide: AttendancePhotoService, useValue: service }] }).compileComponents();
    const component = TestBed.createComponent(AttendancePhoto).componentInstance as any;
    component.demo = true;
    component.photo.set({ image: 'sample', mimeType: 'image/jpeg', preview: 'sample' });
    const result = jasmine.createSpy('result'); component.recognized.subscribe(result);
    await component.readPhoto();
    expect(service.recognize).not.toHaveBeenCalled();
    expect(result).toHaveBeenCalledWith(jasmine.objectContaining({ className: '6A1', present: 33, total: 35, absentCount: 2 }));
  });
});

describe('Điền biểu mẫu từ kết quả Gemini', () => {
  beforeEach(async () => {
    spyOn(App.prototype, 'ngOnInit').and.stub();
    await TestBed.configureTestingModule({ imports: [App], providers: [{ provide: NotificationService, useValue: { latest: () => null } }] }).compileComponents();
  });

  it('clears unknown counts and leaves unknown absence status for teacher correction', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.currentUserProfile.set({ uid: 'teacher', role: 'teacher', isTestAccount: true });
    app.applyAttendancePhoto({ className: '6A1', total: null, present: null, absentCount: 1, absentees: [{ name: 'Học sinh A', status: '' }], warnings: ['Chưa rõ trạng thái'] });
    expect(app.total).toBeNull(); expect(app.present).toBeNull();
    expect(app.absentees[0].status).toBe('');
    expect(app.validateForm()).toBeFalse();
    expect(app.submitted()).toBeFalse();
  });

  it('does not truncate read names when board counts disagree', () => {
    const app = TestBed.createComponent(App).componentInstance as any;
    app.currentUserProfile.set({ uid: 'teacher', role: 'teacher', isTestAccount: true });
    app.applyAttendancePhoto({ className: '6A1', total: 35, present: 35, absentCount: 0, absentees: [{ name: 'Học sinh A', status: 'Có phép' }], warnings: [] });
    expect(app.absentees.length).toBe(1); expect(app.validateForm()).toBeFalse();
  });
});

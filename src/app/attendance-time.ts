export type AttendanceSession = 'morning' | 'afternoon';

export const ATTENDANCE_WINDOWS = {
  morning: { start: 7 * 60, end: 10 * 60 + 40, startLabel: '07:00', endLabel: '10:40', label: '07:00 – 10:40', name: 'buổi sáng' },
  afternoon: { start: 13 * 60 + 10, end: 17 * 60, startLabel: '13:10', endLabel: '17:00', label: '13:10 – 17:00', name: 'buổi chiều' }
} as const;

export function attendanceTimeStatus(session: AttendanceSession, now = new Date(), isTestAccount = false): { allowed: boolean; message: string } {
  if (isTestAccount) return { allowed: true, message: 'Tài khoản test: không giới hạn thời gian điểm danh.' };
  const window = ATTENDANCE_WINDOWS[session];
  const minutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 7 * 60) % (24 * 60);
  if (minutes < window.start) {
    return { allowed: false, message: `Chưa đến giờ điểm danh ${window.name} (chỉ mở từ ${window.startLabel} đến ${window.endLabel}).` };
  }
  if (minutes >= window.end) {
    return { allowed: false, message: `Đã khóa hệ thống điểm danh ${window.name} từ ${window.endLabel}.` };
  }
  return { allowed: true, message: `Trong khung giờ điểm danh ${window.name} (${window.label}).` };
}

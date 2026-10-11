export interface AbsenteeDetail {
  name: string;
  status: 'Có phép' | 'Không phép' | 'Đi trễ';
}

export interface AttendanceRecord {
  teacherUid: string;
  teacherName: string;
  className: string;
  present: number;
  total: number;
  absentNames: string[];
  absentees?: AbsenteeDetail[];
  checkedAt: string;
  revision?: string;
  updatedAt?: number;
}

export function attendanceClassKey(className: string): string {
  return className.trim().replace(/\s+/g, '').toUpperCase();
}

export function attendanceVersion(record: AttendanceRecord): string {
  // Include the data too, so changes to a legacy record invalidate an earlier review.
  return JSON.stringify([record.revision || null, record.updatedAt || null,
    record.teacherUid, record.teacherName, attendanceClassKey(record.className),
    record.present, record.total, record.absentNames || [],
    (record.absentees || []).map(abs => [abs.name, abs.status]), record.checkedAt]);
}

export function findClassRecord(records: Record<string, AttendanceRecord>, className: string): AttendanceRecord | null {
  const key = attendanceClassKey(className);
  return Object.values(records)
    .filter(record => attendanceClassKey(record.className) === key)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || b.checkedAt.localeCompare(a.checkedAt))[0] || null;
}

export function mergeAttendanceRecords(legacy: Record<string, AttendanceRecord>, classes: Record<string, AttendanceRecord>): Record<string, AttendanceRecord> {
  const result = { ...legacy };
  const replacedClasses = new Set(Object.keys(classes));
  for (const [uid, record] of Object.entries(result)) {
    if (replacedClasses.has(attendanceClassKey(record.className))) delete result[uid];
  }
  for (const record of Object.values(classes).sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))) {
    result[record.teacherUid] = record;
  }
  return result;
}

export function canSaveAttendance(existing: AttendanceRecord | null, teacherUid: string, reviewedVersion: string | null): boolean {
  if (reviewedVersion !== null) return existing !== null && attendanceVersion(existing) === reviewedVersion;
  return !existing || existing.teacherUid === teacherUid;
}

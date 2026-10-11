import { Injectable } from '@angular/core';
import { getAuth } from 'firebase/auth';
import { getDatabase, onValue, push, ref, set } from 'firebase/database';
import { app } from '../firebase';

export interface BoardAttendance {
  className: string | null;
  present: number | null;
  total: number | null;
  absentCount: number | null;
  absentees: { name: string; status: 'Có phép' | 'Không phép' | 'Đi trễ' | '' }[];
  warnings: string[];
}
export interface AttendancePhotoData { image: string; mimeType: 'image/jpeg'; preview: string }

export function boardAttendanceFromDatabase(value: Partial<BoardAttendance>): BoardAttendance {
  // Realtime Database omits null properties and empty arrays.
  return { className: value.className ?? null, present: value.present ?? null, total: value.total ?? null,
    absentCount: value.absentCount ?? null, absentees: value.absentees || [], warnings: value.warnings || [] };
}

@Injectable({ providedIn: 'root' })
export class AttendancePhotoService {
  async prepare(file: File): Promise<AttendancePhotoData> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw { code: 'unsupported-image' };
    if (file.size > 12 * 1024 * 1024) throw { code: 'large-image' };
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject({ code: 'invalid-image' }); element.src = url;
      });
      const ratio = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw { code: 'invalid-image' };
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.5, 0.35]) {
        const preview = canvas.toDataURL('image/jpeg', quality);
        const base64 = preview.split(',')[1];
        if (base64 && base64.length <= 1228800) return { image: base64, mimeType: 'image/jpeg', preview };
      }
      throw { code: 'large-image' };
    } finally { URL.revokeObjectURL(url); }
  }

  async recognize(photo: AttendancePhotoData): Promise<BoardAttendance> {
    const uid = getAuth(app).currentUser?.uid;
    if (!uid) throw { code: 'unauthenticated' };
    const request = push(ref(getDatabase(app), `attendanceImageRequests/${uid}`));
    await set(request, { actorUid: uid, image: photo.image, mimeType: photo.mimeType, status: 'pending', createdAt: Date.now() });
    return new Promise<BoardAttendance>((resolve, reject) => {
      let stop: (() => void) | undefined;
      const timer = setTimeout(() => { stop?.(); reject({ code: 'worker-timeout' }); }, 90000);
      stop = onValue(request, snapshot => {
        const value = snapshot.val();
        if (value?.status === 'done' && value.result) { clearTimeout(timer); stop?.(); resolve(boardAttendanceFromDatabase(value.result)); }
        else if (value?.status === 'error') { clearTimeout(timer); stop?.(); reject({ code: value.code }); }
      }, error => { clearTimeout(timer); stop?.(); reject(error); });
    });
  }
}

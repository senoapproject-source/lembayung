import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database';
import { addAuditLog, enqueueSync } from '../db/actions';
import { sendDeviceNotification } from './notificationService';
import type {
  AppSettings,
  AttendanceRecord,
  User,
  WorkShiftSchedule,
} from '../types/models';

export const MAX_OPEN_ATTENDANCE_HOURS = 15;

export const DEFAULT_WORK_SHIFTS: WorkShiftSchedule[] = [
  {
    id: 'shift-pagi',
    nama: 'Shift 1 Pagi',
    jamMasuk: '08:00',
    jamPulang: '17:00',
    durasiJam: 9,
    toleransiTelatMenit: 10,
  },
  {
    id: 'shift-middle',
    nama: 'Middle',
    jamMasuk: '11:00',
    jamPulang: '20:00',
    durasiJam: 9,
    toleransiTelatMenit: 10,
  },
  {
    id: 'shift-sore',
    nama: 'Shift 2 Sore',
    jamMasuk: '14:00',
    jamPulang: '23:00',
    durasiJam: 9,
    toleransiTelatMenit: 10,
  },
  {
    id: 'shift-malam',
    nama: 'Shift 3 Malam',
    jamMasuk: '22:00',
    jamPulang: '07:00',
    durasiJam: 9,
    toleransiTelatMenit: 10,
  },
];

export function getWorkShifts(settings?: AppSettings): WorkShiftSchedule[] {
  if (settings?.workShifts && settings.workShifts.length > 0) {
    return settings.workShifts;
  }
  return DEFAULT_WORK_SHIFTS;
}

export function formatLocalDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatClockHm(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDurationMinutes(minutes?: number): string {
  if (minutes === undefined || minutes === null || minutes < 0) return '-';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h <= 0) return `${m} menit`;
  if (m === 0) return `${h} jam`;
  return `${h} jam ${m} mnt`;
}

/**
 * Generate 6-digit PIN acak yang dijamin unik di antara seluruh akun pada outlet ini.
 */
export function generateUniqueSixDigitPin(existingUsers: User[]): string {
  const used = new Set(
    existingUsers
      .map((u) => String(u.pin || '').trim())
      .filter((p) => /^\d{6}$/.test(p))
  );
  for (let attempt = 0; attempt < 200; attempt++) {
    const num = Math.floor(100000 + Math.random() * 900000);
    const candidate = String(num);
    if (!used.has(candidate)) return candidate;
  }
  // Fallback deterministik
  for (let n = 100001; n <= 999999; n++) {
    const candidate = String(n);
    if (!used.has(candidate)) return candidate;
  }
  return '100001';
}

/**
 * Cek apakah PIN sudah dipakai oleh akun lain pada outlet yang sama.
 */
export function findDuplicatePinOwner(
  pin: string,
  existingUsers: User[],
  excludeUserId?: string
): User | undefined {
  const clean = pin.trim();
  if (!clean) return undefined;
  return existingUsers.find(
    (u) => u.id !== excludeUserId && String(u.pin || '').trim() === clean
  );
}

function parseHmToMinutes(hm: string): number {
  const [hStr, mStr] = hm.split(':');
  const h = parseInt(hStr || '0', 10) || 0;
  const m = parseInt(mStr || '0', 10) || 0;
  return h * 60 + m;
}

/**
 * Pilih otomatis jadwal shift yang jam masuknya paling dekat dengan jam perangkat saat ini.
 */
export function detectClosestWorkShift(
  now: Date,
  shifts: WorkShiftSchedule[] = DEFAULT_WORK_SHIFTS
): WorkShiftSchedule {
  const list = shifts.length > 0 ? shifts : DEFAULT_WORK_SHIFTS;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  let best = list[0];
  let bestDiff = Infinity;

  for (const s of list) {
    const startMin = parseHmToMinutes(s.jamMasuk);
    let diff = Math.abs(nowMinutes - startMin);
    if (diff > 720) diff = 1440 - diff; // wrap tengah malam
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}

/**
 * Hitung keterlambatan (menit) setelah dikurangi toleransi shift.
 */
export function computeLateMinutes(clockIn: Date, shift: WorkShiftSchedule): number {
  const nowMin = clockIn.getHours() * 60 + clockIn.getMinutes();
  const startMin = parseHmToMinutes(shift.jamMasuk);
  let delta = nowMin - startMin;
  // Tangani shift malam (mis. jadwal 22:00, datang 00:05)
  if (delta < -720) delta += 1440;
  if (delta > 720) delta -= 1440;
  const tol = shift.toleransiTelatMenit ?? 10;
  if (delta <= tol) return 0;
  return delta;
}

/**
 * Cari absen masuk aktif (belum clockOut) untuk karyawan tertentu.
 * Jika absen terbuka sudah melewati MAX_OPEN_ATTENDANCE_HOURS (15 jam),
 * otomatis ditutup sebagai `lupa_pulang` agar besoknya bisa Absen Masuk baru dengan mulus.
 */
export async function findActiveAttendanceForUser(
  userId: string,
  now: Date = new Date()
): Promise<{
  activeAttendance: AttendanceRecord | null;
  autoClosedForgotRecord: AttendanceRecord | null;
}> {
  const openRecords = await db.attendances
    .where('userId')
    .equals(userId)
    .filter((a) => !a.clockOutAt && a.status !== 'lupa_pulang')
    .toArray();

  if (openRecords.length === 0) {
    return { activeAttendance: null, autoClosedForgotRecord: null };
  }

  openRecords.sort((a, b) => Date.parse(b.clockInAt) - Date.parse(a.clockInAt));
  const latest = openRecords[0];
  const elapsedHours = (now.getTime() - Date.parse(latest.clockInAt)) / (1000 * 60 * 60);

  if (elapsedHours >= MAX_OPEN_ATTENDANCE_HOURS) {
    const updated: AttendanceRecord = {
      ...latest,
      status: 'lupa_pulang',
      workMinutes: 0,
      syncStatus: 'pending',
      updatedAt: now.toISOString(),
    };
    await db.attendances.put(updated);
    await enqueueSync('attendance', updated.id, 'upsert', updated);
    return { activeAttendance: null, autoClosedForgotRecord: updated };
  }

  return { activeAttendance: latest, autoClosedForgotRecord: null };
}

/**
 * Catat Absen Masuk memakai waktu perangkat + foto selfie terkompresi.
 */
export async function recordClockIn(params: {
  user: User;
  shift: WorkShiftSchedule;
  photoIn?: string;
  now?: Date;
}): Promise<AttendanceRecord> {
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const lateMinutes = computeLateMinutes(now, params.shift);

  const record: AttendanceRecord = {
    id: uuidv4(),
    userId: params.user.id,
    userNama: params.user.nama,
    userRole: params.user.role,
    tanggal: formatLocalDateYmd(now),
    shiftId: params.shift.id,
    shiftNama: params.shift.nama,
    scheduledStart: params.shift.jamMasuk,
    scheduledEnd: params.shift.jamPulang,
    clockInAt: nowIso,
    photoIn: params.photoIn,
    lateMinutes,
    status: lateMinutes > 0 ? 'telat' : 'hadir',
    syncStatus: 'pending',
    updatedAt: nowIso,
  };

  await db.attendances.put(record);
  await addAuditLog(
    params.user,
    'ABSEN_MASUK',
    params.user.nama,
    `${params.shift.nama} · Masuk ${formatClockHm(nowIso)}${lateMinutes > 0 ? ` (Telat ${lateMinutes} mnt)` : ' (Tepat Waktu)'}`
  );
  await enqueueSync('attendance', record.id, 'upsert', record);

  sendDeviceNotification({
    title: `Absen Masuk · ${params.user.nama}`,
    body: `${params.shift.nama} pukul ${formatClockHm(nowIso)}${lateMinutes > 0 ? ` (Telat ${lateMinutes} menit)` : ' (Tepat waktu)'}`,
    dedupKey: `att-in-${record.id}`,
    broadcastFcm: true,
  });

  return record;
}

/**
 * Catat Absen Pulang memakai waktu perangkat + foto selfie terkompresi.
 */
export async function recordClockOut(params: {
  attendance: AttendanceRecord;
  user: User;
  photoOut?: string;
  now?: Date;
}): Promise<AttendanceRecord> {
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const diffMs = Math.max(0, now.getTime() - Date.parse(params.attendance.clockInAt));
  const workMinutes = Math.round(diffMs / 60000);

  const updated: AttendanceRecord = {
    ...params.attendance,
    clockOutAt: nowIso,
    photoOut: params.photoOut,
    workMinutes,
    syncStatus: 'pending',
    updatedAt: nowIso,
  };

  await db.attendances.put(updated);
  await addAuditLog(
    params.user,
    'ABSEN_PULANG',
    params.user.nama,
    `${updated.shiftNama} · Pulang ${formatClockHm(nowIso)} (Durasi ${formatDurationMinutes(workMinutes)})`
  );
  await enqueueSync('attendance', updated.id, 'upsert', updated);

  sendDeviceNotification({
    title: `Absen Pulang · ${params.user.nama}`,
    body: `${updated.shiftNama} pulang ${formatClockHm(nowIso)} · Total ${formatDurationMinutes(workMinutes)}`,
    dedupKey: `att-out-${updated.id}`,
    broadcastFcm: true,
  });

  return updated;
}

/**
 * Koreksi manual jam pulang oleh Owner / Manager untuk status `lupa_pulang`.
 */
export async function correctForgotCheckout(params: {
  attendance: AttendanceRecord;
  clockOutIso: string;
  note: string;
  editor: User;
}): Promise<AttendanceRecord> {
  const nowIso = new Date().toISOString();
  const diffMs = Math.max(0, Date.parse(params.clockOutIso) - Date.parse(params.attendance.clockInAt));
  const workMinutes = Math.round(diffMs / 60000);

  const updated: AttendanceRecord = {
    ...params.attendance,
    clockOutAt: params.clockOutIso,
    workMinutes,
    status: 'dikoreksi',
    correctedBy: params.editor.nama,
    correctedAt: nowIso,
    correctionNote: params.note.trim() || 'Koreksi jam pulang manual',
    syncStatus: 'pending',
    updatedAt: nowIso,
  };

  await db.attendances.put(updated);
  await addAuditLog(
    params.editor,
    'KOREKSI_ABSEN',
    params.attendance.userNama,
    `Koreksi pulang ${params.attendance.tanggal} -> ${formatClockHm(params.clockOutIso)} (${updated.correctionNote})`
  );
  await enqueueSync('attendance', updated.id, 'upsert', updated);
  return updated;
}

/**
 * Kompres foto selfie dari elemen <video> atau File gambar ke JPEG ringan (~25-35 KB, maks 360px)
 * agar 100% aman disimpan offline di Dexie dan hemat storage Cloud.
 */
export function captureCompressedSelfieFromVideo(video: HTMLVideoElement): string {
  const maxDim = 360;
  const vw = video.videoWidth || 360;
  const vh = video.videoHeight || 360;
  const scale = Math.min(1, maxDim / Math.max(vw, vh));
  const w = Math.max(160, Math.round(vw * scale));
  const h = Math.max(160, Math.round(vh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  // Mirror horizontal untuk kamera depan agar natural
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.65);
}

export function compressImageFileToSelfie(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file foto.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format foto tidak didukung.'));
      img.onload = () => {
        const maxDim = 360;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(160, Math.round(img.width * scale));
        const h = Math.max(160, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas tidak tersedia.'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.65));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

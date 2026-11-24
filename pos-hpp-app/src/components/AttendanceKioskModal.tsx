import React, { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import {
  captureCompressedSelfieFromVideo,
  compressImageFileToSelfie,
  detectClosestWorkShift,
  findActiveAttendanceForUser,
  formatClockHm,
  formatDurationMinutes,
  getWorkShifts,
  recordClockIn,
  recordClockOut,
} from '../services/attendanceService';
import type { AttendanceRecord, User, WorkShiftSchedule } from '../types/models';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Delete,
  LogIn,
  LogOut,
  X,
} from 'lucide-react';

interface AttendanceKioskModalProps {
  onClose?: () => void;
  onSuccess?: (record: AttendanceRecord) => void;
  /** Jika sudah diketahui user-nya (mis. gerbang wajib absen sebelum Buka Kasir), langsung ke step Selfie */
  preselectedUser?: User;
  /** Jika true, modal tidak bisa ditutup sebelum Absen Masuk selesai */
  mandatoryClockIn?: boolean;
  onSwitchUser?: () => void;
}

export const AttendanceKioskModal: React.FC<AttendanceKioskModalProps> = ({
  onClose,
  onSuccess,
  preselectedUser,
  mandatoryClockIn = false,
  onSwitchUser,
}) => {
  const settings = useLiveQuery(() => db.settings.get('global'));
  const users = useLiveQuery(() => db.users.toArray()) ?? [];
  const activeUsers = users.filter((u) => u.active);
  const workShifts = getWorkShifts(settings);

  const [step, setStep] = useState<'pin' | 'selfie' | 'done'>(
    preselectedUser ? 'selfie' : 'pin'
  );
  const [pinInput, setPinInput] = useState('');
  const [duplicateMatches, setDuplicateMatches] = useState<User[]>([]);
  const [matchedUser, setMatchedUser] = useState<User | null>(preselectedUser ?? null);
  const [activeAtt, setActiveAtt] = useState<AttendanceRecord | null>(null);
  const [forgotNotice, setForgotNotice] = useState<AttendanceRecord | null>(null);
  const [selectedShift, setSelectedShift] = useState<WorkShiftSchedule>(() =>
    detectClosestWorkShift(new Date(), workShifts)
  );
  const [nowClock, setNowClock] = useState<Date>(() => new Date());

  // Kamera depan untuk selfie
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [capturedPhoto, setCapturedPhoto] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [doneResult, setDoneResult] = useState<{
    mode: 'in' | 'out';
    record: AttendanceRecord;
  } | null>(null);

  // Perbarui jam real-time setiap 15 detik
  useEffect(() => {
    const t = setInterval(() => setNowClock(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  // Jika preselectedUser diberikan, langsung cek status absensi aktifnya
  useEffect(() => {
    if (!preselectedUser) return;
    let cancelled = false;
    findActiveAttendanceForUser(preselectedUser.id)
      .then(({ activeAttendance, autoClosedForgotRecord }) => {
        if (cancelled) return;
        setActiveAtt(activeAttendance);
        setForgotNotice(autoClosedForgotRecord);
        setSelectedShift(detectClosestWorkShift(new Date(), workShifts));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [preselectedUser?.id]);

  // Nyalakan kamera depan saat masuk step selfie
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  };

  useEffect(() => {
    if (step !== 'selfie' || capturedPhoto) {
      stopCamera();
      return;
    }
    let mounted = true;
    setCameraError('');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
          audio: false,
        })
        .then((stream) => {
          if (!mounted) {
            stream.getTracks().forEach((tr) => tr.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
          setCameraReady(true);
        })
        .catch(() => {
          if (!mounted) return;
          setCameraError(
            'Kamera langsung tidak tersedia. Gunakan tombol "Buka Kamera Selfie" di bawah.'
          );
        });
    } else {
      setCameraError('Gunakan tombol "Buka Kamera Selfie" di bawah untuk mengambil foto.');
    }

    return () => {
      mounted = false;
      stopCamera();
    };
  }, [step, capturedPhoto]);

  const proceedToSelfieForUser = async (found: User) => {
    setDuplicateMatches([]);
    const now = new Date();
    setNowClock(now);
    const { activeAttendance, autoClosedForgotRecord } =
      await findActiveAttendanceForUser(found.id, now);
    setMatchedUser(found);
    setActiveAtt(activeAttendance);
    setForgotNotice(autoClosedForgotRecord);
    setSelectedShift(detectClosestWorkShift(now, workShifts));
    setCapturedPhoto('');
    setStep('selfie');
  };

  const handlePinDigit = async (digit: string) => {
    if (pinInput.length >= 6) return;
    const next = pinInput + digit;
    setPinInput(next);
    setError('');

    if (next.length === 6) {
      const matches = activeUsers.filter((u) => String(u.pin || '').trim() === next);
      if (matches.length === 0) {
        setError('PIN 6 angka tidak ditemukan. Coba periksa kembali.');
        setTimeout(() => setPinInput(''), 350);
        return;
      }
      if (matches.length > 1) {
        setDuplicateMatches(matches);
        setPinInput('');
        return;
      }
      await proceedToSelfieForUser(matches[0]);
    }
  };

  const handleBackspace = () => {
    setPinInput((p) => p.slice(0, -1));
    setError('');
  };

  const handleFileSelfie = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToSelfie(file);
      setCapturedPhoto(dataUrl);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memproses foto selfie.');
    } finally {
      e.target.value = '';
    }
  };

  const handleCaptureAndSubmit = async () => {
    if (!matchedUser || saving) return;
    let photo = capturedPhoto;
    if (!photo && cameraReady && videoRef.current) {
      photo = captureCompressedSelfieFromVideo(videoRef.current);
      setCapturedPhoto(photo);
    }
    if (!photo) {
      setError('Mohon ambil foto selfie terlebih dahulu.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const now = new Date();
      let record: AttendanceRecord;
      const isClockOut = Boolean(activeAtt) && !mandatoryClockIn;

      if (isClockOut && activeAtt) {
        record = await recordClockOut({
          attendance: activeAtt,
          user: matchedUser,
          photoOut: photo,
          now,
        });
        setDoneResult({ mode: 'out', record });
      } else {
        record = await recordClockIn({
          user: matchedUser,
          shift: selectedShift,
          photoIn: photo,
          now,
        });
        setDoneResult({ mode: 'in', record });
      }

      stopCamera();
      setStep('done');
      setTimeout(() => {
        onSuccess?.(record);
        if (!mandatoryClockIn) {
          onClose?.();
        }
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan absensi.');
    } finally {
      setSaving(false);
    }
  };

  const isClockOutMode = Boolean(activeAtt) && !mandatoryClockIn;
  const elapsedMinutes = activeAtt
    ? Math.max(0, Math.round((nowClock.getTime() - Date.parse(activeAtt.clockInAt)) / 60000))
    : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-[410px] rounded-2xl p-5 flex flex-col gap-4 max-h-[90dvh] overflow-y-auto shadow-2xl border border-[#e2e0d8]">
        {/* Header Modal */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-[#e4f1ea] text-[#1F7A5A] flex items-center justify-center shrink-0">
              <Clock size={18} />
            </div>
            <div>
              <div className="font-bold text-sm text-[#1f1e1d]">
                {mandatoryClockIn ? 'Wajib Absen Masuk' : 'Absen Karyawan'}
              </div>
              <div className="text-[11px] text-[#6b6a68]">
                {settings?.namaUsaha || 'Lembayung'} · {formatClockHm(nowClock.toISOString())}
              </div>
            </div>
          </div>
          {!mandatoryClockIn && onClose && (
            <button
              type="button"
              onClick={() => {
                stopCamera();
                onClose();
              }}
              className="p-1.5 rounded-lg text-[#6b6a68] hover:bg-[#ece9e0]"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* ============================================================
            STEP 1: INPUT PIN 6 ANGKA (TANPA PILIH NAMA)
           ============================================================ */}
        {step === 'pin' && duplicateMatches.length > 1 && (
          <div className="flex flex-col gap-2.5 py-1">
            <div className="text-center">
              <div className="text-sm font-bold text-[#1f1e1d]">Pilih Nama Anda</div>
              <div className="text-[11px] text-[#7a4300] mt-0.5">
                PIN ini masih dipakai lebih dari 1 akun lama.
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {duplicateMatches.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => proceedToSelfieForUser(u)}
                  className="h-11 px-4 rounded-xl border border-[#d6d3c8] bg-[#faf9f5] hover:bg-[#e4f1ea] hover:border-[#1F7A5A] text-sm font-semibold text-[#1f1e1d] flex items-center justify-between"
                >
                  <span>{u.nama}</span>
                  <span className="text-[11px] text-[#6b6a68] capitalize">{u.role}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDuplicateMatches([])}
              className="text-xs font-medium text-[#6b6a68] text-center pt-1"
            >
              ‹ Kembali ke Numpad
            </button>
          </div>
        )}

        {step === 'pin' && duplicateMatches.length <= 1 && (
          <div className="flex flex-col items-center gap-4 py-1">
            <div className="text-center">
              <div className="text-sm font-semibold text-[#1f1e1d]">
                Masukkan 6 Angka PIN Anda
              </div>
              <div className="text-xs text-[#6b6a68] mt-0.5">
                Sistem otomatis mengenali nama &amp; status Absen Masuk / Pulang
              </div>
            </div>

            <div className="flex items-center justify-center gap-3.5 my-1">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className={`w-3.5 h-3.5 rounded-full transition-all ${
                    idx < pinInput.length
                      ? 'bg-[#1F7A5A] scale-110'
                      : 'bg-[#ece9e0] border border-[#d6d3c8]'
                  }`}
                />
              ))}
            </div>

            {error && (
              <div className="w-full text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-xl text-center">
                {error}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2.5 w-full max-w-[260px]">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handlePinDigit(d)}
                  className="h-13 rounded-2xl bg-[#faf9f5] hover:bg-[#e4f1ea] active:bg-[#1F7A5A] active:text-white border border-[#e2e0d8] text-lg font-bold text-[#1f1e1d] transition select-none"
                >
                  {d}
                </button>
              ))}
              <div />
              <button
                type="button"
                onClick={() => handlePinDigit('0')}
                className="h-13 rounded-2xl bg-[#faf9f5] hover:bg-[#e4f1ea] active:bg-[#1F7A5A] active:text-white border border-[#e2e0d8] text-lg font-bold text-[#1f1e1d] transition select-none"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleBackspace}
                className="h-13 rounded-2xl bg-[#faf9f5] hover:bg-[#fbe4e1] text-[#4a4947] hover:text-[#9b1c12] border border-[#e2e0d8] flex items-center justify-center transition"
              >
                <Delete size={20} />
              </button>
            </div>
          </div>
        )}

        {/* ============================================================
            STEP 2: SAPAAN NAMA + PILIH SHIFT (SAAT MASUK) + SELFIE
           ============================================================ */}
        {step === 'selfie' && matchedUser && (
          <div className="flex flex-col gap-3.5">
            {/* Sapaan Personal */}
            <div
              className={`rounded-xl p-3.5 border ${
                isClockOutMode
                  ? 'bg-[#fbf3e6] border-[#f0dcb8]'
                  : 'bg-[#e4f1ea] border-[#c5dfd1]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                    isClockOutMode
                      ? 'bg-[#7a4300] text-white'
                      : 'bg-[#1F7A5A] text-white'
                  }`}
                >
                  {isClockOutMode ? <LogOut size={11} /> : <LogIn size={11} />}
                  {isClockOutMode ? 'ABSEN PULANG' : 'ABSEN MASUK'}
                </span>
                <span className="text-xs font-bold text-[#1f1e1d]">
                  {formatClockHm(nowClock.toISOString())}
                </span>
              </div>
              <div className="text-base font-bold text-[#1f1e1d] mt-1.5">
                {isClockOutMode
                  ? `Halo, ${matchedUser.nama}! Terima kasih hari ini`
                  : `Halo, ${matchedUser.nama}! Selamat datang`}
              </div>
              {isClockOutMode && activeAtt ? (
                <div className="text-xs text-[#7a4300] mt-0.5">
                  {activeAtt.shiftNama} · Masuk {formatClockHm(activeAtt.clockInAt)} · Durasi{' '}
                  <strong>{formatDurationMinutes(elapsedMinutes)}</strong>
                </div>
              ) : (
                <div className="text-xs text-[#1f4d3a] mt-0.5">
                  Silakan ambil foto selfie untuk mencatat jam datang Anda.
                </div>
              )}
            </div>

            {forgotNotice && (
              <div className="bg-[#fbeed9] border border-[#f0dcb8] text-[#7a4300] rounded-xl px-3 py-2 text-xs flex items-start gap-2">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <span>
                  Absen Anda pada <strong>{forgotNotice.tanggal}</strong> otomatis ditandai{' '}
                  <strong>Lupa Absen Pulang</strong> (dapat dikoreksi oleh Owner/Manager).
                </span>
              </div>
            )}

            {/* Pilihan Shift Kerja saat Absen Masuk (otomatis pilih terdekat, bisa diubah 1 tap) */}
            {!isClockOutMode && (
              <div className="flex flex-col gap-1.5">
                <div className="text-xs font-semibold text-[#4a4947]">
                  Jadwal Shift (otomatis pilih terdekat):
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {workShifts.map((s) => {
                    const active = selectedShift.id === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedShift(s)}
                        className={`px-2.5 py-2 rounded-xl border text-left transition ${
                          active
                            ? 'bg-[#e4f1ea] border-[#1F7A5A] text-[#1F7A5A]'
                            : 'bg-[#faf9f5] border-[#e2e0d8] text-[#4a4947]'
                        }`}
                      >
                        <div className="text-xs font-bold leading-tight">{s.nama}</div>
                        <div className="text-[10px] opacity-80 mt-0.5">
                          {s.jamMasuk} – {s.jamPulang}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Preview Kamera Selfie */}
            <div className="relative w-full aspect-square max-h-[250px] bg-[#18181B] rounded-2xl overflow-hidden flex items-center justify-center border border-[#e2e0d8]">
              {capturedPhoto ? (
                <img
                  src={capturedPhoto}
                  alt="Selfie Absen"
                  className="w-full h-full object-cover"
                />
              ) : (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                  {!cameraReady && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-white/80 text-xs gap-2 bg-[#18181B]">
                      <Camera size={28} className="text-white/60" />
                      <span>{cameraError || 'Menyiapkan kamera depan...'}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Fallback file input kamera (jika getUserMedia diblokir di WebView / mau ulang selfie) */}
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-[#1F7A5A] cursor-pointer hover:underline inline-flex items-center gap-1">
                <Camera size={14} />
                {capturedPhoto ? 'Ambil Ulang via Kamera' : 'Buka Kamera Selfie'}
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handleFileSelfie}
                  className="hidden"
                />
              </label>
              {capturedPhoto && (
                <button
                  type="button"
                  onClick={() => setCapturedPhoto('')}
                  className="text-xs text-[#6b6a68] hover:text-[#1f1e1d]"
                >
                  Ulangi Kamera Live
                </button>
              )}
            </div>

            {error && (
              <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={saving || (!cameraReady && !capturedPhoto)}
              onClick={handleCaptureAndSubmit}
              className={`h-12 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition ${
                isClockOutMode
                  ? 'bg-[#c2410c] hover:bg-[#9a3412]'
                  : 'bg-[#1F7A5A] hover:bg-[#15563f]'
              }`}
            >
              <Camera size={16} />
              {saving
                ? 'Menyimpan Absen...'
                : isClockOutMode
                ? 'Ambil Selfie & Absen Pulang'
                : 'Ambil Selfie & Absen Masuk'}
            </button>

            {mandatoryClockIn && onSwitchUser && (
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  onSwitchUser();
                }}
                className="text-xs font-medium text-[#6b6a68] text-center hover:underline"
              >
                Ganti Pengguna Lain
              </button>
            )}
          </div>
        )}

        {/* ============================================================
            STEP 3: KONFIRMASI SUKSES
           ============================================================ */}
        {step === 'done' && doneResult && (
          <div className="py-6 flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-[#e4f1ea] text-[#1F7A5A] flex items-center justify-center">
              <CheckCircle2 size={32} />
            </div>
            <div>
              <div className="text-base font-bold text-[#1f1e1d]">
                {doneResult.mode === 'in' ? 'Absen Masuk Berhasil!' : 'Absen Pulang Berhasil!'}
              </div>
              <div className="text-xs text-[#6b6a68] mt-1">
                <strong>{doneResult.record.userNama}</strong> · {doneResult.record.shiftNama}
              </div>
              <div className="text-xs font-semibold text-[#1F7A5A] mt-0.5">
                {doneResult.mode === 'in'
                  ? `Jam datang: ${formatClockHm(doneResult.record.clockInAt)}${
                      doneResult.record.lateMinutes > 0
                        ? ` (Telat ${doneResult.record.lateMinutes} menit)`
                        : ' (Tepat waktu)'
                    }`
                  : `Jam pulang: ${formatClockHm(doneResult.record.clockOutAt)} · Durasi ${formatDurationMinutes(
                      doneResult.record.workMinutes
                    )}`}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

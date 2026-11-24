import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { updateSettings } from '../db/actions';
import {
  correctForgotCheckout,
  formatClockHm,
  formatDurationMinutes,
  formatLocalDateYmd,
  getWorkShifts,
} from '../services/attendanceService';
import type { AttendanceRecord, User, WorkShiftSchedule } from '../types/models';
import {
  AlertTriangle,
  Calendar,
  Clock,
  Download,
  Edit3,
  Image as ImageIcon,
  Settings2,
  X,
} from 'lucide-react';

interface AttendanceReportPageProps {
  user: User;
  onBack?: () => void;
}

export const AttendanceReportPage: React.FC<AttendanceReportPageProps> = ({ user, onBack }) => {
  const settings = useLiveQuery(() => db.settings.get('global'));
  const attendances =
    useLiveQuery(() => db.attendances.orderBy('clockInAt').reverse().toArray()) ?? [];
  const workShifts = getWorkShifts(settings);

  const todayYmd = formatLocalDateYmd(new Date());
  const currentMonthYm = todayYmd.slice(0, 7);

  const [filterMode, setFilterMode] = useState<'today' | 'month' | 'forgot'>('today');
  const [selectedMonth, setSelectedMonth] = useState(currentMonthYm);
  const [previewPhoto, setPreviewPhoto] = useState<{ title: string; src: string } | null>(null);

  // Modal Koreksi Lupa Absen Pulang
  const [correctTarget, setCorrectTarget] = useState<AttendanceRecord | null>(null);
  const [correctTime, setCorrectTime] = useState('17:00');
  const [correctNote, setCorrectNote] = useState('');
  const [savingCorrection, setSavingCorrection] = useState(false);

  // Modal Atur Jadwal Shift Kerja
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [draftShifts, setDraftShifts] = useState<WorkShiftSchedule[]>([]);

  const isManagerOrOwner = user.role === 'owner' || user.role === 'manager';

  const forgotCount = useMemo(
    () => attendances.filter((a) => a.status === 'lupa_pulang').length,
    [attendances]
  );

  const activeNowCount = useMemo(
    () => attendances.filter((a) => !a.clockOutAt && a.status !== 'lupa_pulang').length,
    [attendances]
  );

  const filtered = useMemo(() => {
    if (filterMode === 'today') {
      return attendances.filter((a) => a.tanggal === todayYmd || (!a.clockOutAt && a.status !== 'lupa_pulang'));
    }
    if (filterMode === 'forgot') {
      return attendances.filter((a) => a.status === 'lupa_pulang');
    }
    return attendances.filter((a) => a.tanggal.startsWith(selectedMonth));
  }, [attendances, filterMode, todayYmd, selectedMonth]);

  // Rekap per karyawan (untuk tampilan Bulanan)
  const monthlySummaryByUser = useMemo(() => {
    const map = new Map<
      string,
      { nama: string; hadir: number; telatCount: number; telatMenit: number; totalMenit: number; lupaPulang: number }
    >();
    const monthRows = attendances.filter((a) => a.tanggal.startsWith(selectedMonth));
    for (const a of monthRows) {
      const cur = map.get(a.userId) ?? {
        nama: a.userNama,
        hadir: 0,
        telatCount: 0,
        telatMenit: 0,
        totalMenit: 0,
        lupaPulang: 0,
      };
      cur.hadir += 1;
      if (a.lateMinutes > 0) {
        cur.telatCount += 1;
        cur.telatMenit += a.lateMinutes;
      }
      if (a.status === 'lupa_pulang') cur.lupaPulang += 1;
      cur.totalMenit += a.workMinutes ?? 0;
      map.set(a.userId, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.nama.localeCompare(b.nama));
  }, [attendances, selectedMonth]);

  const handleOpenCorrect = (rec: AttendanceRecord) => {
    setCorrectTarget(rec);
    setCorrectTime(rec.scheduledEnd || '17:00');
    setCorrectNote('Lupa absen pulang');
  };

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctTarget) return;
    setSavingCorrection(true);
    try {
      const [hStr, mStr] = correctTime.split(':');
      const inDate = new Date(correctTarget.clockInAt);
      const outDate = new Date(inDate);
      outDate.setHours(parseInt(hStr || '17', 10), parseInt(mStr || '0', 10), 0, 0);
      // Jika jam pulang lebih kecil dari jam masuk (shift malam), tambah 1 hari
      if (outDate.getTime() <= inDate.getTime()) {
        outDate.setDate(outDate.getDate() + 1);
      }
      await correctForgotCheckout({
        attendance: correctTarget,
        clockOutIso: outDate.toISOString(),
        note: correctNote,
        editor: user,
      });
      setCorrectTarget(null);
    } finally {
      setSavingCorrection(false);
    }
  };

  const handleExportCsv = () => {
    const header = [
      'Tanggal',
      'Nama Karyawan',
      'Role',
      'Shift',
      'Jadwal',
      'Jam Masuk',
      'Jam Pulang',
      'Telat (Menit)',
      'Durasi Kerja (Menit)',
      'Status',
      'Catatan Koreksi',
    ];
    const rows = filtered.map((a) => [
      a.tanggal,
      a.userNama,
      a.userRole,
      a.shiftNama,
      `${a.scheduledStart}-${a.scheduledEnd}`,
      formatClockHm(a.clockInAt),
      a.clockOutAt ? formatClockHm(a.clockOutAt) : '-',
      String(a.lateMinutes ?? 0),
      String(a.workMinutes ?? 0),
      a.status,
      a.correctionNote || '',
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `absensi-lembayung-${filterMode === 'month' ? selectedMonth : todayYmd}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveWorkShifts = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings({ workShifts: draftShifts }, user);
    setShowShiftModal(false);
  };

  return (
    <div className="px-3.5 sm:px-5 pt-4 sm:pt-5 pb-8 flex flex-col gap-3.5 w-full max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-[20px] sm:text-[22px] font-bold">Absensi Tim</h1>
          <div className="text-xs text-[#6b6a68]">
            Sedang bekerja: <strong>{activeNowCount}</strong> · Perlu koreksi:{' '}
            <strong className={forgotCount > 0 ? 'text-[#9b1c12]' : ''}>{forgotCount}</strong>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="h-9 px-3 rounded-full border border-[#d6d3c8] bg-white text-xs font-medium whitespace-nowrap"
            >
              ‹ Laporan
            </button>
          )}
          {user.role === 'owner' && (
            <button
              type="button"
              onClick={() => {
                setDraftShifts(workShifts.map((s) => ({ ...s })));
                setShowShiftModal(true);
              }}
              className="h-9 px-3 rounded-full border border-[#d6d3c8] bg-white text-xs font-semibold text-[#1F7A5A] flex items-center gap-1 whitespace-nowrap"
            >
              <Settings2 size={13} /> Jadwal Shift
            </button>
          )}
          <button
            type="button"
            onClick={handleExportCsv}
            className="h-9 px-3 rounded-full bg-[#1F7A5A] text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
          >
            <Download size={13} /> Ekspor CSV
          </button>
        </div>
      </div>

      {/* Filter Tab */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['today', 'Hari Ini & Aktif'],
            ['month', 'Rekap Bulanan'],
            ['forgot', `Lupa Pulang (${forgotCount})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilterMode(k)}
            className={`h-9 px-3.5 rounded-full text-xs font-semibold border whitespace-nowrap transition ${
              filterMode === k
                ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                : 'bg-white border-[#d6d3c8] text-[#4a4947]'
            }`}
          >
            {label}
          </button>
        ))}

        {filterMode === 'month' && (
          <div className="inline-flex items-center gap-1.5 bg-white border border-[#d6d3c8] rounded-full px-3 h-9 text-xs">
            <Calendar size={13} className="text-[#1F7A5A]" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent text-xs font-semibold focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Rekap Ringkas per Karyawan saat Mode Bulanan */}
      {filterMode === 'month' && monthlySummaryByUser.length > 0 && (
        <div className="bg-white border border-[#e2e0d8] rounded-xl overflow-hidden">
          <div className="px-3.5 py-2.5 bg-[#faf9f5] border-b border-[#e2e0d8] text-xs font-bold text-[#4a4947]">
            Ringkasan Karyawan ({selectedMonth})
          </div>
          <div className="divide-y divide-[#eeece5]">
            {monthlySummaryByUser.map((row) => (
              <div
                key={row.nama}
                className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="font-semibold text-[#1f1e1d]">{row.nama}</div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="px-2 py-0.5 rounded-full bg-[#e4f1ea] text-[#1F7A5A] font-semibold">
                    {row.hadir} hari
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-[#ece9e0] text-[#4a4947] font-medium">
                    Total {formatDurationMinutes(row.totalMenit)}
                  </span>
                  {row.telatCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-[#fbeed9] text-[#7a4300] font-semibold">
                      Telat {row.telatCount}x ({row.telatMenit} mnt)
                    </span>
                  )}
                  {row.lupaPulang > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-[#fbe4e1] text-[#9b1c12] font-semibold">
                      Lupa pulang {row.lupaPulang}x
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daftar Detail Absensi */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.length === 0 ? (
          <div className="col-span-full bg-white border border-[#e2e0d8] rounded-xl p-8 text-center text-xs text-[#6b6a68]">
            Belum ada catatan absensi pada filter ini.
          </div>
        ) : (
          filtered.map((a) => {
            const isForgot = a.status === 'lupa_pulang';
            const isActive = !a.clockOutAt && !isForgot;
            const badgeClass = isForgot
              ? 'bg-[#fbe4e1] text-[#9b1c12]'
              : isActive
              ? 'bg-[#e4f1ea] text-[#1F7A5A]'
              : a.status === 'telat'
              ? 'bg-[#fbeed9] text-[#7a4300]'
              : a.status === 'dikoreksi'
              ? 'bg-[#e0e7ff] text-[#3730a3]'
              : 'bg-[#e4f1ea] text-[#1F7A5A]';
            const badgeLabel = isForgot
              ? 'Lupa Absen Pulang'
              : isActive
              ? 'Sedang Bekerja'
              : a.status === 'dikoreksi'
              ? 'Dikoreksi'
              : a.lateMinutes > 0
              ? `Telat ${a.lateMinutes} mnt`
              : 'Tepat Waktu';

            return (
              <div
                key={a.id}
                className="bg-white border border-[#e2e0d8] rounded-xl p-3.5 flex flex-col gap-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-[#1f1e1d] truncate">{a.userNama}</div>
                    <div className="text-[11px] text-[#6b6a68]">
                      {a.tanggal} · {a.shiftNama} ({a.scheduledStart}–{a.scheduledEnd})
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${badgeClass}`}
                  >
                    {badgeLabel}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-[#faf9f5] rounded-lg p-2.5 text-center text-xs">
                  <div>
                    <div className="text-[10px] text-[#6b6a68]">Masuk</div>
                    <div className="font-bold text-[#1f1e1d]">{formatClockHm(a.clockInAt)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#6b6a68]">Pulang</div>
                    <div className="font-bold text-[#1f1e1d]">
                      {a.clockOutAt ? formatClockHm(a.clockOutAt) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#6b6a68]">Durasi</div>
                    <div className="font-bold text-[#1F7A5A]">
                      {formatDurationMinutes(a.workMinutes)}
                    </div>
                  </div>
                </div>

                {a.correctionNote && (
                  <div className="text-[11px] text-[#3730a3] bg-[#eef2ff] rounded-lg px-2.5 py-1.5">
                    Koreksi oleh <strong>{a.correctedBy}</strong>: {a.correctionNote}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#eeece5]">
                  <div className="flex items-center gap-1.5">
                    {a.photoIn && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewPhoto({
                            title: `Selfie Masuk · ${a.userNama} (${formatClockHm(a.clockInAt)})`,
                            src: a.photoIn!,
                          })
                        }
                        className="text-[11px] font-semibold text-[#1F7A5A] bg-[#e4f1ea] px-2.5 py-1 rounded-lg inline-flex items-center gap-1"
                      >
                        <ImageIcon size={12} /> Foto Masuk
                      </button>
                    )}
                    {a.photoOut && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewPhoto({
                            title: `Selfie Pulang · ${a.userNama} (${formatClockHm(a.clockOutAt)})`,
                            src: a.photoOut!,
                          })
                        }
                        className="text-[11px] font-semibold text-[#7a4300] bg-[#fbeed9] px-2.5 py-1 rounded-lg inline-flex items-center gap-1"
                      >
                        <ImageIcon size={12} /> Foto Pulang
                      </button>
                    )}
                  </div>

                  {isManagerOrOwner && (isForgot || isActive) && (
                    <button
                      type="button"
                      onClick={() => handleOpenCorrect(a)}
                      className="text-[11px] font-semibold text-[#9b1c12] hover:underline inline-flex items-center gap-1"
                    >
                      <Edit3 size={12} /> Koreksi Pulang
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal Preview Foto Selfie */}
      {previewPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setPreviewPhoto(null)}
        >
          <div
            className="bg-white rounded-2xl p-4 max-w-[360px] w-full flex flex-col gap-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-[#1f1e1d]">{previewPhoto.title}</div>
              <button type="button" onClick={() => setPreviewPhoto(null)}>
                <X size={18} className="text-[#6b6a68]" />
              </button>
            </div>
            <img
              src={previewPhoto.src}
              alt={previewPhoto.title}
              className="w-full rounded-xl object-cover aspect-square bg-[#18181B]"
            />
          </div>
        </div>
      )}

      {/* Modal Koreksi Jam Pulang */}
      {correctTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveCorrection}
            className="bg-white w-full max-w-[390px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xl"
          >
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-[#9b1c12]" />
                <div className="text-base font-bold">Koreksi Jam Pulang</div>
              </div>
              <button type="button" onClick={() => setCorrectTarget(null)}>
                <X size={18} className="text-[#6b6a68]" />
              </button>
            </div>
            <div className="text-xs text-[#6b6a68]">
              <strong>{correctTarget.userNama}</strong> · {correctTarget.tanggal} ({correctTarget.shiftNama}, masuk{' '}
              {formatClockHm(correctTarget.clockInAt)})
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4a4947] mb-1">
                Jam Pulang Sebenarnya *
              </label>
              <input
                type="time"
                value={correctTime}
                onChange={(e) => setCorrectTime(e.target.value)}
                className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm font-semibold"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4a4947] mb-1">
                Catatan / Alasan Koreksi *
              </label>
              <input
                type="text"
                value={correctNote}
                onChange={(e) => setCorrectNote(e.target.value)}
                placeholder="Misal: Lupa tap pulang, dikonfirmasi kasir"
                className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                required
              />
            </div>
            <button
              type="submit"
              disabled={savingCorrection}
              className="h-11 rounded-xl bg-[#1F7A5A] text-white font-semibold text-sm disabled:opacity-60"
            >
              {savingCorrection ? 'Menyimpan...' : 'Simpan Koreksi'}
            </button>
          </form>
        </div>
      )}

      {/* Modal Atur Jadwal Shift Kerja */}
      {showShiftModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveWorkShifts}
            className="bg-white w-full max-w-[440px] rounded-2xl p-5 flex flex-col gap-3.5 max-h-[85dvh] overflow-y-auto shadow-xl"
          >
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Clock size={18} className="text-[#1F7A5A]" />
                <div className="text-base font-bold">Master Jadwal Shift Kerja</div>
              </div>
              <button type="button" onClick={() => setShowShiftModal(false)}>
                <X size={18} className="text-[#6b6a68]" />
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              {draftShifts.map((s, idx) => (
                <div
                  key={s.id}
                  className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-3 flex flex-col gap-2"
                >
                  <input
                    type="text"
                    value={s.nama}
                    onChange={(e) => {
                      const next = [...draftShifts];
                      next[idx] = { ...s, nama: e.target.value };
                      setDraftShifts(next);
                    }}
                    className="w-full h-9 border border-[#d6d3c8] rounded-lg px-2.5 text-xs font-bold bg-white"
                    required
                  />
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <label className="text-[10px] text-[#6b6a68]">Jam Masuk</label>
                      <input
                        type="time"
                        value={s.jamMasuk}
                        onChange={(e) => {
                          const next = [...draftShifts];
                          next[idx] = { ...s, jamMasuk: e.target.value };
                          setDraftShifts(next);
                        }}
                        className="w-full h-9 border border-[#d6d3c8] rounded-lg px-2 bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#6b6a68]">Jam Pulang</label>
                      <input
                        type="time"
                        value={s.jamPulang}
                        onChange={(e) => {
                          const next = [...draftShifts];
                          next[idx] = { ...s, jamPulang: e.target.value };
                          setDraftShifts(next);
                        }}
                        className="w-full h-9 border border-[#d6d3c8] rounded-lg px-2 bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#6b6a68]">Toleransi (mnt)</label>
                      <input
                        type="number"
                        min="0"
                        max="60"
                        value={s.toleransiTelatMenit}
                        onChange={(e) => {
                          const next = [...draftShifts];
                          next[idx] = { ...s, toleransiTelatMenit: Number(e.target.value) || 0 };
                          setDraftShifts(next);
                        }}
                        className="w-full h-9 border border-[#d6d3c8] rounded-lg px-2 bg-white"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="submit"
              className="h-11 rounded-xl bg-[#1F7A5A] text-white font-semibold text-sm"
            >
              Simpan Jadwal Shift
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

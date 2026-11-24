import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { CuaninLogo } from './CuaninLogo';
import { AttendanceKioskModal } from './AttendanceKioskModal';
import type { User } from '../types/models';
import { Clock, Delete, Lock, ShoppingBag, Store, X } from 'lucide-react';

interface KasirStandbyScreenProps {
  onCashierIdentified: (kasir: User) => void;
  onExitKasirMode: () => void;
}

export const KasirStandbyScreen: React.FC<KasirStandbyScreenProps> = ({
  onCashierIdentified,
  onExitKasirMode,
}) => {
  const settings = useLiveQuery(() => db.settings.get('global'));
  const users = useLiveQuery(() => db.users.toArray()) ?? [];
  const activeUsers = users.filter((u) => u.active);
  const activeAttendances =
    useLiveQuery(() =>
      db.attendances
        .filter((a) => !a.clockOutAt && a.status !== 'lupa_pulang')
        .toArray()
    ) ?? [];

  const [showAttendance, setShowAttendance] = useState(false);
  const [showPinOpenKasir, setShowPinOpenKasir] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const handleOpenKasirDigit = (digit: string) => {
    if (pinInput.length >= 6) return;
    const next = pinInput + digit;
    setPinInput(next);
    setPinError('');

    if (next.length === 6) {
      const matched = activeUsers.find((u) => String(u.pin || '').trim() === next);
      if (!matched) {
        setPinError('PIN karyawan tidak dikenali. Periksa kembali 6 angka PIN Anda.');
        setTimeout(() => setPinInput(''), 350);
        return;
      }
      setShowPinOpenKasir(false);
      setPinInput('');
      onCashierIdentified(matched);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#faf9f5] safe-frame flex flex-col">
      {/* Header Mode Kasir */}
      <header className="bg-white border-b border-[#e2e0d8] px-4 py-3 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <CuaninLogo size={26} />
          <div className="min-w-0">
            <div className="font-bold text-sm text-[#1f1e1d] truncate">
              {settings?.namaUsaha || 'Lembayung'}
            </div>
            <div className="text-[11px] font-semibold text-[#1F7A5A]">Mode Kasir</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onExitKasirMode}
          className="h-9 px-3 rounded-xl border border-[#d6d3c8] bg-white hover:bg-[#faf9f5] text-xs font-semibold text-[#4a4947] inline-flex items-center gap-1.5 shrink-0"
        >
          <Lock size={13} /> Kunci Layar
        </button>
      </header>

      {/* Area Utama Standby (Kasir Belum Dibuka) */}
      <main className="flex-1 flex flex-col items-center justify-center p-5">
        <div className="w-full max-w-[400px] bg-white border border-[#e2e0d8] rounded-2xl p-6 shadow-xs flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#fbf3e6] text-[#7a4300] flex items-center justify-center">
            <Store size={28} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#1f1e1d]">Kasir Belum Dibuka</h1>
            <p className="text-xs text-[#6b6a68] mt-1 leading-relaxed">
              Transaksi penjualan terkunci sampai kasir melakukan <strong>Buka Kasir</strong>.
              Karyawan dapat langsung melakukan <strong>Absen Masuk / Pulang</strong> di bawah.
            </p>
          </div>

          {activeAttendances.length > 0 && (
            <div className="w-full bg-[#f4f9f6] border border-[#c5dfd1] rounded-xl px-3.5 py-2.5 text-left">
              <div className="text-[11px] font-bold text-[#1F7A5A] mb-1">
                Sedang Hadir ({activeAttendances.length} orang)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeAttendances.map((a) => (
                  <span
                    key={a.id}
                    className="text-[11px] font-medium bg-white border border-[#c5dfd1] text-[#1f1e1d] px-2 py-0.5 rounded-full"
                  >
                    {a.userNama}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="w-full flex flex-col gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                setPinInput('');
                setPinError('');
                setShowPinOpenKasir(true);
              }}
              className="w-full h-12 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm flex items-center justify-center gap-2 transition"
            >
              <ShoppingBag size={17} /> Buka Kasir
            </button>

            <button
              type="button"
              onClick={() => setShowAttendance(true)}
              className="w-full h-12 rounded-xl bg-[#e4f1ea] hover:bg-[#d5eadf] border border-[#1F7A5A]/30 text-[#1F7A5A] font-semibold text-sm flex items-center justify-center gap-2 transition"
            >
              <Clock size={17} /> Absen Masuk / Pulang (Selfie)
            </button>
          </div>
        </div>
      </main>

      {/* Modal Input PIN Pribadi Karyawan untuk Buka Kasir */}
      {showPinOpenKasir && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[360px] rounded-2xl p-5 flex flex-col items-center gap-4 shadow-2xl border border-[#e2e0d8]">
            <div className="w-full flex items-center justify-between">
              <div>
                <div className="font-bold text-sm text-[#1f1e1d]">PIN Kasir untuk Buka Kasir</div>
                <div className="text-[11px] text-[#6b6a68]">
                  Masukkan 6 angka PIN pribadi kasir yang bertugas
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPinOpenKasir(false)}
                className="p-1 text-[#6b6a68]"
              >
                <X size={18} />
              </button>
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

            {pinError && (
              <div className="w-full text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-xl text-center">
                {pinError}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2.5 w-full max-w-[250px]">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleOpenKasirDigit(d)}
                  className="h-13 rounded-2xl bg-[#faf9f5] hover:bg-[#e4f1ea] active:bg-[#1F7A5A] active:text-white border border-[#e2e0d8] text-lg font-bold text-[#1f1e1d] transition select-none"
                >
                  {d}
                </button>
              ))}
              <div />
              <button
                type="button"
                onClick={() => handleOpenKasirDigit('0')}
                className="h-13 rounded-2xl bg-[#faf9f5] hover:bg-[#e4f1ea] active:bg-[#1F7A5A] active:text-white border border-[#e2e0d8] text-lg font-bold text-[#1f1e1d] transition select-none"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setPinInput((p) => p.slice(0, -1))}
                className="h-13 rounded-2xl bg-[#faf9f5] hover:bg-[#fbe4e1] text-[#4a4947] border border-[#e2e0d8] flex items-center justify-center transition"
              >
                <Delete size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {showAttendance && (
        <AttendanceKioskModal onClose={() => setShowAttendance(false)} />
      )}
    </div>
  );
};

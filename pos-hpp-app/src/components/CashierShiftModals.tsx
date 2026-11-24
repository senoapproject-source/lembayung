import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { closeCashierShift, openCashierShift } from '../db/actions';
import {
  formatJam,
  formatRibuanInput,
  formatRupiah,
  formatTanggalPendek,
  stripNonDigits,
} from '../lib/calculations';
import { CuaninLogo } from './CuaninLogo';
import type { CashierShift, User } from '../types/models';
import { Banknote, CheckCircle2, Lock, LogOut, Wallet, X } from 'lucide-react';

interface OpenShiftScreenProps {
  user: User;
  namaUsaha?: string;
  onOpened: (shift: CashierShift) => void;
  onSwitchUser: () => void;
}

/**
 * Layar Buka Kasir: wajib muncul sebelum kasir bisa masuk ke POS.
 * Tombol "Buka Kasir" disabled sampai kasir menginput nominal uang fisik di laci.
 */
export const OpenShiftScreen: React.FC<OpenShiftScreenProps> = ({
  user,
  namaUsaha,
  onOpened,
  onSwitchUser,
}) => {
  const [modalAwalStr, setModalAwalStr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canOpen = modalAwalStr.trim().length > 0 && !submitting;

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canOpen) return;
    setSubmitting(true);
    try {
      const shift = await openCashierShift(Number(modalAwalStr) || 0, user);
      onOpened(shift);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#faf9f5] safe-frame flex flex-col justify-center px-6 py-8">
      <div className="w-full max-w-[390px] mx-auto flex flex-col gap-5">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <CuaninLogo size={52} />
          <div className="text-lg font-bold text-[#1f1e1d] mt-1">Buka Kasir</div>
          <div className="text-xs text-[#6b6a68]">
            Halo <strong>{user.nama}</strong> · {namaUsaha || 'Lembayung'}
          </div>
        </div>

        <form
          onSubmit={handleOpen}
          className="bg-white border border-[#e2e0d8] rounded-2xl p-5 flex flex-col gap-4 shadow-xs"
        >
          <div className="bg-[#e4f1ea] border border-[#c5dfd1] rounded-xl p-3 flex items-start gap-2.5 text-xs text-[#1f4d3a]">
            <Banknote size={18} className="shrink-0 mt-0.5 text-[#1F7A5A]" />
            <div>
              Hitung uang tunai yang saat ini ada di mesin / laci kasir terlebih dahulu, lalu masukkan nominalnya untuk memulai shift.
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#4a4947] mb-1.5">
              Uang Modal Awal di Laci Kasir (Rp) *
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={formatRibuanInput(modalAwalStr)}
              onChange={(e) => setModalAwalStr(stripNonDigits(e.target.value))}
              placeholder="Contoh: 200.000 (isi 0 jika kosong)"
              className="w-full h-12 border border-[#d6d3c8] rounded-[10px] px-3.5 text-base font-bold text-[#1f1e1d] focus:outline-none focus:border-[#1F7A5A]"
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={!canOpen}
            className="h-12 rounded-[10px] bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-[15px] flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle2 size={17} />
            {submitting ? 'Membuka Kasir...' : 'Buka Kasir'}
          </button>

          <button
            type="button"
            onClick={onSwitchUser}
            className="text-xs text-[#6b6a68] hover:text-[#9b1c12] flex items-center justify-center gap-1 pt-1"
          >
            <LogOut size={13} /> Ganti Kasir / Kembali ke PIN
          </button>
        </form>
      </div>
    </div>
  );
};

interface CloseShiftModalProps {
  shift: CashierShift;
  user: User;
  onClose: () => void;
  onShiftClosed: () => void;
}

/**
 * Modal Tutup Kasir: menampilkan modal awal, pendapatan Cash (+ QRIS/Transfer),
 * pengeluaran kasir selama shift, estimasi uang di laci, dan input hitung uang fisik.
 * Tombol "Tutup Kasir" disabled sebelum nominal uang fisik diinput.
 */
export const CloseShiftModal: React.FC<CloseShiftModalProps> = ({
  shift,
  user,
  onClose,
  onShiftClosed,
}) => {
  const transactions = useLiveQuery(() => db.transactions.toArray()) ?? [];
  const expenses = useLiveQuery(() => db.expenses.toArray()) ?? [];
  const savedOrders = useLiveQuery(() => db.savedOrders.toArray()) ?? [];
  const openBillTotal = savedOrders.reduce(
    (sum, o) => sum + o.items.reduce((s, i) => s + i.hargaJual * i.jumlah, 0),
    0
  );

  const [uangFisikStr, setUangFisikStr] = useState('');
  const [catatan, setCatatan] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const liveStats = useMemo(() => {
    const shiftTxs = transactions.filter(
      (t) =>
        t.status !== 'void' &&
        t.kasirId === shift.kasirId &&
        t.waktu >= shift.waktuBuka
    );
    let pendapatanCash = 0;
    let pendapatanQris = 0;
    let pendapatanTransfer = 0;
    for (const tx of shiftTxs) {
      if (tx.metodeBayar === 'Cash') pendapatanCash += tx.total;
      else if (tx.metodeBayar === 'QRIS') pendapatanQris += tx.total;
      else if (tx.metodeBayar === 'Transfer') pendapatanTransfer += tx.total;
    }

    const shiftExps = expenses.filter(
      (e) =>
        !e.dibatalkan &&
        e.sumber === 'manual' &&
        e.pembuatId === shift.kasirId &&
        e.createdAt >= shift.waktuBuka
    );
    const pengeluaranKasir = shiftExps.reduce((s, e) => s + e.nominal, 0);
    const expectedCash = shift.modalAwal + pendapatanCash - pengeluaranKasir;

    return {
      txCount: shiftTxs.length,
      pendapatanCash,
      pendapatanQris,
      pendapatanTransfer,
      pengeluaranKasir,
      shiftExps,
      expectedCash,
    };
  }, [transactions, expenses, shift]);

  const hasInput = uangFisikStr.trim().length > 0;
  const uangFisikNum = hasInput ? Number(uangFisikStr) || 0 : 0;
  const selisih = uangFisikNum - liveStats.expectedCash;
  const canClose = hasInput && !submitting;

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canClose) return;
    setSubmitting(true);
    try {
      await closeCashierShift(shift.id, uangFisikNum, catatan.trim() || undefined, user);
      onShiftClosed();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3.5 max-h-[88vh] overflow-y-auto shadow-xl">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-base font-bold text-[#1f1e1d]">Tutup Kasir</div>
            <div className="text-xs text-[#6b6a68]">
              {shift.kasirNama} · Buka {formatTanggalPendek(shift.waktuBuka)} {formatJam(shift.waktuBuka)}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-[#6b6a68]">
            <X size={20} />
          </button>
        </div>

        {/* Ringkasan Kas Shift */}
        <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-3.5 flex flex-col gap-2 text-xs">
          <div className="flex justify-between">
            <span className="text-[#6b6a68]">Modal Awal Laci</span>
            <span className="font-semibold text-[#1f1e1d]">{formatRupiah(shift.modalAwal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6b6a68]">Pendapatan Cash ({liveStats.txCount} trx)</span>
            <span className="font-semibold text-[#1F7A5A]">+{formatRupiah(liveStats.pendapatanCash)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6b6a68]">Pengeluaran Kasir ({liveStats.shiftExps.length} item)</span>
            <span className="font-semibold text-[#9b1c12]">−{formatRupiah(liveStats.pengeluaranKasir)}</span>
          </div>
          <div className="border-t border-dashed border-[#d6d3c8] pt-2 mt-0.5 flex justify-between text-sm font-bold">
            <span>Seharusnya di Laci</span>
            <span className="text-[#1F7A5A]">{formatRupiah(liveStats.expectedCash)}</span>
          </div>
          {(liveStats.pendapatanQris > 0 || liveStats.pendapatanTransfer > 0) && (
            <div className="border-t border-[#eeece5] pt-2 text-[11px] text-[#6b6a68] flex justify-between">
              <span>Non-Tunai (Info):</span>
              <span>
                QRIS {formatRupiah(liveStats.pendapatanQris)} · Transfer {formatRupiah(liveStats.pendapatanTransfer)}
              </span>
            </div>
          )}
        </div>

        {/* Info Estafet Open Bill (Disimpan) ke Shift Berikutnya */}
        {savedOrders.length > 0 && (
          <div className="bg-[#fbf3e6] border border-[#f0dcb8] rounded-xl px-3.5 py-2.5 text-xs text-[#7a4300]">
            <strong>{savedOrders.length} Open Bill (Disimpan)</strong> senilai{' '}
            <strong>{formatRupiah(openBillTotal)}</strong> sedang aktif dan akan{' '}
            <strong>otomatis diteruskan ke Shift berikutnya</strong> (tidak perlu ditagih sekarang).
          </div>
        )}

        {/* Daftar Pengeluaran Kasir Selama Shift (Read-Only) */}
        {liveStats.shiftExps.length > 0 && (
          <div className="bg-white border border-[#e2e0d8] rounded-xl p-3 flex flex-col gap-1.5">
            <div className="text-[11px] font-semibold text-[#4a4947] flex items-center gap-1.5">
              <Wallet size={13} className="text-[#1F7A5A]" />
              Rincian Pengeluaran Kasir (tidak dapat diubah/dihapus)
            </div>
            <div className="flex flex-col gap-1 max-h-24 overflow-y-auto text-xs">
              {liveStats.shiftExps.map((e) => (
                <div key={e.id} className="flex justify-between gap-2 text-[#4a4947]">
                  <span className="truncate">{e.keterangan}</span>
                  <span className="font-medium shrink-0">{formatRupiah(e.nominal)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleCloseShift} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#4a4947] mb-1">
              Hitung &amp; Masukkan Uang Fisik di Laci (Rp) *
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={formatRibuanInput(uangFisikStr)}
              onChange={(e) => setUangFisikStr(stripNonDigits(e.target.value))}
              placeholder="Masukkan hasil hitung uang tunai"
              className="w-full h-12 border border-[#d6d3c8] rounded-[10px] px-3.5 text-base font-bold text-[#1f1e1d] focus:outline-none focus:border-[#1F7A5A]"
              autoFocus
            />
          </div>

          {hasInput && (
            <div
              className={`rounded-xl px-3.5 py-2.5 text-xs font-semibold flex justify-between items-center ${
                selisih === 0
                  ? 'bg-[#e4f1ea] text-[#1F7A5A] border border-[#c5dfd1]'
                  : selisih > 0
                  ? 'bg-[#fbf3e6] text-[#7a4300] border border-[#f0dcb8]'
                  : 'bg-[#fbe4e1] text-[#9b1c12] border border-[#f5c2bc]'
              }`}
            >
              <span>
                {selisih === 0
                  ? 'Kas Laci Pas ✓'
                  : selisih > 0
                  ? 'Selisih Lebih (+)'
                  : 'Selisih Kurang (−)'}
              </span>
              <span className="text-sm font-bold">
                {selisih === 0 ? 'Rp0' : `${selisih > 0 ? '+' : ''}${formatRupiah(selisih)}`}
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#4a4947] mb-1">
              Catatan Tutup Kasir (opsional)
            </label>
            <input
              type="text"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Misal: Uang receh pas / ada selisih kembalian"
              className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-xs"
            />
          </div>

          <button
            type="submit"
            disabled={!canClose}
            className="h-12 rounded-[10px] bg-[#9b1c12] hover:bg-[#7d160e] text-white font-semibold text-[15px] flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Lock size={16} />
            {submitting ? 'Menutup Kasir...' : 'Tutup Kasir & Selesaikan Shift'}
          </button>
        </form>
      </div>
    </div>
  );
};

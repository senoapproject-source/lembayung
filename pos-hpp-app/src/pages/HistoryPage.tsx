import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { voidTransaction } from '../db/actions';
import { formatJam, formatRupiah } from '../lib/calculations';
import { ReceiptModal } from '../components/ReceiptModal';
import type { CashierShift, Transaction, User } from '../types/models';
import { MessageCircle } from 'lucide-react';

interface HistoryPageProps {
  user: User;
  activeShift?: CashierShift;
  onBack: () => void;
}

const VOID_REASONS = [
  'Salah input menu atau jumlah',
  'Pelanggan batal membeli',
  'Lainnya',
];

export const HistoryPage: React.FC<HistoryPageProps> = ({ user, activeShift, onBack }) => {
  const settings = useLiveQuery(() => db.settings.get('global'));
  const transactions = useLiveQuery(() => db.transactions.toArray()) ?? [];
  const [filterDay, setFilterDay] = useState<'today' | 'yesterday' | 'all'>('today');
  const [voidTarget, setVoidTarget] = useState<Transaction | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<Transaction | null>(null);
  const [selectedReason, setSelectedReason] = useState(VOID_REASONS[0]);
  const [customReason, setCustomReason] = useState('');

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayDt = new Date();
  yesterdayDt.setDate(yesterdayDt.getDate() - 1);
  const yesterdayStr = yesterdayDt.toISOString().slice(0, 10);

  const isKasirShiftMode = user.role === 'kasir' && Boolean(activeShift);

  const filtered = useMemo(() => {
    return transactions
      .filter((tx) => {
        if (isKasirShiftMode && activeShift) {
          // Pisahkan ketat antar shift: hanya tampilkan transaksi milik shift aktif ini
          return tx.kasirId === activeShift.kasirId && tx.waktu >= activeShift.waktuBuka;
        }
        if (user.role === 'kasir' && tx.kasirId !== user.id) return false;
        const txDate = tx.waktu.slice(0, 10);
        if (filterDay === 'today') return txDate === todayStr;
        if (filterDay === 'yesterday') return txDate === yesterdayStr;
        return true;
      })
      .sort((a, b) => b.waktu.localeCompare(a.waktu));
  }, [transactions, user, activeShift, isKasirShiftMode, filterDay, todayStr, yesterdayStr]);

  const handleConfirmVoid = async () => {
    if (!voidTarget) return;
    const finalReason =
      selectedReason === 'Lainnya' ? customReason.trim() : selectedReason;
    if (!finalReason) return;
    await voidTransaction(voidTarget.id, finalReason, user);
    setVoidTarget(null);
    setCustomReason('');
  };

  return (
    <div className="px-3.5 sm:px-5 pt-4 sm:pt-5 pb-6 flex flex-col gap-3.5 w-full max-w-full overflow-x-hidden">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div className="min-w-0">
          <h1 className="text-[20px] sm:text-[22px] font-bold">Riwayat</h1>
          <div className="text-xs text-[#6b6a68]">
            {user.role === 'owner' || user.role === 'manager'
              ? 'Kasir: semua · Owner & Manager dapat membatalkan (void) transaksi'
              : isKasirShiftMode && activeShift
              ? `Shift aktif ${user.nama} (sejak ${formatJam(activeShift.waktuBuka)}) · hanya transaksi shift ini`
              : `Riwayat transaksi ${user.nama}`}
          </div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="h-9 px-3 rounded-full border border-[#d6d3c8] bg-white text-xs sm:text-[13px] font-medium whitespace-nowrap shrink-0"
        >
          ‹ Kembali
        </button>
      </div>

      {!isKasirShiftMode && (
        <div className="flex gap-2">
          {(
            [
              ['today', 'Hari ini'],
              ['yesterday', 'Kemarin'],
              ['all', 'Semua'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilterDay(key)}
              className={`h-[34px] px-3.5 rounded-full text-[13px] font-medium border ${
                filterDay === key
                  ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                  : 'bg-white border-[#d6d3c8] text-[#1f1e1d]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.length === 0 ? (
          <div className="col-span-full bg-white border border-[#e2e0d8] rounded-xl p-6 text-center text-xs text-[#6b6a68]">
            Belum ada transaksi pada periode ini.
          </div>
        ) : (
          filtered.map((tx) => {
            const isVoid = tx.status === 'void';
            const itemSummary = tx.items
              .map((i) => `${i.menuNama} ×${i.jumlah}`)
              .join(', ');
            return (
              <div
                key={tx.id}
                className={`border border-[#e2e0d8] rounded-xl p-3.5 transition flex flex-col justify-between ${
                  isVoid ? 'bg-[#fdf7f6]' : 'bg-white'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div
                    className={`font-semibold text-sm ${
                      isVoid ? 'text-[#6b6a68] line-through' : ''
                    }`}
                  >
                    {tx.nomorStruk} · {formatJam(tx.waktu)}
                    {tx.namaPelanggan ? ` · ${tx.namaPelanggan}` : ''}
                  </div>
                  {isVoid ? (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[10px] bg-[#fbe4e1] text-[#9b1c12]">
                      Void
                    </span>
                  ) : (
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-[10px] ${
                        tx.metodeBayar === 'Cash'
                          ? 'bg-[#ece9e0] text-[#4a4947]'
                          : 'bg-[#e4f1ea] text-[#1F7A5A]'
                      }`}
                    >
                      {tx.metodeBayar}
                    </span>
                  )}
                </div>

                <div className="text-xs text-[#6b6a68] mt-1">
                  {itemSummary}
                  {tx.diskonLabel ? ` · ${tx.diskonLabel}` : ''} · {tx.kasirNama}
                </div>

                <div className="flex justify-between items-center mt-2">
                  <span
                    className={`font-semibold text-sm ${
                      isVoid ? 'text-[#6b6a68] line-through' : ''
                    }`}
                  >
                    {formatRupiah(tx.total)}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setReceiptTarget(tx)}
                      className="text-xs font-semibold text-[#1F7A5A] bg-[#e4f1ea] px-2.5 py-1 rounded-lg flex items-center gap-1"
                    >
                      <MessageCircle size={12} /> Struk &amp; WA
                    </button>
                    {(user.role === 'owner' || user.role === 'manager') && !isVoid && (
                      <button
                        type="button"
                        onClick={() => {
                          setVoidTarget(tx);
                          setSelectedReason(VOID_REASONS[0]);
                        }}
                        className="text-xs font-semibold text-[#9b1c12] bg-[#fbe4e1] px-2.5 py-1 rounded-lg"
                      >
                        Void
                      </button>
                    )}
                  </div>
                </div>
                {isVoid && tx.alasanVoid && (
                  <div className="text-[11px] text-[#9b1c12] mt-1">
                    Alasan void: {tx.alasanVoid}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="text-xs text-[#6b6a68] px-0.5">
        Transaksi void tidak dihitung di omzet, laba, arus kas, atau laporan lain.
      </div>

      {/* Modal Struk & Kirim WA */}
      {receiptTarget && (
        <ReceiptModal
          tx={receiptTarget}
          settings={settings}
          onClose={() => setReceiptTarget(null)}
        />
      )}

      {/* Modal Void Transaksi */}
      {voidTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xl">
            <div className="flex justify-between items-center">
              <div className="text-base font-bold">Void transaksi {voidTarget.nomorStruk}</div>
              <span className="text-xs text-[#6b6a68]">Owner</span>
            </div>
            <div className="text-xs text-[#1f1e1d]">
              Alasan wajib diisi dan tercatat di audit trail.
            </div>

            <div className="flex flex-col gap-3">
              {VOID_REASONS.map((reason) => {
                const active = selectedReason === reason;
                return (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setSelectedReason(reason)}
                    className="flex items-center gap-2.5 text-sm text-left"
                  >
                    <span
                      className={`w-[18px] h-[18px] rounded-full shrink-0 box-border ${
                        active ? 'border-[6px] border-[#1F7A5A]' : 'border-2 border-[#b9b5a8]'
                      }`}
                    />
                    <span>{reason === 'Lainnya' ? 'Lainnya (tulis alasan)' : reason}</span>
                  </button>
                );
              })}
              {selectedReason === 'Lainnya' && (
                <input
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Tulis alasan pembatalan..."
                  className="h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                />
              )}
            </div>

            <div className="grid grid-cols-[1fr_1.4fr] gap-2.5 mt-1">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="h-12 rounded-[10px] border border-[#d6d3c8] bg-white text-[#1f1e1d] font-semibold text-[15px]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmVoid}
                disabled={selectedReason === 'Lainnya' && !customReason.trim()}
                className="h-12 rounded-[10px] bg-[#9b1c12] text-white font-semibold text-[15px] disabled:opacity-50"
              >
                Void transaksi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

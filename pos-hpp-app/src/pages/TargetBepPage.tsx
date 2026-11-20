import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { enqueueSync } from '../db/actions';
import {
  calcBepAndPrediction,
  calcFinancialSummary,
  formatPercent,
  formatRibuanInput,
  formatRupiah,
  stripNonDigits,
} from '../lib/calculations';
import { X } from 'lucide-react';

interface TargetBepPageProps {
  onBack: () => void;
}

export const TargetBepPage: React.FC<TargetBepPageProps> = ({ onBack }) => {
  const settings = useLiveQuery(() => db.settings.get('global'));
  const transactions = useLiveQuery(() => db.transactions.toArray()) ?? [];
  const expenses = useLiveQuery(() => db.expenses.toArray()) ?? [];
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? [];

  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const monthLabel = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const sisaHari = Math.max(0, daysInMonth - now.getDate());

  const target = useLiveQuery(() => db.monthlyTargets.get(currentMonth), [currentMonth]);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editOmzet, setEditOmzet] = useState('');
  const [editLaba, setEditLaba] = useState('');

  const { summary, pred, targetOmzet, targetLaba } = useMemo(() => {
    const monthTx = transactions.filter((t) => t.waktu.startsWith(currentMonth));
    const monthExp = expenses.filter((e) => e.tanggal.startsWith(currentMonth));
    const sum = calcFinancialSummary(monthTx, monthExp, categories);

    // Hitung rata-rata harian 7 hari terakhir (FR-TGT-04)
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const startStr = sevenDaysAgo.toISOString().slice(0, 10);
    const todayStr = now.toISOString().slice(0, 10);

    const recentValidTx = transactions.filter((t) => {
      const d = t.waktu.slice(0, 10);
      return t.status !== 'void' && d >= startStr && d <= todayStr;
    });

    const uniqueDays = new Set(recentValidTx.map((t) => t.waktu.slice(0, 10)));
    const hariData = uniqueDays.size;
    const totalRecent = recentValidTx.reduce((s, t) => s + t.total, 0);
    const avgDaily = hariData > 0 ? totalRecent / hariData : 0;

    const tOmzet = target?.targetOmzet ?? 20000000;
    const tLaba = target?.targetLaba ?? 6000000;

    const prediction = calcBepAndPrediction({
      omzetBerjalan: sum.omzet,
      targetOmzet: tOmzet,
      biayaTetapBulanan: sum.biayaTetap,
      biayaOperasionalBerjalan: sum.biayaOperasional,
      rataRataMarginKotorPersen: sum.rataRataMarginKotorPersen,
      rataRataOmzetHarian: avgDaily,
      sisaHari,
      hariDataTersedia: hariData,
      ambangMepetBepPersen: settings?.ambangMepetBepPersen ?? 10,
    });

    return { summary: sum, pred: prediction, targetOmzet: tOmzet, targetLaba: tLaba };
  }, [transactions, expenses, categories, currentMonth, target, sisaHari, settings, now]);

  const omzetPct = targetOmzet > 0 ? Math.min(100, Math.round((summary.omzet / targetOmzet) * 100)) : 0;
  const labaPct = targetLaba > 0 ? Math.min(100, Math.max(0, Math.round((summary.labaBersih / targetLaba) * 100))) : 0;

  const openEdit = () => {
    setEditOmzet(String(targetOmzet));
    setEditLaba(String(targetLaba));
    setShowEditModal(true);
  };

  const handleSaveTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      bulan: currentMonth,
      targetOmzet: Math.max(0, Number(editOmzet) || 0),
      targetLaba: Math.max(0, Number(editLaba) || 0),
    };
    await db.monthlyTargets.put(payload);
    await enqueueSync('master', currentMonth, 'upsert', payload);
    setShowEditModal(false);
  };

  const badgeClass =
    pred.status === 'Untung'
      ? 'bg-[#e4f1ea] text-[#1F7A5A]'
      : pred.status === 'Mepet BEP'
      ? 'bg-[#fbeed9] text-[#7a4300]'
      : 'bg-[#fbe4e1] text-[#9b1c12]';

  return (
    <div className="px-5 pt-5 pb-6 flex flex-col gap-3">
      <div className="flex justify-between items-center gap-2">
        <div>
          <h1 className="text-[22px] font-bold">Target &amp; BEP</h1>
          <div className="text-xs text-[#6b6a68]">
            {monthLabel} · sisa {sisaHari} hari
          </div>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onBack}
            className="h-9 px-3 rounded-full border border-[#d6d3c8] bg-white text-[13px] font-medium"
          >
            ‹ Laporan
          </button>
          <button
            type="button"
            onClick={openEdit}
            className="h-9 px-3 rounded-full border border-[#d6d3c8] bg-white text-[13px] font-medium"
          >
            Ubah target
          </button>
        </div>
      </div>

      {/* Grid 2 Kolom di Tablet: Target Omzet & Target Laba */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {/* Target Omzet */}
        <div className="bg-white border border-[#e2e0d8] rounded-xl p-4 flex flex-col gap-2.5">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-sm">Target omzet</span>
            <span className="font-bold text-sm">{formatRupiah(targetOmzet)}</span>
          </div>
          <div className="h-2.5 rounded-[5px] bg-[#ece9e0] overflow-hidden">
            <div className="h-full bg-[#1F7A5A]" style={{ width: `${omzetPct}%` }} />
          </div>
          <div className="flex justify-between text-xs text-[#6b6a68]">
            <span>
              Omzet berjalan {formatRupiah(summary.omzet)} ({omzetPct}%)
            </span>
            <span>Sisa {formatRupiah(Math.max(0, targetOmzet - summary.omzet))}</span>
          </div>
          <div className="bg-[#faf9f5] rounded-[10px] px-3 py-2.5 flex justify-between items-center">
            <span className="text-xs text-[#1f1e1d]">Butuh penjualan per hari</span>
            <span className="font-bold text-sm text-[#1F7A5A]">
              {formatRupiah(pred.kebutuhanPerHari)}
            </span>
          </div>
          <div className="text-xs text-[#6b6a68]">
            Rata-rata harian saat ini {formatRupiah(pred.rataRataOmzetHarian)}.
          </div>
        </div>

        {/* Target Laba & Titik Impas (BEP) */}
        <div className="flex flex-col gap-3.5">
          <div className="bg-white border border-[#e2e0d8] rounded-xl p-4 flex flex-col gap-2.5">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-sm">Target laba</span>
              <span className="font-bold text-sm">{formatRupiah(targetLaba)}</span>
            </div>
            <div className="h-2.5 rounded-[5px] bg-[#ece9e0] overflow-hidden">
              <div className="h-full bg-[#1F7A5A]" style={{ width: `${labaPct}%` }} />
            </div>
            <div className="text-xs text-[#6b6a68]">
              Laba berjalan {formatRupiah(summary.labaBersih)} ({labaPct}%)
            </div>
          </div>

          <div className="bg-white border border-[#e2e0d8] rounded-xl p-4 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-sm">Titik impas (BEP)</span>
              <span className="font-bold text-sm">{formatRupiah(pred.bepOmzet)}</span>
            </div>
            {summary.biayaTetap <= 0 ? (
              <div className="text-xs text-[#7a4300] bg-[#fbf3e6] p-2.5 rounded-lg">
                Belum ada pengeluaran yang ditandai sebagai biaya tetap bulanan. Tandai di menu Pengeluaran agar BEP akurat.
              </div>
            ) : (
              <div className="text-xs text-[#6b6a68]">
                Biaya tetap {formatRupiah(summary.biayaTetap)} ÷ rata-rata margin kotor{' '}
                {formatPercent(summary.rataRataMarginKotorPersen)}.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Prediksi Akhir Bulan */}
      <div className="bg-white border border-[#e2e0d8] rounded-xl p-4 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <span className="font-semibold text-sm">Prediksi akhir bulan</span>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-xl ${badgeClass}`}>
            {pred.status}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <div className="text-xs text-[#6b6a68]">Proyeksi omzet</div>
            <div className="font-bold text-base">{formatRupiah(pred.proyeksiOmzet)}</div>
          </div>
          <div>
            <div className="text-xs text-[#6b6a68]">Proyeksi laba</div>
            <div className="font-bold text-base">{formatRupiah(pred.proyeksiLaba)}</div>
          </div>
        </div>
        <div className="text-xs text-[#6b6a68]">
          Selisih terhadap BEP: {pred.selisihBep >= 0 ? '+' : ''}
          {formatRupiah(pred.selisihBep)}. Status “Mepet BEP” jika omzet di bawah BEP ×{' '}
          {(1 + (settings?.ambangMepetBepPersen ?? 10) / 100).toFixed(2).replace('.', ',')}.
        </div>
      </div>

      {/* Catatan Keandalan (FR-TGT-06) */}
      {pred.hariDataTersedia < 7 && (
        <div className="bg-[#fbf3e6] border border-[#f0dcb8] rounded-xl p-3.5 flex flex-col gap-1">
          <div className="font-semibold text-[13px] text-[#7a4300]">Catatan keandalan</div>
          <div className="text-xs text-[#7a4300]">
            Prediksi kurang andal, baru tersedia {pred.hariDataTersedia} hari data transaksi (minimal 7 hari untuk proyeksi stabil).
          </div>
        </div>
      )}

      {/* Modal Ubah Target */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xl">
            <div className="flex justify-between items-center">
              <div className="text-base font-bold">Ubah Target {monthLabel}</div>
              <button type="button" onClick={() => setShowEditModal(false)}>
                <X size={20} className="text-[#6b6a68]" />
              </button>
            </div>
            <form onSubmit={handleSaveTarget} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">Target Omzet (Rp)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatRibuanInput(editOmzet)}
                  onChange={(e) => setEditOmzet(stripNonDigits(e.target.value))}
                  className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">Target Laba Bersih (Rp)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatRibuanInput(editLaba)}
                  onChange={(e) => setEditLaba(stripNonDigits(e.target.value))}
                  className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                  required
                />
              </div>
              <button
                type="submit"
                className="h-12 rounded-[10px] bg-[#1F7A5A] text-white font-semibold text-[15px]"
              >
                Simpan Target
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import {
  calcFinancialSummary,
  formatJam,
  formatPercent,
  formatRupiah,
  formatRupiahCompact,
  formatTanggalPendek,
} from '../lib/calculations';
import { Banknote, ChevronRight, Clock, Landmark, Mail, QrCode, Target } from 'lucide-react';
import { sendPeriodicSummaryEmailToOwner } from '../services/authEmailService';
import { syncWithCloud } from '../services/syncService';

interface ReportsPageProps {
  onOpenExpenses: () => void;
  onOpenHistory: () => void;
  onOpenTargetBep: () => void;
}

type PeriodFilter = 'today' | '7days' | 'this_month' | 'last_month';

const PIE_COLORS = ['#1F7A5A', '#E9A23B', '#3F5A73', '#A39E93', '#7A4300', '#9B1C12'];

function buildConicGradient(items: Array<{ pct: number; color: string }>): string {
  if (items.length === 0) return '#ece9e0';
  let acc = 0;
  const stops = items.map((it) => {
    const start = acc;
    acc += it.pct;
    return `${it.color} ${start.toFixed(1)}% ${acc.toFixed(1)}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  onOpenExpenses,
  onOpenHistory,
  onOpenTargetBep,
}) => {
  const transactions = useLiveQuery(() => db.transactions.toArray()) ?? [];
  const expenses = useLiveQuery(() => db.expenses.toArray()) ?? [];
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? [];
  const cashierShifts = useLiveQuery(() => db.cashierShifts.toArray()) ?? [];

  const [period, setPeriod] = useState<PeriodFilter>('this_month');
  const [incomeChartMode, setIncomeChartMode] = useState<'metode' | 'menu'>('metode');
  const [emailSending, setEmailSending] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const { filteredTx, filteredExp, filteredShifts, periodLabel } = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const thisMonth = todayStr.slice(0, 7);

    const lastMonthDt = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = lastMonthDt.toISOString().slice(0, 7);

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const sevenDaysStr = sevenDaysAgo.toISOString().slice(0, 10);

    const matchDate = (dateStr: string) => {
      if (period === 'today') return dateStr === todayStr;
      if (period === '7days') return dateStr >= sevenDaysStr && dateStr <= todayStr;
      if (period === 'this_month') return dateStr.startsWith(thisMonth);
      return dateStr.startsWith(lastMonth);
    };

    const labels: Record<PeriodFilter, string> = {
      today: 'Hari ini',
      '7days': '7 hari terakhir',
      this_month: now.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' }),
      last_month: lastMonthDt.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' }),
    };

    return {
      filteredTx: transactions.filter((t) => matchDate(t.waktu.slice(0, 10))),
      filteredExp: expenses.filter((e) => matchDate(e.tanggal)),
      filteredShifts: cashierShifts
        .filter((s) => matchDate(s.waktuBuka.slice(0, 10)))
        .sort((a, b) => b.waktuBuka.localeCompare(a.waktuBuka)),
      periodLabel: labels[period],
    };
  }, [transactions, expenses, cashierShifts, period]);

  const shiftSummary = useMemo(() => {
    let totalModalAwal = 0;
    let totalCashShift = 0;
    let totalPengeluaranKasir = 0;
    let totalUangFisik = 0;
    let totalSelisih = 0;
    let closedCount = 0;
    for (const s of filteredShifts) {
      totalModalAwal += s.modalAwal;
      totalCashShift += s.pendapatanCash;
      totalPengeluaranKasir += s.pengeluaranKasir;
      if (s.status === 'closed') {
        closedCount += 1;
        totalUangFisik += s.uangFisikAkhir ?? 0;
        totalSelisih += s.selisih ?? 0;
      }
    }
    return {
      totalShifts: filteredShifts.length,
      closedCount,
      totalModalAwal,
      totalCashShift,
      totalPengeluaranKasir,
      totalUangFisik,
      totalSelisih,
    };
  }, [filteredShifts]);

  const summary = useMemo(
    () => calcFinancialSummary(filteredTx, filteredExp, categories),
    [filteredTx, filteredExp, categories]
  );

  // Rincian Pembayaran per Metode (Cash, QRIS, Transfer) untuk cocokkan laci kas & rekening
  const paymentMethodStats = useMemo(() => {
    const validTx = filteredTx.filter((t) => t.status !== 'void');
    const base: Record<'Cash' | 'QRIS' | 'Transfer', { total: number; count: number }> = {
      Cash: { total: 0, count: 0 },
      QRIS: { total: 0, count: 0 },
      Transfer: { total: 0, count: 0 },
    };
    for (const tx of validTx) {
      const key = (tx.metodeBayar in base ? tx.metodeBayar : 'Cash') as 'Cash' | 'QRIS' | 'Transfer';
      base[key].total += tx.total;
      base[key].count += 1;
    }
    const grand = base.Cash.total + base.QRIS.total + base.Transfer.total;
    return [
      {
        method: 'Cash' as const,
        label: 'Tunai (Cash)',
        total: base.Cash.total,
        count: base.Cash.count,
        pct: grand > 0 ? Math.round((base.Cash.total / grand) * 100) : 0,
        color: '#1F7A5A',
      },
      {
        method: 'QRIS' as const,
        label: 'QRIS',
        total: base.QRIS.total,
        count: base.QRIS.count,
        pct: grand > 0 ? Math.round((base.QRIS.total / grand) * 100) : 0,
        color: '#E9A23B',
      },
      {
        method: 'Transfer' as const,
        label: 'Transfer Bank',
        total: base.Transfer.total,
        count: base.Transfer.count,
        pct: grand > 0 ? Math.round((base.Transfer.total / grand) * 100) : 0,
        color: '#3F5A73',
      },
    ];
  }, [filteredTx]);

  // Pie Chart Pengeluaran per Kategori
  const expenseSlices = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filteredExp) {
      if (e.dibatalkan) continue;
      map.set(e.categoryNama, (map.get(e.categoryNama) ?? 0) + e.nominal);
    }
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
    if (total <= 0) return [];
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value], idx) => ({
        name,
        value,
        pct: Math.round((value / total) * 100),
        color: PIE_COLORS[idx % PIE_COLORS.length],
      }));
  }, [filteredExp]);

  // Pie Chart Pemasukan per Metode atau per Menu
  const incomeSlices = useMemo(() => {
    const validTx = filteredTx.filter((t) => t.status !== 'void');
    const map = new Map<string, number>();
    if (incomeChartMode === 'metode') {
      for (const tx of validTx) {
        map.set(tx.metodeBayar, (map.get(tx.metodeBayar) ?? 0) + tx.total);
      }
    } else {
      for (const tx of validTx) {
        for (const it of tx.items) {
          map.set(it.menuNama, (map.get(it.menuNama) ?? 0) + it.hargaJual * it.jumlah);
        }
      }
    }
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
    if (total <= 0) return [];
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, value], idx) => ({
        name,
        value,
        pct: Math.round((value / total) * 100),
        color: PIE_COLORS[idx % PIE_COLORS.length],
      }));
  }, [filteredTx, incomeChartMode]);

  // Produk Terlaris & Teruntung (FR-RPT-03 & FR-RPT-04)
  const { topSold, topProfit } = useMemo(() => {
    const map = new Map<string, { nama: string; qty: number; profit: number; revenue: number }>();
    for (const tx of filteredTx) {
      if (tx.status === 'void') continue;
      for (const it of tx.items) {
        const cur = map.get(it.menuId) ?? { nama: it.menuNama, qty: 0, profit: 0, revenue: 0 };
        cur.qty += it.jumlah;
        cur.profit += (it.hargaJual - it.snapshotHpp) * it.jumlah;
        cur.revenue += it.hargaJual * it.jumlah;
        map.set(it.menuId, cur);
      }
    }
    const arr = Array.from(map.values());
    return {
      topSold: [...arr].sort((a, b) => b.qty - a.qty).slice(0, 4),
      topProfit: [...arr].sort((a, b) => b.profit - a.profit).slice(0, 4),
    };
  }, [filteredTx]);

  const handleExportCsv = () => {
    const rows = [
      ['Periode', periodLabel],
      ['Omzet', summary.omzet],
      ['Jumlah Transaksi', summary.jumlahTransaksi],
      ['HPP Terjual', summary.hppTerjual],
      ['Laba Kotor', summary.labaKotor],
      ['Biaya Operasional (di luar HPP)', summary.biayaOperasional],
      ['Laba Bersih', summary.labaBersih],
      ['Total Pengeluaran (termasuk Bahan Baku)', summary.totalPengeluaran],
      ['Arus Kas', summary.arusKas],
      ...paymentMethodStats.map((pm) => [
        `Pembayaran ${pm.label} (${pm.count} trx)`,
        pm.total,
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-pos-hpp-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendSummaryEmail = async () => {
    setEmailSending(true);
    setEmailFeedback(null);
    try {
      // Pastikan data terbaru sudah naik ke Cloud dulu sebelum server menghitung ringkasan
      if (navigator.onLine) {
        await syncWithCloud().catch(() => {});
      }
      const now = new Date();
      const emailPeriod: 'daily' | 'monthly' = period === 'today' ? 'daily' : 'monthly';
      let dateStr: string | undefined;
      if (period === 'today') {
        dateStr = now.toISOString().slice(0, 10);
      } else if (period === 'last_month') {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        dateStr = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}`;
      } else {
        dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      }

      const res = await sendPeriodicSummaryEmailToOwner(emailPeriod, dateStr);
      if (res.success) {
        setEmailFeedback({ ok: true, text: res.message || 'Ringkasan laporan dikirim ke email Owner.' });
      } else {
        setEmailFeedback({ ok: false, text: res.error || 'Gagal mengirim ringkasan ke email.' });
      }
    } finally {
      setEmailSending(false);
    }
  };

  const maxBar = Math.max(summary.omzet, summary.totalPengeluaran, 1);

  return (
    <div className="px-3.5 sm:px-5 pt-4 sm:pt-5 pb-6 flex flex-col gap-3 w-full max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <h1 className="text-[20px] sm:text-[22px] font-bold">Laporan</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenTargetBep}
            className="h-9 px-2.5 sm:px-3 rounded-full bg-[#e4f1ea] text-[#1F7A5A] text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
          >
            <Target size={14} /> Target &amp; BEP
          </button>
          <button
            type="button"
            disabled={emailSending}
            onClick={handleSendSummaryEmail}
            className="h-9 px-2.5 sm:px-3 rounded-full border border-[#d6d3c8] text-[#1F7A5A] bg-white text-xs font-semibold flex items-center gap-1 disabled:opacity-50 whitespace-nowrap"
          >
            <Mail size={13} /> {emailSending ? 'Mengirim...' : 'Kirim Email'}
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="h-9 px-2.5 sm:px-3 rounded-full border border-[#d6d3c8] text-[#1f1e1d] bg-white text-xs font-medium whitespace-nowrap"
          >
            Ekspor
          </button>
        </div>
      </div>

      {emailFeedback && (
        <div
          className={`text-xs font-medium px-3 py-2 rounded-xl ${
            emailFeedback.ok
              ? 'bg-[#e4f1ea] text-[#14532d]'
              : 'bg-[#fbe4e1] text-[#9b1c12]'
          }`}
        >
          {emailFeedback.text}
        </div>
      )}

      {/* Filter Periode (FR-RPT-08) */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {(
          [
            ['today', 'Hari ini'],
            ['7days', '7 hari'],
            ['this_month', 'Bulan ini'],
            ['last_month', 'Bulan lalu'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setPeriod(k)}
            className={`h-[34px] px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap border ${
              period === k
                ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                : 'bg-white border-[#d6d3c8] text-[#1f1e1d]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Ringkasan Metrik Utama: 2 kolom di HP, 4 kolom di Tablet/Desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#e4f1ea] border border-[#c5dfd1] rounded-xl p-3.5">
          <div className="text-xs text-[#1f4d3a]">Laba Bersih</div>
          <div className="text-lg font-bold text-[#1F7A5A] mt-0.5">
            {formatRupiah(summary.labaBersih)}
          </div>
          <div className="text-[11px] text-[#1f4d3a] mt-1">
            Omzet − HPP − Biaya Ops
          </div>
        </div>
        <div className="bg-white border border-[#e2e0d8] rounded-xl p-3.5">
          <div className="text-xs text-[#6b6a68]">Arus Kas</div>
          <div className="text-lg font-bold text-[#1f1e1d] mt-0.5">
            {formatRupiah(summary.arusKas)}
          </div>
          <div className="text-[11px] text-[#6b6a68] mt-1">
            Pemasukan − Semua Keluar
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenHistory}
          className="text-left bg-white border border-[#e2e0d8] hover:border-[#1F7A5A] rounded-xl p-3.5 transition"
        >
          <div className="text-xs text-[#6b6a68] flex items-center justify-between">
            <span>Pemasukan (Omzet)</span>
            <ChevronRight size={13} />
          </div>
          <div className="text-lg font-bold text-[#1f1e1d] mt-0.5">
            {formatRupiah(summary.omzet)}
          </div>
          <div className="text-[11px] text-[#6b6a68] mt-1">
            {summary.jumlahTransaksi} transaksi selesai
          </div>
        </button>
        <button
          type="button"
          onClick={onOpenExpenses}
          className="text-left bg-white border border-[#e2e0d8] hover:border-[#1F7A5A] rounded-xl p-3.5 transition"
        >
          <div className="text-xs text-[#6b6a68] flex items-center justify-between">
            <span>Total Pengeluaran</span>
            <ChevronRight size={13} />
          </div>
          <div className="text-lg font-bold text-[#1f1e1d] mt-0.5">
            {formatRupiah(summary.totalPengeluaran)}
          </div>
          <div className="text-[11px] text-[#6b6a68] mt-1">
            Biaya ops: {formatRupiah(summary.biayaOperasional)}
          </div>
        </button>
      </div>

      {/* Rincian Pembayaran per Metode (Cash, QRIS, Transfer) */}
      <div className="bg-white border border-[#e2e0d8] rounded-xl p-4 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <div>
            <div className="font-semibold text-sm">Pembayaran per Metode</div>
            <div className="text-xs text-[#6b6a68]">
              Rincian pemasukan {periodLabel} untuk pencocokan kas &amp; rekening
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenHistory}
            className="text-xs font-semibold text-[#1F7A5A] hover:underline shrink-0"
          >
            Riwayat ›
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {paymentMethodStats.map((pm) => (
            <div
              key={pm.method}
              className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-3 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#4a4947]">
                  {pm.method === 'Cash' ? (
                    <Banknote size={14} className="text-[#1F7A5A] shrink-0" />
                  ) : pm.method === 'QRIS' ? (
                    <QrCode size={14} className="text-[#E9A23B] shrink-0" />
                  ) : (
                    <Landmark size={14} className="text-[#3F5A73] shrink-0" />
                  )}
                  <span>{pm.label}</span>
                </div>
                <span className="text-[11px] font-semibold text-[#6b6a68]">{pm.pct}%</span>
              </div>
              <div className="text-base font-bold text-[#1f1e1d]">
                {formatRupiah(pm.total)}
              </div>
              <div className="h-1.5 rounded-full bg-[#ece9e0] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pm.pct}%`, background: pm.color }}
                />
              </div>
              <div className="text-[11px] text-[#6b6a68]">
                {pm.count} transaksi selesai
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rekap Shift Kasir (Buka & Tutup Kasir) */}
      <div className="bg-white border border-[#e2e0d8] rounded-xl p-4 flex flex-col gap-3">
        <div className="flex justify-between items-center gap-2">
          <div>
            <div className="font-semibold text-sm flex items-center gap-1.5">
              <Clock size={15} className="text-[#1F7A5A]" />
              Rekap Shift Kasir (Buka &amp; Tutup Kasir)
            </div>
            <div className="text-xs text-[#6b6a68]">
              {periodLabel} · {shiftSummary.totalShifts} shift ({shiftSummary.closedCount} selesai)
            </div>
          </div>
          {shiftSummary.closedCount > 0 && (
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${
                shiftSummary.totalSelisih === 0
                  ? 'bg-[#e4f1ea] text-[#1F7A5A]'
                  : shiftSummary.totalSelisih > 0
                  ? 'bg-[#fbf3e6] text-[#7a4300]'
                  : 'bg-[#fbe4e1] text-[#9b1c12]'
              }`}
            >
              Total Selisih:{' '}
              {shiftSummary.totalSelisih === 0
                ? 'Pas (Rp0)'
                : `${shiftSummary.totalSelisih > 0 ? '+' : ''}${formatRupiah(shiftSummary.totalSelisih)}`}
            </span>
          )}
        </div>

        {filteredShifts.length === 0 ? (
          <div className="text-xs text-[#6b6a68] py-2">
            Belum ada data buka/tutup kasir pada periode ini.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-lg p-2.5">
                <div className="text-[11px] text-[#6b6a68]">Total Modal Awal</div>
                <div className="font-bold text-sm mt-0.5">{formatRupiah(shiftSummary.totalModalAwal)}</div>
              </div>
              <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-lg p-2.5">
                <div className="text-[11px] text-[#6b6a68]">Cash Masuk Shift</div>
                <div className="font-bold text-sm text-[#1F7A5A] mt-0.5">
                  {formatRupiah(shiftSummary.totalCashShift)}
                </div>
              </div>
              <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-lg p-2.5">
                <div className="text-[11px] text-[#6b6a68]">Pengeluaran Kasir</div>
                <div className="font-bold text-sm text-[#9b1c12] mt-0.5">
                  {formatRupiah(shiftSummary.totalPengeluaranKasir)}
                </div>
              </div>
              <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-lg p-2.5">
                <div className="text-[11px] text-[#6b6a68]">Uang Fisik Tutup</div>
                <div className="font-bold text-sm mt-0.5">{formatRupiah(shiftSummary.totalUangFisik)}</div>
              </div>
            </div>

            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-0.5">
              {filteredShifts.map((s) => (
                <div
                  key={s.id}
                  className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-3 flex flex-col gap-1.5 text-xs"
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="font-semibold text-sm text-[#1f1e1d]">
                      {s.kasirNama}{' '}
                      <span className="text-[11px] font-normal text-[#6b6a68]">
                        · {formatTanggalPendek(s.waktuBuka)} {formatJam(s.waktuBuka)}
                        {s.waktuTutup ? ` – ${formatJam(s.waktuTutup)}` : ''}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                        s.status === 'open'
                          ? 'bg-[#e4f1ea] text-[#1F7A5A]'
                          : (s.selisih ?? 0) === 0
                          ? 'bg-[#e4f1ea] text-[#1F7A5A]'
                          : (s.selisih ?? 0) > 0
                          ? 'bg-[#fbf3e6] text-[#7a4300]'
                          : 'bg-[#fbe4e1] text-[#9b1c12]'
                      }`}
                    >
                      {s.status === 'open'
                        ? 'Sedang Aktif'
                        : (s.selisih ?? 0) === 0
                        ? 'Pas ✓'
                        : `Selisih ${(s.selisih ?? 0) > 0 ? '+' : ''}${formatRupiah(s.selisih ?? 0)}`}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px] text-[#4a4947]">
                    <div>Modal: <strong>{formatRupiah(s.modalAwal)}</strong></div>
                    <div>Cash: <strong className="text-[#1F7A5A]">{formatRupiah(s.pendapatanCash)}</strong></div>
                    <div>Keluar: <strong className="text-[#9b1c12]">{formatRupiah(s.pengeluaranKasir)}</strong></div>
                    <div>
                      {s.status === 'closed'
                        ? <>Fisik: <strong>{formatRupiah(s.uangFisikAkhir ?? 0)}</strong></>
                        : <>Est. Laci: <strong>{formatRupiah(s.expectedCash)}</strong></>}
                    </div>
                  </div>
                  {s.catatan && (
                    <div className="text-[11px] text-[#6b6a68] italic">Catatan: {s.catatan}</div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Grid 2 Kolom di Tablet: Pemasukan vs Pengeluaran + Terlaris/Teruntung */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {/* Pemasukan vs Pengeluaran (Klik untuk buka detail Riwayat / Pengeluaran) */}
        <div className="bg-white border border-[#e2e0d8] rounded-xl p-4 flex flex-col justify-between gap-2.5">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-sm">Pemasukan vs pengeluaran</span>
            <span className="text-xs text-[#6b6a68]">
              {periodLabel} · {summary.jumlahTransaksi} trx
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenHistory}
            className="w-full text-left group flex flex-col gap-1.5 py-0.5"
          >
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#6b6a68] group-hover:text-[#1F7A5A] flex items-center gap-0.5">
                Pemasukan (Omzet) <ChevronRight size={13} />
              </span>
              <span className="font-semibold text-sm text-[#1f1e1d]">
                {formatRupiah(summary.omzet)}
              </span>
            </div>
            <div className="h-2.5 rounded bg-[#ece9e0] overflow-hidden">
              <div
                className="h-full bg-[#1F7A5A]"
                style={{ width: `${summary.omzet > 0 ? Math.round((summary.omzet / maxBar) * 100) : 0}%` }}
              />
            </div>
          </button>

          <button
            type="button"
            onClick={onOpenExpenses}
            className="w-full text-left group flex flex-col gap-1.5 py-0.5"
          >
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#6b6a68] group-hover:text-[#1F7A5A] flex items-center gap-0.5">
                Pengeluaran (Total) <ChevronRight size={13} />
              </span>
              <span className="font-semibold text-sm text-[#1f1e1d]">
                {formatRupiah(summary.totalPengeluaran)}
              </span>
            </div>
            <div className="h-2.5 rounded bg-[#ece9e0] overflow-hidden">
              <div
                className="h-full bg-[#E9A23B]"
                style={{
                  width: `${
                    summary.totalPengeluaran > 0
                      ? Math.round((summary.totalPengeluaran / maxBar) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </button>
        </div>

        {/* Terlaris & Teruntung */}
        <div className="bg-white border border-[#e2e0d8] rounded-xl p-4 flex flex-col justify-between gap-2.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="font-semibold text-sm">Terlaris</div>
              <div className="text-xs text-[#6b6a68]">urut jumlah terjual</div>
            </div>
            <div>
              <div className="font-semibold text-sm">Teruntung</div>
              <div className="text-xs text-[#6b6a68]">urut total laba</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div className="flex flex-col gap-1.5">
              {topSold.length === 0 ? (
                <span className="text-xs text-[#6b6a68]">Belum ada data</span>
              ) : (
                topSold.map((it) => (
                  <div key={it.nama} className="flex justify-between gap-2">
                    <span className="truncate">{it.nama}</span>
                    <span className="font-semibold text-[#1F7A5A] shrink-0">{it.qty}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {topProfit.length === 0 ? (
                <span className="text-xs text-[#6b6a68]">Belum ada data</span>
              ) : (
                topProfit.map((it) => (
                  <div key={it.nama} className="flex justify-between gap-2">
                    <span className="truncate">{it.nama}</span>
                    <span className="font-semibold text-[#1F7A5A] shrink-0">
                      {formatRupiahCompact(it.profit)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="text-xs text-[#6b6a68]">
            Rata-rata margin kotor periode ini: {formatPercent(summary.rataRataMarginKotorPersen)}.
          </div>
        </div>
      </div>

      {/* Grid 2 Kolom di Tablet: Pie Chart Pengeluaran & Pie Chart Pemasukan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {/* Pie Chart Pengeluaran per Kategori */}
        <div className="bg-white border border-[#e2e0d8] rounded-xl p-4 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-sm">Pengeluaran per kategori</span>
            <button
              type="button"
              onClick={onOpenExpenses}
              className="text-xs font-semibold text-[#1F7A5A] hover:underline"
            >
              + Catat / Detail ›
            </button>
          </div>
          {expenseSlices.length > 0 ? (
            <div className="flex items-center gap-4">
              <div
                className="w-28 h-28 rounded-full shrink-0"
                style={{ background: buildConicGradient(expenseSlices) }}
              />
              <div className="flex flex-col gap-1.5 text-[13px] min-w-0">
                {expenseSlices.map((s) => (
                  <div key={s.name} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                      style={{ background: s.color }}
                    />
                    <span className="truncate">
                      {s.name} {s.pct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-[#6b6a68] py-4">Belum ada pengeluaran pada periode ini.</div>
          )}
        </div>

        {/* Pie Chart Pemasukan per Metode / Menu */}
        <div className="bg-white border border-[#e2e0d8] rounded-xl p-4 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-sm">
              Pemasukan per {incomeChartMode === 'metode' ? 'metode' : 'menu'}
            </span>
            <div className="flex bg-[#ece9e0] rounded-lg p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setIncomeChartMode('metode')}
                className={`px-2 py-1 rounded-md ${
                  incomeChartMode === 'metode'
                    ? 'bg-white font-semibold text-[#1F7A5A]'
                    : 'text-[#4a4947]'
                }`}
              >
                Metode
              </button>
              <button
                type="button"
                onClick={() => setIncomeChartMode('menu')}
                className={`px-2 py-1 rounded-md ${
                  incomeChartMode === 'menu'
                    ? 'bg-white font-semibold text-[#1F7A5A]'
                    : 'text-[#4a4947]'
                }`}
              >
                Menu
              </button>
            </div>
          </div>
          {incomeSlices.length > 0 ? (
            <div className="flex items-center gap-4">
              <div
                className="w-28 h-28 rounded-full shrink-0"
                style={{ background: buildConicGradient(incomeSlices) }}
              />
              <div className="flex flex-col gap-1.5 text-[13px] min-w-0 flex-1">
                {incomeSlices.map((s) => (
                  <div key={s.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                        style={{ background: s.color }}
                      />
                      <span className="truncate">{s.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-[#4a4947] shrink-0">
                      {formatRupiah(s.value)} ({s.pct}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-[#6b6a68] py-4">Belum ada penjualan pada periode ini.</div>
          )}
        </div>
      </div>
    </div>
  );
};

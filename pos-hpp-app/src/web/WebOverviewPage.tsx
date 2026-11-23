import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { db } from '../db/database';
import {
  calcFinancialSummary,
  formatJam,
  formatPercent,
  formatRupiah,
  formatRupiahCompact,
  formatTanggalPendek,
} from '../lib/calculations';
import {
  fetchAllBranchesPerformance,
  type BranchPerformanceRow,
} from '../services/branchService';
import type { BranchInfo } from '../types/models';
import {
  ArrowRight,
  Banknote,
  Building2,
  Clock,
  Landmark,
  QrCode,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';

interface WebOverviewPageProps {
  dateFrom: string;
  dateTo: string;
  isAllBranches: boolean;
  branches: BranchInfo[];
  onSelectBranch: (outletId: string) => void;
  onNavigate: (tab: 'sales' | 'expenses' | 'recipes' | 'ingredients' | 'target' | 'branches') => void;
}

export const WebOverviewPage: React.FC<WebOverviewPageProps> = ({
  dateFrom,
  dateTo,
  isAllBranches,
  branches,
  onSelectBranch,
  onNavigate,
}) => {
  const transactions = useLiveQuery(() => db.transactions.toArray()) ?? [];
  const expenses = useLiveQuery(() => db.expenses.toArray()) ?? [];
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? [];
  const cashierShifts = useLiveQuery(() => db.cashierShifts.toArray()) ?? [];

  const [allBranchStats, setAllBranchStats] = useState<BranchPerformanceRow[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);

  useEffect(() => {
    if (!isAllBranches) return;
    let active = true;
    setLoadingAll(true);
    fetchAllBranchesPerformance(branches, dateFrom, dateTo)
      .then((rows) => {
        if (active) setAllBranchStats(rows);
      })
      .finally(() => {
        if (active) setLoadingAll(false);
      });
    return () => {
      active = false;
    };
  }, [isAllBranches, branches, dateFrom, dateTo]);

  // Filter single branch data by date range
  const { filteredTx, filteredExp, filteredShifts } = useMemo(() => {
    return {
      filteredTx: transactions.filter((t) => {
        const d = t.waktu.slice(0, 10);
        return d >= dateFrom && d <= dateTo;
      }),
      filteredExp: expenses.filter((e) => e.tanggal >= dateFrom && e.tanggal <= dateTo),
      filteredShifts: cashierShifts
        .filter((s) => {
          const d = s.waktuBuka.slice(0, 10);
          return d >= dateFrom && d <= dateTo;
        })
        .sort((a, b) => b.waktuBuka.localeCompare(a.waktuBuka)),
    };
  }, [transactions, expenses, cashierShifts, dateFrom, dateTo]);

  const summary = useMemo(
    () => calcFinancialSummary(filteredTx, filteredExp, categories),
    [filteredTx, filteredExp, categories]
  );

  // Daily trend chart data
  const dailyTrend = useMemo(() => {
    const map = new Map<string, { tanggal: string; omzet: number; hpp: number; pengeluaran: number }>();
    for (const tx of filteredTx) {
      if (tx.status === 'void') continue;
      const d = tx.waktu.slice(0, 10);
      const cur = map.get(d) || { tanggal: d, omzet: 0, hpp: 0, pengeluaran: 0 };
      cur.omzet += tx.total;
      for (const it of tx.items) {
        cur.hpp += it.snapshotHpp * it.jumlah;
      }
      map.set(d, cur);
    }
    for (const exp of filteredExp) {
      if (exp.dibatalkan) continue;
      const d = exp.tanggal;
      const cur = map.get(d) || { tanggal: d, omzet: 0, hpp: 0, pengeluaran: 0 };
      cur.pengeluaran += exp.nominal;
      map.set(d, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => a.tanggal.localeCompare(b.tanggal))
      .map((r) => ({
        ...r,
        label: r.tanggal.slice(5), // MM-DD
      }));
  }, [filteredTx, filteredExp]);

  // Payment methods breakdown
  const paymentBreakdown = useMemo(() => {
    const base = { Cash: { total: 0, count: 0 }, QRIS: { total: 0, count: 0 }, Transfer: { total: 0, count: 0 } };
    let grand = 0;
    for (const tx of filteredTx) {
      if (tx.status === 'void') continue;
      base[tx.metodeBayar].total += tx.total;
      base[tx.metodeBayar].count += 1;
      grand += tx.total;
    }
    return (['Cash', 'QRIS', 'Transfer'] as const).map((m) => ({
      method: m,
      total: base[m].total,
      count: base[m].count,
      pct: grand > 0 ? (base[m].total / grand) * 100 : 0,
    }));
  }, [filteredTx]);

  // Top profitable & selling menus
  const topMenus = useMemo(() => {
    const map = new Map<
      string,
      { nama: string; qty: number; omzet: number; hpp: number; laba: number }
    >();
    for (const tx of filteredTx) {
      if (tx.status === 'void') continue;
      for (const it of tx.items) {
        const cur = map.get(it.menuNama) || { nama: it.menuNama, qty: 0, omzet: 0, hpp: 0, laba: 0 };
        const rev = it.hargaJual * it.jumlah;
        const cost = it.snapshotHpp * it.jumlah;
        cur.qty += it.jumlah;
        cur.omzet += rev;
        cur.hpp += cost;
        cur.laba += rev - cost;
        map.set(it.menuNama, cur);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.omzet - a.omzet)
      .slice(0, 10);
  }, [filteredTx]);

  // ============================================================================
  // MODE GABUNGAN: SEMUA CABANG (KHUSUS OWNER)
  // ============================================================================
  if (isAllBranches) {
    const totals = allBranchStats.reduce(
      (acc, r) => ({
        omzet: acc.omzet + r.omzet,
        hpp: acc.hpp + r.hppTerjual,
        labaKotor: acc.labaKotor + r.labaKotor,
        biayaOps: acc.biayaOps + r.biayaOperasional,
        labaBersih: acc.labaBersih + r.labaBersih,
        trx: acc.trx + r.jumlahTransaksi,
        selisih: acc.selisih + r.totalSelisihKas,
      }),
      { omzet: 0, hpp: 0, labaKotor: 0, biayaOps: 0, labaBersih: 0, trx: 0, selisih: 0 }
    );

    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#1f1e1d] flex items-center gap-2">
              <Building2 size={20} className="text-[#1F7A5A]" /> Ringkasan Gabungan ({branches.length} Cabang)
            </h2>
            <p className="text-xs text-[#6b6a68] mt-0.5">
              Periode {dateFrom} s/d {dateTo} · Perbandingan performa seluruh cabang secara real-time
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('branches')}
            className="h-9 px-3.5 rounded-xl bg-[#1F7A5A] text-white text-xs font-semibold flex items-center gap-1.5"
          >
            Kelola Cabang <ArrowRight size={14} />
          </button>
        </div>

        {/* KPI Cards Gabungan */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            title="Total Omzet Semua Cabang"
            value={formatRupiah(totals.omzet)}
            sub={`${totals.trx} transaksi selesai`}
            icon={<TrendingUp size={18} className="text-[#1F7A5A]" />}
          />
          <KpiCard
            title="Laba Kotor Gabungan"
            value={formatRupiah(totals.labaKotor)}
            sub={`HPP: ${formatRupiah(totals.hpp)}`}
            icon={<Receipt size={18} className="text-[#3f5a73]" />}
          />
          <KpiCard
            title="Biaya Operasional (Non-HPP)"
            value={formatRupiah(totals.biayaOps)}
            sub={`Selisih laci kas: ${formatRupiah(totals.selisih)}`}
            icon={<Wallet size={18} className="text-[#c87d1c]" />}
          />
          <KpiCard
            title="Laba Bersih Estimasi"
            value={formatRupiah(totals.labaBersih)}
            sub={`Net margin: ${formatPercent(totals.omzet > 0 ? (totals.labaBersih / totals.omzet) * 100 : 0)}`}
            highlight={totals.labaBersih >= 0 ? 'positive' : 'negative'}
            icon={
              totals.labaBersih >= 0 ? (
                <TrendingUp size={18} className="text-[#1F7A5A]" />
              ) : (
                <TrendingDown size={18} className="text-[#9b1c12]" />
              )
            }
          />
        </div>

        {/* Grafik Perbandingan Cabang */}
        <div className="bg-white border border-[#e2e0d8] rounded-2xl p-5">
          <div className="font-bold text-sm text-[#1f1e1d] mb-4">
            Perbandingan Omzet &amp; Laba Bersih per Cabang
          </div>
          {loadingAll ? (
            <div className="h-[260px] flex items-center justify-center text-xs text-[#6b6a68]">
              Memuat data seluruh cabang...
            </div>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={allBranchStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eeece5" />
                  <XAxis dataKey="namaCabang" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => formatRupiahCompact(Number(v))} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatRupiah(Number(v))} />
                  <Bar dataKey="omzet" name="Omzet" fill="#1F7A5A" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="labaBersih" name="Laba Bersih" fill="#E9A23B" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Tabel Ranking Cabang */}
        <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#eeece5] font-bold text-sm text-[#1f1e1d]">
            Rincian Performa per Cabang
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#faf9f5] text-[#6b6a68] border-b border-[#eeece5]">
                <tr>
                  <th className="py-3 px-4 font-semibold">Cabang</th>
                  <th className="py-3 px-4 font-semibold">ID Outlet</th>
                  <th className="py-3 px-4 font-semibold text-right">Trx</th>
                  <th className="py-3 px-4 font-semibold text-right">Omzet</th>
                  <th className="py-3 px-4 font-semibold text-right">HPP</th>
                  <th className="py-3 px-4 font-semibold text-right">Biaya Ops</th>
                  <th className="py-3 px-4 font-semibold text-right">Laba Bersih</th>
                  <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eeece5]">
                {allBranchStats.map((row) => (
                  <tr key={row.outletId} className="hover:bg-[#faf9f5]">
                    <td className="py-3 px-4 font-semibold text-[#1f1e1d]">
                      {row.namaUsaha} · <span className="text-[#1F7A5A]">{row.namaCabang}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-[#6b6a68]">
                      {row.outletId}
                    </td>
                    <td className="py-3 px-4 text-right">{row.jumlahTransaksi}</td>
                    <td className="py-3 px-4 text-right font-semibold">{formatRupiah(row.omzet)}</td>
                    <td className="py-3 px-4 text-right text-[#6b6a68]">{formatRupiah(row.hppTerjual)}</td>
                    <td className="py-3 px-4 text-right text-[#9b1c12]">{formatRupiah(row.biayaOperasional)}</td>
                    <td
                      className={`py-3 px-4 text-right font-bold ${
                        row.labaBersih >= 0 ? 'text-[#1F7A5A]' : 'text-[#9b1c12]'
                      }`}
                    >
                      {formatRupiah(row.labaBersih)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onSelectBranch(row.outletId)}
                        className="px-2.5 py-1 rounded-lg bg-[#e4f1ea] text-[#1F7A5A] font-semibold hover:bg-[#d2e8dc]"
                      >
                        Buka Detail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // MODE 1 CABANG (EXECUTIVE OVERVIEW LAYAR LEBAR)
  // ============================================================================
  const aov = summary.jumlahTransaksi > 0 ? summary.omzet / summary.jumlahTransaksi : 0;
  const openShifts = cashierShifts.filter((s) => s.status === 'open');

  return (
    <div className="flex flex-col gap-6">
      {/* 6 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        <KpiCard
          title="Total Penjualan"
          value={formatRupiah(summary.omzet)}
          sub={`${summary.jumlahTransaksi} trx · rata-rata ${formatRupiahCompact(aov)}`}
        />
        <KpiCard
          title="Total HPP Terjual"
          value={formatRupiah(summary.hppTerjual)}
          sub={`${formatPercent(summary.omzet > 0 ? (summary.hppTerjual / summary.omzet) * 100 : 0)} dari omzet`}
        />
        <KpiCard
          title="Laba Kotor"
          value={formatRupiah(summary.labaKotor)}
          sub={`Margin ${formatPercent(summary.omzet > 0 ? (summary.labaKotor / summary.omzet) * 100 : 0)}`}
        />
        <KpiCard
          title="Biaya Operasional"
          value={formatRupiah(summary.biayaOperasional)}
          sub={`Total keluar: ${formatRupiahCompact(summary.totalPengeluaran)}`}
        />
        <KpiCard
          title="Laba Bersih"
          value={formatRupiah(summary.labaBersih)}
          sub={`Net ${formatPercent(summary.omzet > 0 ? (summary.labaBersih / summary.omzet) * 100 : 0)}`}
          highlight={summary.labaBersih >= 0 ? 'positive' : 'negative'}
        />
        <KpiCard
          title="Shift Kasir"
          value={`${filteredShifts.length} Shift`}
          sub={openShifts.length > 0 ? `${openShifts.length} sedang buka` : 'Semua shift tertutup'}
        />
      </div>

      {/* Baris Grafik Tren Harian (8 kolom) + Metode Bayar (4 kolom) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 bg-white border border-[#e2e0d8] rounded-2xl p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-sm text-[#1f1e1d]">
                Tren Harian: Penjualan vs HPP vs Pengeluaran
              </div>
              <div className="text-xs text-[#6b6a68]">
                Periode {dateFrom} s/d {dateTo}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('sales')}
              className="text-xs font-semibold text-[#1F7A5A] hover:underline"
            >
              Lihat semua transaksi →
            </button>
          </div>
          {dailyTrend.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-xs text-[#6b6a68]">
              Belum ada data transaksi atau pengeluaran pada rentang tanggal ini.
            </div>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyTrend}>
                  <defs>
                    <linearGradient id="omzetFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1F7A5A" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#1F7A5A" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eeece5" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => formatRupiahCompact(Number(v))} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatRupiah(Number(v))} />
                  <Area
                    type="monotone"
                    dataKey="omzet"
                    name="Penjualan"
                    stroke="#1F7A5A"
                    strokeWidth={2.5}
                    fill="url(#omzetFill)"
                  />
                  <Area
                    type="monotone"
                    dataKey="hpp"
                    name="HPP Terjual"
                    stroke="#E9A23B"
                    strokeWidth={2}
                    fill="transparent"
                  />
                  <Area
                    type="monotone"
                    dataKey="pengeluaran"
                    name="Pengeluaran"
                    stroke="#9B1C12"
                    strokeWidth={2}
                    fill="transparent"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="lg:col-span-4 bg-white border border-[#e2e0d8] rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="font-bold text-sm text-[#1f1e1d]">Komposisi Pembayaran</div>
            <div className="text-xs text-[#6b6a68] mt-0.5">
              Cocokkan uang laci kasir &amp; mutasi rekening
            </div>
            <div className="flex flex-col gap-4 mt-4">
              {paymentBreakdown.map((pm) => (
                <div key={pm.method} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#1f1e1d] flex items-center gap-1.5">
                      {pm.method === 'Cash' && <Banknote size={14} className="text-[#1F7A5A]" />}
                      {pm.method === 'QRIS' && <QrCode size={14} className="text-[#c87d1c]" />}
                      {pm.method === 'Transfer' && <Landmark size={14} className="text-[#3f5a73]" />}
                      {pm.method}
                      <span className="text-[#6b6a68] font-normal">({pm.count} trx)</span>
                    </span>
                    <span className="font-bold text-[#1f1e1d]">{formatRupiah(pm.total)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#eeece5] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pm.pct}%`,
                        backgroundColor:
                          pm.method === 'Cash'
                            ? '#1F7A5A'
                            : pm.method === 'QRIS'
                            ? '#E9A23B'
                            : '#3F5A73',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Shift Sedang Aktif */}
          <div className="border-t border-[#eeece5] pt-3">
            <div className="text-xs font-bold text-[#4a4947] flex items-center gap-1.5 mb-2">
              <Clock size={13} className="text-[#1F7A5A]" /> Status Shift Kasir Aktif
            </div>
            {openShifts.length === 0 ? (
              <div className="text-xs text-[#6b6a68] bg-[#faf9f5] rounded-xl p-3">
                Tidak ada kasir yang sedang buka shift saat ini.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {openShifts.map((s) => (
                  <div
                    key={s.id}
                    className="bg-[#e4f1ea] border border-[#c5dfd1] rounded-xl px-3 py-2 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-[#14532d]">{s.kasirNama}</div>
                      <div className="text-[11px] text-[#1f4d3a]">
                        Buka pukul {formatJam(s.waktuBuka)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-[#1f4d3a]">Modal Awal</div>
                      <div className="font-bold text-[#14532d]">{formatRupiah(s.modalAwal)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Baris Bawah: Tabel Profitabilitas Menu (7 kolom) + Rekap Shift Kasir Terbaru (5 kolom) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#eeece5] flex items-center justify-between">
            <div>
              <div className="font-bold text-sm text-[#1f1e1d]">
                Top Menu Terlaris &amp; Kontribusi Laba
              </div>
              <div className="text-xs text-[#6b6a68]">
                Berdasarkan omzet &amp; HPP aktual transaksi pada periode terpilih
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('recipes')}
              className="text-xs font-semibold text-[#1F7A5A] hover:underline"
            >
              Kelola Menu &amp; Resep →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#faf9f5] text-[#6b6a68] border-b border-[#eeece5]">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Menu</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Terjual</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Omzet</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Total HPP</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Laba &amp; Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eeece5]">
                {topMenus.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-[#6b6a68]">
                      Belum ada penjualan menu pada periode ini.
                    </td>
                  </tr>
                ) : (
                  topMenus.map((m) => {
                    const margin = m.omzet > 0 ? (m.laba / m.omzet) * 100 : 0;
                    return (
                      <tr key={m.nama} className="hover:bg-[#faf9f5]">
                        <td className="py-2.5 px-4 font-semibold text-[#1f1e1d]">{m.nama}</td>
                        <td className="py-2.5 px-3 text-right">{m.qty}</td>
                        <td className="py-2.5 px-3 text-right font-medium">
                          {formatRupiah(m.omzet)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-[#6b6a68]">
                          {formatRupiah(m.hpp)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span className="font-bold text-[#1F7A5A]">{formatRupiah(m.laba)}</span>{' '}
                          <span className="text-[11px] text-[#6b6a68]">
                            ({formatPercent(margin)})
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#eeece5]">
            <div className="font-bold text-sm text-[#1f1e1d]">Rekap Shift Kasir Terbaru</div>
            <div className="text-xs text-[#6b6a68]">
              Audit modal awal, uang seharusnya, fisik &amp; selisih laci
            </div>
          </div>
          <div className="divide-y divide-[#eeece5]">
            {filteredShifts.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#6b6a68]">
                Belum ada shift kasir pada periode ini.
              </div>
            ) : (
              filteredShifts.slice(0, 6).map((s) => {
                const selisih = s.selisih ?? 0;
                return (
                  <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-[#1f1e1d] flex items-center gap-1.5">
                        {s.kasirNama}
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                            s.status === 'open'
                              ? 'bg-[#e4f1ea] text-[#14532d]'
                              : 'bg-[#ece9e0] text-[#4a4947]'
                          }`}
                        >
                          {s.status === 'open' ? 'Buka' : 'Tutup'}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#6b6a68] mt-0.5">
                        {formatTanggalPendek(s.waktuBuka)} · {formatJam(s.waktuBuka)}
                        {s.waktuTutup ? ` – ${formatJam(s.waktuTutup)}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-[#1f1e1d]">
                        Cash {formatRupiah(s.pendapatanCash)}
                      </div>
                      {s.status === 'closed' && (
                        <div
                          className={`text-[11px] font-bold ${
                            selisih === 0
                              ? 'text-[#1F7A5A]'
                              : selisih > 0
                              ? 'text-[#c87d1c]'
                              : 'text-[#9b1c12]'
                          }`}
                        >
                          Selisih:{' '}
                          {selisih === 0
                            ? 'Pas (Rp0)'
                            : `${selisih > 0 ? '+' : ''}${formatRupiah(selisih)}`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface KpiCardProps {
  title: string;
  value: string;
  sub: string;
  highlight?: 'positive' | 'negative';
  icon?: React.ReactNode;
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, sub, highlight, icon }) => (
  <div className="bg-white border border-[#e2e0d8] rounded-2xl p-4 flex flex-col justify-between gap-1.5 shadow-2xs">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] font-semibold text-[#6b6a68]">{title}</span>
      {icon}
    </div>
    <div
      className={`text-lg font-bold tracking-tight truncate ${
        highlight === 'positive'
          ? 'text-[#1F7A5A]'
          : highlight === 'negative'
          ? 'text-[#9b1c12]'
          : 'text-[#1f1e1d]'
      }`}
    >
      {value}
    </div>
    <div className="text-[11px] text-[#6b6a68] truncate">{sub}</div>
  </div>
);

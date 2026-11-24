import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../db/database';
import { getSupabaseClient } from '../services/syncService';
import { formatRupiah } from '../lib/calculations';
import { formatClockHm, formatDurationMinutes } from '../services/attendanceService';
import type { BranchInfo } from '../types/models';
import {
  Building2,
  Camera,
  Download,
  ExternalLink,
  RefreshCw,
  Search,
  Settings,
  X,
} from 'lucide-react';

export type AllBranchesModule =
  | 'sales'
  | 'expenses'
  | 'recipes'
  | 'ingredients'
  | 'target'
  | 'attendance'
  | 'settings';

interface WebAllBranchesModuleViewProps {
  module: AllBranchesModule;
  branches: BranchInfo[];
  dateFrom: string;
  dateTo: string;
  onOpenBranchModule: (outletId: string, module: AllBranchesModule) => void;
}

function escapeCsvCell(v: unknown): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const WebAllBranchesModuleView: React.FC<WebAllBranchesModuleViewProps> = ({
  module,
  branches,
  dateFrom,
  dateTo,
  onOpenBranchModule,
}) => {
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewSelfie, setPreviewSelfie] = useState<{ title: string; src: string } | null>(null);

  // Raw cloud datasets
  const [salesRows, setSalesRows] = useState<Array<Record<string, any>>>([]);
  const [expenseRows, setExpenseRows] = useState<Array<Record<string, any>>>([]);
  const [ingredientRows, setIngredientRows] = useState<Array<Record<string, any>>>([]);
  const [menuRows, setMenuRows] = useState<Array<Record<string, any>>>([]);
  const [recipeMap, setRecipeMap] = useState<Map<string, number>>(new Map());
  const [targetRows, setTargetRows] = useState<
    Array<{
      outletId: string;
      namaCabang: string;
      targetLaba: number;
      omzetBulanIni: number;
      hppBulanIni: number;
      biayaOpBulanIni: number;
      labaBersih: number;
    }>
  >([]);
  const [attendanceRows, setAttendanceRows] = useState<Array<Record<string, any>>>([]);

  const branchNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of branches) {
      m.set(b.outletId.trim().toUpperCase(), b.namaCabang);
    }
    return m;
  }, [branches]);

  const outletIds = useMemo(() => branches.map((b) => b.outletId.trim().toUpperCase()), [branches]);

  useEffect(() => {
    setSearch('');
    setBranchFilter('ALL');
  }, [module]);

  useEffect(() => {
    if (module === 'settings' || outletIds.length === 0 || !navigator.onLine) return;
    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      try {
        const localSettings = await db.settings.get('global');
        const client = getSupabaseClient(localSettings);

        if (module === 'sales') {
          const { data } = await client
            .from('transactions')
            .select('outlet_id, id, nomor_struk, waktu, kasir_nama, nama_pelanggan, metode_bayar, total, status, items')
            .in('outlet_id', outletIds)
            .order('waktu', { ascending: false });
          if (!cancelled) {
            const filtered = ((data as Array<Record<string, any>>) || []).filter((t) => {
              const d = String(t.waktu || '').slice(0, 10);
              return d >= dateFrom && d <= dateTo;
            });
            setSalesRows(filtered);
          }
        } else if (module === 'expenses') {
          const [expRes, catRes] = await Promise.all([
            client
              .from('expenses')
              .select('outlet_id, id, tanggal, category_id, category_nama, nominal, keterangan, pembuat_nama, dibatalkan')
              .in('outlet_id', outletIds)
              .order('tanggal', { ascending: false }),
            client
              .from('expense_categories')
              .select('outlet_id, id, sudah_masuk_hpp')
              .in('outlet_id', outletIds),
          ]);
          const hppKeys = new Set(
            ((catRes.data as Array<{ outlet_id: string; id: string; sudah_masuk_hpp: boolean }>) || [])
              .filter((c) => c.sudah_masuk_hpp)
              .map((c) => `${String(c.outlet_id).toUpperCase()}::${c.id}`)
          );
          if (!cancelled) {
            const filtered = ((expRes.data as Array<Record<string, any>>) || [])
              .filter((e) => !e.dibatalkan)
              .filter((e) => {
                const d = String(e.tanggal || '').slice(0, 10);
                return d >= dateFrom && d <= dateTo;
              })
              .map((e) => ({
                ...e,
                isHpp: hppKeys.has(`${String(e.outlet_id).toUpperCase()}::${e.category_id}`),
              }));
            setExpenseRows(filtered);
          }
        } else if (module === 'ingredients') {
          const { data } = await client
            .from('ingredients')
            .select('outlet_id, id, nama, satuan_dasar, label_satuan_dasar, harga_aktif, active, updated_at')
            .in('outlet_id', outletIds)
            .order('nama', { ascending: true });
          if (!cancelled) setIngredientRows((data as Array<Record<string, any>>) || []);
        } else if (module === 'recipes') {
          const [menusRes, recsRes] = await Promise.all([
            client
              .from('menus')
              .select('outlet_id, id, recipe_id, nama, kategori, harga_jual, active, updated_at')
              .in('outlet_id', outletIds)
              .order('nama', { ascending: true }),
            client
              .from('recipes')
              .select('outlet_id, id, hpp_per_porsi')
              .in('outlet_id', outletIds),
          ]);
          const rMap = new Map<string, number>();
          for (const r of (recsRes.data as Array<Record<string, any>>) || []) {
            rMap.set(`${String(r.outlet_id).toUpperCase()}::${r.id}`, Number(r.hpp_per_porsi || 0));
          }
          if (!cancelled) {
            setRecipeMap(rMap);
            setMenuRows((menusRes.data as Array<Record<string, any>>) || []);
          }
        } else if (module === 'target') {
          const ym = dateFrom.slice(0, 7);
          const [tgtRes, txRes, expRes, catRes] = await Promise.all([
            client
              .from('monthly_targets')
              .select('outlet_id, bulan, target_laba_bersih')
              .in('outlet_id', outletIds)
              .eq('bulan', ym),
            client
              .from('transactions')
              .select('outlet_id, waktu, total, status, items')
              .in('outlet_id', outletIds),
            client
              .from('expenses')
              .select('outlet_id, tanggal, category_id, nominal, dibatalkan')
              .in('outlet_id', outletIds),
            client
              .from('expense_categories')
              .select('outlet_id, id, sudah_masuk_hpp')
              .in('outlet_id', outletIds),
          ]);
          const hppKeys = new Set(
            ((catRes.data as Array<{ outlet_id: string; id: string; sudah_masuk_hpp: boolean }>) || [])
              .filter((c) => c.sudah_masuk_hpp)
              .map((c) => `${String(c.outlet_id).toUpperCase()}::${c.id}`)
          );
          const tgtMap = new Map<string, number>();
          for (const t of (tgtRes.data as Array<Record<string, any>>) || []) {
            tgtMap.set(String(t.outlet_id).toUpperCase(), Number(t.target_laba_bersih || 0));
          }
          const summaryMap = new Map(
            branches.map((b) => [
              b.outletId.toUpperCase(),
              {
                outletId: b.outletId.toUpperCase(),
                namaCabang: b.namaCabang,
                targetLaba: tgtMap.get(b.outletId.toUpperCase()) || 0,
                omzetBulanIni: 0,
                hppBulanIni: 0,
                biayaOpBulanIni: 0,
                labaBersih: 0,
              },
            ])
          );
          for (const tx of (txRes.data as Array<Record<string, any>>) || []) {
            if (tx.status === 'void') continue;
            if (!String(tx.waktu || '').startsWith(ym)) continue;
            const row = summaryMap.get(String(tx.outlet_id).toUpperCase());
            if (!row) continue;
            row.omzetBulanIni += Number(tx.total || 0);
            for (const it of Array.isArray(tx.items) ? tx.items : []) {
              row.hppBulanIni += Number(it.snapshotHpp || 0) * Number(it.jumlah || 0);
            }
          }
          for (const exp of (expRes.data as Array<Record<string, any>>) || []) {
            if (exp.dibatalkan) continue;
            if (!String(exp.tanggal || '').startsWith(ym)) continue;
            const oid = String(exp.outlet_id).toUpperCase();
            const row = summaryMap.get(oid);
            if (!row) continue;
            if (!hppKeys.has(`${oid}::${exp.category_id}`)) {
              row.biayaOpBulanIni += Number(exp.nominal || 0);
            }
          }
          const list = Array.from(summaryMap.values()).map((r) => ({
            ...r,
            labaBersih: r.omzetBulanIni - r.hppBulanIni - r.biayaOpBulanIni,
          }));
          if (!cancelled) setTargetRows(list);
        } else if (module === 'attendance') {
          const { data } = await client
            .from('attendances')
            .select(
              'outlet_id, id, tanggal, user_nama, user_role, shift_nama, clock_in_at, clock_out_at, clock_in_photo, clock_out_photo, late_minutes, duration_minutes, status'
            )
            .in('outlet_id', outletIds)
            .order('clock_in_at', { ascending: false });
          if (!cancelled) {
            const filtered = ((data as Array<Record<string, any>>) || []).filter((a) => {
              const d = String(a.tanggal || '').slice(0, 10);
              return d >= dateFrom && d <= dateTo;
            });
            setAttendanceRows(filtered);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [module, outletIds.join(','), dateFrom, dateTo, refreshKey]);

  const getBranchLabel = (oid: string) => {
    const clean = String(oid || '').trim().toUpperCase();
    return branchNameMap.get(clean) || clean;
  };

  const q = search.trim().toLowerCase();

  // =========================================================================
  // PENGATURAN OUTLET (PILIH CABANG YANG INGIN DIATUR)
  // =========================================================================
  if (module === 'settings') {
    return (
      <div className="bg-white border border-[#e2e0d8] rounded-2xl p-5 flex flex-col gap-4">
        <div>
          <h2 className="font-bold text-base text-[#1f1e1d] flex items-center gap-2">
            <Settings size={18} className="text-[#1F7A5A]" /> Pilih Cabang untuk Diatur
          </h2>
          <p className="text-xs text-[#6b6a68] mt-0.5">
            Setiap cabang memiliki profil struk, alamat, logo, dan PIN Otorisasi Mode Kasir masing-masing. Pilih cabang di bawah untuk membuka pengaturannya.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {branches.map((b) => (
            <div
              key={b.outletId}
              className="border border-[#e2e0d8] rounded-2xl p-4 bg-[#faf9f5]/70 flex flex-col justify-between gap-3"
            >
              <div>
                <div className="font-bold text-sm text-[#1f1e1d]">{b.namaCabang}</div>
                <div className="text-[11px] font-mono text-[#1F7A5A] mt-0.5">{b.outletId}</div>
                <div className="text-xs text-[#6b6a68] mt-1 truncate">{b.alamatUsaha || '—'}</div>
              </div>
              <button
                type="button"
                onClick={() => onOpenBranchModule(b.outletId, 'settings')}
                className="h-9 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <Settings size={14} /> Atur Outlet Ini
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Toolbar gabungan lintas cabang
  const renderToolbar = (title: string, subtitle: string, onExport?: () => void) => (
    <div className="px-5 py-4 border-b border-[#eeece5] flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-bold text-base text-[#1f1e1d] flex items-center gap-2">
          <Building2 size={17} className="text-[#1F7A5A]" /> {title}
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#e4f1ea] text-[#1F7A5A]">
            {branches.length} Cabang
          </span>
        </h2>
        <p className="text-xs text-[#6b6a68] mt-0.5">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6a68] pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari data atau cabang..."
            className="h-9 w-52 pl-8 pr-7 rounded-xl border border-[#d6d3c8] bg-[#faf9f5] focus:bg-white text-xs focus:outline-none focus:border-[#1F7A5A]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6b6a68]"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="h-9 rounded-xl border border-[#d6d3c8] bg-white px-2.5 text-xs font-medium text-[#1f1e1d] focus:outline-none focus:border-[#1F7A5A]"
        >
          <option value="ALL">Semua Cabang ({branches.length})</option>
          {branches.map((b) => (
            <option key={b.outletId} value={b.outletId.toUpperCase()}>
              {b.namaCabang}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
          className="h-9 px-3 rounded-xl border border-[#d6d3c8] bg-white hover:bg-[#faf9f5] text-xs font-semibold text-[#4a4947] inline-flex items-center gap-1.5"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Muat Ulang
        </button>
        {onExport && (
          <button
            type="button"
            onClick={onExport}
            className="h-9 px-3 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Download size={13} /> Ekspor CSV
          </button>
        )}
      </div>
    </div>
  );

  const matchBranch = (oid: string) =>
    branchFilter === 'ALL' || String(oid || '').trim().toUpperCase() === branchFilter;

  // =========================================================================
  // 1. PENJUALAN & RIWAYAT (SEMUA CABANG)
  // =========================================================================
  if (module === 'sales') {
    const filtered = salesRows.filter((t) => {
      if (!matchBranch(t.outlet_id)) return false;
      if (!q) return true;
      return (
        getBranchLabel(t.outlet_id).toLowerCase().includes(q) ||
        String(t.nomor_struk || '').toLowerCase().includes(q) ||
        String(t.kasir_nama || '').toLowerCase().includes(q) ||
        String(t.nama_pelanggan || '').toLowerCase().includes(q) ||
        String(t.metode_bayar || '').toLowerCase().includes(q)
      );
    });
    const validTxs = filtered.filter((t) => t.status !== 'void');
    const totalOmzet = validTxs.reduce((s, t) => s + Number(t.total || 0), 0);
    const voidCount = filtered.length - validTxs.length;

    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Total Omzet Gabungan" value={formatRupiah(totalOmzet)} accent />
          <SummaryCard label="Transaksi Berhasil" value={`${validTxs.length} struk`} />
          <SummaryCard
            label="Rata-rata Struk"
            value={formatRupiah(validTxs.length > 0 ? Math.round(totalOmzet / validTxs.length) : 0)}
          />
          <SummaryCard label="Transaksi Void" value={`${voidCount} struk`} danger={voidCount > 0} />
        </div>
        <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
          {renderToolbar(
            'Penjualan & Riwayat — Semua Cabang',
            `Periode ${dateFrom} s.d. ${dateTo} lintas seluruh cabang`,
            () =>
              downloadCsv(
                `penjualan-semua-cabang-${dateFrom}_${dateTo}.csv`,
                ['Waktu', 'Cabang', 'No Struk', 'Kasir', 'Pelanggan', 'Metode', 'Total', 'Status'],
                filtered.map((t) => [
                  t.waktu,
                  getBranchLabel(t.outlet_id),
                  t.nomor_struk,
                  t.kasir_nama,
                  t.nama_pelanggan || '-',
                  t.metode_bayar,
                  t.total,
                  t.status,
                ])
              )
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#faf9f5] text-[#6b6a68] border-b border-[#eeece5]">
                <tr>
                  <th className="py-3 px-4 font-semibold">Waktu</th>
                  <th className="py-3 px-3 font-semibold">Cabang</th>
                  <th className="py-3 px-3 font-semibold">No. Struk</th>
                  <th className="py-3 px-3 font-semibold">Kasir</th>
                  <th className="py-3 px-3 font-semibold">Metode</th>
                  <th className="py-3 px-3 font-semibold text-right">Total</th>
                  <th className="py-3 px-4 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eeece5]">
                {loading ? (
                  <tr><td colSpan={7} className="py-10 text-center text-[#6b6a68]">Memuat data penjualan seluruh cabang...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="py-10 text-center text-[#6b6a68]">Belum ada transaksi pada periode ini.</td></tr>
                ) : (
                  filtered.slice(0, 300).map((t) => (
                    <tr key={`${t.outlet_id}-${t.id}`} className="hover:bg-[#faf9f5]">
                      <td className="py-2.5 px-4 whitespace-nowrap text-[#6b6a68]">
                        {String(t.waktu || '').slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <BranchBadge name={getBranchLabel(t.outlet_id)} />
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#1f1e1d]">{t.nomor_struk}</td>
                      <td className="py-2.5 px-3">{t.kasir_nama}</td>
                      <td className="py-2.5 px-3">{t.metode_bayar}</td>
                      <td className="py-2.5 px-3 text-right font-semibold">{formatRupiah(Number(t.total || 0))}</td>
                      <td className="py-2.5 px-4 text-right">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            t.status === 'void'
                              ? 'bg-[#fbe4e1] text-[#9b1c12]'
                              : 'bg-[#e4f1ea] text-[#1F7A5A]'
                          }`}
                        >
                          {t.status === 'void' ? 'VOID' : 'Selesai'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 2. PENGELUARAN (SEMUA CABANG)
  // =========================================================================
  if (module === 'expenses') {
    const filtered = expenseRows.filter((e) => {
      if (!matchBranch(e.outlet_id)) return false;
      if (!q) return true;
      return (
        getBranchLabel(e.outlet_id).toLowerCase().includes(q) ||
        String(e.category_nama || '').toLowerCase().includes(q) ||
        String(e.keterangan || '').toLowerCase().includes(q) ||
        String(e.pembuat_nama || '').toLowerCase().includes(q)
      );
    });
    const totalAll = filtered.reduce((s, e) => s + Number(e.nominal || 0), 0);
    const totalOp = filtered.filter((e) => !e.isHpp).reduce((s, e) => s + Number(e.nominal || 0), 0);
    const totalBahan = totalAll - totalOp;

    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryCard label="Total Pengeluaran Gabungan" value={formatRupiah(totalAll)} />
          <SummaryCard label="Biaya Operasional (Non-HPP)" value={formatRupiah(totalOp)} accent />
          <SummaryCard label="Pembelian Bahan Baku (HPP)" value={formatRupiah(totalBahan)} />
        </div>
        <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
          {renderToolbar(
            'Pengeluaran — Semua Cabang',
            `Periode ${dateFrom} s.d. ${dateTo} lintas seluruh cabang`,
            () =>
              downloadCsv(
                `pengeluaran-semua-cabang-${dateFrom}_${dateTo}.csv`,
                ['Tanggal', 'Cabang', 'Kategori', 'Keterangan', 'Pencatat', 'Nominal'],
                filtered.map((e) => [
                  e.tanggal,
                  getBranchLabel(e.outlet_id),
                  e.category_nama,
                  e.keterangan,
                  e.pembuat_nama || '-',
                  e.nominal,
                ])
              )
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#faf9f5] text-[#6b6a68] border-b border-[#eeece5]">
                <tr>
                  <th className="py-3 px-4 font-semibold">Tanggal</th>
                  <th className="py-3 px-3 font-semibold">Cabang</th>
                  <th className="py-3 px-3 font-semibold">Kategori</th>
                  <th className="py-3 px-3 font-semibold">Keterangan</th>
                  <th className="py-3 px-3 font-semibold">Pencatat</th>
                  <th className="py-3 px-4 font-semibold text-right">Nominal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eeece5]">
                {loading ? (
                  <tr><td colSpan={6} className="py-10 text-center text-[#6b6a68]">Memuat data pengeluaran seluruh cabang...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-[#6b6a68]">Belum ada catatan pengeluaran pada periode ini.</td></tr>
                ) : (
                  filtered.slice(0, 300).map((e) => (
                    <tr key={`${e.outlet_id}-${e.id}`} className="hover:bg-[#faf9f5]">
                      <td className="py-2.5 px-4 whitespace-nowrap text-[#6b6a68]">{e.tanggal}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <BranchBadge name={getBranchLabel(e.outlet_id)} />
                      </td>
                      <td className="py-2.5 px-3 font-medium">{e.category_nama}</td>
                      <td className="py-2.5 px-3 text-[#4a4947]">{e.keterangan || '—'}</td>
                      <td className="py-2.5 px-3 text-[#6b6a68]">{e.pembuat_nama || '—'}</td>
                      <td className="py-2.5 px-4 text-right font-semibold">{formatRupiah(Number(e.nominal || 0))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 3. BAHAN BAKU (SEMUA CABANG)
  // =========================================================================
  if (module === 'ingredients') {
    const filtered = ingredientRows.filter((i) => {
      if (!matchBranch(i.outlet_id)) return false;
      if (!q) return true;
      return (
        getBranchLabel(i.outlet_id).toLowerCase().includes(q) ||
        String(i.nama || '').toLowerCase().includes(q) ||
        String(i.label_satuan_dasar || '').toLowerCase().includes(q)
      );
    });
    const noPriceCount = filtered.filter((i) => Number(i.harga_aktif || 0) <= 0).length;

    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryCard label="Total Item Bahan (Semua Cabang)" value={`${filtered.length} item`} accent />
          <SummaryCard label="Sudah Ada Harga Aktif" value={`${filtered.length - noPriceCount} item`} />
          <SummaryCard label="Belum Ada Harga Beli" value={`${noPriceCount} item`} danger={noPriceCount > 0} />
        </div>
        <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
          {renderToolbar(
            'Bahan Baku — Semua Cabang',
            'Bandingkan daftar bahan baku dan harga aktif di seluruh cabang'
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#faf9f5] text-[#6b6a68] border-b border-[#eeece5]">
                <tr>
                  <th className="py-3 px-4 font-semibold">Cabang</th>
                  <th className="py-3 px-3 font-semibold">Nama Bahan</th>
                  <th className="py-3 px-3 font-semibold">Satuan Dasar</th>
                  <th className="py-3 px-3 font-semibold text-right">Harga Aktif / Satuan</th>
                  <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eeece5]">
                {loading ? (
                  <tr><td colSpan={5} className="py-10 text-center text-[#6b6a68]">Memuat data bahan baku seluruh cabang...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5} className="py-10 text-center text-[#6b6a68]">Belum ada bahan baku tercatat.</td></tr>
                ) : (
                  filtered.map((i) => (
                    <tr key={`${i.outlet_id}-${i.id}`} className="hover:bg-[#faf9f5]">
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <BranchBadge name={getBranchLabel(i.outlet_id)} />
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#1f1e1d]">{i.nama}</td>
                      <td className="py-2.5 px-3 text-[#6b6a68]">{i.label_satuan_dasar || i.satuan_dasar}</td>
                      <td className="py-2.5 px-3 text-right font-semibold">
                        {Number(i.harga_aktif || 0) > 0 ? (
                          formatRupiah(Number(i.harga_aktif))
                        ) : (
                          <span className="text-[#9b1c12]">Belum ada</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenBranchModule(i.outlet_id, 'ingredients')}
                          className="text-[#1F7A5A] font-semibold hover:underline inline-flex items-center gap-1"
                        >
                          Kelola <ExternalLink size={11} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 4. MENU & RESEP HPP (SEMUA CABANG)
  // =========================================================================
  if (module === 'recipes') {
    const filtered = menuRows.filter((m) => {
      if (!matchBranch(m.outlet_id)) return false;
      if (!q) return true;
      return (
        getBranchLabel(m.outlet_id).toLowerCase().includes(q) ||
        String(m.nama || '').toLowerCase().includes(q) ||
        String(m.kategori || '').toLowerCase().includes(q)
      );
    });
    const activeCount = filtered.filter((m) => m.active !== false).length;

    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryCard label="Total Menu (Semua Cabang)" value={`${filtered.length} menu`} accent />
          <SummaryCard label="Menu Aktif" value={`${activeCount} menu`} />
          <SummaryCard label="Cabang Terpantau" value={`${branches.length} cabang`} />
        </div>
        <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
          {renderToolbar(
            'Menu & HPP — Semua Cabang',
            'Pantau harga jual, HPP resep, dan margin profit di seluruh cabang'
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#faf9f5] text-[#6b6a68] border-b border-[#eeece5]">
                <tr>
                  <th className="py-3 px-4 font-semibold">Cabang</th>
                  <th className="py-3 px-3 font-semibold">Nama Menu</th>
                  <th className="py-3 px-3 font-semibold">Kategori</th>
                  <th className="py-3 px-3 font-semibold text-right">Harga Jual</th>
                  <th className="py-3 px-3 font-semibold text-right">HPP</th>
                  <th className="py-3 px-3 font-semibold text-right">Margin</th>
                  <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eeece5]">
                {loading ? (
                  <tr><td colSpan={7} className="py-10 text-center text-[#6b6a68]">Memuat data menu seluruh cabang...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="py-10 text-center text-[#6b6a68]">Belum ada menu tercatat.</td></tr>
                ) : (
                  filtered.map((m) => {
                    const harga = Number(m.harga_jual || 0);
                    const hpp = m.recipe_id
                      ? recipeMap.get(`${String(m.outlet_id).toUpperCase()}::${m.recipe_id}`) || 0
                      : 0;
                    const profit = harga - hpp;
                    const marginPct = harga > 0 ? Math.round((profit / harga) * 100) : 0;
                    return (
                      <tr key={`${m.outlet_id}-${m.id}`} className="hover:bg-[#faf9f5]">
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <BranchBadge name={getBranchLabel(m.outlet_id)} />
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-[#1f1e1d]">{m.nama}</td>
                        <td className="py-2.5 px-3 text-[#6b6a68]">{m.kategori || '—'}</td>
                        <td className="py-2.5 px-3 text-right font-semibold">{formatRupiah(harga)}</td>
                        <td className="py-2.5 px-3 text-right text-[#6b6a68]">{formatRupiah(hpp)}</td>
                        <td className="py-2.5 px-3 text-right font-semibold text-[#1F7A5A]">
                          {formatRupiah(profit)} ({marginPct}%)
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onOpenBranchModule(m.outlet_id, 'recipes')}
                            className="text-[#1F7A5A] font-semibold hover:underline inline-flex items-center gap-1"
                          >
                            Kelola <ExternalLink size={11} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 5. TARGET & BEP (SEMUA CABANG)
  // =========================================================================
  if (module === 'target') {
    const filtered = targetRows.filter((r) => {
      if (!matchBranch(r.outletId)) return false;
      if (!q) return true;
      return r.namaCabang.toLowerCase().includes(q) || r.outletId.toLowerCase().includes(q);
    });
    const sumTarget = filtered.reduce((s, r) => s + r.targetLaba, 0);
    const sumOmzet = filtered.reduce((s, r) => s + r.omzetBulanIni, 0);
    const sumLaba = filtered.reduce((s, r) => s + r.labaBersih, 0);

    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryCard label="Total Target Laba Gabungan" value={formatRupiah(sumTarget)} />
          <SummaryCard label="Omzet Bulan Ini (Gabungan)" value={formatRupiah(sumOmzet)} />
          <SummaryCard label="Laba Bersih Bulan Ini" value={formatRupiah(sumLaba)} accent={sumLaba >= 0} danger={sumLaba < 0} />
        </div>
        <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
          {renderToolbar(
            'Target & BEP — Semua Cabang',
            `Rekap performa bulan ${dateFrom.slice(0, 7)} di seluruh cabang`
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#faf9f5] text-[#6b6a68] border-b border-[#eeece5]">
                <tr>
                  <th className="py-3 px-4 font-semibold">Cabang</th>
                  <th className="py-3 px-3 font-semibold text-right">Target Laba</th>
                  <th className="py-3 px-3 font-semibold text-right">Omzet Bulan Ini</th>
                  <th className="py-3 px-3 font-semibold text-right">Biaya Operasional</th>
                  <th className="py-3 px-3 font-semibold text-right">Laba Bersih</th>
                  <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eeece5]">
                {loading ? (
                  <tr><td colSpan={6} className="py-10 text-center text-[#6b6a68]">Memuat data target seluruh cabang...</td></tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.outletId} className="hover:bg-[#faf9f5]">
                      <td className="py-3 px-4">
                        <BranchBadge name={r.namaCabang} />
                      </td>
                      <td className="py-3 px-3 text-right">{formatRupiah(r.targetLaba)}</td>
                      <td className="py-3 px-3 text-right font-semibold">{formatRupiah(r.omzetBulanIni)}</td>
                      <td className="py-3 px-3 text-right text-[#6b6a68]">{formatRupiah(r.biayaOpBulanIni)}</td>
                      <td className={`py-3 px-3 text-right font-bold ${r.labaBersih >= 0 ? 'text-[#1F7A5A]' : 'text-[#9b1c12]'}`}>
                        {formatRupiah(r.labaBersih)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenBranchModule(r.outletId, 'target')}
                          className="text-[#1F7A5A] font-semibold hover:underline inline-flex items-center gap-1"
                        >
                          Atur Target <ExternalLink size={11} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 6. ABSENSI TIM (SEMUA CABANG)
  // =========================================================================
  const filteredAtt = attendanceRows.filter((a) => {
    if (!matchBranch(a.outlet_id)) return false;
    if (!q) return true;
    return (
      getBranchLabel(a.outlet_id).toLowerCase().includes(q) ||
      String(a.user_nama || '').toLowerCase().includes(q) ||
      String(a.shift_nama || '').toLowerCase().includes(q) ||
      String(a.status || '').toLowerCase().includes(q)
    );
  });
  const activeNowCount = filteredAtt.filter((a) => !a.clock_out_at && a.status !== 'lupa_pulang').length;
  const lateCount = filteredAtt.filter((a) => Number(a.late_minutes || 0) > 0).length;
  const forgotCount = filteredAtt.filter((a) => a.status === 'lupa_pulang').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total Log Absensi" value={`${filteredAtt.length} catatan`} />
        <SummaryCard label="Sedang Hadir (Aktif)" value={`${activeNowCount} orang`} accent />
        <SummaryCard label="Terlambat" value={`${lateCount} kali`} danger={lateCount > 0} />
        <SummaryCard label="Lupa Pulang" value={`${forgotCount} kali`} danger={forgotCount > 0} />
      </div>
      <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
        {renderToolbar(
          'Absensi Tim — Semua Cabang',
          `Periode ${dateFrom} s.d. ${dateTo} lintas Pusat & seluruh Cabang`,
          () =>
            downloadCsv(
              `absensi-semua-cabang-${dateFrom}_${dateTo}.csv`,
              ['Tanggal', 'Cabang', 'Karyawan', 'Shift', 'Masuk', 'Pulang', 'Telat (mnt)', 'Durasi (mnt)', 'Status'],
              filteredAtt.map((a) => [
                a.tanggal,
                getBranchLabel(a.outlet_id),
                a.user_nama,
                a.shift_nama,
                formatClockHm(a.clock_in_at),
                a.clock_out_at ? formatClockHm(a.clock_out_at) : '-',
                a.late_minutes || 0,
                a.duration_minutes || 0,
                a.status,
              ])
            )
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#faf9f5] text-[#6b6a68] border-b border-[#eeece5]">
              <tr>
                <th className="py-3 px-4 font-semibold">Tanggal</th>
                <th className="py-3 px-3 font-semibold">Cabang</th>
                <th className="py-3 px-3 font-semibold">Karyawan</th>
                <th className="py-3 px-3 font-semibold">Shift</th>
                <th className="py-3 px-3 font-semibold">Masuk / Pulang</th>
                <th className="py-3 px-3 font-semibold">Durasi</th>
                <th className="py-3 px-3 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Selfie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eeece5]">
              {loading ? (
                <tr><td colSpan={8} className="py-10 text-center text-[#6b6a68]">Memuat data absensi seluruh cabang...</td></tr>
              ) : filteredAtt.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-[#6b6a68]">Belum ada catatan absensi pada periode ini.</td></tr>
              ) : (
                filteredAtt.slice(0, 300).map((a) => (
                  <tr key={`${a.outlet_id}-${a.id}`} className="hover:bg-[#faf9f5]">
                    <td className="py-2.5 px-4 whitespace-nowrap text-[#6b6a68]">{a.tanggal}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <BranchBadge name={getBranchLabel(a.outlet_id)} />
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-[#1f1e1d]">{a.user_nama}</td>
                    <td className="py-2.5 px-3 text-[#6b6a68]">{a.shift_nama}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px]">
                      {formatClockHm(a.clock_in_at)} – {a.clock_out_at ? formatClockHm(a.clock_out_at) : '...'}
                    </td>
                    <td className="py-2.5 px-3 text-[#6b6a68]">
                      {a.duration_minutes ? formatDurationMinutes(Number(a.duration_minutes)) : '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          a.status === 'lupa_pulang'
                            ? 'bg-[#fbe4e1] text-[#9b1c12]'
                            : Number(a.late_minutes || 0) > 0
                            ? 'bg-[#fbeed9] text-[#7a4300]'
                            : 'bg-[#e4f1ea] text-[#1F7A5A]'
                        }`}
                      >
                        {a.status === 'lupa_pulang'
                          ? 'Lupa Pulang'
                          : Number(a.late_minutes || 0) > 0
                          ? `Telat ${a.late_minutes}m`
                          : a.clock_out_at
                          ? 'Tepat Waktu'
                          : 'Sedang Kerja'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {a.clock_in_photo && (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewSelfie({
                                title: `Masuk · ${a.user_nama} (${getBranchLabel(a.outlet_id)})`,
                                src: a.clock_in_photo,
                              })
                            }
                            className="px-2 py-1 rounded-lg bg-[#e4f1ea] text-[#1F7A5A] text-[10px] font-semibold inline-flex items-center gap-1"
                          >
                            <Camera size={11} /> Masuk
                          </button>
                        )}
                        {a.clock_out_photo && (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewSelfie({
                                title: `Pulang · ${a.user_nama} (${getBranchLabel(a.outlet_id)})`,
                                src: a.clock_out_photo,
                              })
                            }
                            className="px-2 py-1 rounded-lg bg-[#ece9e0] text-[#4a4947] text-[10px] font-semibold inline-flex items-center gap-1"
                          >
                            <Camera size={11} /> Pulang
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {previewSelfie && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPreviewSelfie(null)}
        >
          <div
            className="bg-white rounded-2xl p-4 max-w-[360px] w-full flex flex-col gap-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold text-xs text-[#1f1e1d] truncate">{previewSelfie.title}</div>
              <button type="button" onClick={() => setPreviewSelfie(null)}>
                <X size={16} className="text-[#6b6a68]" />
              </button>
            </div>
            <img
              src={previewSelfie.src}
              alt={previewSelfie.title}
              className="w-full rounded-xl object-cover max-h-[380px]"
            />
          </div>
        </div>
      )}
    </div>
  );
};

const BranchBadge: React.FC<{ name: string }> = ({ name }) => (
  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#e4f1ea] text-[#1F7A5A] text-[11px] font-semibold">
    {name}
  </span>
);

const SummaryCard: React.FC<{
  label: string;
  value: string;
  accent?: boolean;
  danger?: boolean;
}> = ({ label, value, accent, danger }) => (
  <div className="bg-white border border-[#e2e0d8] rounded-2xl p-4">
    <div className="text-[11px] font-medium text-[#6b6a68]">{label}</div>
    <div
      className={`text-lg font-bold mt-1 ${
        danger ? 'text-[#9b1c12]' : accent ? 'text-[#1F7A5A]' : 'text-[#1f1e1d]'
      }`}
    >
      {value}
    </div>
  </div>
);

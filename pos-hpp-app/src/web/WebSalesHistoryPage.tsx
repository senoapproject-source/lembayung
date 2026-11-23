import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { voidTransaction } from '../db/actions';
import { formatJam, formatRupiah, formatTanggalPendek } from '../lib/calculations';
import { ReceiptModal } from '../components/ReceiptModal';
import type { Transaction, User } from '../types/models';
import { Ban, Download, Eye, Search, X } from 'lucide-react';

interface WebSalesHistoryPageProps {
  user: User;
  dateFrom: string;
  dateTo: string;
}

export const WebSalesHistoryPage: React.FC<WebSalesHistoryPageProps> = ({
  user,
  dateFrom,
  dateTo,
}) => {
  const transactions = useLiveQuery(() => db.transactions.toArray()) ?? [];
  const settings = useLiveQuery(() => db.settings.get('global'));

  const [search, setSearch] = useState('');
  const [filterMethod, setFilterMethod] = useState<'ALL' | 'Cash' | 'QRIS' | 'Transfer'>('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'selesai' | 'void'>('ALL');
  const [filterCashier, setFilterCashier] = useState<string>('ALL');
  const [receiptTarget, setReceiptTarget] = useState<Transaction | null>(null);
  const [voidTarget, setVoidTarget] = useState<Transaction | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const cashiers = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.kasirNama))).sort(),
    [transactions]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions
      .filter((t) => {
        const d = t.waktu.slice(0, 10);
        if (d < dateFrom || d > dateTo) return false;
        if (filterMethod !== 'ALL' && t.metodeBayar !== filterMethod) return false;
        if (filterStatus !== 'ALL' && t.status !== filterStatus) return false;
        if (filterCashier !== 'ALL' && t.kasirNama !== filterCashier) return false;
        if (q) {
          const hay = `${t.nomorStruk} ${t.kasirNama} ${t.namaPelanggan || ''} ${t.items
            .map((i) => i.menuNama)
            .join(' ')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.waktu.localeCompare(a.waktu));
  }, [transactions, dateFrom, dateTo, filterMethod, filterStatus, filterCashier, search]);

  const totals = useMemo(() => {
    let omzet = 0;
    let hpp = 0;
    let validCount = 0;
    let voidCount = 0;
    for (const tx of filtered) {
      if (tx.status === 'void') {
        voidCount += 1;
        continue;
      }
      validCount += 1;
      omzet += tx.total;
      for (const it of tx.items) {
        hpp += it.snapshotHpp * it.jumlah;
      }
    }
    return { omzet, hpp, laba: omzet - hpp, validCount, voidCount };
  }, [filtered]);

  const handleExportCsv = () => {
    const header = [
      'No Struk',
      'Tanggal',
      'Jam',
      'Kasir',
      'Pelanggan',
      'Metode',
      'Subtotal',
      'Diskon',
      'Total',
      'HPP',
      'Laba Kotor',
      'Status',
    ];
    const rows = filtered.map((tx) => {
      const txHpp = tx.items.reduce((s, i) => s + i.snapshotHpp * i.jumlah, 0);
      return [
        tx.nomorStruk,
        tx.waktu.slice(0, 10),
        formatJam(tx.waktu),
        `"${tx.kasirNama}"`,
        `"${tx.namaPelanggan || '-'}"`,
        tx.metodeBayar,
        tx.subtotal,
        tx.diskonNominal,
        tx.total,
        txHpp,
        tx.total - txHpp,
        tx.status,
      ].join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `penjualan-lembayung-${dateFrom}-sd-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget || !voidReason.trim()) return;
    await voidTransaction(voidTarget.id, voidReason.trim(), user);
    setVoidTarget(null);
    setVoidReason('');
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Bar Ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white border border-[#e2e0d8] rounded-2xl p-4">
          <div className="text-[11px] font-semibold text-[#6b6a68]">Total Omzet Terfilter</div>
          <div className="text-lg font-bold text-[#1f1e1d] mt-1">{formatRupiah(totals.omzet)}</div>
          <div className="text-[11px] text-[#6b6a68]">
            {totals.validCount} selesai · {totals.voidCount} void
          </div>
        </div>
        <div className="bg-white border border-[#e2e0d8] rounded-2xl p-4">
          <div className="text-[11px] font-semibold text-[#6b6a68]">Total HPP Terjual</div>
          <div className="text-lg font-bold text-[#4a4947] mt-1">{formatRupiah(totals.hpp)}</div>
          <div className="text-[11px] text-[#6b6a68]">Snapshot HPP saat transaksi</div>
        </div>
        <div className="bg-white border border-[#e2e0d8] rounded-2xl p-4">
          <div className="text-[11px] font-semibold text-[#6b6a68]">Laba Kotor Penjualan</div>
          <div className="text-lg font-bold text-[#1F7A5A] mt-1">{formatRupiah(totals.laba)}</div>
          <div className="text-[11px] text-[#6b6a68]">Sebelum biaya operasional non-HPP</div>
        </div>
        <div className="bg-white border border-[#e2e0d8] rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold text-[#6b6a68]">Ekspor Data</div>
            <div className="text-xs text-[#4a4947] mt-1">{filtered.length} baris transaksi</div>
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            className="h-9 px-3.5 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-[#e2e0d8] rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6a68]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nomor struk, menu, pelanggan, atau kasir..."
            className="w-full h-9 border border-[#d6d3c8] rounded-xl pl-9 pr-3 text-xs focus:outline-none focus:border-[#1F7A5A]"
          />
        </div>
        <select
          value={filterMethod}
          onChange={(e) => setFilterMethod(e.target.value as typeof filterMethod)}
          className="h-9 border border-[#d6d3c8] rounded-xl px-3 text-xs bg-white"
        >
          <option value="ALL">Semua Metode</option>
          <option value="Cash">Cash</option>
          <option value="QRIS">QRIS</option>
          <option value="Transfer">Transfer</option>
        </select>
        <select
          value={filterCashier}
          onChange={(e) => setFilterCashier(e.target.value)}
          className="h-9 border border-[#d6d3c8] rounded-xl px-3 text-xs bg-white"
        >
          <option value="ALL">Semua Kasir</option>
          {cashiers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
          className="h-9 border border-[#d6d3c8] rounded-xl px-3 text-xs bg-white"
        >
          <option value="ALL">Semua Status</option>
          <option value="selesai">Selesai</option>
          <option value="void">Void (Dibatalkan)</option>
        </select>
      </div>

      {/* Tabel Transaksi Lengkap */}
      <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#faf9f5] text-[#6b6a68] border-b border-[#eeece5]">
              <tr>
                <th className="py-3 px-4 font-semibold">No. Struk</th>
                <th className="py-3 px-3 font-semibold">Waktu</th>
                <th className="py-3 px-3 font-semibold">Kasir</th>
                <th className="py-3 px-3 font-semibold">Pelanggan &amp; Item</th>
                <th className="py-3 px-3 font-semibold">Metode</th>
                <th className="py-3 px-3 font-semibold text-right">Total</th>
                <th className="py-3 px-3 font-semibold text-right">HPP</th>
                <th className="py-3 px-3 font-semibold text-right">Laba</th>
                <th className="py-3 px-3 font-semibold text-center">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eeece5]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-[#6b6a68]">
                    Tidak ada transaksi yang cocok dengan filter saat ini.
                  </td>
                </tr>
              ) : (
                filtered.map((tx) => {
                  const txHpp = tx.items.reduce((s, i) => s + i.snapshotHpp * i.jumlah, 0);
                  const txLaba = tx.total - txHpp;
                  const isVoid = tx.status === 'void';
                  return (
                    <tr key={tx.id} className={`hover:bg-[#faf9f5] ${isVoid ? 'opacity-65' : ''}`}>
                      <td className="py-3 px-4 font-bold text-[#1f1e1d] whitespace-nowrap">
                        {tx.nomorStruk}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-[#4a4947]">
                        {formatTanggalPendek(tx.waktu)} · {formatJam(tx.waktu)}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">{tx.kasirNama}</td>
                      <td className="py-3 px-3 max-w-[260px]">
                        {tx.namaPelanggan && (
                          <div className="font-semibold text-[#1f1e1d] truncate">
                            {tx.namaPelanggan}
                          </div>
                        )}
                        <div className="text-[11px] text-[#6b6a68] truncate">
                          {tx.items.map((i) => `${i.menuNama} ×${i.jumlah}`).join(', ')}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full bg-[#ece9e0] text-[#4a4947] font-semibold text-[11px]">
                          {tx.metodeBayar}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold whitespace-nowrap">
                        {formatRupiah(tx.total)}
                      </td>
                      <td className="py-3 px-3 text-right text-[#6b6a68] whitespace-nowrap">
                        {formatRupiah(txHpp)}
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-[#1F7A5A] whitespace-nowrap">
                        {isVoid ? '—' : formatRupiah(txLaba)}
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            isVoid
                              ? 'bg-[#fbe4e1] text-[#9b1c12]'
                              : 'bg-[#e4f1ea] text-[#14532d]'
                          }`}
                        >
                          {isVoid ? 'Void' : 'Selesai'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setReceiptTarget(tx)}
                            className="px-2.5 py-1 rounded-lg border border-[#d6d3c8] hover:bg-[#ece9e0] text-[#1f1e1d] font-medium inline-flex items-center gap-1"
                          >
                            <Eye size={12} /> Struk
                          </button>
                          {!isVoid && (user.role === 'owner' || user.role === 'manager') && (
                            <button
                              type="button"
                              onClick={() => {
                                setVoidTarget(tx);
                                setVoidReason('');
                              }}
                              className="px-2.5 py-1 rounded-lg border border-[#f5c2bc] text-[#9b1c12] hover:bg-[#fbe4e1] font-medium inline-flex items-center gap-1"
                            >
                              <Ban size={12} /> Void
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Struk Digital */}
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
          <form
            onSubmit={handleConfirmVoid}
            className="bg-white w-full max-w-[400px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <div className="font-bold text-base text-[#9b1c12]">
                Batalkan (Void) {voidTarget.nomorStruk}
              </div>
              <button type="button" onClick={() => setVoidTarget(null)}>
                <X size={18} className="text-[#6b6a68]" />
              </button>
            </div>
            <div className="text-xs text-[#6b6a68]">
              Transaksi senilai <strong>{formatRupiah(voidTarget.total)}</strong> akan dibatalkan dan dikeluarkan dari perhitungan omzet.
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4a4947] mb-1">
                Alasan Pembatalan *
              </label>
              <input
                type="text"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Contoh: Salah input menu / pelanggan batal"
                className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="h-9 px-4 rounded-xl border border-[#d6d3c8] text-xs font-semibold"
              >
                Batal
              </button>
              <button
                type="submit"
                className="h-9 px-4 rounded-xl bg-[#9b1c12] text-white text-xs font-semibold"
              >
                Konfirmasi Void
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

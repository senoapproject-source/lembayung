import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database';
import { addAuditLog, enqueueSync } from '../db/actions';
import { sendDeviceNotification } from '../services/notificationService';
import { formatRibuanInput, formatRupiah, formatTanggalPendek, stripNonDigits } from '../lib/calculations';
import { CustomSelect } from '../components/CustomSelect';
import type { CashierShift, Expense, User } from '../types/models';
import { Camera, Download, Eye, Plus, Trash2, X } from 'lucide-react';

interface ExpensesPageProps {
  user: User;
  activeShift?: CashierShift;
  onBack?: () => void;
}

export const ExpensesPage: React.FC<ExpensesPageProps> = ({ user, activeShift, onBack }) => {
  const isOwner = user.role === 'owner' || user.role === 'manager';
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? [];
  const expenses = useLiveQuery(() => db.expenses.toArray()) ?? [];

  const [selectedCat, setSelectedCat] = useState('Semua');
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [previewExpense, setPreviewExpense] = useState<Expense | null>(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  // Form Pengeluaran Manual
  const [tanggal, setTanggal] = useState(todayStr);
  const [categoryId, setCategoryId] = useState('cat-lain');
  const [nominal, setNominal] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [biayaTetap, setBiayaTetap] = useState(false);
  const [lampiranFoto, setLampiranFoto] = useState<string | undefined>(undefined);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const isOwnerOnlyCat = (nama: string) => /^(gaji|sewa)$/i.test(nama.trim());

  const visibleCategories = useMemo(
    () =>
      isOwner
        ? categories
        : categories.filter((c) => !c.isSystem && !isOwnerOnlyCat(c.nama)),
    [categories, isOwner]
  );

  const currentMonth = todayStr.slice(0, 7);

  const validExpenses = useMemo(() => {
    return expenses
      .filter((e) => {
        if (e.dibatalkan) return false;
        // Kasir hanya melihat catatan kas kecil milik SHIFT AKTIF ini (tidak tercampur dengan shift sebelumnya!)
        if (!isOwner) {
          if (activeShift) {
            return (
              e.pembuatId === activeShift.kasirId &&
              e.sumber === 'manual' &&
              e.createdAt >= activeShift.waktuBuka
            );
          }
          return e.tanggal === todayStr && e.pembuatId === user.id && e.sumber === 'manual';
        }
        return true;
      })
      .sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.createdAt.localeCompare(a.createdAt));
  }, [expenses, isOwner, activeShift, todayStr, user.id]);

  const totalRingkasan = useMemo(
    () =>
      isOwner
        ? validExpenses
            .filter((e) => e.tanggal.startsWith(currentMonth))
            .reduce((s, e) => s + e.nominal, 0)
        : validExpenses.reduce((s, e) => s + e.nominal, 0),
    [validExpenses, currentMonth, isOwner]
  );

  const filteredExpenses = useMemo(() => {
    if (selectedCat === 'Semua') return validExpenses;
    return validExpenses.filter((e) => e.categoryNama === selectedCat);
  }, [validExpenses, selectedCat]);

  const selectedCategoryObj = catMap.get(categoryId);
  const canMarkFixed = isOwner && (selectedCategoryObj ? !selectedCategoryObj.sudahMasukHpp : true);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLampiranFoto(String(reader.result));
    reader.readAsDataURL(file);
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const nom = Number(nominal);
    if (!categoryId || nom <= 0) return;

    const cat = catMap.get(categoryId);
    const id = uuidv4();
    const exp: Expense = {
      id,
      tanggal,
      categoryId,
      categoryNama: cat?.nama ?? 'Lain-lain',
      nominal: nom,
      keterangan: keterangan.trim() || cat?.nama || 'Pengeluaran',
      lampiranFoto,
      biayaTetap: canMarkFixed ? biayaTetap : false,
      sumber: 'manual',
      pembuatId: user.id,
      pembuatNama: user.nama,
      createdAt: new Date().toISOString(),
      syncStatus: navigator.onLine ? 'synced' : 'pending',
    };

    await db.expenses.add(exp);
    await addAuditLog(user, 'TAMBAH_PENGELUARAN', exp.categoryNama, `${exp.keterangan} · Rp${nom}`);
    sendDeviceNotification({
      title: `Pengeluaran: ${exp.categoryNama}`,
      body: `${formatRupiah(nom)} · ${exp.keterangan} (${user.nama})`,
      dedupKey: `exp-new-${id}`,
      broadcastFcm: true,
    });
    await enqueueSync('expense', id, 'upsert', exp);

    setNominal('');
    setKeterangan('');
    setBiayaTetap(false);
    setLampiranFoto(undefined);
    setShowAddSheet(false);
  };

  return (
    <div className="px-3.5 sm:px-5 pt-4 sm:pt-5 pb-6 flex flex-col gap-3.5 w-full max-w-full overflow-x-hidden">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div className="min-w-0">
          <h1 className="text-[20px] sm:text-[22px] font-bold">
            {isOwner ? 'Pengeluaran' : 'Kas Kecil / Belanja'}
          </h1>
          <div className="text-xs text-[#6b6a68]">
            {isOwner
              ? `Bulan ini · total ${formatRupiah(totalRingkasan)}`
              : `Hari ini · total ${formatRupiah(totalRingkasan)}`}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 shrink-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="h-9 px-2.5 sm:px-3 rounded-full border border-[#d6d3c8] bg-white text-xs sm:text-[13px] font-medium whitespace-nowrap"
            >
              ‹ Laporan
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (!isOwner) setTanggal(todayStr);
              setShowAddSheet(true);
            }}
            className="h-9 px-3 rounded-full bg-[#1F7A5A] text-white text-xs sm:text-[13px] font-medium flex items-center gap-1 whitespace-nowrap"
          >
            <Plus size={14} /> Catat
          </button>
        </div>
      </div>

      {/* Filter Kategori */}
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {['Semua', ...visibleCategories.map((c) => c.nama)].map((nama) => (
          <button
            key={nama}
            type="button"
            onClick={() => setSelectedCat(nama)}
            className={`h-[34px] px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap border ${
              selectedCat === nama
                ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                : 'bg-white border-[#d6d3c8] text-[#1f1e1d]'
            }`}
          >
            {nama}
          </button>
        ))}
      </div>

      {/* Daftar Pengeluaran (Grid 2-3 kolom di Tablet/Desktop) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filteredExpenses.length === 0 ? (
          <div className="col-span-full bg-white border border-[#e2e0d8] rounded-xl p-6 text-center text-xs text-[#6b6a68]">
            Belum ada catatan pengeluaran.
          </div>
        ) : (
          filteredExpenses.map((exp) => {
            const cat = catMap.get(exp.categoryId);
            const sudahMasukHpp = cat?.sudahMasukHpp ?? exp.sumber === 'pembelian';
            return (
              <div
                key={exp.id}
                className="bg-white border border-[#e2e0d8] rounded-xl px-3.5 py-3 flex justify-between items-center gap-3"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{exp.categoryNama}</div>
                  <div className="text-xs text-[#6b6a68] truncate">
                    {exp.keterangan} · {formatTanggalPendek(exp.tanggal)}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {sudahMasukHpp && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[10px] bg-[#e4f1ea] text-[#1F7A5A]">
                        Sudah masuk HPP
                      </span>
                    )}
                    {exp.sumber === 'pembelian' && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[10px] bg-[#ece9e0] text-[#4a4947]">
                        Dari pembelian
                      </span>
                    )}
                    {exp.biayaTetap && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[10px] bg-[#ece9e0] text-[#4a4947]">
                        Biaya tetap bulanan
                      </span>
                    )}
                    {exp.lampiranFoto && (
                      <button
                        type="button"
                        onClick={() => setPreviewExpense(exp)}
                        className="text-[11px] font-semibold px-2.5 py-0.5 rounded-[10px] bg-[#e4f1ea] hover:bg-[#d3e8dc] text-[#1F7A5A] border border-[#c5dfd1] inline-flex items-center gap-1 transition"
                      >
                        <Eye size={11} /> Lihat Nota
                      </button>
                    )}
                  </div>
                </div>
                <div className="font-semibold text-sm shrink-0">{formatRupiah(exp.nominal)}</div>
              </div>
            );
          })
        )}
      </div>

      {isOwner && (
        <div className="text-xs text-[#6b6a68] px-0.5">
          Kategori “Sudah masuk HPP” tetap tercatat dan masuk arus kas, tetapi tidak dikurangkan lagi dari laba.
        </div>
      )}

      {/* Modal Catat Pengeluaran */}
      {showAddSheet && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3 max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-base font-bold">
                  {isOwner ? 'Catat pengeluaran' : 'Catat belanja langsung'}
                </div>
                <div className="text-xs text-[#6b6a68]">
                  {isOwner ? 'Pengeluaran operasional / kas toko' : 'Kas kecil harian (es batu, plastik, tisu, dll.)'}
                </div>
              </div>
              <button type="button" onClick={() => setShowAddSheet(false)}>
                <X size={20} className="text-[#6b6a68]" />
              </button>
            </div>

            <form onSubmit={handleSaveExpense} className="flex flex-col gap-3">
              <div className={isOwner ? 'grid grid-cols-2 gap-2.5' : 'flex flex-col'}>
                {isOwner && (
                  <div>
                    <label className="block text-xs font-medium text-[#4a4947] mb-1">Tanggal</label>
                    <input
                      type="date"
                      value={tanggal}
                      onChange={(e) => setTanggal(e.target.value)}
                      className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                      required
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Kategori</label>
                  <CustomSelect
                    value={categoryId}
                    onChange={(val) => {
                      setCategoryId(val);
                      const c = catMap.get(val);
                      if (c?.sudahMasukHpp) setBiayaTetap(false);
                    }}
                    options={visibleCategories
                      .filter((c) => !c.isSystem)
                      .map((c) => ({
                        value: c.id,
                        label: c.nama,
                      }))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">Nominal (Rp)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatRibuanInput(nominal)}
                  onChange={(e) => setNominal(stripNonDigits(e.target.value))}
                  placeholder="45.000"
                  className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">Keterangan</label>
                <input
                  type="text"
                  value={keterangan}
                  onChange={(e) => setKeterangan(e.target.value)}
                  placeholder={isOwner ? 'Contoh: Lap kasir dan plastik' : 'Contoh: Beli es batu, galon, plastik'}
                  className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                  required
                />
              </div>

              {canMarkFixed && (
                <div className="flex justify-between items-center py-1">
                  <span className="text-[13px]">Tandai biaya tetap bulanan (untuk BEP)</span>
                  <button
                    type="button"
                    onClick={() => setBiayaTetap((v) => !v)}
                    className={`w-11 h-[26px] rounded-full relative transition ${
                      biayaTetap ? 'bg-[#1F7A5A]' : 'bg-[#cfcbbf]'
                    }`}
                  >
                    <span
                      className={`absolute top-[3px] w-5 h-5 rounded-full bg-white transition-all ${
                        biayaTetap ? 'right-[3px]' : 'left-[3px]'
                      }`}
                    />
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[#6b6a68]">
                    {lampiranFoto ? 'Foto nota terlampir ✓' : 'Lampiran foto nota (opsional)'}
                  </span>
                  <label className="text-[13px] font-semibold text-[#1F7A5A] cursor-pointer flex items-center gap-1">
                    <Camera size={14} /> {lampiranFoto ? 'Ganti foto' : '+ Foto nota'}
                    <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                  </label>
                </div>
                {lampiranFoto && (
                  <div className="relative rounded-xl border border-[#e2e0d8] bg-[#faf9f5] p-2 flex items-center gap-3">
                    <img
                      src={lampiranFoto}
                      alt="Preview nota"
                      className="w-16 h-16 rounded-lg object-cover border border-[#d6d3c8] shrink-0"
                    />
                    <div className="flex-1 min-w-0 text-[11px] text-[#4a4947]">
                      Foto nota siap disimpan bersama pengeluaran ini.
                    </div>
                    <button
                      type="button"
                      onClick={() => setLampiranFoto(undefined)}
                      title="Hapus foto nota"
                      className="p-1.5 rounded-lg text-[#9b1c12] hover:bg-[#fbe4e1] shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="h-12 rounded-[10px] bg-[#1F7A5A] text-white font-semibold text-[15px] mt-1"
              >
                Simpan pengeluaran
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal Preview Foto Nota Pengeluaran */}
      {previewExpense && previewExpense.lampiranFoto && (
        <div
          className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4"
          onClick={() => setPreviewExpense(null)}
        >
          <div
            className="bg-white w-full max-w-[480px] rounded-2xl p-4 flex flex-col gap-3 max-h-[90vh] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 border-b border-[#eeece5] pb-2.5">
              <div className="min-w-0">
                <div className="font-bold text-sm text-[#1f1e1d] truncate">
                  Foto Nota · {previewExpense.categoryNama}
                </div>
                <div className="text-xs text-[#6b6a68] truncate">
                  {previewExpense.keterangan} · {formatTanggalPendek(previewExpense.tanggal)} ·{' '}
                  <strong className="text-[#1F7A5A]">{formatRupiah(previewExpense.nominal)}</strong>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewExpense(null)}
                className="p-1 rounded-lg text-[#6b6a68] hover:bg-[#ece9e0]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-2 flex items-center justify-center overflow-auto max-h-[65vh]">
              <img
                src={previewExpense.lampiranFoto}
                alt={`Nota ${previewExpense.keterangan}`}
                className="max-w-full max-h-[60vh] object-contain rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-2">
              <a
                href={previewExpense.lampiranFoto}
                download={`nota-${previewExpense.tanggal}-${previewExpense.categoryNama.replace(/\s+/g, '-').toLowerCase()}.png`}
                className="h-9 px-3.5 rounded-xl border border-[#1F7A5A] text-[#1F7A5A] hover:bg-[#e4f1ea] text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Download size={14} /> Unduh Nota
              </a>
              <button
                type="button"
                onClick={() => setPreviewExpense(null)}
                className="h-9 px-4 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white text-xs font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

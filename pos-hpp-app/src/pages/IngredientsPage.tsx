import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database';
import {
  addAuditLog,
  cancelPurchase,
  enqueueSync,
  recalculateAllPricingAndHpp,
  recordPurchase,
} from '../db/actions';
import { deleteIngredientFromSupabase } from '../services/syncService';
import {
  formatRibuanInput,
  formatRupiah,
  formatTanggalPendek,
  stripNonDigits,
} from '../lib/calculations';
import { CustomSelect } from '../components/CustomSelect';
import type { BaseUnit, Ingredient, User } from '../types/models';
import { Edit3, Plus, Trash2, X } from 'lucide-react';

interface IngredientsPageProps {
  user: User;
}

export const IngredientsPage: React.FC<IngredientsPageProps> = ({ user }) => {
  const settings = useLiveQuery(() => db.settings.get('global'));
  const ingredients = useLiveQuery(() => db.ingredients.toArray()) ?? [];
  const purchases = useLiveQuery(() => db.purchases.toArray()) ?? [];
  const recipes = useLiveQuery(() => db.recipes.toArray()) ?? [];

  const isManagerOrOwner = user.role === 'owner' || user.role === 'manager';

  const [selectedIngId, setSelectedIngId] = useState<string>('ing-telur');
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showAddIngredientModal, setShowAddIngredientModal] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null);
  const [ingModalError, setIngModalError] = useState('');

  // Form pembelian
  const [pIngId, setPIngId] = useState('');
  const [pTanggal, setPTanggal] = useState(new Date().toISOString().slice(0, 10));
  const [pJumlahBeli, setPJumlahBeli] = useState('1');
  const [pSatuanBeli, setPSatuanBeli] = useState('kg');
  const [pTotalHarga, setPTotalHarga] = useState('');
  const [pSatuanDasarDidapat, setPSatuanDasarDidapat] = useState('');
  const [pPenjual, setPPenjual] = useState('');

  // Form tambah bahan
  const [newNama, setNewNama] = useState('');
  const [newSatuanDasar, setNewSatuanDasar] = useState<BaseUnit>('gram');
  const [newLabelSatuan, setNewLabelSatuan] = useState('gram');

  const activeIngredients = useMemo(
    () => ingredients.filter((i) => i.active),
    [ingredients]
  );

  const selectedIng: Ingredient | undefined =
    activeIngredients.find((i) => i.id === selectedIngId) ?? activeIngredients[0];

  const selectedPurchases = useMemo(() => {
    if (!selectedIng) return [];
    return purchases
      .filter((p) => p.ingredientId === selectedIng.id && !p.dibatalkan)
      .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.createdAt.localeCompare(b.createdAt));
  }, [purchases, selectedIng]);

  const purchaseCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of purchases) {
      if (!p.dibatalkan) {
        map.set(p.ingredientId, (map.get(p.ingredientId) ?? 0) + 1);
      }
    }
    return map;
  }, [purchases]);

  const openPurchaseModal = (ingId?: string) => {
    const target = ingId ?? selectedIng?.id ?? activeIngredients[0]?.id ?? '';
    setPIngId(target);
    setPTanggal(new Date().toISOString().slice(0, 10));
    setPJumlahBeli('1');
    setPSatuanBeli('kg');
    setPTotalHarga('');
    setPSatuanDasarDidapat('');
    setPPenjual('');
    setShowPurchaseModal(true);
  };

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = Number(pTotalHarga);
    const dasar = Number(pSatuanDasarDidapat);
    const jml = Number(pJumlahBeli) || 1;
    if (!pIngId || total <= 0 || dasar <= 0) return;

    await recordPurchase(
      {
        ingredientId: pIngId,
        tanggal: pTanggal,
        jumlahBeli: jml,
        satuanBeli: pSatuanBeli || 'unit',
        totalHarga: total,
        satuanDasarDidapat: dasar,
        penjual: pPenjual,
      },
      user
    );
    setSelectedIngId(pIngId);
    setShowPurchaseModal(false);
  };

  const normalizeIngName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

  const openAddIngredientModal = () => {
    setEditingIngredient(null);
    setNewNama('');
    setNewSatuanDasar('gram');
    setNewLabelSatuan('gram');
    setIngModalError('');
    setShowAddIngredientModal(true);
  };

  const openEditIngredientModal = (ing: Ingredient, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingIngredient(ing);
    setNewNama(ing.nama);
    setNewSatuanDasar(ing.satuanDasar);
    setNewLabelSatuan(ing.labelSatuanDasar);
    setIngModalError('');
    setShowAddIngredientModal(true);
  };

  const handleSaveIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    setIngModalError('');
    const cleanNama = newNama.trim().replace(/\s+/g, ' ');
    if (!cleanNama) return;

    // Cegah nama bahan kembar (case-insensitive, mis. "Telor" vs "telor")
    const duplicate = activeIngredients.find(
      (i) =>
        i.id !== editingIngredient?.id &&
        normalizeIngName(i.nama) === normalizeIngName(cleanNama)
    );
    if (duplicate) {
      setIngModalError(
        `Bahan baku "${duplicate.nama}" sudah terdaftar (satuan: ${duplicate.labelSatuanDasar}). Gunakan bahan yang sudah ada atau beri nama lebih spesifik.`
      );
      return;
    }

    const nowIso = new Date().toISOString();
    const cleanLabel = newLabelSatuan.trim() || newSatuanDasar;

    if (editingIngredient) {
      const hasPurchases = (purchaseCountMap.get(editingIngredient.id) ?? 0) > 0;
      const usedInRecipe = recipes.some((r) =>
        r.items.some((it) => it.type === 'ingredient' && it.refId === editingIngredient.id)
      );
      const finalSatuanDasar =
        hasPurchases || usedInRecipe ? editingIngredient.satuanDasar : newSatuanDasar;

      const updated: Ingredient = {
        ...editingIngredient,
        nama: cleanNama,
        satuanDasar: finalSatuanDasar,
        labelSatuanDasar: cleanLabel,
        updatedAt: nowIso,
      };
      await db.ingredients.put(updated);
      await addAuditLog(user, 'UBAH_BAHAN', cleanNama, `Satuan: ${cleanLabel}`);
      await enqueueSync('master', updated.id, 'upsert', updated);
      setSelectedIngId(updated.id);
    } else {
      const id = uuidv4();
      const created: Ingredient = {
        id,
        nama: cleanNama,
        satuanDasar: newSatuanDasar,
        labelSatuanDasar: cleanLabel,
        hargaAktif: 0,
        active: true,
        updatedAt: nowIso,
      };
      await db.ingredients.add(created);
      await addAuditLog(user, 'TAMBAH_BAHAN', cleanNama, `Satuan: ${cleanLabel}`);
      await enqueueSync('master', id, 'upsert', created);
      setSelectedIngId(id);
    }

    setNewNama('');
    setEditingIngredient(null);
    setShowAddIngredientModal(false);
  };

  const handleDeleteIngredient = async (ing: Ingredient, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    // Cek apakah bahan sedang dipakai di resep mana pun
    const usedByRecipes = recipes.filter((r) =>
      r.items.some((it) => it.type === 'ingredient' && it.refId === ing.id)
    );
    if (usedByRecipes.length > 0) {
      const recipeNames = usedByRecipes.map((r) => r.nama).join(', ');
      alert(
        `Bahan "${ing.nama}" tidak dapat dihapus karena sedang digunakan pada resep:\n\n• ${recipeNames}\n\nSilakan hapus atau ganti bahan ini di resep tersebut terlebih dahulu.`
      );
      return;
    }

    const cnt = purchaseCountMap.get(ing.id) ?? 0;
    const msg =
      cnt > 0
        ? `Hapus bahan baku "${ing.nama}"?\n\nBahan ini memiliki ${cnt} catatan pembelian namun tidak dipakai di resep mana pun.`
        : `Hapus bahan baku "${ing.nama}" secara permanen?`;
    if (!confirm(msg)) return;

    await db.ingredients.delete(ing.id);
    await addAuditLog(user, 'HAPUS_BAHAN', ing.nama, 'Bahan baku dihapus');
    const cloudRes = await deleteIngredientFromSupabase(ing.id);
    if (!cloudRes.success) {
      await enqueueSync('master', ing.id, 'delete', { table: 'ingredients', id: ing.id });
    }
    await recalculateAllPricingAndHpp();
  };

  // Hitung titik SVG grafik tren harga (persis desain mockup)
  const chartPoints = useMemo(() => {
    const list = selectedPurchases.slice(-6);
    if (list.length === 0) return [];
    const prices = list.map((p) => p.hargaPerSatuanDasar);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const span = maxP - minP || 1;
    const width = 300;
    const startX = list.length === 1 ? 165 : 35;
    const stepX = list.length > 1 ? (width - 40) / (list.length - 1) : 0;

    return list.map((p, idx) => {
      const x = startX + idx * stepX;
      const y = list.length === 1 ? 40 : 54 - ((p.hargaPerSatuanDasar - minP) / span) * 32;
      return { x, y, purchase: p };
    });
  }, [selectedPurchases]);

  const nMethodLabel =
    settings?.metodeHargaBahan === 'last'
      ? 'Harga terakhir'
      : `Rata-rata ${settings?.jumlahPembelianN ?? 5} pembelian`;

  const nSlice = selectedPurchases.slice(-(settings?.jumlahPembelianN ?? 5));
  const sumPriceN = nSlice.reduce((s, p) => s + p.totalHarga, 0);
  const sumQtyN = nSlice.reduce((s, p) => s + p.satuanDasarDidapat, 0);

  return (
    <div className="px-5 pt-5 pb-6 flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[22px] font-bold">Bahan Baku</h1>
        <div className="flex items-center gap-2">
          {isManagerOrOwner && (
            <button
              type="button"
              onClick={openAddIngredientModal}
              className="h-9 px-3 rounded-full border border-[#d6d3c8] bg-white text-xs font-medium text-[#1f1e1d] flex items-center gap-1"
            >
              <Plus size={14} /> Bahan
            </button>
          )}
          <button
            type="button"
            onClick={() => openPurchaseModal()}
            className="h-9 px-3.5 rounded-full bg-[#1F7A5A] text-white text-[13px] font-medium flex items-center gap-1"
          >
            + Pembelian
          </button>
        </div>
      </div>

      {/* Info metode harga bahan */}
      <div className="bg-white border border-[#e2e0d8] rounded-xl px-3.5 py-3 flex flex-col gap-1.5">
        <div className="flex justify-between items-center">
          <span className="text-xs text-[#6b6a68]">Metode harga bahan</span>
          <span className="text-[13px] font-semibold text-[#1F7A5A]">{nMethodLabel}</span>
        </div>
        <div className="text-xs text-[#6b6a68]">
          Bisa diubah di Pengaturan: harga terakhir, atau rata-rata N pembelian.
        </div>
      </div>

      {/* Layout 2 Kolom di Tablet/Desktop: Kiri Daftar Bahan, Kanan Riwayat & Grafik */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Daftar Bahan Baku */}
        <div className="lg:col-span-5 bg-white border border-[#e2e0d8] rounded-xl overflow-hidden divide-y divide-[#eeece5]">
          {activeIngredients.map((ing) => {
            const isSelected = selectedIng?.id === ing.id;
            const cnt = purchaseCountMap.get(ing.id) ?? 0;
            return (
              <div
                key={ing.id}
                onClick={() => setSelectedIngId(ing.id)}
                className={`w-full text-left px-3.5 py-3 flex justify-between items-center gap-2 cursor-pointer transition ${
                  isSelected ? 'bg-[#f4f9f6]' : 'hover:bg-[#faf9f5]'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                    <span className="truncate">{ing.nama}</span>
                    {ing.hargaAktif <= 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#fbeed9] text-[#7a4300]">
                        Belum ada harga
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#6b6a68]">
                    Satuan dasar: {ing.labelSatuanDasar} · {cnt} pembelian
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className="font-semibold text-sm">{formatRupiah(ing.hargaAktif)}</div>
                    <div className="text-xs text-[#6b6a68]">per {ing.labelSatuanDasar}</div>
                  </div>
                  {isManagerOrOwner && (
                    <div className="flex items-center gap-1 pl-1 border-l border-[#eeece5]">
                      <button
                        type="button"
                        title={`Edit ${ing.nama}`}
                        onClick={(e) => openEditIngredientModal(ing, e)}
                        className="p-1.5 rounded-lg text-[#1F7A5A] hover:bg-[#e4f1ea] transition"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        type="button"
                        title={`Hapus ${ing.nama}`}
                        onClick={(e) => handleDeleteIngredient(ing, e)}
                        className="p-1.5 rounded-lg text-[#9b1c12] hover:bg-[#fbe4e1] transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Riwayat Harga & Grafik Tren */}
        {selectedIng && (
          <div className="lg:col-span-7 flex flex-col gap-3.5">
            <div className="bg-white border border-[#e2e0d8] rounded-xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div className="font-bold text-[15px]">Riwayat harga: {selectedIng.nama}</div>
                <span className="text-xs text-[#6b6a68]">Grafik tren</span>
              </div>

              {chartPoints.length > 0 ? (
                <svg width="100%" height="110" viewBox="0 0 330 92" role="img" aria-label="Tren harga bahan">
                  <line x1="0" y1="78" x2="330" y2="78" stroke="#e2e0d8" strokeWidth="1" />
                  {chartPoints.length > 1 && (
                    <polyline
                      points={chartPoints.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                      fill="none"
                      stroke="#1F7A5A"
                      strokeWidth="2.5"
                    />
                  )}
                  {chartPoints.map((pt) => (
                    <g key={pt.purchase.id}>
                      <circle cx={pt.x} cy={pt.y} r="4.5" fill="#1F7A5A" />
                      <text
                        x={pt.x}
                        y={pt.y - 10}
                        fontSize="10.5"
                        fill="#4a4947"
                        textAnchor="middle"
                      >
                        {formatRupiah(pt.purchase.hargaPerSatuanDasar)}
                      </text>
                      <text
                        x={pt.x}
                        y={72}
                        fontSize="10"
                        fill="#6b6a68"
                        textAnchor="middle"
                      >
                        {formatTanggalPendek(pt.purchase.tanggal)}
                      </text>
                    </g>
                  ))}
                </svg>
              ) : (
                <div className="text-xs text-[#6b6a68] py-4 text-center">
                  Belum ada catatan pembelian untuk bahan ini.
                </div>
              )}

              {selectedPurchases.length > 0 && (
                <div className="border-t border-[#eeece5] pt-2.5 flex flex-col gap-2.5">
                  {[...selectedPurchases].reverse().map((p) => (
                    <div key={p.id} className="flex justify-between items-center gap-2">
                      <div>
                        <div className="font-medium text-[13px]">
                          {formatTanggalPendek(p.tanggal)} · {p.jumlahBeli} {p.satuanBeli} →{' '}
                          {p.satuanDasarDidapat} {selectedIng.labelSatuanDasar}
                        </div>
                        <div className="text-xs text-[#6b6a68]">
                          Total {formatRupiah(p.totalHarga)}
                          {p.penjual ? ` · ${p.penjual}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">
                          {formatRupiah(p.hargaPerSatuanDasar)}
                        </span>
                        {user.role === 'owner' && (
                          <button
                            type="button"
                            title="Batalkan pembelian"
                            onClick={() => {
                              if (confirm('Batalkan catatan pembelian ini? Harga bahan & HPP akan dihitung ulang.')) {
                                cancelPurchase(p.id, user);
                              }
                            }}
                            className="p-1 text-[#9b1c12] hover:bg-[#fbe4e1] rounded"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#e4f1ea] border border-[#c5dfd1] rounded-xl p-3.5 flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <span className="text-xs text-[#1f4d3a]">Harga dipakai di HPP</span>
                <span className="font-bold text-[#1F7A5A] text-[17px]">
                  {formatRupiah(selectedIng.hargaAktif)}/{selectedIng.labelSatuanDasar}
                </span>
              </div>
              <div className="text-xs text-[#1f4d3a]">
                {nSlice.length > 0 && settings?.metodeHargaBahan !== 'last'
                  ? `Rata-rata ${nSlice.length} pembelian: ${formatRupiah(sumPriceN)} ÷ ${sumQtyN} ${selectedIng.labelSatuanDasar}. Otomatis memperbarui HPP resep yang memakai ${selectedIng.nama.toLowerCase()}.`
                  : `Otomatis memperbarui HPP seluruh resep yang memakai ${selectedIng.nama.toLowerCase()}.`}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="text-xs text-[#6b6a68] px-0.5">
        Setiap pembelian otomatis tercatat sebagai pengeluaran Bahan Baku.
      </div>

      {/* Modal Catat Pembelian */}
      {showPurchaseModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3.5 max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="flex justify-between items-center">
              <div className="text-base font-bold">Catat Pembelian Bahan</div>
              <button type="button" onClick={() => setShowPurchaseModal(false)}>
                <X size={20} className="text-[#6b6a68]" />
              </button>
            </div>

            <form onSubmit={handleSavePurchase} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">Bahan Baku</label>
                <CustomSelect
                  title="Pilih Bahan Baku"
                  value={pIngId}
                  onChange={(val) => setPIngId(val)}
                  options={activeIngredients.map((i) => ({
                    value: i.id,
                    label: `${i.nama} (satuan dasar: ${i.labelSatuanDasar})`,
                  }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Tanggal</label>
                  <input
                    type="date"
                    value={pTanggal}
                    onChange={(e) => setPTanggal(e.target.value)}
                    className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Total Harga (Rp)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatRibuanInput(pTotalHarga)}
                    onChange={(e) => setPTotalHarga(stripNonDigits(e.target.value))}
                    placeholder="28.000"
                    className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Jumlah Dibeli</label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    value={pJumlahBeli}
                    onChange={(e) => setPJumlahBeli(e.target.value)}
                    className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Satuan Beli</label>
                  <input
                    type="text"
                    value={pSatuanBeli}
                    onChange={(e) => setPSatuanBeli(e.target.value)}
                    placeholder="kg / liter / pack"
                    className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">
                  Satuan Dasar Didapat (
                  {activeIngredients.find((i) => i.id === pIngId)?.labelSatuanDasar ?? 'unit'})
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  value={pSatuanDasarDidapat}
                  onChange={(e) => setPSatuanDasarDidapat(e.target.value)}
                  placeholder="Contoh: 15 (untuk 1 kg telur dapat 15 butir)"
                  className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                  required
                />
                {Number(pTotalHarga) > 0 && Number(pSatuanDasarDidapat) > 0 && (
                  <div className="text-xs text-[#1F7A5A] font-medium mt-1">
                    Harga per satuan dasar:{' '}
                    {formatRupiah(Number(pTotalHarga) / Number(pSatuanDasarDidapat))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">
                  Penjual / Toko (opsional)
                </label>
                <input
                  type="text"
                  value={pPenjual}
                  onChange={(e) => setPPenjual(e.target.value)}
                  placeholder="Agen Telur Jaya"
                  className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                />
              </div>

              <button
                type="submit"
                className="mt-1 h-12 rounded-[10px] bg-[#1F7A5A] text-white font-semibold text-[15px]"
              >
                Simpan Pembelian
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tambah / Edit Bahan Baku */}
      {showAddIngredientModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xl">
            <div className="flex justify-between items-center">
              <div className="text-base font-bold">
                {editingIngredient ? `Edit Bahan: ${editingIngredient.nama}` : 'Tambah Bahan Baku'}
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingIngredient(null);
                  setShowAddIngredientModal(false);
                }}
              >
                <X size={20} className="text-[#6b6a68]" />
              </button>
            </div>
            <form onSubmit={handleSaveIngredient} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">Nama Bahan</label>
                <input
                  type="text"
                  value={newNama}
                  onChange={(e) => {
                    setNewNama(e.target.value);
                    setIngModalError('');
                  }}
                  placeholder="Contoh: Bawang Merah"
                  className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Jenis Satuan</label>
                  <CustomSelect
                    title="Pilih Jenis Satuan Dasar"
                    value={newSatuanDasar}
                    onChange={(v) => {
                      if (
                        editingIngredient &&
                        ((purchaseCountMap.get(editingIngredient.id) ?? 0) > 0 ||
                          recipes.some((r) =>
                            r.items.some(
                              (it) => it.type === 'ingredient' && it.refId === editingIngredient.id
                            )
                          ))
                      ) {
                        return;
                      }
                      const val = v as BaseUnit;
                      setNewSatuanDasar(val);
                      setNewLabelSatuan(val === 'qty' ? 'pcs' : val);
                    }}
                    options={[
                      { value: 'gram', label: 'gram (berat)' },
                      { value: 'ml', label: 'ml (cair)' },
                      { value: 'qty', label: 'qty (pcs/butir)' },
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Label Satuan</label>
                  <input
                    type="text"
                    value={newLabelSatuan}
                    onChange={(e) => setNewLabelSatuan(e.target.value)}
                    placeholder="gram / ml / butir"
                    className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>
              </div>
              {editingIngredient &&
                ((purchaseCountMap.get(editingIngredient.id) ?? 0) > 0 ||
                  recipes.some((r) =>
                    r.items.some((it) => it.type === 'ingredient' && it.refId === editingIngredient.id)
                  )) && (
                  <div className="text-[11px] text-[#6b6a68] bg-[#faf9f5] border border-[#e2e0d8] rounded-lg px-3 py-2">
                    Jenis satuan dasar dikunci karena bahan ini sudah memiliki riwayat pembelian atau dipakai di resep. Nama bahan &amp; label satuan tetap dapat diubah.
                  </div>
                )}
              {ingModalError && (
                <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-lg">
                  {ingModalError}
                </div>
              )}
              <button
                type="submit"
                className="mt-1 h-12 rounded-[10px] bg-[#1F7A5A] text-white font-semibold text-[15px]"
              >
                {editingIngredient ? 'Simpan Perubahan' : 'Simpan Bahan'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

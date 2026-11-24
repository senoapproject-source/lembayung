import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database';
import { deleteMenu, saveMenu, saveRecipe } from '../db/actions';
import {
  calcActualMargin,
  calcRecipeHpp,
  calcSuggestedPrice,
  formatPercent,
  formatRibuanInput,
  formatRupiah,
  hasCircularRecipeReference,
  stripNonDigits,
} from '../lib/calculations';
import { CustomSelect } from '../components/CustomSelect';
import type { MenuItem, Recipe, RecipeItem, RecipeOtherCost, User } from '../types/models';
import { Plus, Trash2, X } from 'lucide-react';

interface RecipesMenuPageProps {
  user: User;
}

export const RecipesMenuPage: React.FC<RecipesMenuPageProps> = ({ user }) => {
  const settings = useLiveQuery(() => db.settings.get('global'));
  const ingredients = useLiveQuery(() => db.ingredients.toArray()) ?? [];
  const recipes = useLiveQuery(() => db.recipes.toArray()) ?? [];
  const menus = useLiveQuery(() => db.menus.toArray()) ?? [];

  const [subTab, setSubTab] = useState<'resep' | 'menu'>('menu');
  const [selectedKategori, setSelectedKategori] = useState('Semua');

  // Modal Menu
  const [editingMenu, setEditingMenu] = useState<MenuItem | null>(null);
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [mRecipeId, setMRecipeId] = useState('');
  const [mHppManual, setMHppManual] = useState('');
  const [mNama, setMNama] = useState('');
  const [mKategori, setMKategori] = useState('Makanan');
  const [mHargaJual, setMHargaJual] = useState('');
  const [mTargetMargin, setMTargetMargin] = useState('');
  const [savingMenu, setSavingMenu] = useState(false);

  // Modal Resep
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [rNama, setRNama] = useState('');
  const [rPorsi, setRPorsi] = useState('1');
  const [rIsSubRecipe, setRIsSubRecipe] = useState(false);
  const [rItems, setRItems] = useState<RecipeItem[]>([]);
  const [rBiayaLain, setRBiayaLain] = useState<RecipeOtherCost[]>([]);
  const [rError, setRError] = useState('');

  const defaultMargin = settings?.defaultMarginPersen ?? 40;
  const roundingStep = settings?.pembulatanHarga ?? 500;

  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const recMap = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);

  const categories = useMemo(() => {
    const set = new Set(['Semua', 'Makanan', 'Minuman']);
    menus.forEach((m) => set.add(m.kategori));
    return Array.from(set);
  }, [menus]);

  const menuWithMetrics = useMemo(() => {
    return menus.map((m) => {
      const rec = m.recipeId ? recMap.get(m.recipeId) : undefined;
      const hasRecipe = Boolean(rec);
      const hpp = rec ? rec.hppPerPorsi : m.hppManual ?? 0;
      const hasHpp = hasRecipe || (m.hppManual !== undefined && m.hppManual > 0);
      const targetMargin = m.targetMarginPersen ?? defaultMargin;
      const margin = hasHpp ? calcActualMargin(m.hargaJual, hpp) : 0;
      const labaPerPorsi = m.hargaJual - hpp;
      const suggested = hasHpp ? calcSuggestedPrice(hpp, targetMargin, roundingStep) : 0;
      const isBelowHpp = hasHpp && m.hargaJual < hpp;
      const isBelowTarget = hasHpp && !isBelowHpp && margin < targetMargin;
      return {
        menu: m,
        hasRecipe,
        hasHpp,
        hpp,
        targetMargin,
        margin,
        labaPerPorsi,
        suggested,
        isBelowHpp,
        isBelowTarget,
      };
    });
  }, [menus, recMap, defaultMargin, roundingStep]);

  const filteredMenus = useMemo(() => {
    if (selectedKategori === 'Semua') return menuWithMetrics;
    return menuWithMetrics.filter((x) => x.menu.kategori === selectedKategori);
  }, [menuWithMetrics, selectedKategori]);

  const warningCount = useMemo(
    () => menuWithMetrics.filter((x) => x.isBelowHpp || x.isBelowTarget).length,
    [menuWithMetrics]
  );

  // Open Menu Modal
  const openNewMenuModal = () => {
    setEditingMenu(null);
    setMRecipeId('');
    setMHppManual('');
    setMNama('');
    setMKategori('Makanan');
    setMTargetMargin(String(defaultMargin));
    setMHargaJual('');
    setShowMenuModal(true);
  };

  const openEditMenuModal = (m: MenuItem) => {
    setEditingMenu(m);
    setMRecipeId(m.recipeId || '');
    setMHppManual(!m.recipeId && m.hppManual !== undefined && m.hppManual > 0 ? String(m.hppManual) : '');
    setMNama(m.nama);
    setMKategori(m.kategori);
    setMHargaJual(String(m.hargaJual));
    setMTargetMargin(String(m.targetMarginPersen ?? defaultMargin));
    setShowMenuModal(true);
  };

  const handleSaveMenu = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingMenu) return;
    const hargaNum = Number(mHargaJual);
    if (!mNama.trim() || !Number.isFinite(hargaNum) || hargaNum <= 0) {
      alert('Nama menu dan harga jual yang valid wajib diisi.');
      return;
    }
    const parsedManualHpp = mHppManual.trim() !== '' ? Math.max(0, Number(mHppManual) || 0) : undefined;
    setSavingMenu(true);
    try {
      await saveMenu(
        {
          id: editingMenu?.id ?? uuidv4(),
          recipeId: mRecipeId,
          hppManual: mRecipeId ? undefined : parsedManualHpp,
          nama: mNama.trim(),
          kategori: mKategori.trim() || 'Makanan',
          hargaJual: hargaNum,
          targetMarginPersen: Number(mTargetMargin) || defaultMargin,
          active: editingMenu?.active ?? true,
          updatedAt: new Date().toISOString(),
        },
        user
      );
      setShowMenuModal(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal menyimpan menu.');
    } finally {
      setSavingMenu(false);
    }
  };

  const handleDeleteMenu = async (target: MenuItem) => {
    if (
      !confirm(
        `Hapus menu "${target.nama}" secara permanen?\n\nMenu ini akan hilang dari daftar kasir, namun riwayat transaksi dan laporan lama tetap tersimpan utuh.`
      )
    ) {
      return;
    }
    setSavingMenu(true);
    try {
      await deleteMenu(target.id, user);
      setShowMenuModal(false);
      setEditingMenu(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal menghapus menu.');
    } finally {
      setSavingMenu(false);
    }
  };

  // Open Recipe Modal
  const openNewRecipeModal = () => {
    setEditingRecipeId(null);
    setRNama('');
    setRPorsi('1');
    setRIsSubRecipe(false);
    setRItems(
      ingredients[0]
        ? [{ id: uuidv4(), type: 'ingredient', refId: ingredients[0].id, takaran: 100, susutPersen: 0 }]
        : []
    );
    setRBiayaLain([]);
    setRError('');
    setShowRecipeModal(true);
  };

  const openEditRecipeModal = (r: Recipe) => {
    setEditingRecipeId(r.id);
    setRNama(r.nama);
    setRPorsi(String(r.jumlahPorsiHasil));
    setRIsSubRecipe(r.isSubRecipe);
    setRItems(r.items.map((i) => ({ ...i })));
    setRBiayaLain(r.biayaLain.map((b) => ({ ...b })));
    setRError('');
    setShowRecipeModal(true);
  };

  // Live preview HPP inside Recipe Modal
  const draftRecipe: Recipe = {
    id: editingRecipeId ?? 'draft',
    nama: rNama || 'Draft',
    jumlahPorsiHasil: Math.max(1, Number(rPorsi) || 1),
    isSubRecipe: rIsSubRecipe,
    items: rItems,
    biayaLain: rBiayaLain,
    hppPerPorsi: 0,
    hasMissingPrice: false,
    updatedAt: new Date().toISOString(),
  };
  const draftBreakdown = calcRecipeHpp(draftRecipe, ingMap, recMap);

  const handleSaveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    setRError('');
    if (!rNama.trim() || rItems.length === 0) {
      setRError('Nama resep dan minimal 1 bahan wajib diisi.');
      return;
    }

    const targetId = editingRecipeId ?? uuidv4();
    // Cek circular reference (FR-HPP-04)
    for (const it of rItems) {
      if (it.type === 'sub_recipe') {
        if (hasCircularRecipeReference(targetId, it.refId, recipes)) {
          setRError('Referensi melingkar terdeteksi: sub-resep tidak boleh merujuk kembali ke resep ini.');
          return;
        }
      }
    }

    await saveRecipe(
      {
        ...draftRecipe,
        id: targetId,
        hppPerPorsi: Math.round(draftBreakdown.hppPerPorsi),
        hasMissingPrice: draftBreakdown.hasMissingPrice,
      },
      user
    );
    setShowRecipeModal(false);
  };

  const modalSelectedRec = mRecipeId ? recMap.get(mRecipeId) : undefined;
  const modalManualHppVal = mHppManual.trim() !== '' ? Math.max(0, Number(mHppManual) || 0) : 0;
  const modalHpp = modalSelectedRec ? modalSelectedRec.hppPerPorsi : modalManualHppVal;
  const modalHasHpp = Boolean(modalSelectedRec) || modalManualHppVal > 0;
  const modalTarget = Number(mTargetMargin) || defaultMargin;
  const modalSuggested = modalHasHpp ? calcSuggestedPrice(modalHpp, modalTarget, roundingStep) : 0;
  const modalActualMargin = modalHasHpp ? calcActualMargin(Number(mHargaJual) || 0, modalHpp) : 0;

  return (
    <div className="px-3.5 sm:px-5 pt-4 sm:pt-5 pb-6 flex flex-col gap-3.5 w-full max-w-full overflow-x-hidden">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h1 className="text-[20px] sm:text-[22px] font-bold">Resep &amp; Menu</h1>
        <button
          type="button"
          onClick={subTab === 'menu' ? openNewMenuModal : openNewRecipeModal}
          className="h-9 px-3.5 rounded-full bg-[#1F7A5A] text-white text-[13px] font-medium whitespace-nowrap"
        >
          {subTab === 'menu' ? '+ Menu' : '+ Resep'}
        </button>
      </div>

      {/* Segmented Control (persis Mockup Menu_dan_Harga_Jual.html) */}
      <div className="flex bg-[#ece9e0] rounded-[10px] p-[3px]">
        <button
          type="button"
          onClick={() => setSubTab('resep')}
          className={`flex-1 py-2 text-[13px] rounded-lg transition ${
            subTab === 'resep'
              ? 'bg-white text-[#1F7A5A] font-semibold shadow-2xs'
              : 'text-[#4a4947] font-medium'
          }`}
        >
          Resep ({recipes.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('menu')}
          className={`flex-1 py-2 text-[13px] rounded-lg transition ${
            subTab === 'menu'
              ? 'bg-white text-[#1F7A5A] font-semibold shadow-2xs'
              : 'text-[#4a4947] font-medium'
          }`}
        >
          Menu ({menus.length})
        </button>
      </div>

      {subTab === 'menu' ? (
        <>
          {/* Filter Kategori */}
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedKategori(cat)}
                className={`h-[34px] px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap border transition ${
                  selectedKategori === cat
                    ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                    : 'bg-white border-[#d6d3c8] text-[#1f1e1d]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Banner Peringatan (FR-MNU-06) */}
          {warningCount > 0 && (
            <div className="bg-[#fbf3e6] border border-[#f0dcb8] rounded-xl px-3.5 py-3 flex flex-col gap-1">
              <div className="font-semibold text-[13px] text-[#7a4300]">
                {warningCount} menu perlu perhatian
              </div>
              <div className="text-xs text-[#7a4300]">
                Harga jual di bawah HPP atau margin di bawah target.
              </div>
            </div>
          )}

          {/* Daftar Menu (Grid 2 Kolom di Tablet/Desktop) */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredMenus.map(
              ({ menu, hasRecipe, hasHpp, hpp, targetMargin, margin, labaPerPorsi, suggested, isBelowHpp, isBelowTarget }) => (
                <button
                  key={menu.id}
                  type="button"
                  onClick={() => openEditMenuModal(menu)}
                  className="w-full text-left bg-white border border-[#e2e0d8] rounded-xl px-4 py-3.5 hover:border-[#1F7A5A]/50 transition flex flex-col justify-between"
                >
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <div className="font-semibold text-sm flex items-center gap-1.5 flex-wrap">
                        <span>{menu.nama}</span>
                        {!hasRecipe && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#ece9e0] text-[#4a4947]">
                            {hasHpp ? 'HPP Manual' : 'Tanpa Resep'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#6b6a68]">
                        {menu.kategori} · {hasHpp ? `HPP ${formatRupiah(hpp)}` : 'HPP belum diisi'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-sm">{formatRupiah(menu.hargaJual)}</div>
                      <div className="text-xs text-[#6b6a68]">
                        {hasHpp ? `Margin ${formatPercent(margin)}` : 'HPP opsional'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-col items-start gap-1.5">
                    {!hasHpp ? (
                      <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-[10px] bg-[#ece9e0] text-[#4a4947]">
                        Tanpa resep · Ketuk untuk isi HPP manual atau tautkan resep
                      </span>
                    ) : isBelowHpp ? (
                      <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-[10px] bg-[#fbe4e1] text-[#9b1c12]">
                        Harga jual di bawah HPP
                      </span>
                    ) : isBelowTarget ? (
                      <>
                        <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-[10px] bg-[#fbeed9] text-[#7a4300]">
                          Margin di bawah target {targetMargin}%
                        </span>
                        <span className="text-xs text-[#6b6a68]">
                          Saran harga: {formatRupiah(suggested)} (HPP ÷ {100 - targetMargin}%, dibulatkan ke atas Rp{roundingStep})
                        </span>
                      </>
                    ) : (
                      <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-[10px] bg-[#e4f1ea] text-[#1F7A5A]">
                        Laba {formatRupiah(labaPerPorsi)} per porsi · Sesuai target {targetMargin}%
                      </span>
                    )}
                  </div>
                </button>
              )
            )}
          </div>

          <div className="text-xs text-[#6b6a68] px-0.5">
            Harga saran bersifat opsional. Harga jual ditentukan Owner. Ketuk menu untuk mengubah harga.
          </div>
        </>
      ) : (
        /* Daftar Resep (Grid 2 Kolom di Tablet/Desktop) */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {recipes.map((rec) => (
            <button
              key={rec.id}
              type="button"
              onClick={() => openEditRecipeModal(rec)}
              className="w-full text-left bg-white border border-[#e2e0d8] rounded-xl px-4 py-3.5 hover:border-[#1F7A5A]/50 transition flex flex-col justify-between"
            >
              <div className="flex justify-between items-center gap-3">
                <div>
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {rec.nama}
                    {rec.isSubRecipe && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#ece9e0] text-[#4a4947]">
                        Setengah jadi
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#6b6a68]">
                    Hasil {rec.jumlahPorsiHasil} porsi · {rec.items.length} bahan
                    {rec.biayaLain.length > 0 ? ` · ${rec.biayaLain.length} biaya lain` : ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-sm text-[#1F7A5A]">
                    {formatRupiah(rec.hppPerPorsi)}
                  </div>
                  <div className="text-xs text-[#6b6a68]">HPP / porsi</div>
                </div>
              </div>
              {rec.hasMissingPrice && (
                <div className="mt-2">
                  <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-[10px] bg-[#fbeed9] text-[#7a4300]">
                    Ada bahan belum memiliki harga pembelian
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Modal Menu & Harga Jual */}
      {showMenuModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3.5 max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="flex justify-between items-center">
              <div className="text-base font-bold">
                {editingMenu ? 'Ubah Menu & Harga Jual' : 'Tambah Menu Baru'}
              </div>
              <button type="button" onClick={() => setShowMenuModal(false)}>
                <X size={20} className="text-[#6b6a68]" />
              </button>
            </div>

            <form onSubmit={handleSaveMenu} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">
                  Tautkan ke Resep (Opsional)
                </label>
                <CustomSelect
                  value={mRecipeId}
                  onChange={(id) => {
                    setMRecipeId(id);
                    const r = id ? recMap.get(id) : undefined;
                    if (r && !editingMenu && !mNama.trim()) {
                      setMNama(r.nama);
                    }
                    if (r && !editingMenu && !mHargaJual) {
                      const sug = calcSuggestedPrice(r.hppPerPorsi, modalTarget, roundingStep);
                      if (sug > 0) setMHargaJual(String(sug));
                    }
                  }}
                  options={[
                    { value: '', label: '— Tanpa Resep (Isi HPP Manual / Opsional) —' },
                    ...recipes.map((r) => ({
                      value: r.id,
                      label: `${r.nama} (HPP ${formatRupiah(r.hppPerPorsi)})`,
                    })),
                  ]}
                />
              </div>

              {!mRecipeId && (
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    HPP / Modal Manual per Porsi (Rp) — Opsional
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatRibuanInput(mHppManual)}
                    onChange={(e) => setMHppManual(stripNonDigits(e.target.value))}
                    placeholder="Kosongkan jika belum ada / isi modal per porsi"
                    className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                  />
                  <div className="text-[11px] text-[#6b6a68] mt-0.5">
                    Boleh dikosongkan dulu dan diisi nanti, atau pilih resep jika sudah dibuat.
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Nama Menu</label>
                  <input
                    type="text"
                    value={mNama}
                    onChange={(e) => setMNama(e.target.value)}
                    placeholder="Contoh: Air Mineral / Es Kopi"
                    className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Kategori</label>
                  <input
                    type="text"
                    value={mKategori}
                    onChange={(e) => setMKategori(e.target.value)}
                    placeholder="Makanan / Minuman"
                    className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Target Margin (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="95"
                    value={mTargetMargin}
                    onChange={(e) => setMTargetMargin(e.target.value)}
                    className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Harga Jual (Rp)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatRibuanInput(mHargaJual)}
                    onChange={(e) => setMHargaJual(stripNonDigits(e.target.value))}
                    placeholder="Contoh: 15.000"
                    className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm font-semibold"
                    required
                  />
                </div>
              </div>

              {/* Box Kalkulasi Saran Harga */}
              {modalHasHpp ? (
                <div className="bg-[#e4f1ea] border border-[#c5dfd1] rounded-xl p-3 flex flex-col gap-1.5 text-xs text-[#1f4d3a]">
                  <div className="flex justify-between">
                    <span>{modalSelectedRec ? 'HPP Resep:' : 'HPP Manual:'}</span>
                    <span className="font-semibold">{formatRupiah(modalHpp)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Saran harga (margin {modalTarget}%):</span>
                    <button
                      type="button"
                      onClick={() => setMHargaJual(String(modalSuggested))}
                      className="font-bold text-[#1F7A5A] underline"
                    >
                      Pakai {formatRupiah(modalSuggested)}
                    </button>
                  </div>
                  <div className="flex justify-between">
                    <span>Margin aktual:</span>
                    <span className="font-bold">
                      {formatPercent(modalActualMargin)} (Laba {formatRupiah((Number(mHargaJual) || 0) - modalHpp)})
                    </span>
                  </div>
                </div>
              ) : (
                <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-3 text-xs text-[#6b6a68]">
                  HPP belum diisi (opsional). Isi <strong>HPP Manual</strong> di atas atau pilih <strong>Resep</strong> untuk melihat saran harga jual dan perhitungan margin otomatis.
                </div>
              )}

              <button
                type="submit"
                disabled={savingMenu}
                className="h-12 rounded-[10px] bg-[#1F7A5A] text-white font-semibold text-[15px] disabled:opacity-60"
              >
                {savingMenu ? 'Menyimpan...' : 'Simpan Menu'}
              </button>

              {editingMenu && (
                <button
                  type="button"
                  disabled={savingMenu}
                  onClick={() => handleDeleteMenu(editingMenu)}
                  className="h-11 rounded-[10px] border border-[#f5c2bc] bg-[#fdf7f6] hover:bg-[#fbe4e1] text-[#9b1c12] font-semibold text-sm flex items-center justify-center gap-1.5 transition disabled:opacity-60"
                >
                  <Trash2 size={15} /> Hapus Menu Ini
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Modal Kalkulator Resep & HPP */}
      {showRecipeModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3.5 max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="flex justify-between items-center">
              <div className="text-base font-bold">
                {editingRecipeId ? 'Edit Resep & HPP' : 'Buat Resep Baru'}
              </div>
              <button type="button" onClick={() => setShowRecipeModal(false)}>
                <X size={20} className="text-[#6b6a68]" />
              </button>
            </div>

            <form onSubmit={handleSaveRecipe} className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2.5">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Nama Resep</label>
                  <input
                    type="text"
                    value={rNama}
                    onChange={(e) => setRNama(e.target.value)}
                    placeholder="Contoh: Ayam Geprek"
                    className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Hasil Porsi</label>
                  <input
                    type="number"
                    min="1"
                    value={rPorsi}
                    onChange={(e) => setRPorsi(e.target.value)}
                    className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-[#4a4947]">
                <input
                  type="checkbox"
                  checked={rIsSubRecipe}
                  onChange={(e) => setRIsSubRecipe(e.target.checked)}
                  className="accent-[#1F7A5A]"
                />
                Jadikan bahan setengah jadi (bisa dipakai resep lain)
              </label>

              {/* Komponen Bahan */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold uppercase text-[#4a4947]">Komponen Bahan</span>
                  <button
                    type="button"
                    onClick={() =>
                      setRItems((prev) => [
                        ...prev,
                        {
                          id: uuidv4(),
                          type: 'ingredient',
                          refId: ingredients[0]?.id ?? '',
                          takaran: 100,
                          susutPersen: 0,
                        },
                      ])
                    }
                    className="text-xs font-semibold text-[#1F7A5A] flex items-center gap-1"
                  >
                    <Plus size={14} /> Tambah Bahan
                  </button>
                </div>

                {rItems.map((it, idx) => {
                  const cost = draftBreakdown.itemCosts[it.id] ?? 0;
                  return (
                    <div
                      key={it.id}
                      className="border border-[#e2e0d8] rounded-xl p-2.5 flex flex-col gap-2 bg-[#faf9f5]"
                    >
                      <div className="flex gap-2 items-center">
                        <div className="flex-1 min-w-0">
                          <CustomSelect
                            value={`${it.type}:${it.refId}`}
                            className="h-9 text-xs"
                            onChange={(val) => {
                              const [t, id] = val.split(':');
                              setRItems((prev) =>
                                prev.map((x, i) =>
                                  i === idx
                                    ? { ...x, type: t as 'ingredient' | 'sub_recipe', refId: id }
                                    : x
                                )
                              );
                            }}
                            options={[
                              ...ingredients.map((ing) => ({
                                value: `ingredient:${ing.id}`,
                                label: `${ing.nama} (${ing.labelSatuanDasar})`,
                                group: 'Bahan Baku',
                              })),
                              ...recipes
                                .filter((r) => r.isSubRecipe && r.id !== editingRecipeId)
                                .map((sr) => ({
                                  value: `sub_recipe:${sr.id}`,
                                  label: `[Sub] ${sr.nama}`,
                                  group: 'Sub-Resep (Setengah Jadi)',
                                })),
                            ]}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setRItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 text-[#9b1c12]"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2 items-center">
                        <div>
                          <span className="text-[11px] text-[#6b6a68]">Takaran</span>
                          <input
                            type="number"
                            step="any"
                            min="0.01"
                            value={it.takaran}
                            onChange={(e) =>
                              setRItems((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, takaran: Number(e.target.value) } : x
                                )
                              )
                            }
                            className="w-full h-8 border border-[#d6d3c8] rounded-lg px-2 text-xs bg-white"
                          />
                        </div>
                        <div>
                          <span className="text-[11px] text-[#6b6a68]">Susut (%)</span>
                          <input
                            type="number"
                            min="0"
                            max="95"
                            value={it.susutPersen}
                            onChange={(e) =>
                              setRItems((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, susutPersen: Number(e.target.value) } : x
                                )
                              )
                            }
                            className="w-full h-8 border border-[#d6d3c8] rounded-lg px-2 text-xs bg-white"
                          />
                        </div>
                        <div className="text-right pt-3">
                          <span className="text-xs font-semibold text-[#1F7A5A]">
                            {formatRupiah(cost)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Biaya Lain (Kemasan, Gas, Tenaga Kerja) */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold uppercase text-[#4a4947]">
                    Biaya Lain (Kemasan / Gas / dll)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setRBiayaLain((prev) => [
                        ...prev,
                        { id: uuidv4(), nama: 'Kemasan', nominal: 1000, mode: 'porsi' },
                      ])
                    }
                    className="text-xs font-semibold text-[#1F7A5A] flex items-center gap-1"
                  >
                    <Plus size={14} /> Tambah
                  </button>
                </div>

                {rBiayaLain.map((b, idx) => (
                  <div key={b.id} className="grid grid-cols-12 gap-1.5 items-center">
                    <input
                      type="text"
                      value={b.nama}
                      onChange={(e) =>
                        setRBiayaLain((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, nama: e.target.value } : x))
                        )
                      }
                      className="col-span-5 h-9 border border-[#d6d3c8] rounded-lg px-2 text-xs"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatRibuanInput(b.nominal)}
                      onChange={(e) =>
                        setRBiayaLain((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, nominal: Number(stripNonDigits(e.target.value)) || 0 } : x
                          )
                        )
                      }
                      className="col-span-3 h-9 border border-[#d6d3c8] rounded-lg px-2 text-xs"
                    />
                    <div className="col-span-3">
                      <CustomSelect
                        value={b.mode}
                        className="h-9 text-xs px-2"
                        onChange={(val) =>
                          setRBiayaLain((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, mode: val as 'batch' | 'porsi' } : x
                            )
                          )
                        }
                        options={[
                          { value: 'batch', label: '/batch' },
                          { value: 'porsi', label: '/porsi' },
                        ]}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setRBiayaLain((prev) => prev.filter((_, i) => i !== idx))}
                      className="col-span-1 text-[#9b1c12] flex justify-center"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Ringkasan HPP Live */}
              <div className="bg-[#e4f1ea] border border-[#c5dfd1] rounded-xl p-3 flex justify-between items-center">
                <div>
                  <div className="text-xs text-[#1f4d3a]">Estimasi HPP per porsi</div>
                  <div className="text-[11px] text-[#1f4d3a]">
                    Bahan {formatRupiah(draftBreakdown.totalBiayaBahan)} + Biaya lain
                  </div>
                </div>
                <div className="text-lg font-bold text-[#1F7A5A]">
                  {formatRupiah(draftBreakdown.hppPerPorsi)}
                </div>
              </div>

              {rError && (
                <div className="text-xs bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-lg">
                  {rError}
                </div>
              )}

              <button
                type="submit"
                className="h-12 rounded-[10px] bg-[#1F7A5A] text-white font-semibold text-[15px]"
              >
                Simpan Resep
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

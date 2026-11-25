import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import {
  addAuditLog,
  createPosTransaction,
  deleteHoldOrder,
  saveHoldOrder,
} from '../db/actions';
import { sendDeviceNotification } from '../services/notificationService';
import { formatJam, formatRibuanInput, formatRupiah, stripNonDigits } from '../lib/calculations';
import { ReceiptModal } from '../components/ReceiptModal';
import { SelfOrderShareModal } from '../components/SelfOrderShareModal';
import {
  extractSelfOrderMeta,
  formatModeLabel,
  formatStageLabel,
  updateSelfOrderStageByCashier,
} from '../services/selfOrderService';
import {
  evaluateStoreOpenStatus,
  toggleStoreOpenByOwner,
} from '../services/branchService';
import type { MenuItem, PaymentMethod, SavedOrder, Transaction, User } from '../types/models';
import {
  Bookmark,
  FolderOpen,
  MapPin,
  MessageCircle,
  Minus,
  Plus,
  Power,
  QrCode,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';

interface PosPageProps {
  user: User;
  onOpenHistory: () => void;
}

interface CartItem {
  menu: MenuItem;
  jumlah: number;
  catatan: string;
  participantName?: string;
  participantWa?: string;
}

export const PosPage: React.FC<PosPageProps> = ({ user, onOpenHistory }) => {
  const settings = useLiveQuery(() => db.settings.get('global'));
  const menus = useLiveQuery(() => db.menus.toArray()) ?? [];
  const rawSavedOrders =
    useLiveQuery(() => db.savedOrders.orderBy('waktuSimpan').reverse().toArray()) ?? [];
  // Sembunyikan kamar Pesan Bareng yang masih draft (belum dikirim Host ke kasir)
  const savedOrders = useMemo(
    () => rawSavedOrders.filter((o) => o.kasirId !== 'SELF_ORDER_GROUP_DRAFT'),
    [rawSavedOrders]
  );

  const [search, setSearch] = useState('');
  const [showSelfOrderShare, setShowSelfOrderShare] = useState(false);
  const [togglingOwnerStore, setTogglingOwnerStore] = useState(false);
  const openCashierShift = useLiveQuery(() =>
    db.cashierShifts.where('status').equals('open').first()
  );
  const storeOpenState = evaluateStoreOpenStatus({
    hasOpenShift: Boolean(openCashierShift),
    activeCashierName: openCashierShift?.kasirNama,
    shiftOpenedAt: openCashierShift?.waktuBuka,
    hoursConfig: {
      autoStoreHoursEnabled: settings?.autoStoreHoursEnabled,
      storeOpenTime: settings?.storeOpenTime,
      storeCloseTime: settings?.storeCloseTime,
      storeManualOverride: settings?.storeManualOverride,
    },
  });
  const [deleteOrderTarget, setDeleteOrderTarget] = useState<SavedOrder | null>(null);
  const [deleteOrderPin, setDeleteOrderPin] = useState('');
  const [deleteOrderReason, setDeleteOrderReason] = useState('');
  const [deleteOrderErr, setDeleteOrderErr] = useState('');
  const [selectedKategori, setSelectedKategori] = useState('Semua');
  const [cart, setCart] = useState<CartItem[]>([]);

  // Active Hold Order ID & Optional Split Bill Participant Name
  const [activeSavedOrderId, setActiveSavedOrderId] = useState<string | undefined>(undefined);
  const [activeSplitParticipant, setActiveSplitParticipant] = useState<string | undefined>(undefined);
  const [namaPelanggan, setNamaPelanggan] = useState('');
  const [noWaPelanggan, setNoWaPelanggan] = useState('');

  // Modal Simpan Orderan (Hold Order / Open Bill)
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showSavedListModal, setShowSavedListModal] = useState(false);

  // Payment Bottom Sheet (untuk layar HP < md)
  const [showPaySheet, setShowPaySheet] = useState(false);
  const [metodeBayar, setMetodeBayar] = useState<PaymentMethod>('Cash');
  const [uangDiterima, setUangDiterima] = useState('');
  const [diskonMode, setDiskonMode] = useState<'none' | 'percent' | 'nominal'>('none');
  const [diskonValue, setDiskonValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Struk Digital
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);

  const activeMenus = useMemo(() => menus.filter((m) => m.active), [menus]);
  const menuMap = useMemo(() => new Map(menus.map((m) => [m.id, m])), [menus]);

  const categories = useMemo(() => {
    const set = new Set(['Semua']);
    activeMenus.forEach((m) => set.add(m.kategori));
    return Array.from(set);
  }, [activeMenus]);

  const filteredMenus = useMemo(() => {
    return activeMenus.filter((m) => {
      const matchCat = selectedKategori === 'Semua' || m.kategori === selectedKategori;
      const matchSearch =
        !search.trim() || m.nama.toLowerCase().includes(search.trim().toLowerCase());
      return matchCat && matchSearch;
    });
  }, [activeMenus, selectedKategori, search]);

  const canDiscount = user.role === 'owner' || user.canDiscount;

  const getQtyInCart = (menuId: string) =>
    cart.find((c) => c.menu.id === menuId)?.jumlah ?? 0;

  const addToCart = (menu: MenuItem) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.menu.id === menu.id);
      const next =
        idx >= 0
          ? prev.map((c, i) => (i === idx ? { ...c, jumlah: c.jumlah + 1 } : c))
          : [...prev, { menu, jumlah: 1, catatan: '' }];
      const nextSub = next.reduce((s, c) => s + c.menu.hargaJual * c.jumlah, 0);
      setUangDiterima(String(nextSub));
      return next;
    });
  };

  const updateQty = (menuId: string, delta: number) => {
    setCart((prev) => {
      const next = prev
        .map((c) => (c.menu.id === menuId ? { ...c, jumlah: c.jumlah + delta } : c))
        .filter((c) => c.jumlah > 0);
      const nextSub = next.reduce((s, c) => s + c.menu.hargaJual * c.jumlah, 0);
      setUangDiterima(String(nextSub));
      return next;
    });
  };

  const updateNote = (menuId: string, catatan: string) => {
    setCart((prev) => prev.map((c) => (c.menu.id === menuId ? { ...c, catatan } : c)));
  };

  const clearCartState = () => {
    setCart([]);
    setActiveSavedOrderId(undefined);
    setActiveSplitParticipant(undefined);
    setNamaPelanggan('');
    setNoWaPelanggan('');
    setDiskonMode('none');
    setDiskonValue('');
    setUangDiterima('');
  };

  const totalItems = cart.reduce((s, c) => s + c.jumlah, 0);
  const subtotal = cart.reduce((s, c) => s + c.menu.hargaJual * c.jumlah, 0);

  const diskonNominal = useMemo(() => {
    if (!canDiscount || diskonMode === 'none') return 0;
    const val = Number(diskonValue) || 0;
    if (diskonMode === 'percent') {
      return Math.round((subtotal * Math.min(Math.max(val, 0), 100)) / 100);
    }
    return Math.min(subtotal, Math.max(0, val));
  }, [canDiscount, diskonMode, diskonValue, subtotal]);

  const diskonLabel =
    diskonNominal > 0
      ? diskonMode === 'percent'
        ? `Diskon ${diskonValue}%`
        : `Diskon ${formatRupiah(diskonNominal)}`
      : undefined;

  const grandTotal = Math.max(0, subtotal - diskonNominal);
  const cashReceivedNum = Number(uangDiterima) || 0;
  const kembalian = Math.max(0, cashReceivedNum - grandTotal);

  const openPay = () => {
    setMetodeBayar('Cash');
    setUangDiterima(String(grandTotal));
    setShowPaySheet(true);
  };

  // Simpan Orderan Dulu (Hold Order)
  const handleSaveHoldOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;
    const label = namaPelanggan.trim() || `Meja / Pelanggan #${savedOrders.length + 1}`;
    await saveHoldOrder(
      {
        id: activeSavedOrderId,
        labelMejaPelanggan: label,
        noWaPelanggan: noWaPelanggan.trim() || undefined,
        items: cart,
      },
      user
    );
    clearCartState();
    setShowHoldModal(false);
    setShowPaySheet(false);
  };

  // Muat kembali Order Tersimpan ke keranjang (mendukung Bayar Semua Gabungan ATAU Split Bill 1 Pemesan Saja)
  const handleResumeSavedOrder = (order: SavedOrder, onlyParticipantName?: string) => {
    const targetLower = onlyParticipantName?.trim().toLowerCase();
    const sourceItems = targetLower
      ? order.items.filter((it) => (it.participantName || '').trim().toLowerCase() === targetLower)
      : order.items;

    const restoredCart: CartItem[] = [];
    let detectedParticipantWa = '';
    for (const it of sourceItems) {
      if (it.participantWa && !detectedParticipantWa) {
        detectedParticipantWa = it.participantWa;
      }
      const m =
        menuMap.get(it.menuId) ?? {
          id: it.menuId,
          recipeId: '',
          nama: it.menuNama,
          kategori: 'Lainnya',
          hargaJual: it.hargaJual,
          active: true,
          updatedAt: order.waktuSimpan,
        };
      restoredCart.push({
        menu: m,
        jumlah: it.jumlah,
        catatan: it.catatan || '',
        participantName: it.participantName,
        participantWa: it.participantWa,
      });
    }
    const sub = restoredCart.reduce((s, c) => s + c.menu.hargaJual * c.jumlah, 0);
    setCart(restoredCart);
    setUangDiterima(String(sub));
    setActiveSavedOrderId(order.id);
    setActiveSplitParticipant(onlyParticipantName);
    setNamaPelanggan(
      onlyParticipantName
        ? `${onlyParticipantName} (${order.labelMejaPelanggan})`
        : order.labelMejaPelanggan
    );
    setNoWaPelanggan(
      onlyParticipantName
        ? detectedParticipantWa || order.noWaPelanggan || ''
        : order.noWaPelanggan || ''
    );
    setShowSavedListModal(false);
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (metodeBayar === 'Cash' && cashReceivedNum < grandTotal) return;
    setSaving(true);
    try {
      const tx = await createPosTransaction(
        {
          items: cart.map((c) => ({
            menu: c.menu,
            jumlah: c.jumlah,
            catatan: c.catatan,
            participantName: c.participantName,
            participantWa: c.participantWa,
          })),
          metodeBayar,
          diskonNominal,
          diskonLabel,
          uangDiterima: metodeBayar === 'Cash' ? cashReceivedNum : grandTotal,
          namaPelanggan: namaPelanggan.trim() || undefined,
          noWaPelanggan: noWaPelanggan.trim() || undefined,
          savedOrderIdToDelete: activeSavedOrderId,
          splitParticipantToRemove: activeSplitParticipant,
        },
        user
      );
      clearCartState();
      setShowPaySheet(false);
      setReceiptTx(tx);
    } finally {
      setSaving(false);
    }
  };

  const quickCashAmounts = useMemo(() => {
    const list = [grandTotal];
    const next10 = Math.ceil(grandTotal / 10000) * 10000;
    const next50 = Math.ceil(grandTotal / 50000) * 50000;
    const next100 = Math.ceil(grandTotal / 100000) * 100000;
    for (const amt of [next10, next50, next100, 50000, 100000]) {
      if (amt >= grandTotal && !list.includes(amt)) list.push(amt);
    }
    return list.slice(0, 4);
  }, [grandTotal]);

  // Komponen Isi Keranjang & Pembayaran (Dipakai di Panel Kanan Tablet & Modal HP)
  const renderCheckoutControls = (isTabletPanel: boolean) => (
    <div className="flex flex-col gap-3">
      {/* Daftar Item + Catatan */}
      <div
        className={`border border-[#e2e0d8] rounded-xl divide-y divide-[#eeece5] overflow-y-auto bg-[#faf9f5] ${
          isTabletPanel ? 'max-h-[240px]' : 'max-h-40'
        }`}
      >
        {cart.map((c) => (
          <div key={c.menu.id} className="p-3 flex flex-col gap-1.5">
            <div className="flex justify-between items-center gap-2">
              <div className="text-sm font-semibold min-w-0 truncate">{c.menu.nama}</div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => updateQty(c.menu.id, -1)}
                    className="w-6 h-6 rounded-full bg-[#ece9e0] flex items-center justify-center text-[#1f1e1d]"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="text-xs font-bold min-w-[18px] text-center">{c.jumlah}</span>
                  <button
                    type="button"
                    onClick={() => updateQty(c.menu.id, 1)}
                    className="w-6 h-6 rounded-full bg-[#1F7A5A] text-white flex items-center justify-center"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="text-sm font-semibold min-w-[72px] text-right">
                  {formatRupiah(c.menu.hargaJual * c.jumlah)}
                </div>
              </div>
            </div>
            <input
              type="text"
              value={c.catatan}
              onChange={(e) => updateNote(c.menu.id, e.target.value)}
              placeholder="Catatan item (pedas / tanpa es)"
              className="text-xs border border-[#eeece5] rounded-lg px-2.5 py-1.5 bg-white"
            />
          </div>
        ))}
      </div>

      {/* Pelanggan / Meja & No WA */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-medium text-[#4a4947] mb-1">
            Pelanggan / Meja
          </label>
          <input
            type="text"
            value={namaPelanggan}
            onChange={(e) => setNamaPelanggan(e.target.value)}
            placeholder="Meja 2 / Budi"
            className="w-full h-9 border border-[#d6d3c8] rounded-lg px-2.5 text-xs"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-[#4a4947] mb-1">
            No. WA Struk
          </label>
          <input
            type="tel"
            value={noWaPelanggan}
            onChange={(e) => setNoWaPelanggan(e.target.value)}
            placeholder="0812xxxx"
            className="w-full h-9 border border-[#d6d3c8] rounded-lg px-2.5 text-xs"
          />
        </div>
      </div>

      {/* Diskon per transaksi (hanya jika diizinkan) */}
      {canDiscount && (
        <div className="flex flex-col gap-2 bg-[#faf9f5] p-2.5 rounded-xl border border-[#e2e0d8]">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-[#4a4947]">Diskon Transaksi</span>
            <div className="flex gap-1">
              {(['none', 'percent', 'nominal'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setDiskonMode(m);
                    if (m === 'none') setDiskonValue('');
                  }}
                  className={`text-[11px] px-2.5 py-0.5 rounded-full border ${
                    diskonMode === m
                      ? 'bg-[#1F7A5A] text-white border-[#1F7A5A]'
                      : 'bg-white border-[#d6d3c8]'
                  }`}
                >
                  {m === 'none' ? 'Tanpa' : m === 'percent' ? '%' : 'Rp'}
                </button>
              ))}
            </div>
          </div>
          {diskonMode !== 'none' && (
            <input
              type="text"
              inputMode="numeric"
              value={diskonMode === 'nominal' ? formatRibuanInput(diskonValue) : diskonValue}
              onChange={(e) =>
                setDiskonValue(
                  diskonMode === 'nominal' ? stripNonDigits(e.target.value) : e.target.value.replace(/[^\d.]/g, '')
                )
              }
              placeholder={
                diskonMode === 'percent' ? 'Masukkan % (misal 10)' : 'Masukkan nominal Rp (misal 5.000)'
              }
              className="h-9 border border-[#d6d3c8] rounded-lg px-3 text-xs bg-white"
            />
          )}
        </div>
      )}

      {/* Metode Pembayaran */}
      <div>
        <div className="text-xs font-medium text-[#4a4947] mb-1.5">Metode Pembayaran</div>
        <div className="grid grid-cols-3 gap-2">
          {(['Cash', 'QRIS', 'Transfer'] as PaymentMethod[]).map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => {
                setMetodeBayar(method);
                if (method === 'Cash') setUangDiterima(String(grandTotal));
              }}
              className={`h-10 rounded-[10px] font-semibold text-xs border transition ${
                metodeBayar === method
                  ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                  : 'bg-white border-[#d6d3c8] text-[#1f1e1d]'
              }`}
            >
              {method}
            </button>
          ))}
        </div>
      </div>

      {/* Input Cash & Kembalian */}
      {metodeBayar === 'Cash' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-[#4a4947]">Uang Diterima</label>
            <span className="text-xs font-semibold text-[#1F7A5A]">
              Kembalian: {formatRupiah(kembalian)}
            </span>
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={formatRibuanInput(uangDiterima)}
            onChange={(e) => setUangDiterima(stripNonDigits(e.target.value))}
            className="h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm font-bold"
          />
          <div className="flex gap-1.5 flex-wrap">
            {quickCashAmounts.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setUangDiterima(String(amt))}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-[#d6d3c8] bg-[#faf9f5] font-medium"
              >
                {amt === grandTotal ? 'Uang Pas' : formatRupiah(amt)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Total & Tombol Aksi */}
      <div className="border-t border-[#eeece5] pt-2.5 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-xs font-medium text-[#4a4947]">Total Bayar</span>
          <span className="text-lg font-bold text-[#1f1e1d]">{formatRupiah(grandTotal)}</span>
        </div>
        <div className="grid grid-cols-[1fr_1.6fr] gap-2">
          <button
            type="button"
            onClick={() => {
              setShowPaySheet(false);
              setShowHoldModal(true);
            }}
            className="h-11 rounded-[10px] border border-[#1F7A5A] text-[#1F7A5A] font-semibold text-xs flex items-center justify-center gap-1"
          >
            <Bookmark size={14} /> Simpan Dulu
          </button>
          <button
            type="button"
            disabled={saving || (metodeBayar === 'Cash' && cashReceivedNum < grandTotal)}
            onClick={handleCheckout}
            className="h-11 rounded-[10px] bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Bayar Sekarang'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden">
      {/* ====================================================================
          KOLOM KIRI: KATALOG MENU (FULL DI HP, FLEKSIBEL DI TABLET)
         ==================================================================== */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3.5 sm:px-5 pt-4 sm:pt-5 pb-28 md:pb-6 flex flex-col gap-3.5 min-w-0">
        {/* Header */}
        <div className="flex flex-wrap justify-between items-center gap-2">
          <div className="min-w-0">
            <h1 className="text-[20px] sm:text-[22px] font-bold">Kasir</h1>
            <div className="text-xs text-[#6b6a68] truncate">
              {settings?.namaUsaha ?? 'Lembayung'} · {user.nama}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            {user.role === 'owner' && (
              <button
                type="button"
                disabled={togglingOwnerStore}
                onClick={async () => {
                  setTogglingOwnerStore(true);
                  try {
                    await toggleStoreOpenByOwner({
                      targetOpen: !storeOpenState.isStoreOpen,
                      owner: user,
                    });
                  } finally {
                    setTogglingOwnerStore(false);
                  }
                }}
                title="Klik untuk Buka / Tutup Toko langsung tanpa input modal uang"
                className={`h-9 px-2.5 sm:px-3 rounded-full border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition ${
                  storeOpenState.isStoreOpen
                    ? 'border-[#c5dfd1] bg-[#e4f1ea] text-[#15803d]'
                    : 'border-[#f5c2bc] bg-[#fbe4e1] text-[#9b1c12]'
                }`}
              >
                <Power size={13} />
                <span>{storeOpenState.isStoreOpen ? 'Toko Buka' : 'Toko Tutup'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSelfOrderShare(true)}
              title="Bagikan QR & Link Self-Order / Delivery / Pesan Bareng"
              className="h-9 px-2.5 sm:px-3 rounded-full border border-[#c5dfd1] bg-[#f4f9f6] text-[#1F7A5A] text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
            >
              <QrCode size={14} />
              <span className="hidden sm:inline">QR &amp; Link</span> Order
            </button>
            <button
              type="button"
              onClick={() => setShowSavedListModal(true)}
              className="h-9 px-2.5 sm:px-3 rounded-full border border-[#1F7A5A] bg-[#e4f1ea] text-[#1F7A5A] text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
            >
              <FolderOpen size={14} />
              Disimpan ({savedOrders.length})
            </button>
            <button
              type="button"
              onClick={onOpenHistory}
              className="h-9 px-2.5 sm:px-3 rounded-full border border-[#d6d3c8] bg-white text-xs font-medium text-[#1f1e1d] whitespace-nowrap"
            >
              Riwayat
            </button>
          </div>
        </div>

        {/* Indikator jika sedang melanjutkan Order Tersimpan */}
        {activeSavedOrderId && (
          <div className="bg-[#fbf3e6] border border-[#f0dcb8] rounded-xl px-3.5 py-2.5 flex justify-between items-center text-xs">
            <div>
              <span className="font-semibold text-[#7a4300]">Melanjutkan order: </span>
              <span className="font-bold text-[#1f1e1d]">{namaPelanggan}</span>
            </div>
            <button
              type="button"
              onClick={clearCartState}
              className="text-[#9b1c12] font-semibold underline"
            >
              Batalkan
            </button>
          </div>
        )}

        {/* Baris Pencarian & Filter Kategori */}
        <div className="flex flex-col lg:flex-row gap-2.5 lg:items-center">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b6a68]"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari menu..."
              className="w-full h-11 pl-10 pr-3 rounded-[10px] border border-[#d6d3c8] bg-white text-sm focus:outline-none focus:border-[#1F7A5A]"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedKategori(cat)}
                className={`h-[36px] px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap border transition ${
                  selectedKategori === cat
                    ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                    : 'bg-white border-[#d6d3c8] text-[#1f1e1d]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid Menu Responsif Otomatis (menyesuaikan lebar panel tengah agar kartu tidak pernah sempit/overflow) */}
        <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
          {filteredMenus.map((menu) => {
            const qty = getQtyInCart(menu.id);
            return (
              <div
                key={menu.id}
                onClick={() => addToCart(menu)}
                className={`bg-white rounded-xl p-3.5 border transition cursor-pointer select-none flex flex-col justify-between gap-2.5 overflow-hidden active:scale-[0.98] ${
                  qty > 0
                    ? 'border-[#1F7A5A] ring-1 ring-[#1F7A5A] shadow-xs'
                    : 'border-[#e2e0d8] hover:border-[#1F7A5A]/50'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-[11px] text-[#6b6a68] truncate">{menu.kategori}</div>
                  <div className="font-semibold text-sm leading-snug mt-0.5 line-clamp-2 break-words">
                    {menu.nama}
                  </div>
                </div>

                <div className="flex flex-wrap justify-between items-center gap-1.5">
                  <div className="font-bold text-sm text-[#1F7A5A] whitespace-nowrap">
                    {formatRupiah(menu.hargaJual)}
                  </div>
                  {qty > 0 && (
                    <div
                      className="flex items-center gap-1.5 shrink-0 ml-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => updateQty(menu.id, -1)}
                        className="w-7 h-7 rounded-full bg-[#ece9e0] flex items-center justify-center text-[#1f1e1d] shrink-0"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="text-sm font-bold min-w-[18px] text-center">{qty}</span>
                      <button
                        type="button"
                        onClick={() => updateQty(menu.id, 1)}
                        className="w-7 h-7 rounded-full bg-[#1F7A5A] text-white flex items-center justify-center shrink-0"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ====================================================================
          KOLOM KANAN: PANEL KERANJANG & PEMBAYARAN KHUSUS TABLET (md:flex)
         ==================================================================== */}
      <aside className="hidden md:flex md:w-[310px] lg:w-[360px] bg-white border-l border-[#e2e0d8] flex-col justify-between p-4 pb-6 shrink-0 overflow-y-auto">
        <div className="flex flex-col gap-3">
          <div className="flex justify-between items-center pb-2 border-b border-[#eeece5]">
            <div className="flex items-center gap-2">
              <ShoppingBag size={18} className="text-[#1F7A5A]" />
              <span className="font-bold text-base">Keranjang Pesanan</span>
            </div>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={clearCartState}
                className="text-xs font-semibold text-[#9b1c12] hover:underline"
              >
                Kosongkan
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center gap-2 text-[#6b6a68]">
              <div className="w-12 h-12 rounded-2xl bg-[#faf9f5] border border-[#e2e0d8] flex items-center justify-center">
                <ShoppingBag size={22} className="opacity-50" />
              </div>
              <div className="text-sm font-medium">Keranjang masih kosong</div>
              <div className="text-xs max-w-[220px]">
                Ketuk menu di sebelah kiri untuk menambahkan pesanan pelanggan.
              </div>
            </div>
          ) : (
            renderCheckoutControls(true)
          )}
        </div>
      </aside>

      {/* ====================================================================
          FLOATING CART BAR KHUSUS LAYAR HP (md:hidden)
         ==================================================================== */}
      {cart.length > 0 && (
        <div className="md:hidden fixed bottom-[82px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[398px] z-30 flex gap-2">
          <button
            type="button"
            onClick={() => setShowHoldModal(true)}
            className="h-14 px-3.5 rounded-xl bg-white border-2 border-[#1F7A5A] text-[#1F7A5A] shadow-lg font-semibold text-xs flex flex-col items-center justify-center shrink-0 active:scale-[0.98]"
          >
            <Bookmark size={16} />
            <span>Simpan Dulu</span>
          </button>

          <button
            type="button"
            onClick={openPay}
            className="flex-1 h-14 px-4 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white shadow-lg flex items-center justify-between active:scale-[0.99] transition"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
                <ShoppingBag size={18} />
              </div>
              <div className="text-left">
                <div className="text-xs opacity-90">{totalItems} item dipilih</div>
                <div className="font-bold text-base leading-tight">
                  {formatRupiah(grandTotal)}
                </div>
              </div>
            </div>
            <span className="font-semibold text-sm bg-white/20 px-3 py-1.5 rounded-lg">
              Bayar →
            </span>
          </button>
        </div>
      )}

      {/* Modal Simpan Orderan Dulu (Open Bill / Hold Order) */}
      {showHoldModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xl">
            <div className="flex justify-between items-center">
              <div className="text-base font-bold">Simpan Orderan Dulu (Open Bill)</div>
              <button type="button" onClick={() => setShowHoldModal(false)}>
                <X size={20} className="text-[#6b6a68]" />
              </button>
            </div>
            <div className="text-xs text-[#6b6a68]">
              Pesanan sebanyak <strong>{totalItems} item ({formatRupiah(subtotal)})</strong> akan
              disimpan sementara dan bisa dilanjutkan atau dibayar nanti.
            </div>
            <form onSubmit={handleSaveHoldOrder} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">
                  Nama Pelanggan / Nomor Meja *
                </label>
                <input
                  type="text"
                  value={namaPelanggan}
                  onChange={(e) => setNamaPelanggan(e.target.value)}
                  placeholder="Contoh: Meja 4 - Pak Budi / Takeaway Rina"
                  className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">
                  No. WhatsApp Pelanggan (opsional, untuk kirim struk nanti)
                </label>
                <input
                  type="tel"
                  value={noWaPelanggan}
                  onChange={(e) => setNoWaPelanggan(e.target.value)}
                  placeholder="0812xxxx"
                  className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                />
              </div>
              <button
                type="submit"
                className="h-12 rounded-[10px] bg-[#1F7A5A] text-white font-semibold text-[15px] mt-1"
              >
                Simpan Orderan
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal Daftar Orderan Tersimpan */}
      {showSavedListModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[460px] rounded-2xl p-5 flex flex-col gap-3.5 max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="flex justify-between items-center">
              <div className="text-base font-bold">
                Orderan Tersimpan ({savedOrders.length})
              </div>
              <button type="button" onClick={() => setShowSavedListModal(false)}>
                <X size={20} className="text-[#6b6a68]" />
              </button>
            </div>

            {savedOrders.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#6b6a68]">
                Belum ada orderan yang disimpan. Pilih menu lalu tekan tombol{' '}
                <strong>"Simpan Dulu"</strong> untuk menahan pesanan.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {savedOrders.map((ord) => {
                  const ordTotal = ord.items.reduce((s, i) => s + i.hargaJual * i.jumlah, 0);
                  const ordQty = ord.items.reduce((s, i) => s + i.jumlah, 0);
                  const selfMeta = extractSelfOrderMeta(ord);
                  const waClean = (ord.noWaPelanggan || '')
                    .replace(/\D/g, '')
                    .replace(/^0/, '62');
                  return (
                    <div
                      key={ord.id}
                      className={`border rounded-xl p-3.5 flex flex-col gap-2 ${
                        selfMeta
                          ? 'border-[#1F7A5A]/50 bg-[#f4f9f6]'
                          : 'border-[#e2e0d8] bg-[#faf9f5]'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <div className="font-bold text-sm text-[#1f1e1d] flex items-center gap-1.5 flex-wrap">
                            <span>{ord.labelMejaPelanggan}</span>
                            {selfMeta && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#1F7A5A] text-white">
                                {formatModeLabel(selfMeta.mode)}
                              </span>
                            )}
                            {selfMeta?.isGroupOrder && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#e0e7ff] text-[#3730a3]">
                                Pesan Bareng
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#6b6a68]">
                            Disimpan pukul {formatJam(ord.waktuSimpan)} ·{' '}
                            {selfMeta
                              ? formatStageLabel(selfMeta.stage, selfMeta.mode)
                              : `oleh ${ord.kasirNama}`}
                            {ord.noWaPelanggan ? ` · WA: ${ord.noWaPelanggan}` : ''}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-sm text-[#1F7A5A]">
                            {formatRupiah(ordTotal)}
                          </div>
                          <div className="text-[11px] text-[#6b6a68]">{ordQty} item</div>
                        </div>
                      </div>

                      {selfMeta?.deliveryAddress && (
                        <div className="bg-white border border-[#c5dfd1] rounded-lg px-2.5 py-1.5 text-xs text-[#1f1e1d] flex items-start justify-between gap-2">
                          <div className="flex items-start gap-1.5">
                            <MapPin size={13} className="text-[#1F7A5A] shrink-0 mt-0.5" />
                            <div>
                              <div>{selfMeta.deliveryAddress}</div>
                              {selfMeta.deliveryLandmark && (
                                <div className="text-[11px] font-semibold text-[#1F7A5A] mt-0.5">
                                  Patokan: {selfMeta.deliveryLandmark}
                                </div>
                              )}
                            </div>
                          </div>
                          {selfMeta.mapsUrl && (
                            <a
                              href={selfMeta.mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-bold text-[#1F7A5A] underline shrink-0"
                            >
                              Buka Maps
                            </a>
                          )}
                        </div>
                      )}

                      <div className="text-xs text-[#4a4947]">
                        {ord.items
                          .map(
                            (i) =>
                              `${i.menuNama} ×${i.jumlah}${i.catatan ? ` (${i.catatan})` : ''}`
                          )
                          .join(', ')}
                      </div>

                      {/* Daftar Split Bill per Orang (Bayar Terpisah & Kirim Struk Terpisah per Pemesan) */}
                      {(() => {
                        const pMap = new Map<
                          string,
                          { name: string; wa?: string; total: number; qty: number }
                        >();
                        for (const it of ord.items) {
                          const pName = (it.participantName || '').trim();
                          if (!pName) continue;
                          const key = pName.toLowerCase();
                          const prev = pMap.get(key) || {
                            name: pName,
                            wa: it.participantWa,
                            total: 0,
                            qty: 0,
                          };
                          if (!prev.wa && it.participantWa) prev.wa = it.participantWa;
                          prev.total += it.hargaJual * it.jumlah;
                          prev.qty += it.jumlah;
                          pMap.set(key, prev);
                        }
                        const participants = Array.from(pMap.values());
                        if (participants.length <= 1) return null;
                        return (
                          <div className="bg-white border border-[#c7d2fe] rounded-xl p-2.5 flex flex-col gap-1.5">
                            <div className="text-[11px] font-bold text-[#3730a3]">
                              👥 Split Bill (Bayar &amp; Kirim Struk Terpisah per Orang):
                            </div>
                            {participants.map((p) => (
                              <div
                                key={p.name}
                                className="flex items-center justify-between gap-2 text-xs border-t border-[#eeece5] pt-1.5"
                              >
                                <div className="min-w-0">
                                  <span className="font-semibold text-[#1f1e1d]">👤 {p.name}</span>
                                  <span className="text-[11px] text-[#6b6a68]">
                                    {' '}
                                    ({p.qty} item · {formatRupiah(p.total)})
                                  </span>
                                  {p.wa && (
                                    <div className="text-[10px] text-[#1F7A5A] font-mono">
                                      WA: {p.wa}
                                    </div>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleResumeSavedOrder(ord, p.name)}
                                  className="h-7 px-2.5 rounded-lg bg-[#eef2ff] hover:bg-[#e0e7ff] border border-[#c7d2fe] text-[#3730a3] text-[11px] font-semibold shrink-0"
                                >
                                  Bayar {p.name}
                                </button>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {/* Tombol Update Status Live & Konfirmasi WA khusus Pesanan Self-Order */}
                      {selfMeta && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <button
                            type="button"
                            onClick={() => updateSelfOrderStageByCashier(ord, 'diproses')}
                            className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition ${
                              selfMeta.stage === 'diproses'
                                ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                                : 'bg-white border-[#c5dfd1] text-[#1F7A5A]'
                            }`}
                          >
                            👨‍🍳 Proses/Masak
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSelfOrderStageByCashier(ord, 'diantar')}
                            className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition ${
                              selfMeta.stage === 'diantar'
                                ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                                : 'bg-white border-[#c5dfd1] text-[#1F7A5A]'
                            }`}
                          >
                            {selfMeta.mode === 'delivery' ? '🛵 Sedang Diantar' : '✅ Siap Diambil'}
                          </button>
                          {waClean && (
                            <a
                              href={`https://wa.me/${waClean}?text=${encodeURIComponent(
                                `Halo Kak *${selfMeta.customerName}*, pesanan Anda di *${
                                  settings?.namaUsaha || 'Lembayung'
                                }* (${ordQty} item · Total *${formatRupiah(
                                  ordTotal
                                )}*) sudah kami terima dan sedang kami proses ya!`
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="h-7 px-2.5 rounded-lg bg-white border border-[#c5dfd1] text-[#1F7A5A] text-[11px] font-semibold inline-flex items-center gap-1"
                            >
                              <MessageCircle size={12} /> Konfirmasi WA
                            </a>
                          )}
                        </div>
                      )}

                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleResumeSavedOrder(ord)}
                          className="flex-1 h-9 rounded-lg bg-[#1F7A5A] text-white text-xs font-semibold"
                        >
                          Buka / Lanjutkan Bayar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteOrderTarget(ord);
                            setDeleteOrderPin('');
                            setDeleteOrderReason('');
                            setDeleteOrderErr('');
                          }}
                          className="h-9 px-2.5 rounded-lg border border-[#d6d3c8] text-[#9b1c12] flex items-center justify-center"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Otorisasi PIN + Wajib Alasan untuk Hapus Open Bill (Disimpan) */}
      {deleteOrderTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setDeleteOrderErr('');
              const cleanPin = deleteOrderPin.trim();
              const cleanReason = deleteOrderReason.trim();
              if (!/^\d{6}$/.test(cleanPin)) {
                setDeleteOrderErr('Masukkan 6 angka PIN Anda.');
                return;
              }
              if (cleanReason.length < 3) {
                setDeleteOrderErr('Alasan pembatalan wajib diisi (min. 3 karakter).');
                return;
              }
              const kasirAuthPin = String(settings?.kasirAuthPin || '').trim();
              const allUsers = await db.users.toArray();
              const isAuthPinMatch = Boolean(kasirAuthPin && cleanPin === kasirAuthPin);
              const privilegedActor = allUsers.find(
                (u) =>
                  u.active &&
                  (u.role === 'owner' || u.role === 'manager') &&
                  String(u.pin || '').trim() === cleanPin
              );
              if (!isAuthPinMatch && !privilegedActor) {
                setDeleteOrderErr(
                  kasirAuthPin
                    ? 'PIN Otorisasi salah. Masukkan 6 angka PIN Otorisasi Mode Kasir.'
                    : 'PIN tidak dikenali. Atur PIN Otorisasi Mode Kasir di Pengaturan atau gunakan PIN Owner/Manager.'
                );
                return;
              }
              const actor = privilegedActor ?? user;
              const target = deleteOrderTarget;
              const targetTotal = target.items.reduce((s, i) => s + i.hargaJual * i.jumlah, 0);
              await deleteHoldOrder(target.id);
              await addAuditLog(
                actor,
                'HAPUS_OPEN_BILL',
                target.labelMejaPelanggan,
                `Total ${formatRupiah(targetTotal)} · Alasan: ${cleanReason}`
              );
              sendDeviceNotification({
                title: `Open Bill Dihapus · ${target.labelMejaPelanggan}`,
                body: `Dihapus oleh ${actor.nama} (${formatRupiah(targetTotal)}) · Alasan: ${cleanReason}`,
                dedupKey: `del-hold-${target.id}`,
                broadcastFcm: true,
              });
              setDeleteOrderTarget(null);
            }}
            className="bg-white w-full max-w-[390px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xl border border-[#e2e0d8]"
          >
            <div className="flex justify-between items-center">
              <div>
                <div className="text-base font-bold text-[#9b1c12]">Hapus Pesanan Tersimpan</div>
                <div className="text-xs text-[#6b6a68]">{deleteOrderTarget.labelMejaPelanggan}</div>
              </div>
              <button type="button" onClick={() => setDeleteOrderTarget(null)}>
                <X size={20} className="text-[#6b6a68]" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4a4947] mb-1">
                Alasan Pembatalan *
              </label>
              <input
                type="text"
                value={deleteOrderReason}
                onChange={(e) => setDeleteOrderReason(e.target.value)}
                placeholder="Misal: Pelanggan batal pesan / salah input meja"
                className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4a4947] mb-1">
                PIN Otorisasi Mode Kasir (6 Angka) *
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={deleteOrderPin}
                onChange={(e) => setDeleteOrderPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
                className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-center text-lg font-bold tracking-[0.35em]"
                required
              />
            </div>
            {deleteOrderErr && (
              <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-lg">
                {deleteOrderErr}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteOrderTarget(null)}
                className="flex-1 h-10 rounded-[10px] border border-[#d6d3c8] text-xs font-semibold text-[#4a4947]"
              >
                Batal
              </button>
              <button
                type="submit"
                className="flex-1 h-10 rounded-[10px] bg-[#9b1c12] hover:bg-[#7f1d1d] text-white text-xs font-semibold"
              >
                Konfirmasi Hapus
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Pembayaran (Hanya di HP) */}
      {showPaySheet && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3.5 max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="flex justify-between items-center">
              <div className="text-base font-bold">Ringkasan &amp; Pembayaran</div>
              <button type="button" onClick={() => setShowPaySheet(false)}>
                <X size={20} className="text-[#6b6a68]" />
              </button>
            </div>
            {renderCheckoutControls(false)}
          </div>
        </div>
      )}

      {/* Modal QR & Link Self-Order / Delivery / Pesan Bareng */}
      {showSelfOrderShare && (
        <SelfOrderShareModal
          settings={settings}
          onClose={() => setShowSelfOrderShare(false)}
        />
      )}

      {/* Modal Struk Digital + Kirim WA Biasa + Link Struk */}
      {receiptTx && (
        <ReceiptModal
          tx={receiptTx}
          settings={settings}
          onClose={() => setReceiptTx(null)}
        />
      )}
    </div>
  );
};

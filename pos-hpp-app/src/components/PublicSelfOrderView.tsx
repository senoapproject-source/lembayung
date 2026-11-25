import React, { useEffect, useMemo, useState } from 'react';
import { formatRupiah } from '../lib/calculations';
import { CuaninLogo } from './CuaninLogo';
import {
  buildSelfOrderUrl,
  createGroupOrderRoom,
  extractSelfOrderMeta,
  fetchPublicSelfOrder,
  fetchPublicStoreCatalog,
  formatModeLabel,
  formatStageLabel,
  getOrCreateSelfOrderDeviceId,
  getOwnedParticipantsInGroup,
  rememberOwnedParticipantInGroup,
  removeGroupParticipantItems,
  submitSelfOrderToCashier,
  upsertGroupParticipantItems,
  type PublicStoreCatalog,
  type SelfOrderCartItem,
  type SelfOrderMode,
} from '../services/selfOrderService';
import type { MenuItem, SavedOrder } from '../types/models';
import {
  Check,
  CheckCircle2,
  Copy,
  MessageCircle,
  Minus,
  Navigation,
  Pencil,
  Plus,
  Search,
  Share2,
  ShoppingBag,
  Store,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';

interface LocalCartEntry {
  menu: MenuItem;
  jumlah: number;
  catatan: string;
}

export const PublicSelfOrderView: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const outletIdParam = (params.get('order') || '').trim().toUpperCase();
  const mejaParam = (params.get('meja') || '').trim();
  const initialGroupId = (params.get('group') || '').trim();
  const initialTrackId = (params.get('track') || '').trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState<PublicStoreCatalog | null>(null);

  // Mode Pesanan & Identitas Pelanggan
  const [mode, setMode] = useState<SelfOrderMode>(mejaParam ? 'dine_in' : 'delivery');
  const [customerName, setCustomerName] = useState(
    () => sessionStorage.getItem('lembayung_so_name') || ''
  );
  const [customerWa, setCustomerWa] = useState(
    () => sessionStorage.getItem('lembayung_so_wa') || ''
  );
  const [tableNumber, setTableNumber] = useState(mejaParam);
  const [pickupTime, setPickupTime] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryLandmark, setDeliveryLandmark] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [locatingGps, setLocatingGps] = useState(false);

  // Katalog & Keranjang Pribadi
  const [search, setSearch] = useState('');
  const [selectedKategori, setSelectedKategori] = useState('Semua');
  const [myCart, setMyCart] = useState<LocalCartEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Group Order (Pesan Bareng) & Live Tracking State
  const [groupOrderId, setGroupOrderId] = useState<string>(initialGroupId);
  const [trackedOrderId, setTrackedOrderId] = useState<string>(initialTrackId);
  const [sharedOrder, setSharedOrder] = useState<SavedOrder | null>(null);
  const [orderCompletedPaid, setOrderCompletedPaid] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [groupSyncMsg, setGroupSyncMsg] = useState('');
  // Nama & No. WA pemesan yang sedang diinput di HP ini (bisa berganti-ganti jika ada teman numpang order di 1 HP yang sama)
  const [participantName, setParticipantName] = useState(
    () => sessionStorage.getItem('lembayung_so_name') || ''
  );
  const [participantWa, setParticipantWa] = useState(
    () => sessionStorage.getItem('lembayung_so_wa') || ''
  );
  const myDeviceId = useMemo(() => getOrCreateSelfOrderDeviceId(), []);

  const isHost = useMemo(() => {
    if (!groupOrderId) return true;
    return sessionStorage.getItem(`lembayung_host_${groupOrderId}`) === '1';
  }, [groupOrderId]);

  // 1. Muat katalog toko
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPublicStoreCatalog(outletIdParam)
      .then((res) => {
        if (cancelled) return;
        if (!res.success || !res.catalog) {
          setError(res.error || 'Toko tidak ditemukan.');
          return;
        }
        setCatalog(res.catalog);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [outletIdParam]);

  // 2. Poll live data untuk Group Order atau Live Order Tracking setiap 4 detik
  const activePollOrderId = trackedOrderId || groupOrderId;
  useEffect(() => {
    if (!activePollOrderId || !outletIdParam) return;
    let cancelled = false;

    const refreshOrder = async () => {
      const ord = await fetchPublicSelfOrder(outletIdParam, activePollOrderId);
      if (cancelled) return;
      if (!ord) {
        // Jika sebelumnya sudah ada dan sekarang hilang dari saved_orders -> artinya sudah selesai dibayar di Kasir!
        if (sharedOrder && trackedOrderId) {
          setOrderCompletedPaid(true);
        }
        return;
      }
      setSharedOrder(ord);
      const meta = extractSelfOrderMeta(ord);
      if (meta && meta.stage !== 'draft_group' && !trackedOrderId) {
        // Host sudah mengirim pesanan grup ke kasir -> otomatis pindah ke layar Live Tracker!
        setTrackedOrderId(ord.id);
      }
    };

    refreshOrder();
    const timer = setInterval(refreshOrder, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activePollOrderId, outletIdParam, Boolean(sharedOrder), trackedOrderId]);

  const categories = useMemo(() => {
    const s = new Set(['Semua']);
    (catalog?.menus || []).forEach((m) => s.add(m.kategori));
    return Array.from(s);
  }, [catalog?.menus]);

  const filteredMenus = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (catalog?.menus || []).filter((m) => {
      const matchCat = selectedKategori === 'Semua' || m.kategori === selectedKategori;
      const matchQ = !q || m.nama.toLowerCase().includes(q);
      return matchCat && matchQ;
    });
  }, [catalog?.menus, selectedKategori, search]);

  const getMyQty = (menuId: string) =>
    myCart.find((c) => c.menu.id === menuId)?.jumlah || 0;

  const updateMyCart = (menu: MenuItem, delta: number) => {
    setMyCart((prev) => {
      const idx = prev.findIndex((c) => c.menu.id === menu.id);
      if (idx === -1 && delta > 0) {
        return [...prev, { menu, jumlah: delta, catatan: '' }];
      }
      return prev
        .map((c, i) => (i === idx ? { ...c, jumlah: c.jumlah + delta } : c))
        .filter((c) => c.jumlah > 0);
    });
  };

  const updateMyNote = (menuId: string, catatan: string) => {
    setMyCart((prev) => prev.map((c) => (c.menu.id === menuId ? { ...c, catatan } : c)));
  };

  const mySubtotal = myCart.reduce((s, c) => s + c.menu.hargaJual * c.jumlah, 0);
  const myTotalQty = myCart.reduce((s, c) => s + c.jumlah, 0);

  // Pin GPS Google Maps + Auto-Fill Alamat Lengkap (Reverse Geocoding) untuk Pesan Antar
  const handleGetGpsLocation = () => {
    if (!navigator.geolocation) {
      alert('Browser Anda tidak mendukung fitur GPS.');
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const link = `https://maps.google.com/?q=${lat},${lng}`;
        setMapsUrl(link);
        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=id`
          );
          if (resp.ok) {
            const data = (await resp.json()) as { display_name?: string };
            if (data?.display_name) {
              setDeliveryAddress(data.display_name);
              setLocatingGps(false);
              return;
            }
          }
        } catch {
          // fallback ke koordinat jika layanan peta sedang sibuk
        }
        if (!deliveryAddress.trim()) {
          setDeliveryAddress(`Titik GPS (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
        }
        setLocatingGps(false);
      },
      () => {
        alert('Gagal mengambil titik GPS. Pastikan izin lokasi browser aktif.');
        setLocatingGps(false);
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  // Buat Kamar Pesan Bareng (Group Order)
  const handleStartGroupOrder = async () => {
    if (!customerName.trim()) {
      alert('Masukkan Nama Anda terlebih dahulu sebelum membuat Pesanan Bareng.');
      return;
    }
    sessionStorage.setItem('lembayung_so_name', customerName.trim());
    sessionStorage.setItem('lembayung_so_wa', customerWa.trim());
    setSubmitting(true);
    try {
      const res = await createGroupOrderRoom({
        outletId: outletIdParam,
        hostName: customerName.trim(),
        hostWa: customerWa.trim(),
        hostDeviceId: myDeviceId,
        mode,
        tableNumber,
        pickupTime,
        deliveryAddress,
        deliveryLandmark,
        mapsUrl,
        initialItems: myCart,
      });
      if (!res.success || !res.orderId) {
        alert(res.error || 'Gagal membuat kamar Pesan Bareng.');
        return;
      }
      sessionStorage.setItem(`lembayung_host_${res.orderId}`, '1');
      setGroupOrderId(res.orderId);
      // Jika Host tadi sudah pilih menu awal, kosongkan myCart karena sudah tersimpan di Keranjang Bersama,
      // sehingga HP ini siap dipakai sendiri atau dipinjam teman yang HP-nya lowbat
      if (myCart.length > 0) {
        setMyCart([]);
        setGroupSyncMsg(
          `Kamar Pesan Bareng dibuat & pilihan ${customerName.trim()} sudah masuk! Teman yang numpang HP bisa ganti nama di bawah.`
        );
      } else {
        setParticipantName(customerName.trim());
        setParticipantWa(customerWa.trim());
      }
      const nextUrl = buildSelfOrderUrl(outletIdParam, {
        group: res.orderId,
        customBaseUrl: window.location.origin,
      });
      window.history.replaceState({}, '', nextUrl);
    } finally {
      setSubmitting(false);
    }
  };

  // Simpan pilihan menu untuk 1 nama pemesan ke Keranjang Bersama (mendukung beberapa teman numpang di 1 HP!)
  const handleSaveMyGroupItems = async () => {
    const targetPerson = (participantName || customerName).trim();
    if (!targetPerson) {
      alert('Masukkan Nama Panggilan pemesan terlebih dahulu.');
      return;
    }
    if (myCart.length === 0) {
      alert('Pilih minimal 1 menu untuk dimasukkan ke Keranjang Bareng.');
      return;
    }
    setSubmitting(true);
    setGroupSyncMsg('');
    try {
      const res = await upsertGroupParticipantItems({
        outletId: outletIdParam,
        orderId: groupOrderId,
        participantName: targetPerson,
        participantWa: participantWa.trim() || undefined,
        participantDeviceId: myDeviceId,
        items: myCart,
      });
      if (!res.success) {
        alert(res.error || 'Gagal menyimpan ke Keranjang Bareng.');
        return;
      }
      rememberOwnedParticipantInGroup(groupOrderId, targetPerson);
      sessionStorage.setItem('lembayung_so_name', targetPerson);
      if (participantWa.trim()) {
        sessionStorage.setItem('lembayung_so_wa', participantWa.trim());
      }
      if (res.updatedOrder) setSharedOrder(res.updatedOrder);
      // Kosongkan keranjang lokal setelah masuk ke Keranjang Bersama agar teman lain yang numpang HP bisa langsung input pesanan baru!
      setMyCart([]);
      setGroupSyncMsg(
        `✓ Pesanan "${targetPerson}" sudah masuk ke Keranjang Bareng! Jika ada teman yang numpang order di HP ini, klik "+ Numpang Order Teman Lain".`
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Muat kembali pesanan salah satu orang dari Keranjang Bersama untuk diedit di HP ini
  const handleEditParticipantFromGroup = (
    personName: string,
    personWa: string | undefined,
    items: SelfOrderCartItem[]
  ) => {
    const menuMap = new Map((catalog?.menus || []).map((m) => [m.id, m]));
    const restored: LocalCartEntry[] = items
      .map((it) => {
        const m = menuMap.get(it.menuId);
        if (!m) return null;
        return {
          menu: m,
          jumlah: it.jumlah,
          catatan: (it.catatan || '').replace(/^\[[^\]]+\]\s*/, ''),
        };
      })
      .filter((x): x is LocalCartEntry => Boolean(x));
    setParticipantName(personName);
    setParticipantWa(personWa || '');
    setMyCart(restored);
    setGroupSyncMsg(`Sedang mengubah pesanan milik "${personName}". Klik Simpan ke Keranjang Bareng jika selesai.`);
  };

  const handleRemoveParticipantFromGroup = async (personName: string) => {
    if (!confirm(`Hapus pesanan milik "${personName}" dari Keranjang Bersama?`)) return;
    setSubmitting(true);
    try {
      const res = await removeGroupParticipantItems({
        outletId: outletIdParam,
        orderId: groupOrderId,
        participantName: personName,
        participantDeviceId: myDeviceId,
      });
      if (!res.success) {
        alert(res.error || 'Tidak dapat menghapus pesanan milik perangkat lain.');
        return;
      }
      if (res.updatedOrder) {
        setSharedOrder(res.updatedOrder);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Kirim Pesanan (Mandiri atau Finalisasi Group Order) ke Kasir Toko
  const handleSubmitOrderToStore = async () => {
    const sharedMeta = sharedOrder ? extractSelfOrderMeta(sharedOrder) : null;
    const effectiveHostName = (sharedMeta?.hostName || customerName || participantName).trim();
    const effectiveMode = sharedMeta?.mode || mode;
    const effectiveWa = (sharedMeta?.customerWa || customerWa).trim();
    const effectiveTable = (sharedMeta?.tableNumber || tableNumber).trim();
    const effectivePickup = (sharedMeta?.pickupTime || pickupTime).trim();
    const effectiveAddress = (sharedMeta?.deliveryAddress || deliveryAddress).trim();
    const effectiveLandmark = (sharedMeta?.deliveryLandmark || deliveryLandmark).trim();
    const effectiveMaps = (sharedMeta?.mapsUrl || mapsUrl).trim();

    if (!effectiveHostName) {
      alert('Nama Pemesan wajib diisi.');
      return;
    }
    if (effectiveMode === 'dine_in' && !effectiveTable) {
      alert('Nomor Meja wajib diisi untuk Makan di Tempat.');
      return;
    }
    if ((effectiveMode === 'delivery' || effectiveMode === 'pickup') && effectiveWa.replace(/\D/g, '').length < 9) {
      alert('Nomor WhatsApp aktif wajib diisi untuk konfirmasi pesanan.');
      return;
    }
    if (effectiveMode === 'delivery' && !effectiveAddress) {
      alert('Alamat pengantaran lengkap wajib diisi untuk Pesan Antar.');
      return;
    }

    setSubmitting(true);
    try {
      let itemsToSend: Array<{
        menuId: string;
        menuNama: string;
        hargaJual: number;
        jumlah: number;
        catatan?: string;
        participantName?: string;
        participantWa?: string;
        participantDeviceId?: string;
      }> = [];

      if (groupOrderId && sharedOrder) {
        const currentPerson = (participantName || effectiveHostName).trim();
        const currentWa = (participantWa || effectiveWa).trim() || undefined;
        const existingGroupItems = (sharedOrder.items as SelfOrderCartItem[]).filter(
          (i) => i.menuId !== '__GROUP_HOLDER__' && i.jumlah > 0
        );
        if (myCart.length > 0) {
          // Hanya timpa pesanan currentPerson jika pesanan tersebut memang dibuat dari HP ini (myDeviceId)
          const existingSameName = existingGroupItems.filter(
            (i) => (i.participantName || '').trim().toLowerCase() === currentPerson.toLowerCase()
          );
          const ownedByOtherDevice =
            existingSameName.length > 0 &&
            existingSameName.some((i) => i.participantDeviceId !== myDeviceId);
          if (ownedByOtherDevice) {
            alert(
              `Nama "${currentPerson}" sudah digunakan oleh teman dari HP lain. Pesanan milik "${currentPerson}" tidak dapat diubah dari HP ini.`
            );
            setSubmitting(false);
            return;
          }
          const others = existingGroupItems.filter(
            (i) => (i.participantName || '').trim().toLowerCase() !== currentPerson.toLowerCase()
          );
          const unsavedCurrent = myCart.map((c) => ({
            menuId: c.menu.id,
            menuNama: c.menu.nama,
            hargaJual: c.menu.hargaJual,
            jumlah: c.jumlah,
            catatan: c.catatan,
            participantName: currentPerson,
            participantWa: currentWa,
            participantDeviceId: myDeviceId,
          }));
          itemsToSend = [...others, ...unsavedCurrent];
        } else {
          itemsToSend = existingGroupItems;
        }
      } else {
        itemsToSend = myCart.map((c) => ({
          menuId: c.menu.id,
          menuNama: c.menu.nama,
          hargaJual: c.menu.hargaJual,
          jumlah: c.jumlah,
          catatan: c.catatan,
          participantName: effectiveHostName,
          participantWa: effectiveWa || undefined,
        }));
      }

      const res = await submitSelfOrderToCashier({
        outletId: outletIdParam,
        existingGroupOrderId: groupOrderId || undefined,
        meta: {
          mode: effectiveMode,
          customerName: effectiveHostName,
          customerWa: effectiveWa || undefined,
          tableNumber: effectiveTable || undefined,
          pickupTime: effectivePickup || undefined,
          deliveryAddress: effectiveAddress || undefined,
          deliveryLandmark: effectiveLandmark || undefined,
          mapsUrl: effectiveMaps || undefined,
          isGroupOrder: Boolean(groupOrderId),
          groupCode: sharedMeta?.groupCode,
          hostName: effectiveHostName,
        },
        items: itemsToSend,
      });

      if (!res.success || !res.orderId) {
        alert(res.error || 'Gagal mengirim pesanan.');
        return;
      }

      setTrackedOrderId(res.orderId);
      const trackUrl = buildSelfOrderUrl(outletIdParam, {
        track: res.orderId,
        customBaseUrl: window.location.origin,
      });
      window.history.replaceState({}, '', trackUrl);
    } finally {
      setSubmitting(false);
    }
  };

  // Hitung rincian Split Bill per orang untuk Group Order
  const splitBillSummary = useMemo(() => {
    const items = ((sharedOrder?.items as SelfOrderCartItem[]) || []).filter(
      (i) => i.menuId !== '__GROUP_HOLDER__' && i.jumlah > 0
    );
    const ownedNames = new Set(getOwnedParticipantsInGroup(groupOrderId));
    const sessionNameNorm = (
      sessionStorage.getItem('lembayung_so_name') ||
      participantName ||
      customerName ||
      ''
    )
      .trim()
      .toLowerCase();
    const sessionWaDigits = (
      sessionStorage.getItem('lembayung_so_wa') ||
      participantWa ||
      customerWa ||
      ''
    ).replace(/\D/g, '');

    const map = new Map<
      string,
      {
        name: string;
        wa?: string;
        deviceId?: string;
        isMine: boolean;
        total: number;
        qty: number;
        items: SelfOrderCartItem[];
      }
    >();
    for (const it of items) {
      const pName = (it.participantName || 'Pemesan').trim();
      const key = pName.toLowerCase();
      const itemWaDigits = (it.participantWa || '').replace(/\D/g, '');

      // Cek apakah pesanan ini milik HP ini:
      // 1) participantDeviceId cocok dengan myDeviceId, ATAU
      // 2) Nama pemesan tercatat di daftar ownedNames HP ini pada kamar ini, ATAU
      // 3) Pesanan lama (belum punya participantDeviceId) dan namanya/WA-nya sama dengan session HP ini
      const checkIsMine = (devId?: string, waDigits?: string) => {
        if (devId) {
          return (
            devId === myDeviceId ||
            ownedNames.has(key) ||
            Boolean(waDigits && sessionWaDigits && waDigits === sessionWaDigits)
          );
        }
        return (
          ownedNames.has(key) ||
          (Boolean(sessionNameNorm) && key === sessionNameNorm) ||
          Boolean(waDigits && sessionWaDigits && waDigits === sessionWaDigits)
        );
      };

      const prev = map.get(key) || {
        name: pName,
        wa: it.participantWa,
        deviceId: it.participantDeviceId,
        isMine: checkIsMine(it.participantDeviceId, itemWaDigits),
        total: 0,
        qty: 0,
        items: [],
      };
      if (!prev.wa && it.participantWa) prev.wa = it.participantWa;
      if (!prev.deviceId && it.participantDeviceId) {
        prev.deviceId = it.participantDeviceId;
      }
      prev.isMine = checkIsMine(prev.deviceId, (prev.wa || '').replace(/\D/g, ''));
      prev.total += it.hargaJual * it.jumlah;
      prev.qty += it.jumlah;
      prev.items.push(it);
      map.set(key, prev);
    }
    return Array.from(map.values());
  }, [
    sharedOrder?.items,
    myDeviceId,
    groupOrderId,
    participantName,
    customerName,
    participantWa,
    customerWa,
  ]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#faf9f5] flex items-center justify-center text-sm text-[#6b6a68]">
        Memuat menu toko...
      </div>
    );
  }

  if (error || !catalog) {
    return (
      <div className="min-h-screen bg-[#faf9f5] flex items-center justify-center p-4">
        <div className="bg-white border border-[#e2e0d8] rounded-2xl p-6 max-w-[380px] w-full text-center flex flex-col gap-3">
          <div className="text-base font-bold text-[#9b1c12]">Tidak Dapat Memuat Toko</div>
          <div className="text-xs text-[#6b6a68]">{error}</div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // LAYAR LIVE ORDER TRACKER (SETELAH PESANAN DIKIRIM KE KASIR)
  // =========================================================================
  if (trackedOrderId) {
    const meta = sharedOrder ? extractSelfOrderMeta(sharedOrder) : null;
    const stage = orderCompletedPaid ? 'selesai' : meta?.stage || 'menunggu_konfirmasi';
    const realItems = ((sharedOrder?.items as SelfOrderCartItem[]) || []).filter(
      (i) => i.menuId !== '__GROUP_HOLDER__' && i.jumlah > 0
    );
    const grandTotal = realItems.reduce((s, i) => s + i.hargaJual * i.jumlah, 0);
    const storeWa = catalog.teleponUsaha.replace(/\D/g, '').replace(/^0/, '62');

    const stages: Array<{ key: string; label: string }> = [
      { key: 'menunggu_konfirmasi', label: 'Menunggu Konfirmasi Kasir' },
      { key: 'diproses', label: 'Sedang Disiapkan / Dimasak' },
      {
        key: 'diantar',
        label:
          meta?.mode === 'delivery'
            ? 'Sedang Diantar ke Lokasi Anda'
            : meta?.mode === 'pickup'
            ? 'Siap Diambil di Toko'
            : 'Siap Disajikan ke Meja',
      },
      { key: 'selesai', label: 'Selesai & Lunas' },
    ];
    const currentIdx = Math.max(0, stages.findIndex((s) => s.key === stage));

    return (
      <div className="min-h-screen bg-[#faf9f5] py-6 px-4 flex justify-center">
        <div className="w-full max-w-[440px] flex flex-col gap-4">
          <div className="bg-white border border-[#e2e0d8] rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CuaninLogo size={32} />
                <div>
                  <div className="font-bold text-sm text-[#1f1e1d]">
                    {catalog.namaUsaha} ({catalog.namaCabang})
                  </div>
                  <div className="text-[11px] text-[#1F7A5A] font-semibold">
                    Status Pesanan Live
                  </div>
                </div>
              </div>
              <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg bg-[#f4f9f6] text-[#1F7A5A] border border-[#c5dfd1]">
                {meta ? formatModeLabel(meta.mode) : 'Self-Order'}
              </span>
            </div>

            <div className="bg-[#f4f9f6] border border-[#c5dfd1] rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={20} className="text-[#1F7A5A] shrink-0" />
                <div>
                  <div className="font-bold text-sm text-[#1f1e1d]">
                    {formatStageLabel(stage, meta?.mode)}
                  </div>
                  <div className="text-[11px] text-[#6b6a68]">
                    {sharedOrder?.labelMejaPelanggan || customerName}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-1">
                {stages.map((st, idx) => {
                  const done = idx <= currentIdx;
                  return (
                    <div key={st.key} className="flex items-center gap-2.5 text-xs">
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          done ? 'bg-[#1F7A5A] text-white' : 'bg-[#e2e0d8] text-[#6b6a68]'
                        }`}
                      >
                        {done ? '✓' : idx + 1}
                      </span>
                      <span className={done ? 'font-semibold text-[#1f1e1d]' : 'text-[#6b6a68]'}>
                        {st.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {meta?.deliveryAddress && (
              <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-3 text-xs flex flex-col gap-1">
                <div className="font-semibold text-[#4a4947]">Alamat Pengantaran:</div>
                <div className="text-[#1f1e1d]">{meta.deliveryAddress}</div>
                {meta.deliveryLandmark && (
                  <div className="text-[11px] text-[#1F7A5A] font-medium">
                    Patokan: {meta.deliveryLandmark}
                  </div>
                )}
              </div>
            )}

            {/* Rincian Split Bill per Orang jika Pesan Bareng */}
            {splitBillSummary.length > 1 && (
              <div className="border border-[#e2e0d8] rounded-xl p-3.5 flex flex-col gap-2">
                <div className="font-bold text-xs text-[#1f1e1d] flex items-center gap-1.5">
                  <Users size={14} className="text-[#1F7A5A]" /> Rincian Patungan per Orang (Split Bill)
                </div>
                {splitBillSummary.map((p) => (
                  <div key={p.name} className="flex justify-between text-xs border-t border-[#eeece5] pt-1.5">
                    <span className="font-medium text-[#1f1e1d]">
                      {p.name} <span className="text-[#6b6a68]">({p.qty} item)</span>
                    </span>
                    <span className="font-bold text-[#1F7A5A]">{formatRupiah(p.total)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Daftar Item */}
            <div className="border-t border-[#eeece5] pt-3 flex flex-col gap-2 text-xs">
              <div className="font-bold text-[#1f1e1d]">Rincian Menu</div>
              {realItems.map((it) => (
                <div key={it.id} className="flex justify-between gap-2">
                  <div>
                    <div className="font-medium text-[#1f1e1d]">
                      {it.menuNama} <span className="font-bold">×{it.jumlah}</span>
                    </div>
                    {it.catatan && <div className="text-[11px] text-[#6b6a68]">{it.catatan}</div>}
                  </div>
                  <div className="font-semibold shrink-0">
                    {formatRupiah(it.hargaJual * it.jumlah)}
                  </div>
                </div>
              ))}
              <div className="flex justify-between border-t border-[#eeece5] pt-2 text-sm font-bold">
                <span>Total Pesanan</span>
                <span className="text-[#1F7A5A]">{formatRupiah(grandTotal)}</span>
              </div>
            </div>

            {storeWa && (
              <a
                href={`https://wa.me/${storeWa}?text=${encodeURIComponent(
                  `Halo ${catalog.namaUsaha}, saya ingin konfirmasi pesanan atas nama *${
                    meta?.customerName || customerName
                  }* (Total ${formatRupiah(grandTotal)}).`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="h-11 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white text-xs font-semibold flex items-center justify-center gap-2"
              >
                <MessageCircle size={16} /> Hubungi WhatsApp Toko
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // LAYAR UTAMA PEMILIHAN MENU & GROUP ORDER (PESAN BARENG)
  // =========================================================================
  const groupShareUrl = groupOrderId
    ? buildSelfOrderUrl(outletIdParam, {
        group: groupOrderId,
        customBaseUrl: window.location.origin,
      })
    : '';

  return (
    <div className="min-h-screen bg-[#faf9f5] pb-28">
      {/* Header Toko */}
      <header className="bg-white border-b border-[#e2e0d8] sticky top-0 z-20 px-4 py-3">
        <div className="max-w-[600px] mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <CuaninLogo size={32} />
            <div className="min-w-0">
              <div className="font-bold text-sm text-[#1f1e1d] truncate">
                {catalog.namaUsaha} · {catalog.namaCabang}
              </div>
              <div className="text-[11px] text-[#6b6a68] truncate">{catalog.alamatUsaha}</div>
            </div>
          </div>
          <span
            className={`text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 ${
              catalog.isStoreOpen
                ? 'bg-[#e4f1ea] text-[#15803d]'
                : 'bg-[#fbe4e1] text-[#9b1c12]'
            }`}
          >
            {catalog.isStoreOpen ? '● Toko Buka' : '● Toko Tutup'}
          </span>
        </div>
      </header>

      <main className="max-w-[600px] mx-auto p-4 flex flex-col gap-4">
        {!catalog.isStoreOpen && (
          <div className="bg-[#fbe4e1] border border-[#f5c2bc] text-[#9b1c12] rounded-2xl p-4 text-xs flex items-center gap-3">
            <Store size={20} className="shrink-0" />
            <div>
              <div className="font-bold text-sm">Maaf, Toko Sedang Tutup</div>
              <div>
                Saat ini kasir belum membuka operasional toko sehingga belum dapat menerima pesanan baru.
              </div>
            </div>
          </div>
        )}

        {/* Banner Kamar Pesan Bareng (Group Order) */}
        {groupOrderId ? (
          <div className="bg-[#eef2ff] border border-[#c7d2fe] rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-[#3730a3]" />
                <div>
                  <div className="font-bold text-sm text-[#3730a3]">
                    Mode Pesan Bareng (Group Order)
                  </div>
                  <div className="text-[11px] text-[#4338ca]">
                    {isHost
                      ? 'Bagikan link ini ke teman-teman, lalu klik Kirim ke Toko jika semua sudah pilih.'
                      : 'Pilih menu Anda lalu tekan tombol "Masukkan ke Keranjang Bareng".'}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard?.writeText(groupShareUrl);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
                className="flex-1 h-9 rounded-xl bg-white border border-[#c7d2fe] text-[#3730a3] text-xs font-semibold inline-flex items-center justify-center gap-1.5"
              >
                {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                {copiedLink ? 'Link Tersalin' : 'Salin Link Bareng'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const txt = `Yuk ikut *Pesan Bareng* ke *${catalog.namaUsaha}*! Klik link ini untuk pilih menu masing-masing:\n${groupShareUrl}`;
                  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
                }}
                className="flex-1 h-9 rounded-xl bg-[#4338ca] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <Share2 size={14} /> Share ke Grup WA
              </button>
            </div>

            {/* Ringkasan Keranjang Bersama & Split Bill Real-Time (+ Edit/Hapus jika numpang 1 HP) */}
            {splitBillSummary.length > 0 && (
              <div className="bg-white rounded-xl p-3 border border-[#c7d2fe] flex flex-col gap-2 text-xs">
                <div className="font-bold text-[#1f1e1d] flex items-center justify-between">
                  <span>Keranjang Bersama ({splitBillSummary.length} orang)</span>
                  <span className="text-[#1F7A5A]">
                    {formatRupiah(splitBillSummary.reduce((s, p) => s + p.total, 0))}
                  </span>
                </div>
                {splitBillSummary.map((p) => (
                  <div key={p.name} className="border-t border-[#eeece5] pt-2 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#1f1e1d]">
                        👤 {p.name}
                        {p.isMine && (
                          <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#eef2ff] text-[#3730a3]">
                            HP Ini
                          </span>
                        )}
                        {p.wa && <span className="text-[10px] font-normal text-[#6b6a68]"> · {p.wa}</span>}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-[#1F7A5A]">{formatRupiah(p.total)}</span>
                        {p.isMine && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEditParticipantFromGroup(p.name, p.wa, p.items)}
                              title="Ubah pilihan menu Anda"
                              className="h-6 px-2 rounded-md border border-[#d6d3c8] bg-[#faf9f5] hover:bg-[#ece9e0] text-[10px] font-semibold text-[#4a4947] inline-flex items-center gap-1"
                            >
                              <Pencil size={10} /> Ubah
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveParticipantFromGroup(p.name)}
                              title="Hapus pesanan ini"
                              className="h-6 px-1.5 rounded-md border border-[#f5c2bc] bg-[#fdf7f6] hover:bg-[#fbe4e1] text-[#9b1c12] inline-flex items-center"
                            >
                              <Trash2 size={10} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-[11px] text-[#6b6a68]">
                      {p.items
                        .map((i) => `${i.menuNama} ×${i.jumlah}${i.catatan ? ` (${i.catatan})` : ''}`)
                        .join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Pilihan Tipe Pesanan & Buat Pesan Bareng */
          <div className="bg-white border border-[#e2e0d8] rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#1f1e1d]">Pilih Cara Pesan</span>
              <button
                type="button"
                disabled={!catalog.isStoreOpen || submitting}
                onClick={handleStartGroupOrder}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#eef2ff] text-[#3730a3] border border-[#c7d2fe] inline-flex items-center gap-1 disabled:opacity-50"
              >
                <Users size={12} /> Buat Pesan Bareng
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: 'dine_in', label: '🍽️ Makan Sini' },
                  { key: 'pickup', label: '🛍️ Ambil Sendiri' },
                  { key: 'delivery', label: '🛵 Pesan Antar' },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key)}
                  className={`h-9 rounded-xl border text-xs font-semibold transition ${
                    mode === m.key
                      ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                      : 'bg-[#faf9f5] border-[#d6d3c8] text-[#4a4947]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div>
                <label className="block text-[11px] font-semibold text-[#4a4947] mb-1">
                  Nama Anda *
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Contoh: Rina"
                  className="w-full h-9 border border-[#d6d3c8] rounded-xl px-3 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#4a4947] mb-1">
                  No. WhatsApp {mode !== 'dine_in' ? '*' : '(Opsional)'}
                </label>
                <input
                  type="tel"
                  value={customerWa}
                  onChange={(e) => setCustomerWa(e.target.value)}
                  placeholder="0812xxxx"
                  className="w-full h-9 border border-[#d6d3c8] rounded-xl px-3 text-xs"
                />
              </div>
            </div>

            {mode === 'dine_in' && (
              <div>
                <label className="block text-[11px] font-semibold text-[#4a4947] mb-1">
                  Nomor Meja *
                </label>
                <input
                  type="text"
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="Contoh: Meja 3"
                  className="w-full h-9 border border-[#d6d3c8] rounded-xl px-3 text-xs"
                />
              </div>
            )}

            {mode === 'pickup' && (
              <div>
                <label className="block text-[11px] font-semibold text-[#4a4947] mb-1">
                  Rencana Jam Ambil
                </label>
                <input
                  type="time"
                  value={pickupTime}
                  onChange={(e) => setPickupTime(e.target.value)}
                  className="w-full h-9 border border-[#d6d3c8] rounded-xl px-3 text-xs"
                />
              </div>
            )}

            {mode === 'delivery' && (
              <div className="flex flex-col gap-2.5">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-[11px] font-semibold text-[#4a4947]">
                      Alamat Pengantaran Lengkap *
                    </label>
                    <button
                      type="button"
                      onClick={handleGetGpsLocation}
                      disabled={locatingGps}
                      className="h-7 px-2.5 rounded-lg bg-[#e4f1ea] text-[#1F7A5A] text-[11px] font-semibold inline-flex items-center gap-1"
                    >
                      <Navigation size={11} />
                      {locatingGps
                        ? 'Mencari Alamat GPS...'
                        : mapsUrl
                        ? '✓ Isi Ulang dari GPS'
                        : 'Isi Otomatis dari GPS'}
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="Klik 'Isi Otomatis dari GPS' di kanan atas atau ketik alamat lengkap Anda"
                    className="w-full border border-[#d6d3c8] rounded-xl p-2.5 text-xs"
                  />
                  {mapsUrl && (
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="text-[#1F7A5A] font-medium">
                        ✓ Titik koordinat Google Maps sudah terlampir
                      </span>
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#1F7A5A] underline font-semibold"
                      >
                        Lihat Peta
                      </a>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#4a4947] mb-1">
                    Patokan Lokasi / Detail Rumah (Opsional)
                  </label>
                  <input
                    type="text"
                    value={deliveryLandmark}
                    onChange={(e) => setDeliveryLandmark(e.target.value)}
                    placeholder="Contoh: Pagar hitam samping masjid / Rumah cat krem"
                    className="w-full h-9 border border-[#d6d3c8] rounded-xl px-3 text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Box Input Nama & No. WA Pemesan di Mode Pesan Bareng + Tombol Numpang Order Teman Lain di 1 HP */}
        {groupOrderId && (
          <div className="bg-white border border-[#e2e0d8] rounded-2xl p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-[11px] font-semibold text-[#4a4947]">
                Sedang Memilih Menu untuk Siapa di HP Ini? *
              </label>
              <button
                type="button"
                onClick={() => {
                  setParticipantName('');
                  setParticipantWa('');
                  setMyCart([]);
                  setGroupSyncMsg('Silakan ketik Nama & No. WA teman yang numpang order lalu pilih menunya.');
                }}
                className="h-7 px-2.5 rounded-lg bg-[#eef2ff] border border-[#c7d2fe] text-[#3730a3] text-[11px] font-semibold inline-flex items-center gap-1 shrink-0"
              >
                <UserPlus size={12} /> + Numpang Order Teman Lain
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={participantName}
                onChange={(e) => setParticipantName(e.target.value)}
                placeholder="Nama pemesan (mis. Budi / Andi) *"
                className="w-full h-9 border border-[#d6d3c8] rounded-xl px-3 text-xs font-semibold text-[#1f1e1d] focus:outline-none focus:border-[#4338ca]"
              />
              <input
                type="tel"
                value={participantWa}
                onChange={(e) => setParticipantWa(e.target.value)}
                placeholder="No. WA (0812... untuk kirim struk terpisah)"
                className="w-full h-9 border border-[#d6d3c8] rounded-xl px-3 text-xs text-[#1f1e1d] focus:outline-none focus:border-[#4338ca]"
              />
            </div>
            <div className="text-[11px] text-[#6b6a68]">
              💡 Isi <strong>No. WA masing-masing pemesan</strong> agar kasir dapat mengirimkan <strong>Struk Digital Terpisah (Split Bill)</strong> langsung ke WhatsApp tiap orang.
            </div>
          </div>
        )}

        {groupSyncMsg && (
          <div className="bg-[#e4f1ea] border border-[#c5dfd1] text-[#14532d] text-xs font-semibold px-3.5 py-2.5 rounded-xl">
            {groupSyncMsg}
          </div>
        )}

        {/* Pencarian & Filter Kategori Menu */}
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b6a68]"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari menu favorit..."
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#d6d3c8] bg-white text-xs focus:outline-none focus:border-[#1F7A5A]"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedKategori(cat)}
                className={`h-8 px-3 rounded-full text-xs font-semibold whitespace-nowrap border transition ${
                  selectedKategori === cat
                    ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                    : 'bg-white border-[#d6d3c8] text-[#4a4947]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Daftar Menu */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {filteredMenus.map((menu) => {
            const qty = getMyQty(menu.id);
            const entry = myCart.find((c) => c.menu.id === menu.id);
            return (
              <div
                key={menu.id}
                className={`bg-white rounded-2xl p-3.5 border flex flex-col justify-between gap-2.5 transition ${
                  qty > 0 ? 'border-[#1F7A5A] ring-1 ring-[#1F7A5A]' : 'border-[#e2e0d8]'
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="text-[10px] font-medium text-[#6b6a68]">{menu.kategori}</div>
                    <div className="font-bold text-sm text-[#1f1e1d] mt-0.5">{menu.nama}</div>
                    <div className="font-bold text-sm text-[#1F7A5A] mt-1">
                      {formatRupiah(menu.hargaJual)}
                    </div>
                  </div>
                  {qty === 0 ? (
                    <button
                      type="button"
                      disabled={!catalog.isStoreOpen}
                      onClick={() => updateMyCart(menu, 1)}
                      className="h-8 px-3 rounded-xl bg-[#e4f1ea] text-[#1F7A5A] text-xs font-bold disabled:opacity-40"
                    >
                      + Tambah
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => updateMyCart(menu, -1)}
                        className="w-7 h-7 rounded-full bg-[#ece9e0] flex items-center justify-center"
                      >
                        <Minus size={13} />
                      </button>
                      <span className="text-xs font-bold min-w-[18px] text-center">{qty}</span>
                      <button
                        type="button"
                        onClick={() => updateMyCart(menu, 1)}
                        className="w-7 h-7 rounded-full bg-[#1F7A5A] text-white flex items-center justify-center"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {qty > 0 && (
                  <input
                    type="text"
                    value={entry?.catatan || ''}
                    onChange={(e) => updateMyNote(menu.id, e.target.value)}
                    placeholder="Catatan (mis. pedas / tanpa es)"
                    className="w-full h-8 border border-[#e2e0d8] rounded-lg px-2.5 text-[11px] bg-[#faf9f5]"
                  />
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* Bottom Sticky Action Bar */}
      {catalog.isStoreOpen && (myTotalQty > 0 || (groupOrderId && splitBillSummary.length > 0)) && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#e2e0d8] p-3 shadow-lg">
          <div className="max-w-[600px] mx-auto flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] text-[#6b6a68]">
                {groupOrderId ? `Pilihan Anda (${myTotalQty} item)` : `${myTotalQty} item dipilih`}
              </div>
              <div className="font-bold text-sm text-[#1F7A5A]">{formatRupiah(mySubtotal)}</div>
            </div>

            <div className="flex items-center gap-2">
              {groupOrderId && (
                <button
                  type="button"
                  disabled={submitting || myTotalQty === 0}
                  onClick={handleSaveMyGroupItems}
                  className="h-10 px-3.5 rounded-xl bg-[#4338ca] text-white text-xs font-semibold disabled:opacity-50"
                >
                  {submitting ? 'Menyimpan...' : 'Masukkan ke Keranjang Bareng'}
                </button>
              )}

              {(!groupOrderId || isHost) && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmitOrderToStore}
                  className="h-10 px-4 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <ShoppingBag size={14} />
                  {submitting
                    ? 'Mengirim...'
                    : groupOrderId
                    ? 'Kirim Gabungan ke Toko'
                    : 'Kirim Pesanan'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

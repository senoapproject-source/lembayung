import { db, hashPassword } from './database';
import { calcActiveIngredientPrice, calcRecipeHpp } from '../lib/calculations';
import type {
  User,
  Ingredient,
  Purchase,
  Recipe,
  MenuItem,
  MenuHppHistory,
  Transaction,
  ExpenseCategory,
  Expense,
  MonthlyTarget,
  AppSettings,
} from '../types/models';

export async function seedInitialDataIfEmpty(): Promise<void> {
  const existingSettings = await db.settings.get('global');
  if (existingSettings) return;

  // DI ENVIRONMENT PRODUCTION: JANGAN ISI DATA DEMO (WARUNG SARI / ANDI / DINA)!
  // Biarkan database kosong agar merchant baru langsung masuk ke layar "Buat Akun / Login"
  const envMode = (import.meta.env.VITE_APP_ENV as string | undefined) || import.meta.env.MODE;
  if (envMode === 'production') {
    return;
  }

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const currentMonth = todayStr.slice(0, 7); // YYYY-MM

  const daysAgo = (d: number): string => {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - d);
    return dt.toISOString().slice(0, 10);
  };

  const isoDaysAgo = (d: number, hour: number, minute: number): string => {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - d);
    dt.setHours(hour, minute, 0, 0);
    return dt.toISOString();
  };

  // 1. Settings
  const settings: AppSettings = {
    id: 'global',
    namaUsaha: 'Warung Sari',
    alamatUsaha: 'Jl. Merdeka No. 18, Bandung',
    teleponUsaha: '0812-3456-7890',
    strukHeader: 'Masakan Rumahan & Kopi Hangat',
    strukFooter: 'Terima kasih sudah berbelanja di Warung Sari!',
    strukTampilkanKasir: true,
    strukTampilkanCatatanItem: true,
    strukTampilkanWaUsaha: true,
    defaultMarginPersen: 40,
    metodeHargaBahan: 'weighted_avg',
    jumlahPembelianN: 5,
    pembulatanHarga: 500,
    ambangMepetBepPersen: 10,
    defaultKasirDiscount: false,
    defaultKasirRecordExpense: true,
    lastBackupAt: now.toISOString(),
    cloudSyncMode: 'supabase',
    outletId: 'LM-A10001',
  };

  // 2. Users (sesuai Mockup Pengaturan_dan_Pengguna.html)
  const ownerHash = await hashPassword('Owner123!');
  const kasirHash = await hashPassword('Kasir123!');

  const users: User[] = [
    {
      id: 'usr-owner-1',
      nama: 'Andi',
      username: 'owner@warungsari.id',
      passwordHash: ownerHash,
      pin: '123456',
      role: 'owner',
      canDiscount: true,
      canRecordExpense: true,
      active: true,
      createdAt: isoDaysAgo(30, 8, 0),
      updatedAt: isoDaysAgo(30, 8, 0),
    },
    {
      id: 'usr-kasir-1',
      nama: 'Dina',
      username: 'dina@warungsari.id',
      passwordHash: kasirHash,
      pin: '000000',
      role: 'kasir',
      canDiscount: false,
      canRecordExpense: true,
      active: true,
      createdAt: isoDaysAgo(25, 8, 0),
      updatedAt: isoDaysAgo(25, 8, 0),
    },
    {
      id: 'usr-kasir-2',
      nama: 'Budi',
      username: 'budi@warungsari.id',
      passwordHash: kasirHash,
      role: 'kasir',
      canDiscount: false,
      canRecordExpense: false,
      active: false,
      createdAt: isoDaysAgo(60, 8, 0),
      updatedAt: isoDaysAgo(10, 8, 0),
    },
  ];

  // 3. Expense Categories (FR-EXP-02)
  const categories: ExpenseCategory[] = [
    { id: 'cat-bahan', nama: 'Bahan Baku', sudahMasukHpp: true, isSystem: true },
    { id: 'cat-sewa', nama: 'Sewa', sudahMasukHpp: false },
    { id: 'cat-gas', nama: 'Gas/Listrik', sudahMasukHpp: false },
    { id: 'cat-gaji', nama: 'Gaji', sudahMasukHpp: false },
    { id: 'cat-kemasan', nama: 'Kemasan', sudahMasukHpp: false },
    { id: 'cat-lain', nama: 'Lain-lain', sudahMasukHpp: false },
  ];

  // 4. Ingredients (sesuai Mockup Bahan_Baku_dan_Riwayat_Harga.html)
  const ingredients: Ingredient[] = [
    { id: 'ing-telur', nama: 'Telur', satuanDasar: 'qty', labelSatuanDasar: 'butir', hargaAktif: 1750, active: true, updatedAt: now.toISOString() },
    { id: 'ing-beras', nama: 'Beras', satuanDasar: 'gram', labelSatuanDasar: 'gram', hargaAktif: 14, active: true, updatedAt: now.toISOString() },
    { id: 'ing-minyak', nama: 'Minyak goreng', satuanDasar: 'ml', labelSatuanDasar: 'ml', hargaAktif: 19, active: true, updatedAt: now.toISOString() },
    { id: 'ing-ayam', nama: 'Daging Ayam Fillet', satuanDasar: 'gram', labelSatuanDasar: 'gram', hargaAktif: 45, active: true, updatedAt: now.toISOString() },
    { id: 'ing-mie', nama: 'Mie Telur Kering', satuanDasar: 'gram', labelSatuanDasar: 'gram', hargaAktif: 22, active: true, updatedAt: now.toISOString() },
    { id: 'ing-teh', nama: 'Teh Melati & Gula', satuanDasar: 'gram', labelSatuanDasar: 'gram', hargaAktif: 30, active: true, updatedAt: now.toISOString() },
    { id: 'ing-kopi', nama: 'Kopi & Susu Kental', satuanDasar: 'ml', labelSatuanDasar: 'ml', hargaAktif: 40, active: true, updatedAt: now.toISOString() },
    { id: 'ing-roti', nama: 'Roti Tawar & Topping', satuanDasar: 'qty', labelSatuanDasar: 'porsi', hargaAktif: 10500, active: true, updatedAt: now.toISOString() },
  ];

  // 5. Purchases (sesuai contoh FRD: Telur 1 kg -> 17 butir & 1 kg -> 15 butir)
  const purchases: Purchase[] = [
    {
      id: 'pur-1',
      ingredientId: 'ing-telur',
      tanggal: daysAgo(7),
      jumlahBeli: 1,
      satuanBeli: 'kg',
      totalHarga: 28000,
      satuanDasarDidapat: 17,
      hargaPerSatuanDasar: 28000 / 17,
      penjual: 'Agen Telur Jaya',
      pembuatId: 'usr-owner-1',
      pembuatNama: 'Andi',
      createdAt: isoDaysAgo(7, 7, 30),
    },
    {
      id: 'pur-2',
      ingredientId: 'ing-telur',
      tanggal: todayStr,
      jumlahBeli: 1,
      satuanBeli: 'kg',
      totalHarga: 28000,
      satuanDasarDidapat: 15,
      hargaPerSatuanDasar: 28000 / 15,
      penjual: 'Agen Telur Jaya',
      pembuatId: 'usr-owner-1',
      pembuatNama: 'Andi',
      createdAt: isoDaysAgo(0, 7, 15),
    },
    {
      id: 'pur-3',
      ingredientId: 'ing-beras',
      tanggal: daysAgo(5),
      jumlahBeli: 25,
      satuanBeli: 'kg',
      totalHarga: 350000,
      satuanDasarDidapat: 25000,
      hargaPerSatuanDasar: 14,
      penjual: 'Toko Beras Makmur',
      pembuatId: 'usr-owner-1',
      pembuatNama: 'Andi',
      createdAt: isoDaysAgo(5, 8, 0),
    },
    {
      id: 'pur-4',
      ingredientId: 'ing-minyak',
      tanggal: daysAgo(4),
      jumlahBeli: 10,
      satuanBeli: 'liter',
      totalHarga: 190000,
      satuanDasarDidapat: 10000,
      hargaPerSatuanDasar: 19,
      penjual: 'Grosir Sembako',
      pembuatId: 'usr-owner-1',
      pembuatNama: 'Andi',
      createdAt: isoDaysAgo(4, 9, 0),
    },
    {
      id: 'pur-5',
      ingredientId: 'ing-ayam',
      tanggal: daysAgo(2),
      jumlahBeli: 10,
      satuanBeli: 'kg',
      totalHarga: 450000,
      satuanDasarDidapat: 10000,
      hargaPerSatuanDasar: 45,
      penjual: 'Pasar Baru',
      pembuatId: 'usr-owner-1',
      pembuatNama: 'Andi',
      createdAt: isoDaysAgo(2, 6, 30),
    },
    {
      id: 'pur-6',
      ingredientId: 'ing-mie',
      tanggal: daysAgo(3),
      jumlahBeli: 5,
      satuanBeli: 'kg',
      totalHarga: 110000,
      satuanDasarDidapat: 5000,
      hargaPerSatuanDasar: 22,
      penjual: 'Grosir Sembako',
      pembuatId: 'usr-owner-1',
      pembuatNama: 'Andi',
      createdAt: isoDaysAgo(3, 8, 15),
    },
    {
      id: 'pur-7',
      ingredientId: 'ing-teh',
      tanggal: daysAgo(6),
      jumlahBeli: 2,
      satuanBeli: 'kg',
      totalHarga: 60000,
      satuanDasarDidapat: 2000,
      hargaPerSatuanDasar: 30,
      penjual: 'Grosir Sembako',
      pembuatId: 'usr-owner-1',
      pembuatNama: 'Andi',
      createdAt: isoDaysAgo(6, 9, 0),
    },
    {
      id: 'pur-8',
      ingredientId: 'ing-kopi',
      tanggal: daysAgo(3),
      jumlahBeli: 5,
      satuanBeli: 'liter',
      totalHarga: 200000,
      satuanDasarDidapat: 5000,
      hargaPerSatuanDasar: 40,
      penjual: 'Supplier Kopi',
      pembuatId: 'usr-owner-1',
      pembuatNama: 'Andi',
      createdAt: isoDaysAgo(3, 10, 0),
    },
    {
      id: 'pur-9',
      ingredientId: 'ing-roti',
      tanggal: daysAgo(1),
      jumlahBeli: 20,
      satuanBeli: 'pack',
      totalHarga: 210000,
      satuanDasarDidapat: 20,
      hargaPerSatuanDasar: 10500,
      penjual: 'Bakery Sari',
      pembuatId: 'usr-owner-1',
      pembuatNama: 'Andi',
      createdAt: isoDaysAgo(1, 7, 0),
    },
  ];

  // Recalculate active ingredient prices using weighted average
  for (const ing of ingredients) {
    const ingPurchases = purchases.filter((p) => p.ingredientId === ing.id);
    ing.hargaAktif = calcActiveIngredientPrice(ingPurchases, settings.metodeHargaBahan, settings.jumlahPembelianN);
  }

  // 6. Recipes
  const recipes: Recipe[] = [
    {
      id: 'rec-nasgor',
      nama: 'Nasi Goreng Ayam Telur',
      jumlahPorsiHasil: 5,
      isSubRecipe: false,
      items: [
        { id: 'ri-1', type: 'ingredient', refId: 'ing-beras', takaran: 750, susutPersen: 0 },
        { id: 'ri-2', type: 'ingredient', refId: 'ing-telur', takaran: 5, susutPersen: 0 },
        { id: 'ri-3', type: 'ingredient', refId: 'ing-ayam', takaran: 300, susutPersen: 10 },
        { id: 'ri-4', type: 'ingredient', refId: 'ing-minyak', takaran: 100, susutPersen: 0 },
      ],
      biayaLain: [{ id: 'rc-1', nama: 'Bumbu & Kemasan', nominal: 17550, mode: 'batch' }],
      hppPerPorsi: 0,
      hasMissingPrice: false,
      updatedAt: now.toISOString(),
    },
    {
      id: 'rec-miegor',
      nama: 'Mie Goreng Telur',
      jumlahPorsiHasil: 5,
      isSubRecipe: false,
      items: [
        { id: 'ri-5', type: 'ingredient', refId: 'ing-mie', takaran: 750, susutPersen: 0 },
        { id: 'ri-6', type: 'ingredient', refId: 'ing-telur', takaran: 5, susutPersen: 0 },
        { id: 'ri-7', type: 'ingredient', refId: 'ing-minyak', takaran: 100, susutPersen: 0 },
      ],
      biayaLain: [{ id: 'rc-2', nama: 'Bumbu & Kemasan', nominal: 18350, mode: 'batch' }],
      hppPerPorsi: 0,
      hasMissingPrice: false,
      updatedAt: now.toISOString(),
    },
    {
      id: 'rec-telurdadar',
      nama: 'Telur Dadar',
      jumlahPorsiHasil: 1,
      isSubRecipe: false,
      items: [
        { id: 'ri-8', type: 'ingredient', refId: 'ing-telur', takaran: 2, susutPersen: 0 },
        { id: 'ri-9', type: 'ingredient', refId: 'ing-minyak', takaran: 50, susutPersen: 0 },
      ],
      biayaLain: [{ id: 'rc-3', nama: 'Bumbu & Kemasan', nominal: 2350, mode: 'porsi' }],
      hppPerPorsi: 0,
      hasMissingPrice: false,
      updatedAt: now.toISOString(),
    },
    {
      id: 'rec-rotibakar',
      nama: 'Roti Bakar',
      jumlahPorsiHasil: 1,
      isSubRecipe: false,
      items: [{ id: 'ri-10', type: 'ingredient', refId: 'ing-roti', takaran: 1, susutPersen: 0 }],
      biayaLain: [{ id: 'rc-4', nama: 'Kemasan Box', nominal: 2000, mode: 'porsi' }],
      hppPerPorsi: 0,
      hasMissingPrice: false,
      updatedAt: now.toISOString(),
    },
    {
      id: 'rec-esteh',
      nama: 'Es Teh',
      jumlahPorsiHasil: 1,
      isSubRecipe: false,
      items: [{ id: 'ri-11', type: 'ingredient', refId: 'ing-teh', takaran: 30, susutPersen: 0 }],
      biayaLain: [{ id: 'rc-5', nama: 'Es & Gelas Cup', nominal: 1100, mode: 'porsi' }],
      hppPerPorsi: 0,
      hasMissingPrice: false,
      updatedAt: now.toISOString(),
    },
    {
      id: 'rec-kopisusu',
      nama: 'Kopi Susu',
      jumlahPorsiHasil: 1,
      isSubRecipe: false,
      items: [{ id: 'ri-12', type: 'ingredient', refId: 'ing-kopi', takaran: 150, susutPersen: 0 }],
      biayaLain: [{ id: 'rc-6', nama: 'Es & Gelas Cup', nominal: 1500, mode: 'porsi' }],
      hppPerPorsi: 0,
      hasMissingPrice: false,
      updatedAt: now.toISOString(),
    },
  ];

  const ingMap = new Map(ingredients.map((i) => [i.id, i]));
  const recMap = new Map(recipes.map((r) => [r.id, r]));
  for (const r of recipes) {
    const res = calcRecipeHpp(r, ingMap, recMap);
    r.hppPerPorsi = Math.round(res.hppPerPorsi);
    r.hasMissingPrice = res.hasMissingPrice;
  }

  // 7. Menus (sesuai Mockup Menu_dan_Harga_Jual.html)
  const menus: MenuItem[] = [
    { id: 'mnu-nasgor', recipeId: 'rec-nasgor', nama: 'Nasi Goreng Ayam Telur', kategori: 'Makanan', hargaJual: 18000, targetMarginPersen: 40, active: true, updatedAt: now.toISOString() },
    { id: 'mnu-miegor', recipeId: 'rec-miegor', nama: 'Mie Goreng Telur', kategori: 'Makanan', hargaJual: 16000, targetMarginPersen: 40, active: true, updatedAt: now.toISOString() },
    { id: 'mnu-telurdadar', recipeId: 'rec-telurdadar', nama: 'Telur Dadar', kategori: 'Makanan', hargaJual: 8000, targetMarginPersen: 30, active: true, updatedAt: now.toISOString() },
    { id: 'mnu-rotibakar', recipeId: 'rec-rotibakar', nama: 'Roti Bakar', kategori: 'Makanan', hargaJual: 12000, targetMarginPersen: 35, active: true, updatedAt: now.toISOString() },
    { id: 'mnu-esteh', recipeId: 'rec-esteh', nama: 'Es Teh', kategori: 'Minuman', hargaJual: 5000, targetMarginPersen: 50, active: true, updatedAt: now.toISOString() },
    { id: 'mnu-kopisusu', recipeId: 'rec-kopisusu', nama: 'Kopi Susu', kategori: 'Minuman', hargaJual: 15000, targetMarginPersen: 45, active: true, updatedAt: now.toISOString() },
  ];

  const menuHppHistory: MenuHppHistory[] = menus.map((m) => {
    const rec = recMap.get(m.recipeId);
    return {
      id: `hpp-init-${m.id}`,
      menuId: m.id,
      hpp: rec?.hppPerPorsi ?? 0,
      berlakuSejak: isoDaysAgo(15, 0, 0),
    };
  });

  // 8. Expenses (dari pembelian + manual biaya tetap)
  const purchaseExpenses: Expense[] = purchases.map((p) => ({
    id: `exp-pur-${p.id}`,
    tanggal: p.tanggal,
    categoryId: 'cat-bahan',
    categoryNama: 'Bahan Baku',
    nominal: p.totalHarga,
    keterangan: `Otomatis dari pembelian (${p.jumlahBeli} ${p.satuanBeli})`,
    biayaTetap: false,
    sumber: 'pembelian',
    purchaseId: p.id,
    pembuatId: p.pembuatId,
    pembuatNama: p.pembuatNama,
    createdAt: p.createdAt,
    syncStatus: 'synced',
  }));

  const manualExpenses: Expense[] = [
    {
      id: 'exp-sewa-1',
      tanggal: `${currentMonth}-01`,
      categoryId: 'cat-sewa',
      categoryNama: 'Sewa',
      nominal: 1176000,
      keterangan: 'Sewa kios bulanan',
      biayaTetap: true,
      sumber: 'manual',
      pembuatId: 'usr-owner-1',
      pembuatNama: 'Andi',
      createdAt: isoDaysAgo(10, 9, 0),
      syncStatus: 'synced',
    },
    {
      id: 'exp-gas-1',
      tanggal: `${currentMonth}-05`,
      categoryId: 'cat-gas',
      categoryNama: 'Gas/Listrik',
      nominal: 588000,
      keterangan: 'PLN dan tabung gas',
      biayaTetap: true,
      sumber: 'manual',
      pembuatId: 'usr-owner-1',
      pembuatNama: 'Andi',
      createdAt: isoDaysAgo(6, 10, 0),
      syncStatus: 'synced',
    },
    {
      id: 'exp-lain-1',
      tanggal: daysAgo(3),
      categoryId: 'cat-lain',
      categoryNama: 'Lain-lain',
      nominal: 336000,
      keterangan: 'Lap kasir, tisu, dan plastik',
      biayaTetap: false,
      sumber: 'manual',
      pembuatId: 'usr-kasir-1',
      pembuatNama: 'Dina',
      createdAt: isoDaysAgo(3, 14, 20),
      syncStatus: 'synced',
    },
  ];

  // 9. Sample Transactions (termasuk hari ini & beberapa hari terakhir untuk grafik + BEP)
  const hppOf = (recipeId: string) => recMap.get(recipeId)?.hppPerPorsi ?? 0;

  const transactions: Transaction[] = [
    {
      id: 'tx-0142',
      nomorStruk: '#0142',
      waktu: isoDaysAgo(0, 10, 15),
      kasirId: 'usr-kasir-1',
      kasirNama: 'Dina',
      metodeBayar: 'QRIS',
      subtotal: 41000,
      diskonNominal: 0,
      total: 41000,
      uangDiterima: 41000,
      kembalian: 0,
      status: 'selesai',
      items: [
        { id: 'txi-1', menuId: 'mnu-nasgor', menuNama: 'Nasi Goreng Ayam Telur', jumlah: 2, hargaJual: 18000, snapshotHpp: hppOf('rec-nasgor') },
        { id: 'txi-2', menuId: 'mnu-esteh', menuNama: 'Es Teh', jumlah: 1, hargaJual: 5000, snapshotHpp: hppOf('rec-esteh') },
      ],
      syncStatus: 'synced',
    },
    {
      id: 'tx-0141',
      nomorStruk: '#0141',
      waktu: isoDaysAgo(0, 10, 2),
      kasirId: 'usr-kasir-1',
      kasirNama: 'Dina',
      metodeBayar: 'Cash',
      subtotal: 16000,
      diskonNominal: 0,
      total: 16000,
      uangDiterima: 20000,
      kembalian: 4000,
      status: 'void',
      alasanVoid: 'Salah input menu',
      voidBy: 'Andi',
      voidAt: isoDaysAgo(0, 10, 5),
      items: [
        { id: 'txi-3', menuId: 'mnu-miegor', menuNama: 'Mie Goreng Telur', jumlah: 1, hargaJual: 16000, snapshotHpp: hppOf('rec-miegor') },
      ],
      syncStatus: 'synced',
    },
    {
      id: 'tx-0140',
      nomorStruk: '#0140',
      waktu: isoDaysAgo(0, 9, 48),
      kasirId: 'usr-kasir-1',
      kasirNama: 'Dina',
      metodeBayar: 'Cash',
      subtotal: 30000,
      diskonNominal: 3000,
      diskonLabel: 'Diskon 10%',
      total: 27000,
      uangDiterima: 30000,
      kembalian: 3000,
      status: 'selesai',
      items: [
        { id: 'txi-4', menuId: 'mnu-kopisusu', menuNama: 'Kopi Susu', jumlah: 2, hargaJual: 15000, snapshotHpp: hppOf('rec-kopisusu') },
      ],
      syncStatus: 'synced',
    },
  ];

  // Tambahkan transaksi 6 hari ke belakang agar laporan & prediksi 7 hari terisi realistis
  const historicalSpecs: Array<{
    dayOffset: number;
    num: string;
    method: 'Cash' | 'QRIS' | 'Transfer';
    items: Array<{ menuId: string; nama: string; qty: number; price: number; recId: string }>;
  }> = [
    {
      dayOffset: 1,
      num: '#0139',
      method: 'Cash',
      items: [
        { menuId: 'mnu-nasgor', nama: 'Nasi Goreng Ayam Telur', qty: 18, price: 18000, recId: 'rec-nasgor' },
        { menuId: 'mnu-miegor', nama: 'Mie Goreng Telur', qty: 15, price: 16000, recId: 'rec-miegor' },
        { menuId: 'mnu-esteh', nama: 'Es Teh', qty: 20, price: 5000, recId: 'rec-esteh' },
      ],
    },
    {
      dayOffset: 2,
      num: '#0138',
      method: 'QRIS',
      items: [
        { menuId: 'mnu-nasgor', nama: 'Nasi Goreng Ayam Telur', qty: 22, price: 18000, recId: 'rec-nasgor' },
        { menuId: 'mnu-kopisusu', nama: 'Kopi Susu', qty: 14, price: 15000, recId: 'rec-kopisusu' },
      ],
    },
    {
      dayOffset: 3,
      num: '#0137',
      method: 'Cash',
      items: [
        { menuId: 'mnu-miegor', nama: 'Mie Goreng Telur', qty: 20, price: 16000, recId: 'rec-miegor' },
        { menuId: 'mnu-nasgor', nama: 'Nasi Goreng Ayam Telur', qty: 16, price: 18000, recId: 'rec-nasgor' },
        { menuId: 'mnu-esteh', nama: 'Es Teh', qty: 18, price: 5000, recId: 'rec-esteh' },
      ],
    },
    {
      dayOffset: 4,
      num: '#0136',
      method: 'Transfer',
      items: [
        { menuId: 'mnu-nasgor', nama: 'Nasi Goreng Ayam Telur', qty: 20, price: 18000, recId: 'rec-nasgor' },
        { menuId: 'mnu-kopisusu', nama: 'Kopi Susu', qty: 10, price: 15000, recId: 'rec-kopisusu' },
      ],
    },
    {
      dayOffset: 5,
      num: '#0135',
      method: 'Cash',
      items: [
        { menuId: 'mnu-miegor', nama: 'Mie Goreng Telur', qty: 18, price: 16000, recId: 'rec-miegor' },
        { menuId: 'mnu-telurdadar', nama: 'Telur Dadar', qty: 10, price: 8000, recId: 'rec-telurdadar' },
        { menuId: 'mnu-esteh', nama: 'Es Teh', qty: 16, price: 5000, recId: 'rec-esteh' },
      ],
    },
    {
      dayOffset: 6,
      num: '#0134',
      method: 'QRIS',
      items: [
        { menuId: 'mnu-nasgor', nama: 'Nasi Goreng Ayam Telur', qty: 19, price: 18000, recId: 'rec-nasgor' },
        { menuId: 'mnu-miegor', nama: 'Mie Goreng Telur', qty: 14, price: 16000, recId: 'rec-miegor' },
        { menuId: 'mnu-kopisusu', nama: 'Kopi Susu', qty: 12, price: 15000, recId: 'rec-kopisusu' },
      ],
    },
  ];

  for (const spec of historicalSpecs) {
    const subtotal = spec.items.reduce((s, it) => s + it.qty * it.price, 0);
    transactions.push({
      id: `tx-hist-${spec.dayOffset}`,
      nomorStruk: spec.num,
      waktu: isoDaysAgo(spec.dayOffset, 15, 30),
      kasirId: 'usr-kasir-1',
      kasirNama: 'Dina',
      metodeBayar: spec.method,
      subtotal,
      diskonNominal: 0,
      total: subtotal,
      uangDiterima: subtotal,
      kembalian: 0,
      status: 'selesai',
      items: spec.items.map((it, idx) => ({
        id: `txi-h-${spec.dayOffset}-${idx}`,
        menuId: it.menuId,
        menuNama: it.nama,
        jumlah: it.qty,
        hargaJual: it.price,
        snapshotHpp: hppOf(it.recId),
      })),
      syncStatus: 'synced',
    });
  }

  // 10. Monthly Target
  const target: MonthlyTarget = {
    bulan: currentMonth,
    targetOmzet: 20000000,
    targetLaba: 6000000,
  };

  await db.transaction(
    'rw',
    [
      db.settings,
      db.users,
      db.expenseCategories,
      db.ingredients,
      db.purchases,
      db.recipes,
      db.menus,
      db.menuHppHistory,
      db.expenses,
      db.transactions,
      db.monthlyTargets,
    ],
    async () => {
      await db.settings.put(settings);
      await db.users.bulkPut(users);
      await db.expenseCategories.bulkPut(categories);
      await db.ingredients.bulkPut(ingredients);
      await db.purchases.bulkPut(purchases);
      await db.recipes.bulkPut(recipes);
      await db.menus.bulkPut(menus);
      await db.menuHppHistory.bulkPut(menuHppHistory);
      await db.expenses.bulkPut([...purchaseExpenses, ...manualExpenses]);
      await db.transactions.bulkPut(transactions);
      await db.monthlyTargets.put(target);
    }
  );
}

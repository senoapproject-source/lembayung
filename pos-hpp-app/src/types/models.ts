// Entitas Utama sesuai FRD v1.0 Bab 5

export type UserRole = 'owner' | 'manager' | 'kasir';

export interface User {
  id: string;
  nama: string;
  username: string; // username unik (dipisah dari email untuk Owner)
  email?: string; // alamat email terpisah (wajib & terverifikasi untuk Owner)
  noHp?: string; // nomor WhatsApp / HP karyawan
  emailVerified?: boolean;
  passwordHash: string; // SHA-256 hash
  pin?: string; // PIN 4-6 digit opsional untuk ganti shift/login cepat
  role: UserRole;
  canDiscount: boolean; // Izin tambahan Kasir (a)
  canRecordExpense: boolean; // Izin tambahan Kasir (b) - pembelian bahan & pengeluaran
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BaseUnit = 'gram' | 'ml' | 'qty';

export interface Ingredient {
  id: string;
  nama: string;
  satuanDasar: BaseUnit;
  labelSatuanDasar: string; // misal: 'gram', 'ml', 'butir', 'pcs'
  hargaAktif: number; // harga per satuan dasar
  active: boolean;
  updatedAt: string;
}

export interface Purchase {
  id: string;
  ingredientId: string;
  tanggal: string; // YYYY-MM-DD
  jumlahBeli: number;
  satuanBeli: string; // misal: 'kg', 'liter', 'pack', 'ikat'
  totalHarga: number;
  satuanDasarDidapat: number; // konversi dinamis per pembelian (FR-BHN-03)
  hargaPerSatuanDasar: number; // totalHarga / satuanDasarDidapat
  penjual?: string;
  pembuatId: string;
  pembuatNama: string;
  dibatalkan?: boolean;
  createdAt: string;
}

export type RecipeItemType = 'ingredient' | 'sub_recipe';

export interface RecipeItem {
  id: string;
  type: RecipeItemType;
  refId: string; // ingredientId atau recipeId
  takaran: number; // dalam satuan dasar
  susutPersen: number; // 0 sampai < 100
}

export interface RecipeOtherCost {
  id: string;
  nama: string; // misal: 'Kemasan', 'Gas', 'Tenaga kerja'
  nominal: number;
  mode: 'batch' | 'porsi';
}

export interface Recipe {
  id: string;
  nama: string;
  jumlahPorsiHasil: number;
  isSubRecipe: boolean; // bahan setengah jadi (FR-HPP-04)
  satuanSubRecipe?: BaseUnit; // jika dipakai sebagai sub-resep
  labelSatuanSubRecipe?: string;
  items: RecipeItem[];
  biayaLain: RecipeOtherCost[];
  hppPerPorsi: number; // hasil kalkulasi otomatis
  hasMissingPrice: boolean; // FR-HPP-06
  updatedAt: string;
}

export interface MenuItem {
  id: string;
  recipeId: string; // kosong ('') jika menu tanpa resep
  hppManual?: number; // opsional: HPP manual (Rp) jika tanpa resep
  nama: string;
  kategori: string;
  foto?: string;
  hargaJual: number;
  targetMarginPersen?: number; // opsional, fallback ke global default
  active: boolean;
  updatedAt: string;
}

export interface MenuHppHistory {
  id: string;
  menuId: string;
  hpp: number;
  berlakuSejak: string; // ISO timestamp
}

export type PaymentMethod = 'Cash' | 'QRIS' | 'Transfer';
export type TransactionStatus = 'selesai' | 'void';

export interface TransactionItem {
  id: string;
  menuId: string;
  menuNama: string;
  jumlah: number;
  hargaJual: number;
  snapshotHpp: number; // FR-POS-05: snapshot saat transaksi
  catatan?: string;
  participantName?: string; // Nama pemesan pada Pesan Bareng / Split Bill
  participantWa?: string; // No. WA pemesan untuk kirim struk terpisah
}

export interface Transaction {
  id: string; // UUID unik dari perangkat (offline-first)
  nomorStruk: string; // misal: #0143
  waktu: string; // ISO timestamp
  kasirId: string;
  kasirNama: string;
  namaPelanggan?: string; // Nama pelanggan / Nomor meja (opsional)
  noWaPelanggan?: string; // Nomor WA pelanggan untuk kirim struk (opsional)
  metodeBayar: PaymentMethod;
  subtotal: number;
  diskonNominal: number;
  diskonLabel?: string; // misal: "Diskon 10%" atau "Diskon Rp5.000"
  total: number;
  uangDiterima: number;
  kembalian: number;
  status: TransactionStatus;
  alasanVoid?: string;
  voidBy?: string;
  voidAt?: string;
  items: TransactionItem[];
  syncStatus: 'pending' | 'synced';
}

export interface SavedOrderItem {
  id: string;
  menuId: string;
  menuNama: string;
  hargaJual: number;
  jumlah: number;
  catatan?: string;
  participantName?: string;
  participantWa?: string;
}

export interface SavedOrder {
  id: string;
  labelMejaPelanggan: string; // misal: "Meja 3 - Budi" atau "Takeaway - Rina"
  noWaPelanggan?: string;
  waktuSimpan: string; // ISO timestamp
  kasirId: string;
  kasirNama: string;
  items: SavedOrderItem[];
}

export interface ExpenseCategory {
  id: string;
  nama: string;
  sudahMasukHpp: boolean; // Aturan anti hitung ganda (Bab 4)
  isSystem?: boolean; // Bahan Baku selalu true & tidak bisa dihapus
}

export interface Expense {
  id: string;
  tanggal: string; // YYYY-MM-DD
  categoryId: string;
  categoryNama: string;
  nominal: number;
  keterangan: string;
  lampiranFoto?: string; // base64 / data URL
  biayaTetap: boolean; // hanya untuk kategori !sudahMasukHpp
  sumber: 'manual' | 'pembelian';
  purchaseId?: string;
  pembuatId: string;
  pembuatNama: string;
  dibatalkan?: boolean;
  createdAt: string;
  syncStatus: 'pending' | 'synced';
}

export interface MonthlyTarget {
  bulan: string; // YYYY-MM
  targetOmzet: number;
  targetLaba: number;
}

export interface CashierShift {
  id: string;
  kasirId: string;
  kasirNama: string;
  waktuBuka: string; // ISO timestamp
  waktuTutup?: string; // ISO timestamp saat ditutup
  status: 'open' | 'closed';
  modalAwal: number; // uang fisik di laci saat buka kasir
  pendapatanCash: number; // total penjualan Cash selama shift
  pendapatanQris: number; // total penjualan QRIS selama shift
  pendapatanTransfer: number; // total penjualan Transfer selama shift
  pengeluaranKasir: number; // total pengeluaran manual oleh kasir selama shift
  expectedCash: number; // modalAwal + pendapatanCash - pengeluaranKasir
  uangFisikAkhir?: number; // uang fisik yang dihitung kasir saat tutup kasir
  selisih?: number; // uangFisikAkhir - expectedCash
  catatan?: string;
}

export type PriceMethod = 'last' | 'weighted_avg';
export type RoundingStep = 500 | 1000;

export interface WorkShiftSchedule {
  id: string;
  nama: string; // misal: 'Shift 1 Pagi', 'Middle', 'Shift 2 Sore', 'Shift 3 Malam'
  jamMasuk: string; // HH:mm, misal '08:00'
  jamPulang: string; // HH:mm, misal '17:00'
  durasiJam: number; // misal: 9
  toleransiTelatMenit: number; // default: 10
}

export type AttendanceStatus = 'hadir' | 'telat' | 'lupa_pulang' | 'dikoreksi';

export interface AttendanceRecord {
  id: string;
  userId: string;
  userNama: string;
  userRole: UserRole;
  tanggal: string; // YYYY-MM-DD (tanggal lokal perangkat saat absen masuk)
  shiftId: string;
  shiftNama: string;
  scheduledStart: string; // HH:mm
  scheduledEnd: string; // HH:mm
  clockInAt: string; // ISO timestamp waktu perangkat
  clockOutAt?: string; // ISO timestamp waktu perangkat
  photoIn?: string; // compressed JPEG data URL (~25-35 KB)
  photoOut?: string; // compressed JPEG data URL (~25-35 KB)
  lateMinutes: number; // menit keterlambatan setelah toleransi
  workMinutes?: number; // durasi kerja total dalam menit
  status: AttendanceStatus;
  correctedBy?: string;
  correctedAt?: string;
  correctionNote?: string;
  syncStatus: 'pending' | 'synced';
  updatedAt: string;
}

export interface AppSettings {
  id: 'global';
  namaUsaha: string;
  alamatUsaha: string;
  teleponUsaha: string;
  logoUsaha?: string; // base64 data URL untuk struk digital (FR-SET-01)
  strukHeader?: string; // Catatan atas struk / tagline
  strukFooter?: string; // Pesan bawah struk (contoh: "Terima kasih, selamat menikmati!")
  strukTampilkanKasir?: boolean;
  strukTampilkanCatatanItem?: boolean;
  strukTampilkanWaUsaha?: boolean;
  strukBaseUrl?: string; // URL dasar web untuk link struk online (opsional)
  defaultMarginPersen: number; // default 40
  metodeHargaBahan: PriceMethod; // default 'weighted_avg'
  jumlahPembelianN: number; // default 5
  pembulatanHarga: RoundingStep; // 500 atau 1000
  ambangMepetBepPersen: number; // default 10
  defaultKasirDiscount: boolean; // default false
  defaultKasirRecordExpense: boolean; // default true
  lastBackupAt: string;
  cloudSyncMode: 'local_only' | 'supabase' | 'firebase';
  cloudEndpoint?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  outletId?: string;
  ownerEmail?: string; // Email utama Owner pemilik grup bisnis (multi-cabang)
  parentOutletId?: string; // ID outlet pusat jika merupakan cabang baru
  namaCabang?: string; // Nama cabang, misal: "Pusat", "Cabang Sudirman"
  workShifts?: WorkShiftSchedule[]; // Master jadwal shift kerja (Pagi, Middle, Sore, Malam)
  kasirAuthPin?: string; // PIN Otorisasi 6 angka khusus masuk Mode Kasir & hapus Open Bill
  autoStoreHoursEnabled?: boolean; // Aktifkan jam buka & tutup toko otomatis
  storeOpenTime?: string; // Jam buka otomatis (HH:mm), default '08:00'
  storeCloseTime?: string; // Jam tutup otomatis (HH:mm), default '22:00'
  storeManualOverride?: 'auto' | 'force_open' | 'force_closed'; // Override manual 1-klik oleh Owner
}

export interface BranchInfo {
  outletId: string;
  namaUsaha: string;
  namaCabang: string;
  alamatUsaha: string;
  teleponUsaha: string;
  ownerEmail?: string;
  parentOutletId?: string;
  logoUsaha?: string;
  kasirAuthPin?: string;
  isStoreOpen?: boolean;
  activeCashierName?: string;
  shiftOpenedAt?: string;
  storeHoursLabel?: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userNama: string;
  waktu: string;
  aksi: string;
  objek: string;
  detail: string;
}

export interface SyncQueueItem {
  id: string;
  entity: 'transaction' | 'purchase' | 'expense' | 'master' | 'attendance';
  entityId: string;
  action: 'upsert' | 'void' | 'delete';
  payload: unknown;
  createdAt: string;
  retries: number;
}

-- ============================================================================
-- SKEMA DATABASE RELASIONAL (12 TABEL) SUPABASE UNTUK CUANIN (POS & HPP)
-- Sesuai FRD v1.0 Bab 5 (Multi-Merchant / Multi-Outlet)
--
-- Cara pakai:
-- 1. Buka dashboard Supabase project Anda -> menu "SQL Editor" -> "New query"
-- 2. Copy-paste seluruh isi file ini lalu klik tombol "Run"
-- ============================================================================

-- 1. TABEL OUTLETS (PENGATURAN & PROFIL USAHA PER MERCHANT / MULTI-CABANG)
CREATE TABLE IF NOT EXISTS public.outlets (
  outlet_id TEXT PRIMARY KEY,
  nama_usaha TEXT NOT NULL,
  nama_cabang TEXT DEFAULT 'Pusat',
  owner_email TEXT,
  parent_outlet_id TEXT,
  logo_usaha TEXT,
  alamat_usaha TEXT NOT NULL DEFAULT '-',
  telepon_usaha TEXT NOT NULL DEFAULT '',
  struk_header TEXT,
  struk_footer TEXT,
  struk_base_url TEXT,
  struk_tampilkan_kasir BOOLEAN NOT NULL DEFAULT true,
  struk_tampilkan_catatan_item BOOLEAN NOT NULL DEFAULT true,
  struk_tampilkan_wa_usaha BOOLEAN NOT NULL DEFAULT true,
  default_margin_persen NUMERIC NOT NULL DEFAULT 40,
  metode_harga_bahan TEXT NOT NULL DEFAULT 'weighted_avg',
  jumlah_pembelian_n INTEGER NOT NULL DEFAULT 5,
  pembulatan_harga INTEGER NOT NULL DEFAULT 500,
  ambang_mepet_bep_persen NUMERIC NOT NULL DEFAULT 10,
  default_kasir_discount BOOLEAN NOT NULL DEFAULT false,
  default_kasir_record_expense BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade otomatis kolom multi-cabang & logo struk web jika tabel outlets sudah ada sebelumnya
ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS nama_cabang TEXT DEFAULT 'Pusat';
ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS parent_outlet_id TEXT;
ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS logo_usaha TEXT;

-- 2. TABEL USERS (PENGGUNA: OWNER & KASIR)
CREATE TABLE IF NOT EXISTS public.users (
  outlet_id TEXT NOT NULL,
  id TEXT NOT NULL,
  nama TEXT NOT NULL,
  username TEXT NOT NULL,
  email TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  password_hash TEXT NOT NULL,
  pin TEXT,
  role TEXT NOT NULL,
  can_discount BOOLEAN NOT NULL DEFAULT false,
  can_record_expense BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, id)
);

-- Upgrade otomatis jika tabel users sudah ada sebelumnya
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

-- 2B. TABEL EMAIL_VERIFICATIONS (OTP VERIFIKASI EMAIL & RESET PASSWORD OWNER)
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  purpose TEXT NOT NULL, -- 'register' | 'reset_password'
  code_hash TEXT NOT NULL,
  outlet_id TEXT,
  user_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_lookup
  ON public.email_verifications (email, purpose, used, created_at DESC);
ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.email_verifications TO service_role;

-- 3. TABEL EXPENSE_CATEGORIES (KATEGORI PENGELUARAN & ANTI HITUNG GANDA)
CREATE TABLE IF NOT EXISTS public.expense_categories (
  outlet_id TEXT NOT NULL,
  id TEXT NOT NULL,
  nama TEXT NOT NULL,
  sudah_masuk_hpp BOOLEAN NOT NULL DEFAULT false,
  is_system BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, id)
);

-- 4. TABEL INGREDIENTS (BAHAN BAKU)
CREATE TABLE IF NOT EXISTS public.ingredients (
  outlet_id TEXT NOT NULL,
  id TEXT NOT NULL,
  nama TEXT NOT NULL,
  satuan_dasar TEXT NOT NULL,
  label_satuan_dasar TEXT NOT NULL,
  harga_aktif NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, id)
);

-- 5. TABEL PURCHASES (PEMBELIAN BAHAN BAKU)
CREATE TABLE IF NOT EXISTS public.purchases (
  outlet_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  tanggal TEXT NOT NULL,
  jumlah_beli NUMERIC NOT NULL,
  satuan_beli TEXT NOT NULL,
  total_harga NUMERIC NOT NULL,
  satuan_dasar_didapat NUMERIC NOT NULL,
  harga_per_satuan_dasar NUMERIC NOT NULL,
  penjual TEXT,
  pembuat_id TEXT NOT NULL,
  pembuat_nama TEXT NOT NULL,
  dibatalkan BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, id)
);

-- 6. TABEL RECIPES (RESEP & KALKULATOR HPP)
CREATE TABLE IF NOT EXISTS public.recipes (
  outlet_id TEXT NOT NULL,
  id TEXT NOT NULL,
  nama TEXT NOT NULL,
  jumlah_porsi_hasil NUMERIC NOT NULL DEFAULT 1,
  is_sub_recipe BOOLEAN NOT NULL DEFAULT false,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  biaya_lain JSONB NOT NULL DEFAULT '[]'::jsonb,
  hpp_per_porsi NUMERIC NOT NULL DEFAULT 0,
  has_missing_price BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, id)
);

-- 7. TABEL MENUS (MENU & HARGA JUAL)
CREATE TABLE IF NOT EXISTS public.menus (
  outlet_id TEXT NOT NULL,
  id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  nama TEXT NOT NULL,
  kategori TEXT NOT NULL,
  foto TEXT,
  harga_jual NUMERIC NOT NULL DEFAULT 0,
  target_margin_persen NUMERIC,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, id)
);

-- 8. TABEL MENU_HPP_HISTORY (RIWAYAT HPP MENU)
CREATE TABLE IF NOT EXISTS public.menu_hpp_history (
  outlet_id TEXT NOT NULL,
  id TEXT NOT NULL,
  menu_id TEXT NOT NULL,
  hpp NUMERIC NOT NULL DEFAULT 0,
  berlaku_sejak TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, id)
);

-- 9. TABEL TRANSACTIONS (TRANSAKSI KASIR / POS)
CREATE TABLE IF NOT EXISTS public.transactions (
  outlet_id TEXT NOT NULL,
  id TEXT NOT NULL,
  nomor_struk TEXT NOT NULL,
  waktu TIMESTAMPTZ NOT NULL,
  kasir_id TEXT NOT NULL,
  kasir_nama TEXT NOT NULL,
  nama_pelanggan TEXT,
  no_wa_pelanggan TEXT,
  metode_bayar TEXT NOT NULL,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  diskon_nominal NUMERIC NOT NULL DEFAULT 0,
  diskon_label TEXT,
  total NUMERIC NOT NULL DEFAULT 0,
  uang_diterima NUMERIC NOT NULL DEFAULT 0,
  kembalian NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'selesai',
  alasan_void TEXT,
  void_by TEXT,
  void_at TIMESTAMPTZ,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, id)
);

-- 10. TABEL SAVED_ORDERS (ORDERAN TERSIMPAN / OPEN BILL)
CREATE TABLE IF NOT EXISTS public.saved_orders (
  outlet_id TEXT NOT NULL,
  id TEXT NOT NULL,
  label_meja_pelanggan TEXT NOT NULL,
  no_wa_pelanggan TEXT,
  waktu_simpan TIMESTAMPTZ NOT NULL,
  kasir_id TEXT NOT NULL,
  kasir_nama TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (outlet_id, id)
);

-- 11. TABEL EXPENSES (PENGELUARAN MANUAL & OTOMATIS DARI PEMBELIAN)
CREATE TABLE IF NOT EXISTS public.expenses (
  outlet_id TEXT NOT NULL,
  id TEXT NOT NULL,
  tanggal TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_nama TEXT NOT NULL,
  nominal NUMERIC NOT NULL DEFAULT 0,
  keterangan TEXT NOT NULL,
  lampiran_foto TEXT,
  biaya_tetap BOOLEAN NOT NULL DEFAULT false,
  sumber TEXT NOT NULL DEFAULT 'manual',
  purchase_id TEXT,
  pembuat_id TEXT NOT NULL,
  pembuat_nama TEXT NOT NULL,
  dibatalkan BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, id)
);

-- 12. TABEL MONTHLY_TARGETS (TARGET OMZET & LABA BULANAN)
CREATE TABLE IF NOT EXISTS public.monthly_targets (
  outlet_id TEXT NOT NULL,
  bulan TEXT NOT NULL,
  target_omzet NUMERIC NOT NULL DEFAULT 0,
  target_laba NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, bulan)
);

-- 12B. TABEL CASHIER_SHIFTS (BUKA & TUTUP KASIR / REKONSILIASI LACI KAS)
CREATE TABLE IF NOT EXISTS public.cashier_shifts (
  outlet_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kasir_id TEXT NOT NULL,
  kasir_nama TEXT NOT NULL,
  waktu_buka TIMESTAMPTZ NOT NULL,
  waktu_tutup TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open',
  modal_awal NUMERIC NOT NULL DEFAULT 0,
  pendapatan_cash NUMERIC NOT NULL DEFAULT 0,
  pendapatan_qris NUMERIC NOT NULL DEFAULT 0,
  pendapatan_transfer NUMERIC NOT NULL DEFAULT 0,
  pengeluaran_kasir NUMERIC NOT NULL DEFAULT 0,
  expected_cash NUMERIC NOT NULL DEFAULT 0,
  uang_fisik_akhir NUMERIC,
  selisih NUMERIC,
  catatan TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, id)
);

-- 12C. TABEL DEVICE_PUSH_TOKENS (TOKEN FCM ANDROID UNTUK NOTIFIKASI SAAT APP DITUTUP)
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  outlet_id TEXT NOT NULL,
  token TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  platform TEXT NOT NULL DEFAULT 'android',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, token)
);
CREATE INDEX IF NOT EXISTS idx_device_push_tokens_outlet
  ON public.device_push_tokens (outlet_id, role);

-- 13. TABEL APP_VERSIONS (MANAJEMEN UPDATE APK & OTA LIVE BUNDLE KE SEMUA PERANGKAT)
CREATE TABLE IF NOT EXISTS public.app_versions (
  id TEXT PRIMARY KEY DEFAULT 'android',
  latest_version TEXT NOT NULL DEFAULT '1.0.0',
  min_required_version TEXT NOT NULL DEFAULT '1.0.0',
  download_url TEXT NOT NULL DEFAULT '',
  bundle_zip_url TEXT,
  release_notes TEXT NOT NULL DEFAULT 'Rilis perdana Cuanin POS & Kalkulator HPP v1.0.0',
  force_update BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pastikan kolom bundle_zip_url ada jika tabel sudah dibuat sebelumnya
ALTER TABLE public.app_versions ADD COLUMN IF NOT EXISTS bundle_zip_url TEXT;

-- Masukkan baris awal jika belum ada
INSERT INTO public.app_versions (id, latest_version, min_required_version, download_url, release_notes, force_update)
VALUES (
  'android',
  '1.0.0',
  '1.0.0',
  'https://drive.google.com/',
  'Rilis perdana Cuanin POS & Kalkulator HPP v1.0.0',
  false
)
ON CONFLICT (id) DO NOTHING;

-- Aktifkan Realtime pada tabel transactions, expenses, dan purchases
-- agar HP Owner menerima notifikasi otomatis seketika saat Kasir membuat transaksi dari HP/Tab lain
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.purchases;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.menus;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.recipes;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ingredients;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
-- ============================================================================
-- 14. SUPABASE STORAGE BUCKET UNTUK OTA AUTO-UPDATER (cuanin-updates)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('cuanin-updates', 'cuanin-updates', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Allow public read and upload on cuanin-updates" ON storage.objects;
CREATE POLICY "Allow public read and upload on cuanin-updates"
  ON storage.objects
  FOR ALL
  TO anon, authenticated
  USING (bucket_id = 'cuanin-updates')
  WITH CHECK (bucket_id = 'cuanin-updates');

-- ============================================================================
-- 15. SUPABASE STORAGE BUCKET UNTUK LINK STRUK DIGITAL PNG (cuanin-receipts)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('cuanin-receipts', 'cuanin-receipts', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Allow public read and upload on cuanin-receipts" ON storage.objects;
CREATE POLICY "Allow public read and upload on cuanin-receipts"
  ON storage.objects
  FOR ALL
  TO anon, authenticated
  USING (bucket_id = 'cuanin-receipts')
  WITH CHECK (bucket_id = 'cuanin-receipts');

-- ============================================================================
-- 16. ABSENSI KARYAWAN (ATTENDANCES) & MASTER JADWAL SHIFT KERJA
-- ============================================================================
ALTER TABLE public.outlets
  ADD COLUMN IF NOT EXISTS work_shifts JSONB;
ALTER TABLE public.outlets
  ADD COLUMN IF NOT EXISTS kasir_auth_pin TEXT;

CREATE TABLE IF NOT EXISTS public.attendances (
  outlet_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_nama TEXT NOT NULL,
  user_role TEXT NOT NULL DEFAULT 'kasir',
  tanggal TEXT NOT NULL,
  shift_id TEXT NOT NULL,
  shift_nama TEXT NOT NULL,
  scheduled_start TEXT NOT NULL,
  scheduled_end TEXT NOT NULL,
  clock_in_at TEXT NOT NULL,
  clock_out_at TEXT,
  photo_in TEXT,
  photo_out TEXT,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  work_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'hadir',
  corrected_by TEXT,
  corrected_at TEXT,
  correction_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outlet_id, id)
);

CREATE INDEX IF NOT EXISTS idx_attendances_outlet_tanggal
  ON public.attendances (outlet_id, tanggal DESC);

-- ============================================================================
-- PERMISSIONS & ROW LEVEL SECURITY (RLS) UNTUK 14 TABEL
-- ============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'outlets',
    'users',
    'expense_categories',
    'ingredients',
    'purchases',
    'recipes',
    'menus',
    'menu_hpp_history',
    'transactions',
    'saved_orders',
    'expenses',
    'attendances',
    'monthly_targets',
    'cashier_shifts',
    'device_push_tokens',
    'app_versions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow full access on %I" ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY "Allow full access on %I" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);',
      t, t
    );
  END LOOP;
END $$;

/**
 * Script Upload File APK Lembayung ke Supabase Storage
 * - Testing: npm run upload:apk:testing
 * - Production: npm run upload:apk:prod
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT_DIR = process.cwd();
const isProd = process.argv.includes('--prod');
const envFile = path.join(ROOT_DIR, isProd ? '.env.production' : '.env.testing');

let supabaseUrl = '';
let supabaseKey = '';

if (fs.existsSync(envFile)) {
  const raw = fs.readFileSync(envFile, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('VITE_SUPABASE_URL=')) {
      supabaseUrl = line.replace('VITE_SUPABASE_URL=', '').trim();
    }
    if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) {
      supabaseKey = line.replace('VITE_SUPABASE_ANON_KEY=', '').trim();
    }
  }
}

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Konfigurasi Supabase tidak ditemukan di', envFile);
  process.exit(1);
}

// Jika Production -> wajib ambil app-release.apk; Jika Testing -> wajib ambil app-debug.apk
const candidates = isProd
  ? [
      path.join(ROOT_DIR, 'android', 'app', 'release', 'app-release.apk'),
      path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
    ]
  : [
      path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    ];

const apkPath = candidates.find((p) => fs.existsSync(p));
if (!apkPath) {
  console.error(
    isProd
      ? '❌ File app-release.apk tidak ditemukan! Build dulu lewat Android Studio: Build -> Generate Signed App Bundle / APK -> APK -> release'
      : '❌ File app-debug.apk tidak ditemukan! Build dulu lewat Android Studio: Build -> Build Bundle(s) / APK(s) -> Build APK(s)'
  );
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function bumpPatch(ver) {
  const p = String(ver || '1.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  while (p.length < 3) p.push(0);
  p[2] += 1;
  return p.join('.');
}

function bumpMinor(ver) {
  const p = String(ver || '1.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  return `${p[0] ?? 1}.${(p[1] ?? 0) + 1}`;
}

async function main() {
  const { data: currentRow } = await sb
    .from('app_versions')
    .select('*')
    .eq('id', 'android')
    .maybeSingle();

  const positionalArgs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const customVer = positionalArgs[0] || null;
  const customNotes =
    positionalArgs[1] ||
    'Pembaruan aplikasi (APK) tersedia. Silakan download & pasang update secara manual.';

  const prevVer = currentRow?.latest_version || (isProd ? '1.0' : '1.0.0');
  const nextVersion = customVer || (isProd ? bumpMinor(prevVer) : bumpPatch(prevVer));

  const stat = fs.statSync(apkPath);
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
  const apkBuffer = fs.readFileSync(apkPath);
  const fileName = isProd ? `Lembayung-v${nextVersion}.apk` : `Lembayung-testing-v${nextVersion}.apk`;

  console.log(`\n📦 File ditemukan: ${apkPath} (${sizeMb} MB)`);
  console.log(`☁️  Mengunggah ${fileName} ke Supabase Storage (${isProd ? 'PRODUCTION' : 'TESTING'})...`);

  const { error: uploadErr } = await sb.storage
    .from('cuanin-updates')
    .upload(fileName, apkBuffer, {
      contentType: 'application/vnd.android.package-archive',
      upsert: true,
    });

  if (uploadErr) {
    console.error('❌ Gagal mengunggah APK:', uploadErr.message);
    process.exit(1);
  }

  const { data } = sb.storage.from('cuanin-updates').getPublicUrl(fileName);
  const downloadUrl = data.publicUrl;

  // Update app_versions dengan bundle_zip_url = null agar HP/Tab menampilkan notifikasi & tombol "Download Update APK Manual"
  await sb.from('app_versions').upsert(
    {
      id: 'android',
      latest_version: nextVersion,
      min_required_version: currentRow?.min_required_version || '1.0.0',
      download_url: downloadUrl,
      bundle_zip_url: null,
      release_notes: customNotes,
      force_update: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  console.log(`\n✅ BERHASIL! APK Lembayung v${nextVersion} tayang & notifikasi update manual aktif!`);
  console.log(`🔗 LINK DOWNLOAD LANGSUNG:\n${downloadUrl}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

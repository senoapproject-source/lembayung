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
const isInstallerOnly = process.argv.includes('--installer');
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
    'Versi terbaru Lembayung sudah tersedia. Silakan unduh dan pasang pembaruan.';

  const prevVer = currentRow?.latest_version || (isProd ? '1.0' : '1.0.0');
  const nextVersion = customVer || (isProd ? bumpMinor(prevVer) : bumpPatch(prevVer));

  const stat = fs.statSync(apkPath);
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
  const apkBuffer = fs.readFileSync(apkPath);
  const fileName = isProd ? `Lembayung-v${nextVersion}.apk` : `Lembayung-testing-v${nextVersion}.apk`;
  const latestAliasName = isProd ? 'Lembayung-latest.apk' : 'Lembayung-testing-latest.apk';

  console.log(`\n📦 File ditemukan: ${apkPath} (${sizeMb} MB)`);
  console.log(`☁️  Mengunggah ${fileName} & ${latestAliasName} ke Supabase Storage (${isProd ? 'PRODUCTION' : 'TESTING'})...`);

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

  // Simpan juga alias tetap (Lembayung-latest.apk) agar calon merchant baru selalu mendapat versi terbaru
  await sb.storage
    .from('cuanin-updates')
    .upload(latestAliasName, apkBuffer, {
      contentType: 'application/vnd.android.package-archive',
      upsert: true,
    });

  const { data } = sb.storage.from('cuanin-updates').getPublicUrl(fileName);
  const { data: latestAliasData } = sb.storage.from('cuanin-updates').getPublicUrl(latestAliasName);
  const downloadUrl = data.publicUrl;

  if (isInstallerOnly) {
    // Mode --installer: pertahankan bundle_zip_url agar perangkat lama tetap update via OTA (tidak dipaksa download APK manual)
    await sb.from('app_versions').upsert(
      {
        id: 'android',
        latest_version: currentRow?.latest_version || nextVersion,
        min_required_version: currentRow?.min_required_version || '1.0.0',
        download_url: latestAliasData.publicUrl,
        bundle_zip_url: currentRow?.bundle_zip_url || null,
        release_notes: currentRow?.release_notes || customNotes,
        force_update: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
    console.log(`\n✅ BERHASIL! Installer APK Lembayung v${nextVersion} siap untuk merchant baru (perangkat lama tetap pakai OTA)!`);
  } else {
    // Update app_versions dengan bundle_zip_url = null agar HP/Tab menampilkan tombol Download APK Manual
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
  }

  // Auto-cleanup: hapus file APK versi lama di bucket agar storage tetap hemat (sisakan versi aktif + alias latest)
  const { data: listedFiles } = await sb.storage.from('cuanin-updates').list('', { limit: 200 });
  if (Array.isArray(listedFiles)) {
    const oldApks = listedFiles
      .map((f) => String(f.name || ''))
      .filter((name) => name.endsWith('.apk') && name !== fileName && name !== latestAliasName);
    if (oldApks.length > 0) {
      const { error: rmErr } = await sb.storage.from('cuanin-updates').remove(oldApks);
      if (!rmErr) {
        console.log(`🗑️  Menghapus ${oldApks.length} file APK lama (${oldApks.join(', ')})`);
      }
    }
  }

  console.log(`🔗 LINK VERSI INI:\n${downloadUrl}`);
  console.log(`🔗 LINK TETAP MERCHANT BARU:\n${latestAliasData.publicUrl}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

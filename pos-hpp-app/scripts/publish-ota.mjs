/**
 * Script Publikasi OTA Live Update Lembayung ke Supabase Storage
 * Mengikuti standar Semantic Versioning (MAJOR.MINOR.PATCH, selalu 3 digit):
 * - Testing (default bump PATCH, mis. 1.8.0 -> 1.8.1 -> ... -> 1.8.10):
 *     npm run publish:ota
 *     npm run publish:ota -- --minor --notes "Gelombang fitur baru"
 *     npm run publish:ota -- --version 1.8.1 --notes "Perbaikan bug"
 * - Production (default bump MINOR, mis. 1.7.0 -> 1.8.0; pakai --patch untuk hotfix 1.8.1):
 *     npm run publish:ota:prod
 *     npm run publish:ota:prod -- --patch --notes "Hotfix bug"
 *     npm run publish:ota:prod -- --major --notes "Rilis besar v2.0.0"
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import { createClient } from '@supabase/supabase-js';

const ROOT_DIR = process.cwd();
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const isProdMode = process.argv.includes('--prod');
const skipSyncTesting = process.argv.includes('--no-sync-testing');
const forceUpdateFlag = process.argv.includes('--force');
const bumpMajorFlag = process.argv.includes('--major');
const bumpMinorFlag = process.argv.includes('--minor');
const bumpPatchFlag = process.argv.includes('--patch');

function getFlagValue(flagName) {
  const idx = process.argv.indexOf(flagName);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1].trim();
  }
  const prefix = `${flagName}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

const customMinVersion = getFlagValue('--min');
const flagVersion = getFlagValue('--version');
const flagNotes = getFlagValue('--notes');
const positionalArgs = [];
const valueFlags = new Set(['--min', '--version', '--notes']);
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (valueFlags.has(arg)) {
    i += 1; // skip flag value
    continue;
  }
  if (arg.startsWith('--')) continue;
  positionalArgs.push(arg);
}

function readSupabaseConfig(mode) {
  const envFile = path.join(ROOT_DIR, mode === 'production' ? '.env.production' : '.env.testing');
  let supabaseUrl = '';
  let supabaseKey = '';

  if (fs.existsSync(envFile)) {
    const raw = fs.readFileSync(envFile, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith('VITE_SUPABASE_URL=')) {
        const val = line.replace('VITE_SUPABASE_URL=', '').trim();
        if (val && !val.includes('GANTI_PROJECT_PROD_ANDA')) supabaseUrl = val;
      }
      if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) {
        const val = line.replace('VITE_SUPABASE_ANON_KEY=', '').trim();
        if (val && !val.includes('GANTI_DENGAN_PUBLISHABLE')) supabaseKey = val;
      }
    }
  }
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(`Konfigurasi Supabase tidak ditemukan di ${envFile}`);
  }
  return { supabaseUrl, supabaseKey };
}

function createSupabaseForMode(mode) {
  const { supabaseUrl, supabaseKey } = readSupabaseConfig(mode);
  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
}

function compareSemver(a, b) {
  const pa = String(a || '1.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '1.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function normalizeSemver(ver) {
  const parts = String(ver || '1.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const major = parts[0] ?? 1;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return `${major}.${minor}.${patch}`;
}

function bumpPatchVersion(ver) {
  const [major, minor, patch] = normalizeSemver(ver).split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function bumpMinorVersion(ver) {
  const [major, minor] = normalizeSemver(ver).split('.').map(Number);
  return `${major}.${minor + 1}.0`;
}

function bumpMajorVersion(ver) {
  const [major] = normalizeSemver(ver).split('.').map(Number);
  return `${major + 1}.0.0`;
}

/**
 * Hitung min_required_version otomatis (SemVer 3 digit) agar 2 versi terakhir tetap opsional,
 * sedangkan versi di bawah 2 versi terakhir terkena Pembaruan Wajib:
 * - latest 1.8.3 -> min_required 1.8.2 (1.8.3 & 1.8.2 aman, <= 1.8.1 wajib update)
 * - latest 1.8.0 -> min_required 1.7.0 (1.8.0 & 1.7.x aman, <= 1.6.x wajib update)
 * - latest 2.0.0 -> min_required 1.0.0
 */
function computeMinRequiredVersion(version) {
  const [major, minor, patch] = normalizeSemver(version).split('.').map(Number);
  if (patch > 0) return `${major}.${minor}.${patch - 1}`;
  if (minor > 0) return `${major}.${minor - 1}.0`;
  if (major > 1) return `${major - 1}.0.0`;
  return '1.0.0';
}

function readCodeAppVersion(mode) {
  let codeAppVer = mode === 'production' ? '1.0' : '1.0.0';
  const syncPath = path.join(ROOT_DIR, 'src', 'services', 'syncService.ts');
  if (fs.existsSync(syncPath)) {
    const src = fs.readFileSync(syncPath, 'utf8');
    const ternaryMatch = src.match(/APP_VERSION\s*=[\s\S]*?\?\s*['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/);
    if (ternaryMatch) {
      codeAppVer = mode === 'production' ? ternaryMatch[1] : ternaryMatch[2];
    } else {
      const simpleMatch = src.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (simpleMatch) codeAppVer = simpleMatch[1];
    }
  }
  return codeAppVer;
}

async function publishTarget({ mode, version, notes, currentRow }) {
  const sb = createSupabaseForMode(mode);
  const label = mode === 'production' ? 'PRODUCTION' : 'TESTING';

  console.log(`\n🚀 [${label} 1/5] Mem-build bundle web Lembayung v${version} (mode: ${mode})...`);
  execSync(`npm run build:${mode === 'production' ? 'prod' : 'testing'}`, {
    stdio: 'inherit',
    env: { ...process.env, VITE_APP_VERSION: version },
  });

  if (!fs.existsSync(DIST_DIR)) {
    throw new Error('Folder dist/ tidak ditemukan setelah build.');
  }

  console.log(`📦 [${label} 2/5] Membungkus dist/ menjadi cuanin-ota-${version}.zip...`);
  const zip = new AdmZip();
  zip.addLocalFolder(DIST_DIR);
  const zipBuffer = zip.toBuffer();
  const sha256Hex = crypto.createHash('sha256').update(zipBuffer).digest('hex');
  const fileName = `cuanin-ota-${version}.zip`;

  console.log(
    `☁️  [${label} 3/5] Mengunggah ${fileName} (${Math.round(zipBuffer.length / 1024)} KB, SHA256: ${sha256Hex.slice(0, 12)}...) ke Supabase Storage (${label})...`
  );
  const { error: uploadErr } = await sb.storage
    .from('cuanin-updates')
    .upload(fileName, zipBuffer, {
      contentType: 'application/zip',
      upsert: true,
    });

  if (uploadErr) {
    console.error(`\n❌ [${label}] Gagal upload ke Supabase Storage:`, uploadErr.message);
    process.exit(1);
  }

  const { data: pubUrlData } = sb.storage.from('cuanin-updates').getPublicUrl(fileName);
  const bundleZipUrl = `${pubUrlData.publicUrl}?sha256=${sha256Hex}`;

  let existingRow = currentRow;
  if (!existingRow) {
    const { data } = await sb.from('app_versions').select('*').eq('id', 'android').maybeSingle();
    existingRow = data;
  }

  const minRequiredVersion = customMinVersion
    ? normalizeSemver(customMinVersion)
    : computeMinRequiredVersion(version);

  console.log(
    `📝 [${label} 4/5] Memperbarui tabel app_versions (${label}) ke v${version} (min_required: v${minRequiredVersion}${forceUpdateFlag ? ', FORCE ALL' : ''})...`
  );
  const { error: dbErr } = await sb.from('app_versions').upsert(
    {
      id: 'android',
      latest_version: version,
      min_required_version: minRequiredVersion,
      download_url: existingRow?.download_url || bundleZipUrl,
      bundle_zip_url: bundleZipUrl,
      release_notes: notes,
      force_update: forceUpdateFlag,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (dbErr) {
    console.error(`\n❌ [${label}] Gagal memperbarui tabel app_versions:`, dbErr.message);
    process.exit(1);
  }

  console.log(`🧹 [${label} 5/5] Membersihkan file OTA versi lama di bucket "cuanin-updates"...`);
  const { data: listedFiles, error: listErr } = await sb.storage
    .from('cuanin-updates')
    .list('', { limit: 200 });

  if (!listErr && Array.isArray(listedFiles)) {
    const otaFiles = listedFiles
      .filter((f) => /^cuanin-ota-\d+\.\d+(?:\.\d+)?\.zip$/.test(String(f.name || '')))
      .sort((a, b) => {
        if (a.name === fileName) return -1;
        if (b.name === fileName) return 1;
        const ta = Date.parse(a.updated_at || a.created_at || '') || 0;
        const tb = Date.parse(b.updated_at || b.created_at || '') || 0;
        return tb - ta;
      });

    const toDelete = otaFiles
      .slice(2)
      .map((f) => f.name)
      .filter((name) => name !== fileName);
    if (toDelete.length > 0) {
      const { error: rmErr } = await sb.storage.from('cuanin-updates').remove(toDelete);
      if (rmErr) {
        console.warn(`⚠️  [${label}] Gagal menghapus beberapa file OTA lama: ${rmErr.message}`);
      } else {
        console.log(`🗑️  [${label}] Menghapus ${toDelete.length} file OTA lama (${toDelete.join(', ')})`);
      }
    } else {
      console.log(`✨ [${label}] Storage sudah bersih (hanya ${otaFiles.length} file OTA).`);
    }
  }

  console.log(`✅ [${label}] Update OTA Cuanin v${version} sudah tayang!`);
  console.log(`🔗 [${label}] Bundle URL: ${bundleZipUrl}`);
}

async function main() {
  const primaryMode = isProdMode ? 'production' : 'testing';
  const sb = createSupabaseForMode(primaryMode);

  const codeAppVer = readCodeAppVersion(primaryMode);
  const { data: currentRow } = await sb
    .from('app_versions')
    .select('*')
    .eq('id', 'android')
    .maybeSingle();

  const rawCustomVer = flagVersion || positionalArgs[0] || null;
  const customVer = rawCustomVer ? normalizeSemver(rawCustomVer) : null;
  const customNotes =
    flagNotes ||
    positionalArgs[1] ||
    (isProdMode
      ? 'Pembaruan fitur dan peningkatan performa Lembayung.'
      : 'Pembaruan dan perbaikan terbaru Lembayung.');

  const dbVer = normalizeSemver(currentRow?.latest_version || '1.0.0');
  const highestBase = compareSemver(codeAppVer, dbVer) > 0 ? normalizeSemver(codeAppVer) : dbVer;

  let nextVersion = customVer;
  if (!nextVersion) {
    if (bumpMajorFlag) nextVersion = bumpMajorVersion(highestBase);
    else if (bumpMinorFlag) nextVersion = bumpMinorVersion(highestBase);
    else if (bumpPatchFlag) nextVersion = bumpPatchVersion(highestBase);
    else nextVersion = isProdMode ? bumpMinorVersion(highestBase) : bumpPatchVersion(highestBase);
  }

  await publishTarget({
    mode: primaryMode,
    version: nextVersion,
    notes: customNotes,
    currentRow,
  });

  // Saat rilis ke Production (mis. v1.8.0), otomatis samakan Testing ke v1.8.0
  // supaya siklus testing berikutnya lanjut rapi di v1.8.1, v1.8.2, dst.
  if (isProdMode && !skipSyncTesting) {
    const nextTestingVersion = normalizeSemver(nextVersion);
    console.log(
      `\n🔄 Menyelaraskan Lembayung Testing ke v${nextTestingVersion} (mengikuti rilis Production v${nextVersion})...`
    );
    await publishTarget({
      mode: 'testing',
      version: nextTestingVersion,
      notes: `Pembaruan terbaru Lembayung v${nextVersion} siap digunakan.`,
    });
  }

  console.log(
    `\n📱 Selesai! Semua perangkat yang terpasang Cuanin akan menerima notifikasi update otomatis.\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

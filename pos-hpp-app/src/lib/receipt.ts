import { formatJam, formatRupiah, formatTanggalLengkap } from './calculations';
import { getAppEnvironment, getSupabaseClient } from '../services/syncService';
import type { AppSettings, Transaction } from '../types/models';

/**
 * Payload ringkas struk untuk di-encode ke dalam URL (#struk=...)
 * sehingga link struk bisa dibuka di HP pelanggan mana pun tanpa butuh database server.
 */
export interface PublicReceiptPayload {
  u: string; // nama usaha
  lg?: string; // logo usaha (opsional, dari query DB)
  a: string; // alamat usaha
  p?: string; // telepon usaha
  h?: string; // header tagline
  f?: string; // footer pesan
  n: string; // nomor struk
  w: string; // waktu ISO
  k?: string; // nama kasir
  c?: string; // nama pelanggan / meja
  m: string; // metode bayar
  s: number; // subtotal
  d: number; // diskon nominal
  dl?: string; // diskon label
  t: number; // total
  b: number; // uang diterima
  kb: number; // kembalian
  st: string; // status ('selesai' | 'void')
  it: Array<{
    nm: string; // nama menu
    q: number; // qty
    hj: number; // harga jual
    ct?: string; // catatan
  }>;
}

function toBase64Url(str: string): string {
  const utf8Bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): string {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) {
    b64 += '=';
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Susun payload JSON ringkas struk (~0,5 KB) untuk disimpan ke Supabase Storage atau URL
 */
export function buildReceiptPayload(
  tx: Transaction,
  settings?: AppSettings
): PublicReceiptPayload {
  const showKasir = settings?.strukTampilkanKasir ?? true;
  const showNotes = settings?.strukTampilkanCatatanItem ?? true;
  const showPhone = settings?.strukTampilkanWaUsaha ?? true;

  return {
    u: settings?.namaUsaha || 'Warung Sari',
    a: settings?.alamatUsaha || '',
    p: showPhone ? settings?.teleponUsaha : undefined,
    h: settings?.strukHeader || undefined,
    f: settings?.strukFooter || 'Terima kasih!',
    n: tx.nomorStruk,
    w: tx.waktu,
    k: showKasir ? tx.kasirNama : undefined,
    c: tx.namaPelanggan || undefined,
    m: tx.metodeBayar,
    s: tx.subtotal,
    d: tx.diskonNominal,
    dl: tx.diskonLabel,
    t: tx.total,
    b: tx.uangDiterima,
    kb: tx.kembalian,
    st: tx.status,
    it: tx.items.map((item) => ({
      nm: item.menuNama,
      q: item.jumlah,
      hj: item.hargaJual,
      ct: showNotes ? item.catatan : undefined,
    })),
  };
}

/**
 * Tentukan URL dasar Website Lembayung untuk link struk digital (0 KB Storage).
 * Prioritas: Pengaturan strukBaseUrl -> env VITE_WEB_APP_URL -> origin web saat ini.
 */
export function getWebAppBaseUrl(settings?: AppSettings): string {
  const custom = settings?.strukBaseUrl?.trim();
  if (custom && /^https?:\/\//i.test(custom)) {
    return custom.replace(/\/+$/, '');
  }
  const envUrl = (import.meta.env.VITE_WEB_APP_URL as string | undefined)?.trim();
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    return envUrl.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && /^https?:\/\//i.test(window.location.origin) && !window.location.origin.includes('localhost')) {
    return `${window.location.origin}${window.location.pathname}`.replace(/\/+$/, '');
  }
  return getAppEnvironment() === 'testing'
    ? 'https://lembayung-test.pages.dev'
    : 'https://lembayung-so1.pages.dev';
}

/**
 * Buat link struk digital Website (0 KB Supabase Storage!):
 * - Jika online & memiliki outletId: pakai link pendek ?s=OUTLETID.TXID (langsung baca dari tabel transactions)
 * - Jika offline: fallback otomatis ke #struk=BASE64 sehingga tetap bisa dibuka di HP pelanggan
 */
export function buildWebReceiptUrl(tx: Transaction, settings?: AppSettings): string {
  const base = getWebAppBaseUrl(settings).replace(/#.*$/, '');
  const outletId = (settings?.outletId || '').trim().toUpperCase();
  if (outletId && (typeof navigator === 'undefined' || navigator.onLine)) {
    return `${base}/?s=${encodeURIComponent(`${outletId}.${tx.id}`)}`;
  }
  const payload = buildReceiptPayload(tx, settings);
  const encoded = toBase64Url(JSON.stringify(payload));
  return `${base}/#struk=${encoded}`;
}

/**
 * Ambil data struk digital dari query URL ?s=OUTLETID.TXID (dibuka pelanggan di Website)
 */
export async function fetchPublicReceiptFromQuery(
  search: string
): Promise<PublicReceiptPayload | null> {
  try {
    const params = new URLSearchParams(search);
    const token = params.get('s')?.trim();
    if (!token || !token.includes('.')) return null;
    const dotIdx = token.indexOf('.');
    const outletId = token.slice(0, dotIdx).trim().toUpperCase();
    const txId = token.slice(dotIdx + 1).trim();
    if (!outletId || !txId) return null;

    const client = getSupabaseClient();
    const [txRes, outletRes] = await Promise.all([
      client
        .from('transactions')
        .select('*')
        .eq('outlet_id', outletId)
        .eq('id', txId)
        .maybeSingle(),
      client
        .from('outlets')
        .select('*')
        .eq('outlet_id', outletId)
        .maybeSingle(),
    ]);

    if (!txRes.data) return null;
    const tx = txRes.data as Record<string, any>;
    const outlet = (outletRes.data as Record<string, any> | null) || {};
    const showKasir = outlet.struk_tampilkan_kasir ?? true;
    const showNotes = outlet.struk_tampilkan_catatan_item ?? true;
    const showPhone = outlet.struk_tampilkan_wa_usaha ?? true;

    return {
      u: outlet.nama_usaha || 'Lembayung',
      lg: outlet.logo_usaha || undefined,
      a: outlet.alamat_usaha || '-',
      p: showPhone ? outlet.telepon_usaha || undefined : undefined,
      h: outlet.struk_header || undefined,
      f: outlet.struk_footer || 'Terima kasih!',
      n: tx.nomor_struk,
      w: tx.waktu,
      k: showKasir ? tx.kasir_nama : undefined,
      c: tx.nama_pelanggan || undefined,
      m: tx.metode_bayar,
      s: Number(tx.subtotal || 0),
      d: Number(tx.diskon_nominal || 0),
      dl: tx.diskon_label || undefined,
      t: Number(tx.total || 0),
      b: Number(tx.uang_diterima || 0),
      kb: Number(tx.kembalian || 0),
      st: tx.status || 'selesai',
      it: Array.isArray(tx.items)
        ? tx.items.map((item: Record<string, any>) => ({
            nm: item.menuNama || item.nama || '',
            q: Number(item.jumlah || 1),
            hj: Number(item.hargaJual || 0),
            ct: showNotes ? item.catatan : undefined,
          }))
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Buat link struk digital yang bisa dibuka siapa saja
 */
export function buildReceiptShareLink(tx: Transaction, settings?: AppSettings): string {
  return buildWebReceiptUrl(tx, settings);
}

export function decodeReceiptFromHash(hash: string): PublicReceiptPayload | null {
  if (!hash.startsWith('#struk=')) return null;
  const token = hash.slice('#struk='.length).trim();
  if (!token) return null;
  try {
    const json = fromBase64Url(token);
    return JSON.parse(json) as PublicReceiptPayload;
  } catch {
    return null;
  }
}

/**
 * Normalisasi nomor HP Indonesia ke format internasional WhatsApp (628...)
 * contoh: 0812-3456-7890 -> 6281234567890
 */
export function normalizeIndoPhoneForWa(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) {
    return `62${digits.slice(1)}`;
  }
  if (digits.startsWith('8')) {
    return `62${digits}`;
  }
  return digits;
}

/**
 * Susun teks struk untuk dikirim lewat WhatsApp Biasa (bukan WA Business API)
 */
export function buildWhatsAppReceiptText(
  tx: Transaction,
  settings?: AppSettings,
  includeLink = true,
  overrideReceiptUrl?: string
): string {
  const namaUsaha = settings?.namaUsaha || 'Warung Sari';
  const showKasir = settings?.strukTampilkanKasir ?? true;
  const showNotes = settings?.strukTampilkanCatatanItem ?? true;
  const showPhone = settings?.strukTampilkanWaUsaha ?? true;
  const footer = settings?.strukFooter || 'Terima kasih atas kunjungan Anda!';

  const lines: string[] = [];
  lines.push(`*${namaUsaha}*`);
  if (settings?.strukHeader) lines.push(`_${settings.strukHeader}_`);
  if (settings?.alamatUsaha && settings.alamatUsaha !== '-') {
    lines.push(settings.alamatUsaha);
  }
  if (showPhone && settings?.teleponUsaha) {
    lines.push(`Telp/WA: ${settings.teleponUsaha}`);
  }
  lines.push('--------------------------------');
  lines.push(`No. Struk: *${tx.nomorStruk}*`);
  lines.push(`Waktu: ${formatTanggalLengkap(tx.waktu)} ${formatJam(tx.waktu)}`);
  if (showKasir) lines.push(`Kasir: ${tx.kasirNama}`);
  if (tx.namaPelanggan) lines.push(`Pelanggan/Meja: *${tx.namaPelanggan}*`);
  lines.push('--------------------------------');

  for (const it of tx.items) {
    lines.push(`${it.menuNama} x${it.jumlah} = ${formatRupiah(it.hargaJual * it.jumlah)}`);
    if (showNotes && it.catatan) {
      lines.push(`  _(Catatan: ${it.catatan})_`);
    }
  }

  lines.push('--------------------------------');
  if (tx.diskonNominal > 0) {
    lines.push(`Subtotal: ${formatRupiah(tx.subtotal)}`);
    lines.push(`${tx.diskonLabel || 'Diskon'}: -${formatRupiah(tx.diskonNominal)}`);
  }
  lines.push(`*TOTAL (${tx.metodeBayar}): ${formatRupiah(tx.total)}*`);
  if (tx.metodeBayar === 'Cash') {
    lines.push(`Tunai: ${formatRupiah(tx.uangDiterima)}`);
    lines.push(`Kembalian: ${formatRupiah(tx.kembalian)}`);
  }
  lines.push('--------------------------------');
  lines.push(footer);

  const finalLink =
    overrideReceiptUrl ||
    (includeLink && settings?.strukBaseUrl?.trim() ? buildReceiptShareLink(tx, settings) : '');

  if (finalLink) {
    lines.push('');
    lines.push(`Lihat / Simpan Struk Digital:`);
    lines.push(finalLink);
  }

  return lines.join('\n');
}

/**
 * Kompres file gambar logo usaha dari galeri HP menjadi PNG/DataURL kecil (max 220px)
 * agar ringan disimpan lokal dan 100% bebas masalah CORS saat dirender ke PNG struk.
 */
export async function compressLogoFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar logo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar logo tidak didukung.'));
      img.onload = () => {
        const maxSide = 220;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas tidak didukung.'));
          return;
        }
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memuat gambar logo.'));
    img.src = src;
  });
}

/**
 * Render Struk Digital yang rapi sebagai Gambar PNG (Blob) menggunakan HTML5 Canvas
 */
export async function generateReceiptPngBlob(
  tx: Transaction,
  settings?: AppSettings
): Promise<Blob> {
  const showKasir = settings?.strukTampilkanKasir ?? true;
  const showNotes = settings?.strukTampilkanCatatanItem ?? true;
  const showPhone = settings?.strukTampilkanWaUsaha ?? true;
  const namaUsaha = settings?.namaUsaha || 'Warung Sari';
  const footerText = settings?.strukFooter || 'Terima kasih sudah berbelanja!';

  let logoImg: HTMLImageElement | null = null;
  if (settings?.logoUsaha) {
    try {
      logoImg = await loadImageElement(settings.logoUsaha);
    } catch {
      logoImg = null;
    }
  }

  const width = 560;
  const padX = 40;
  const contentW = width - padX * 2;

  // Hitung estimasi tinggi canvas
  let estHeight = 290;
  if (logoImg) estHeight += 96;
  if (settings?.strukHeader) estHeight += 24;
  if (settings?.alamatUsaha && settings.alamatUsaha !== '-') estHeight += 24;
  if (showPhone && settings?.teleponUsaha) estHeight += 24;
  if (tx.namaPelanggan) estHeight += 26;
  for (const it of tx.items) {
    estHeight += 48;
    if (showNotes && it.catatan) estHeight += 22;
  }
  if (tx.diskonNominal > 0) estHeight += 54;
  if (tx.metodeBayar === 'Cash') estHeight += 54;
  estHeight += 110;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = estHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas tidak didukung di perangkat ini.');

  // Background kertas struk putih bersih
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, estHeight);

  // Strip hijau Cuanin di bagian paling atas
  ctx.fillStyle = '#1F7A5A';
  ctx.fillRect(0, 0, width, 12);

  let y = 40;

  // Gambar Logo Usaha jika ada
  if (logoImg) {
    const maxLogoH = 76;
    const maxLogoW = 160;
    const scale = Math.min(maxLogoW / logoImg.width, maxLogoH / logoImg.height, 1);
    const drawW = Math.round(logoImg.width * scale);
    const drawH = Math.round(logoImg.height * scale);
    const drawX = Math.round((width - drawW) / 2);
    ctx.drawImage(logoImg, drawX, y - 10, drawW, drawH);
    y += drawH + 22;
  } else {
    y = 52;
  }

  const drawCenter = (text: string, font: string, color: string, gap = 26) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, width / 2, y, contentW);
    y += gap;
  };

  const drawRow = (left: string, right: string, font: string, colorLeft: string, colorRight = colorLeft, gap = 26) => {
    ctx.font = font;
    ctx.fillStyle = colorLeft;
    ctx.textAlign = 'left';
    ctx.fillText(left, padX, y, contentW * 0.65);
    ctx.fillStyle = colorRight;
    ctx.textAlign = 'right';
    ctx.fillText(right, width - padX, y, contentW * 0.35);
    y += gap;
  };

  const drawDashedLine = () => {
    ctx.save();
    ctx.strokeStyle = '#D6D3C8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(padX, y - 6);
    ctx.lineTo(width - padX, y - 6);
    ctx.stroke();
    ctx.restore();
    y += 18;
  };

  // Header Usaha
  drawCenter(namaUsaha, 'bold 26px Inter, system-ui, sans-serif', '#1F1E1D', 28);
  if (settings?.strukHeader) {
    drawCenter(settings.strukHeader, 'italic 15px Inter, system-ui, sans-serif', '#6B6A68', 22);
  }
  if (settings?.alamatUsaha && settings.alamatUsaha !== '-') {
    drawCenter(settings.alamatUsaha, '14px Inter, system-ui, sans-serif', '#6B6A68', 22);
  }
  if (showPhone && settings?.teleponUsaha) {
    drawCenter(`Telp/WA: ${settings.teleponUsaha}`, '14px Inter, system-ui, sans-serif', '#6B6A68', 24);
  }

  y += 6;
  drawDashedLine();

  // Metadata Struk
  drawRow('No. Struk', tx.nomorStruk, 'bold 15px Inter, system-ui, sans-serif', '#6B6A68', '#1F1E1D', 24);
  drawRow(
    'Waktu',
    `${formatTanggalLengkap(tx.waktu)} · ${formatJam(tx.waktu)}`,
    '14px Inter, system-ui, sans-serif',
    '#6B6A68',
    '#1F1E1D',
    24
  );
  if (showKasir) {
    drawRow('Kasir', tx.kasirNama, '14px Inter, system-ui, sans-serif', '#6B6A68', '#1F1E1D', 24);
  }
  if (tx.namaPelanggan) {
    drawRow('Pelanggan / Meja', tx.namaPelanggan, 'bold 14px Inter, system-ui, sans-serif', '#6B6A68', '#1F1E1D', 24);
  }
  drawRow('Metode Bayar', tx.metodeBayar, 'bold 14px Inter, system-ui, sans-serif', '#6B6A68', '#1F7A5A', 22);

  drawDashedLine();

  // Item Pesanan
  for (const it of tx.items) {
    drawRow(
      `${it.menuNama}`,
      formatRupiah(it.hargaJual * it.jumlah),
      'bold 16px Inter, system-ui, sans-serif',
      '#1F1E1D',
      '#1F1E1D',
      22
    );
    ctx.font = '13px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#6B6A68';
    ctx.textAlign = 'left';
    ctx.fillText(`${it.jumlah} x ${formatRupiah(it.hargaJual)}`, padX, y);
    y += 22;
    if (showNotes && it.catatan) {
      ctx.font = 'italic 13px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#6B6A68';
      ctx.fillText(`Catatan: ${it.catatan}`, padX, y, contentW);
      y += 20;
    }
    y += 4;
  }

  drawDashedLine();

  // Ringkasan Total
  if (tx.diskonNominal > 0) {
    drawRow('Subtotal', formatRupiah(tx.subtotal), '15px Inter, system-ui, sans-serif', '#6B6A68', '#1F1E1D', 24);
    drawRow(
      tx.diskonLabel || 'Diskon',
      `−${formatRupiah(tx.diskonNominal)}`,
      '15px Inter, system-ui, sans-serif',
      '#9B1C12',
      '#9B1C12',
      26
    );
  }

  drawRow('TOTAL', formatRupiah(tx.total), 'bold 22px Inter, system-ui, sans-serif', '#1F1E1D', '#1F7A5A', 30);

  if (tx.metodeBayar === 'Cash') {
    drawRow('Tunai Diterima', formatRupiah(tx.uangDiterima), '15px Inter, system-ui, sans-serif', '#6B6A68', '#1F1E1D', 24);
    drawRow('Kembalian', formatRupiah(tx.kembalian), '15px Inter, system-ui, sans-serif', '#6B6A68', '#1F1E1D', 24);
  }

  y += 6;
  drawDashedLine();

  // Footer
  drawCenter(footerText, '14px Inter, system-ui, sans-serif', '#4A4947', 24);
  drawCenter('Powered by Lembayung', '12px Inter, system-ui, sans-serif', '#9A9893', 20);

  // Crop canvas agar tinggi pas dengan konten
  const finalHeight = Math.min(estHeight, y + 20);
  const cropped = document.createElement('canvas');
  cropped.width = width;
  cropped.height = finalHeight;
  const cCtx = cropped.getContext('2d');
  if (cCtx) {
    cCtx.drawImage(canvas, 0, 0, width, finalHeight, 0, 0, width, finalHeight);
  }

  return new Promise<Blob>((resolve, reject) => {
    cropped.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Gagal membuat gambar PNG struk.'));
    }, 'image/png');
  });
}

/**
 * Upload Struk dalam format JSON (~0,5 KB — 80x lebih hemat dari PNG!) ke Supabase Storage bucket "cuanin-receipts".
 * Jika settings.strukBaseUrl diisi (URL Web Viewer), otomatis mengembalikan link Web Viewer cantik (?json=...)
 * yang langsung merender struk & tombol "Simpan Gambar PNG" di browser HP pelanggan!
 */
export async function uploadReceiptJsonToSupabase(
  tx: Transaction,
  settings?: AppSettings
): Promise<{
  success: boolean;
  viewerUrl?: string;
  jsonUrl?: string;
  hasViewerBaseUrl: boolean;
  sizeBytes?: number;
  error?: string;
}> {
  const baseUrl = settings?.strukBaseUrl?.trim().replace(/[?#].*$/, '') || '';
  const hasViewerBaseUrl = Boolean(baseUrl && /^https?:\/\//i.test(baseUrl));

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      success: false,
      hasViewerBaseUrl,
      error: 'Perangkat sedang offline. Link struk butuh koneksi internet.',
    };
  }

  try {
    const payload = buildReceiptPayload(tx, settings);
    const jsonString = JSON.stringify(payload);
    const jsonBlob = new Blob([jsonString], { type: 'application/json' });
    const client = getSupabaseClient(settings);
    const outletId = (settings?.outletId || 'CUAN-8899').trim().toUpperCase();
    const safeStruk = tx.nomorStruk.replace(/[^a-zA-Z0-9]/g, '');
    const filePath = `${outletId}/struk-${safeStruk}-${tx.id.slice(0, 6)}.json`;

    const { error: uploadErr } = await client.storage
      .from('cuanin-receipts')
      .upload(filePath, jsonBlob, {
        contentType: 'application/json',
        upsert: true,
      });

    if (uploadErr) {
      return {
        success: false,
        hasViewerBaseUrl,
        error: `Gagal upload struk JSON: ${uploadErr.message}`,
      };
    }

    const { data } = client.storage.from('cuanin-receipts').getPublicUrl(filePath);
    const jsonUrl = data.publicUrl;
    const viewerUrl = hasViewerBaseUrl
      ? `${baseUrl}?json=${encodeURIComponent(jsonUrl)}`
      : jsonUrl;

    return {
      success: true,
      viewerUrl,
      jsonUrl,
      hasViewerBaseUrl,
      sizeBytes: jsonBlob.size,
    };
  } catch (err) {
    return {
      success: false,
      hasViewerBaseUrl,
      error: err instanceof Error ? err.message : 'Gagal membuat link struk JSON.',
    };
  }
}

/**
 * Upload Gambar Struk PNG ke Supabase Storage bucket "cuanin-receipts"
 * dan kembalikan link publik permanen yang bisa dibuka di browser HP pelanggan mana pun (TANPA VERCEL!)
 */
export async function uploadReceiptImageToSupabase(
  tx: Transaction,
  settings?: AppSettings
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, error: 'Perangkat sedang offline. Link struk butuh koneksi internet.' };
  }

  try {
    const blob = await generateReceiptPngBlob(tx, settings);
    const client = getSupabaseClient(settings);
    const outletId = (settings?.outletId || 'CUAN-8899').trim().toUpperCase();
    const safeStruk = tx.nomorStruk.replace(/[^a-zA-Z0-9]/g, '');
    const filePath = `${outletId}/struk-${safeStruk}-${tx.id.slice(0, 6)}.png`;

    const { error: uploadErr } = await client.storage
      .from('cuanin-receipts')
      .upload(filePath, blob, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadErr) {
      return {
        success: false,
        error: `Gagal upload struk: ${uploadErr.message} (Pastikan sudah menjalankan bagian bucket cuanin-receipts di supabase_schema.sql)`,
      };
    }

    const { data } = client.storage.from('cuanin-receipts').getPublicUrl(filePath);
    return { success: true, publicUrl: data.publicUrl };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal membuat link struk.',
    };
  }
}

/**
 * Buat URL wa.me untuk membuka aplikasi WhatsApp biasa secara langsung.
 * Jika nomor WA pelanggan diisi -> langsung buka ruang chat nomor tersebut.
 * Jika nomor WA dikosongkan -> buka pemilih kontak di WhatsApp biasa.
 */
export function buildWhatsAppUrl(rawPhone: string | undefined, messageText: string): string {
  const encodedText = encodeURIComponent(messageText);
  const normalized = rawPhone ? normalizeIndoPhoneForWa(rawPhone) : '';
  if (normalized.length >= 9) {
    return `https://wa.me/${normalized}?text=${encodedText}`;
  }
  return `https://wa.me/?text=${encodedText}`;
}

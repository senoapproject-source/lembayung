import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database';
import { getSupabaseClient, getSupabaseConfig } from './syncService';

export const MEDIA_STORAGE_BUCKET = 'cuanin-receipts';

export interface CompressedImageResult {
  blob: Blob;
  dataUrl: string;
  sizeKb: number;
  width: number;
  height: number;
}

/**
 * Kompresi gambar dari File (kamera / galeri) ke JPEG ringan via HTML5 Canvas
 * dengan mempertahankan rasio aspek.
 */
export async function compressImageFileToJpeg(
  file: File,
  opts?: { maxWidth?: number; maxHeight?: number; quality?: number }
): Promise<CompressedImageResult> {
  const maxWidth = opts?.maxWidth ?? 1080;
  const maxHeight = opts?.maxHeight ?? 1080;
  const quality = opts?.quality ?? 0.72;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      el.src = objectUrl;
    });

    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas tidak tersedia di perangkat ini.');

    // Isi latar putih agar PNG transparan tidak berubah jadi hitam saat dikonversi ke JPEG
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Gagal mengompresi gambar ke JPEG.'))),
        'image/jpeg',
        quality
      );
    });

    return {
      blob,
      dataUrl,
      sizeKb: Math.max(1, Math.round(blob.size / 1024)),
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Kompresi foto secara otomatis lalu unggah ke Supabase Storage.
 * - Jika online & upload sukses -> kembalikan Public URL ringan (~90 karakter, database super hemat).
 * - Jika offline / upload gagal -> otomatis fallback ke Base64 JPEG terkompresi agar tetap 100% jalan offline.
 */
export async function uploadCompressedMediaToStorage(params: {
  file: File;
  folder: 'nota' | 'menus';
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}): Promise<{
  url: string;
  uploadedToStorage: boolean;
  sizeKb: number;
}> {
  const defaults =
    params.folder === 'menus'
      ? { maxWidth: 640, maxHeight: 640, quality: 0.78 }
      : { maxWidth: 1080, maxHeight: 1440, quality: 0.72 };

  const compressed = await compressImageFileToJpeg(params.file, {
    maxWidth: params.maxWidth ?? defaults.maxWidth,
    maxHeight: params.maxHeight ?? defaults.maxHeight,
    quality: params.quality ?? defaults.quality,
  });

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      url: compressed.dataUrl,
      uploadedToStorage: false,
      sizeKb: compressed.sizeKb,
    };
  }

  try {
    const settings = await db.settings.get('global');
    const cfg = getSupabaseConfig(settings);
    const client = getSupabaseClient(settings);
    const cleanOid = (cfg.outletId || 'LM-A10001').replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = `${params.folder}/${cleanOid}/${Date.now()}-${uuidv4().slice(0, 8)}.jpg`;

    const { error } = await client.storage
      .from(MEDIA_STORAGE_BUCKET)
      .upload(filePath, compressed.blob, {
        contentType: 'image/jpeg',
        cacheControl: '31536000',
        upsert: true,
      });

    if (error) {
      return {
        url: compressed.dataUrl,
        uploadedToStorage: false,
        sizeKb: compressed.sizeKb,
      };
    }

    const { data } = client.storage.from(MEDIA_STORAGE_BUCKET).getPublicUrl(filePath);
    return {
      url: data.publicUrl,
      uploadedToStorage: true,
      sizeKb: compressed.sizeKb,
    };
  } catch {
    return {
      url: compressed.dataUrl,
      uploadedToStorage: false,
      sizeKb: compressed.sizeKb,
    };
  }
}

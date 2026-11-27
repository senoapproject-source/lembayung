// Edge Function: Layanan Email Transaksional (Brevo) & Push Notification (FCM) Lembayung
// Fitur: Verifikasi OTP Owner, Email ID Outlet, Pemulihan Akun Owner, Rekap Tutup Kasir, Ringkasan Laporan, & Push FCM
// Env Secrets: BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME, FIREBASE_SERVICE_ACCOUNT_JSON

// @ts-ignore -- Deno URL import (aktif di runtime Supabase Edge Functions)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonRes(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateOtp6(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRp(n: number): string {
  const num = Math.round(Number(n) || 0);
  const sign = num < 0 ? '-' : '';
  return `${sign}Rp${Math.abs(num).toLocaleString('id-ID')}`;
}

function formatWibDateTime(iso?: string | null): string {
  if (!iso) return '-';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' WIB';
}

function getWibDateStr(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value || '2026';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

function wrapEmailLayout(title: string, contentHtml: string): string {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#faf9f5; padding:24px; color:#1f1e1d;">
    <div style="max-width:480px; margin:0 auto; background:#ffffff; border:1px solid #e2e0d8; border-radius:16px; overflow:hidden;">
      <div style="background:#1F7A5A; padding:20px 24px; color:#ffffff;">
        <div style="font-size:18px; font-weight:700; letter-spacing:-0.3px;">Lembayung</div>
        <div style="font-size:12px; opacity:0.9; margin-top:2px;">${escapeHtml(title)}</div>
      </div>
      <div style="padding:24px; font-size:14px; line-height:1.6;">
        ${contentHtml}
      </div>
      <div style="padding:14px 24px; background:#faf9f5; border-top:1px solid #eeece5; font-size:11px; color:#6b6a68;">
        Email ini dikirim otomatis oleh sistem Lembayung. Abaikan jika Anda tidak merasa melakukan permintaan ini.
      </div>
    </div>
  </div>`;
}

async function sendBrevoEmail(params: {
  toEmail: string;
  toName?: string;
  subject: string;
  htmlContent: string;
}) {
  const apiKey = Deno.env.get('BREVO_API_KEY') || '';
  const senderEmail = Deno.env.get('BREVO_SENDER_EMAIL') || '';
  const senderName = Deno.env.get('BREVO_SENDER_NAME') || 'Lembayung';

  if (!apiKey || !senderEmail) {
    throw new Error(
      'Konfigurasi email server (BREVO_API_KEY / BREVO_SENDER_EMAIL) belum disetel di Supabase Secrets.'
    );
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: params.toEmail, name: params.toName || params.toEmail }],
      subject: params.subject,
      htmlContent: params.htmlContent,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Brevo API error (${res.status}): ${errText || res.statusText}`);
  }
}

// ============================================================================
// FIREBASE CLOUD MESSAGING (FCM HTTP v1) HELPER (PURE WEB CRYPTO, ZERO DEPS)
// ============================================================================
function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function getFirebaseAccessToken(serviceAccount: {
  client_email: string;
  private_key: string;
}): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );
  const unsignedJwt = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedJwt)
  );
  const assertion = `${unsignedJwt}.${base64UrlEncode(new Uint8Array(sigBuf))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!tokenRes.ok) {
    const errTxt = await tokenRes.text().catch(() => '');
    throw new Error(`Firebase OAuth error (${tokenRes.status}): ${errTxt}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error('Access token Firebase kosong.');
  return tokenJson.access_token;
}

interface OwnerRow {
  outlet_id: string;
  id: string;
  nama: string;
  username: string;
  email: string | null;
  role: string;
  active: boolean;
}

function getEffectiveOwnerEmail(owner: OwnerRow): string {
  const e = (owner.email || '').trim().toLowerCase();
  if (e && e.includes('@')) return e;
  // Kompatibilitas akun owner lama yang sebelumnya menaruh email di kolom username
  const u = (owner.username || '').trim().toLowerCase();
  if (u && u.includes('@')) return u;
  return '';
}

async function findOwnerByIdentifier(
  sb: ReturnType<typeof createClient>,
  identifier: string
): Promise<OwnerRow | null> {
  const clean = identifier.trim().toLowerCase();
  if (!clean) return null;

  const { data, error } = await sb
    .from('users')
    .select('outlet_id, id, nama, username, email, role, active')
    .eq('role', 'owner');

  if (error || !Array.isArray(data)) return null;

  const rows = data as OwnerRow[];
  return (
    rows.find(
      (r) =>
        (r.username || '').trim().toLowerCase() === clean ||
        (r.email || '').trim().toLowerCase() === clean
    ) || null
  );
}

async function findOwnersByEmail(
  sb: ReturnType<typeof createClient>,
  email: string
): Promise<OwnerRow[]> {
  const clean = email.trim().toLowerCase();
  if (!clean) return [];

  const { data, error } = await sb
    .from('users')
    .select('outlet_id, id, nama, username, email, role, active')
    .eq('role', 'owner');

  if (error || !Array.isArray(data)) return [];

  return (data as OwnerRow[]).filter((r) => getEffectiveOwnerEmail(r) === clean);
}

async function checkRegistrationDuplicate(
  sb: ReturnType<typeof createClient>,
  username: string,
  email: string
): Promise<string | null> {
  const cleanUser = username.trim().toLowerCase();
  const cleanEmail = email.trim().toLowerCase();

  const [usersRes, outletsRes] = await Promise.all([
    sb.from('users').select('username, email'),
    sb.from('outlets').select('owner_email'),
  ]);

  const rows = (usersRes.data as Array<{ username: string | null; email: string | null }> | null) || [];
  const outletRows = (outletsRes.data as Array<{ owner_email: string | null }> | null) || [];
  const usernameTaken = Boolean(
    cleanUser &&
    rows.some((r) => (r.username || '').trim().toLowerCase() === cleanUser)
  );
  const emailTaken = Boolean(
    cleanEmail &&
    (rows.some((r) => {
      const rowEmail = (r.email || '').trim().toLowerCase();
      const rowUser = (r.username || '').trim().toLowerCase();
      return rowEmail === cleanEmail || rowUser === cleanEmail;
    }) ||
      outletRows.some((o) => (o.owner_email || '').trim().toLowerCase() === cleanEmail))
  );

  if (usernameTaken && emailTaken) {
    return `Username "${username}" dan email "${email}" sudah terdaftar. Silakan masuk (Login) atau gunakan data lain.`;
  }
  if (usernameTaken) {
    return `Username "${username}" sudah digunakan. Silakan gunakan username lain.`;
  }
  if (emailTaken) {
    return `Email "${email}" sudah terdaftar. Silakan masuk (Login) atau gunakan Lupa Password.`;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonRes({ success: false, error: 'Supabase environment tidak tersedia.' }, 500);
    }

    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const payload = await req.json();
    const action = String(payload?.action || '').trim();

    // =========================================================================
    // 1. KIRIM OTP VERIFIKASI EMAIL SAAT DAFTAR OWNER BARU
    // =========================================================================
    if (action === 'send_register_otp') {
      const email = String(payload.email || '').trim().toLowerCase();
      const username = String(payload.username || '').trim();
      const namaUsaha = String(payload.namaUsaha || '').trim();
      const namaOwner = String(payload.namaOwner || '').trim();

      if (!email || !email.includes('@')) {
        return jsonRes({ success: false, error: 'Alamat email tidak valid.' }, 400);
      }
      if (!username) {
        return jsonRes({ success: false, error: 'Username wajib diisi.' }, 400);
      }

      // Cek apakah username atau email sudah digunakan akun mana pun di sistem (Owner maupun Kasir)
      const duplicateErr = await checkRegistrationDuplicate(sb, username, email);
      if (duplicateErr) {
        return jsonRes({ success: false, error: duplicateErr }, 200);
      }

      const otp = generateOtp6();
      const codeHash = await sha256Hex(`${email}:register:${otp}`);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await sb
        .from('email_verifications')
        .update({ used: true })
        .eq('email', email)
        .eq('purpose', 'register')
        .eq('used', false);

      const { error: insErr } = await sb.from('email_verifications').insert({
        email,
        purpose: 'register',
        code_hash: codeHash,
        expires_at: expiresAt,
        used: false,
      });

      if (insErr) {
        return jsonRes(
          { success: false, error: `Gagal menyimpan kode verifikasi: ${insErr.message}` },
          500
        );
      }

      await sendBrevoEmail({
        toEmail: email,
        toName: namaOwner || username,
        subject: `[Lembayung] Kode Verifikasi Email Anda: ${otp}`,
        htmlContent: wrapEmailLayout(
          'Verifikasi Pendaftaran Owner',
          `
          <p style="margin-top:0;">Halo <strong>${escapeHtml(namaOwner || username)}</strong>,</p>
          <p>Terima kasih telah mendaftarkan usaha <strong>${escapeHtml(namaUsaha || 'Anda')}</strong> di Lembayung. Masukkan kode verifikasi berikut di aplikasi untuk menyelesaikan pendaftaran:</p>
          <div style="text-align:center; margin:22px 0;">
            <span style="display:inline-block; font-size:28px; font-weight:800; letter-spacing:8px; color:#1F7A5A; background:#e4f1ea; padding:12px 24px; border-radius:12px;">${otp}</span>
          </div>
          <p style="font-size:12px; color:#6b6a68;">Kode berlaku selama <strong>10 menit</strong>. Jangan bagikan kode ini kepada siapa pun.</p>
          `
        ),
      });

      return jsonRes({
        success: true,
        maskedEmail: maskEmail(email),
        message: `Kode verifikasi 6 digit telah dikirim ke ${maskEmail(email)}.`,
      });
    }

    // =========================================================================
    // 2. VERIFIKASI OTP PENDAFTARAN OWNER (+ LANGSUNG KIRIM EMAIL ID OUTLET)
    // =========================================================================
    if (action === 'verify_register_otp') {
      const email = String(payload.email || '').trim().toLowerCase();
      const username = String(payload.username || '').trim();
      const namaOwner = String(payload.namaOwner || '').trim();
      const namaUsaha = String(payload.namaUsaha || '').trim();
      const outletId = String(payload.outletId || '').trim().toUpperCase();
      const kasirAuthPin = String(payload.kasirAuthPin || '').trim();
      const otp = String(payload.otp || '').trim();
      if (!email || !/^\d{6}$/.test(otp)) {
        return jsonRes({ success: false, error: 'Kode verifikasi wajib 6 angka.' }, 200);
      }

      const duplicateErr = await checkRegistrationDuplicate(sb, username, email);
      if (duplicateErr) {
        return jsonRes({ success: false, error: duplicateErr }, 200);
      }

      const codeHash = await sha256Hex(`${email}:register:${otp}`);
      const { data: rows, error } = await sb
        .from('email_verifications')
        .select('*')
        .eq('email', email)
        .eq('purpose', 'register')
        .eq('used', false)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error || !rows || rows.length === 0) {
        return jsonRes(
          { success: false, error: 'Kode verifikasi tidak ditemukan atau sudah dipakai. Kirim ulang kode.' },
          200
        );
      }

      const row = rows[0];
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return jsonRes(
          { success: false, error: 'Kode verifikasi sudah kedaluwarsa. Silakan kirim ulang kode.' },
          200
        );
      }

      if (row.code_hash !== codeHash) {
        return jsonRes({ success: false, error: 'Kode verifikasi salah.' }, 200);
      }

      await sb.from('email_verifications').update({ used: true }).eq('id', row.id);

      // Langsung kirim email ID Outlet + PIN Otorisasi Mode Kasir di dalam request verifikasi yang sama agar pasti terkirim!
      let welcomeEmailSent = false;
      if (outletId) {
        try {
          const pinBlockHtml = kasirAuthPin
            ? `
                <div style="margin-top:12px; padding-top:12px; border-top:1px dashed #d6d3c8;">
                  <div style="font-size:12px; color:#6b6a68;">PIN Otorisasi Mode Kasir (6 Angka)</div>
                  <div style="font-size:22px; font-weight:800; color:#1F7A5A; letter-spacing:4px; margin:4px 0;">${escapeHtml(kasirAuthPin)}</div>
                  <div style="font-size:11px; color:#6b6a68;">Digunakan untuk masuk ke Mode Kasir &amp; menghapus pesanan tersimpan (Open Bill) khusus pada outlet ini. Dapat dilihat atau di-reset kapan saja melalui menu <strong>Pengaturan</strong>.</div>
                </div>
              `
            : '';

          await sendBrevoEmail({
            toEmail: email,
            toName: namaOwner || username,
            subject: `[Lembayung] Pendaftaran Berhasil — ID Outlet Anda: ${outletId}`,
            htmlContent: wrapEmailLayout(
              'Pendaftaran Usaha Berhasil',
              `
              <p style="margin-top:0;">Selamat bergabung, <strong>${escapeHtml(namaOwner || username)}</strong>!</p>
              <p>Usaha <strong>${escapeHtml(namaUsaha || 'Anda')}</strong> telah berhasil terdaftar di <strong>Lembayung</strong>. Simpan informasi akun Owner Anda berikut ini:</p>
              <div style="background:#faf9f5; border:1px solid #e2e0d8; border-radius:12px; padding:16px; margin:16px 0;">
                <div style="font-size:12px; color:#6b6a68;">ID Outlet (Kode Toko)</div>
                <div style="font-size:22px; font-weight:800; color:#1F7A5A; letter-spacing:2px; margin-bottom:10px;">${escapeHtml(outletId)}</div>
                <div style="font-size:12px; color:#6b6a68;">Username Owner</div>
                <div style="font-size:15px; font-weight:700; color:#1f1e1d; margin-bottom:6px;">${escapeHtml(username)}</div>
                <div style="font-size:12px; color:#6b6a68;">Email Terdaftar</div>
                <div style="font-size:14px; font-weight:600; color:#1f1e1d;">${escapeHtml(email)}</div>
                ${pinBlockHtml}
              </div>
              <p style="font-size:13px; color:#4a4947;">Gunakan <strong>ID Outlet</strong> di atas saat menghubungkan tablet atau HP kasir baru ke toko Anda.</p>
              `
            ),
          });
          welcomeEmailSent = true;
        } catch {
          welcomeEmailSent = false;
        }
      }

      return jsonRes({ success: true, verified: true, welcomeEmailSent });
    }

    // =========================================================================
    // 3. KIRIM EMAIL SELAMAT DATANG + INFORMASI ID OUTLET & PIN OTORISASI
    // =========================================================================
    if (action === 'send_welcome_outlet') {
      const email = String(payload.email || '').trim().toLowerCase();
      const namaOwner = String(payload.namaOwner || '').trim();
      const namaUsaha = String(payload.namaUsaha || '').trim();
      const username = String(payload.username || '').trim();
      const outletId = String(payload.outletId || '').trim().toUpperCase();
      const kasirAuthPin = String(payload.kasirAuthPin || '').trim();

      if (!email || !outletId) {
        return jsonRes({ success: false, error: 'Email dan ID Outlet wajib diisi.' }, 400);
      }

      const pinBlockHtml = kasirAuthPin
        ? `
            <div style="margin-top:12px; padding-top:12px; border-top:1px dashed #d6d3c8;">
              <div style="font-size:12px; color:#6b6a68;">PIN Otorisasi Mode Kasir (6 Angka)</div>
              <div style="font-size:22px; font-weight:800; color:#1F7A5A; letter-spacing:4px; margin:4px 0;">${escapeHtml(kasirAuthPin)}</div>
              <div style="font-size:11px; color:#6b6a68;">Digunakan untuk masuk ke Mode Kasir &amp; menghapus pesanan tersimpan (Open Bill) khusus pada outlet ini. Dapat dilihat atau di-reset kapan saja melalui menu <strong>Pengaturan</strong>.</div>
            </div>
          `
        : '';

      await sendBrevoEmail({
        toEmail: email,
        toName: namaOwner || username,
        subject: `[Lembayung] Pendaftaran Berhasil — ID Outlet Anda: ${outletId}`,
        htmlContent: wrapEmailLayout(
          'Pendaftaran Usaha Berhasil',
          `
          <p style="margin-top:0;">Selamat bergabung, <strong>${escapeHtml(namaOwner || username)}</strong>!</p>
          <p>Usaha <strong>${escapeHtml(namaUsaha)}</strong> telah berhasil terdaftar di <strong>Lembayung</strong>. Simpan informasi akun Owner Anda berikut ini:</p>
          <div style="background:#faf9f5; border:1px solid #e2e0d8; border-radius:12px; padding:16px; margin:16px 0;">
            <div style="font-size:12px; color:#6b6a68;">ID Outlet (Kode Toko)</div>
            <div style="font-size:22px; font-weight:800; color:#1F7A5A; letter-spacing:2px; margin-bottom:10px;">${escapeHtml(outletId)}</div>
            <div style="font-size:12px; color:#6b6a68;">Username Owner</div>
            <div style="font-size:15px; font-weight:700; color:#1f1e1d; margin-bottom:6px;">${escapeHtml(username)}</div>
            <div style="font-size:12px; color:#6b6a68;">Email Terdaftar</div>
            <div style="font-size:14px; font-weight:600; color:#1f1e1d;">${escapeHtml(email)}</div>
            ${pinBlockHtml}
          </div>
          <p style="font-size:13px; color:#4a4947;">Gunakan <strong>ID Outlet</strong> di atas saat menghubungkan tablet atau HP kasir baru ke toko Anda.</p>
          `
        ),
      });

      return jsonRes({ success: true });
    }

    // =========================================================================
    // 4. LUPA PASSWORD OWNER (PAKAI USERNAME ATAU EMAIL) -> KIRIM OTP
    // =========================================================================
    if (action === 'forgot_password_request') {
      const identifier = String(payload.identifier || '').trim();
      if (!identifier) {
        return jsonRes({ success: false, error: 'Masukkan Username atau Email Owner.' }, 400);
      }

      const owner = await findOwnerByIdentifier(sb, identifier);
      if (!owner) {
        return jsonRes(
          { success: false, error: 'Akun Owner dengan username atau email tersebut tidak ditemukan.' },
          404
        );
      }

      const ownerEmail = getEffectiveOwnerEmail(owner);
      if (!ownerEmail) {
        return jsonRes(
          {
            success: false,
            error: 'Akun Owner ini belum memiliki alamat email terdaftar. Tambahkan email di menu Pengaturan.',
          },
          400
        );
      }

      const otp = generateOtp6();
      const codeHash = await sha256Hex(`${ownerEmail}:reset_password:${otp}`);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await sb
        .from('email_verifications')
        .update({ used: true })
        .eq('email', ownerEmail)
        .eq('purpose', 'reset_password')
        .eq('used', false);

      await sb.from('email_verifications').insert({
        email: ownerEmail,
        purpose: 'reset_password',
        code_hash: codeHash,
        outlet_id: owner.outlet_id,
        user_id: owner.id,
        expires_at: expiresAt,
        used: false,
      });

      await sendBrevoEmail({
        toEmail: ownerEmail,
        toName: owner.nama,
        subject: `[Lembayung] Kode Reset Kata Sandi Owner: ${otp}`,
        htmlContent: wrapEmailLayout(
          'Permintaan Reset Kata Sandi Owner',
          `
          <p style="margin-top:0;">Halo <strong>${escapeHtml(owner.nama)}</strong>,</p>
          <p>Kami menerima permintaan untuk mengatur ulang kata sandi akun Owner (<strong>${escapeHtml(owner.username)}</strong>). Masukkan kode OTP berikut di aplikasi Lembayung:</p>
          <div style="text-align:center; margin:22px 0;">
            <span style="display:inline-block; font-size:28px; font-weight:800; letter-spacing:8px; color:#1F7A5A; background:#e4f1ea; padding:12px 24px; border-radius:12px;">${otp}</span>
          </div>
          <p style="font-size:12px; color:#6b6a68;">Kode berlaku selama <strong>10 menit</strong>. Jika Anda tidak meminta reset kata sandi, abaikan email ini.</p>
          `
        ),
      });

      return jsonRes({
        success: true,
        maskedEmail: maskEmail(ownerEmail),
        message: `Kode OTP reset kata sandi telah dikirim ke ${maskEmail(ownerEmail)}.`,
      });
    }

    // =========================================================================
    // 5. KONFIRMASI RESET PASSWORD OWNER (OTP + PASSWORD HASH BARU)
    // =========================================================================
    if (action === 'forgot_password_confirm') {
      const identifier = String(payload.identifier || '').trim();
      const otp = String(payload.otp || '').trim();
      const newPasswordHash = String(payload.newPasswordHash || '').trim();

      if (!identifier || !/^\d{6}$/.test(otp) || !newPasswordHash) {
        return jsonRes(
          { success: false, error: 'Username/Email, kode OTP 6 digit, dan kata sandi baru wajib diisi.' },
          400
        );
      }

      const owner = await findOwnerByIdentifier(sb, identifier);
      if (!owner) {
        return jsonRes({ success: false, error: 'Akun Owner tidak ditemukan.' }, 404);
      }

      const ownerEmail = getEffectiveOwnerEmail(owner);
      const codeHash = await sha256Hex(`${ownerEmail}:reset_password:${otp}`);

      const { data: rows } = await sb
        .from('email_verifications')
        .select('*')
        .eq('email', ownerEmail)
        .eq('purpose', 'reset_password')
        .eq('used', false)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!rows || rows.length === 0) {
        return jsonRes(
          { success: false, error: 'Kode OTP tidak ditemukan atau sudah dipakai. Kirim ulang OTP.' },
          400
        );
      }

      const row = rows[0];
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return jsonRes({ success: false, error: 'Kode OTP sudah kedaluwarsa.' }, 400);
      }
      if (row.code_hash !== codeHash) {
        return jsonRes({ success: false, error: 'Kode OTP salah.' }, 400);
      }

      const nowIso = new Date().toISOString();
      const { error: updErr } = await sb
        .from('users')
        .update({ password_hash: newPasswordHash, updated_at: nowIso })
        .eq('outlet_id', owner.outlet_id)
        .eq('id', owner.id);

      if (updErr) {
        return jsonRes(
          { success: false, error: `Gagal memperbarui kata sandi: ${updErr.message}` },
          500
        );
      }

      await sb.from('email_verifications').update({ used: true }).eq('id', row.id);

      return jsonRes({
        success: true,
        outletId: owner.outlet_id,
        userId: owner.id,
        message: 'Kata sandi Owner berhasil diperbarui. Silakan masuk dengan kata sandi baru.',
      });
    }

    // =========================================================================
    // 6. LUPA USERNAME OWNER (WAJIB PAKAI EMAIL)
    // =========================================================================
    if (action === 'forgot_username') {
      const email = String(payload.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        return jsonRes({ success: false, error: 'Masukkan alamat email yang valid.' }, 400);
      }

      const owners = await findOwnersByEmail(sb, email);
      if (owners.length === 0) {
        return jsonRes(
          { success: false, error: 'Tidak ada akun Owner yang terdaftar dengan email tersebut.' },
          404
        );
      }

      const outletIds = Array.from(new Set(owners.map((o) => o.outlet_id)));
      const { data: outlets } = await sb
        .from('outlets')
        .select('outlet_id, nama_usaha')
        .in('outlet_id', outletIds);
      const outletNameMap = new Map<string, string>(
        ((outlets as Array<{ outlet_id: string; nama_usaha: string }> | null) || []).map((o) => [
          o.outlet_id,
          o.nama_usaha,
        ])
      );

      const itemsHtml = owners
        .map((o) => {
          const namaUsaha = outletNameMap.get(o.outlet_id) || o.outlet_id;
          return `
            <div style="background:#faf9f5; border:1px solid #e2e0d8; border-radius:10px; padding:12px 14px; margin-bottom:10px;">
              <div style="font-size:12px; color:#6b6a68;">${escapeHtml(namaUsaha)}</div>
              <div style="font-size:16px; font-weight:700; color:#1F7A5A; margin-top:2px;">Username: ${escapeHtml(o.username)}</div>
            </div>`;
        })
        .join('');

      await sendBrevoEmail({
        toEmail: email,
        toName: owners[0].nama,
        subject: '[Lembayung] Informasi Username Akun Owner Anda',
        htmlContent: wrapEmailLayout(
          'Pengingat Username Owner',
          `
          <p style="margin-top:0;">Halo <strong>${escapeHtml(owners[0].nama)}</strong>,</p>
          <p>Berikut adalah <strong>Username Owner</strong> yang terhubung dengan email <strong>${escapeHtml(email)}</strong>:</p>
          ${itemsHtml}
          <p style="font-size:13px; color:#4a4947;">Anda dapat login ke aplikasi Lembayung menggunakan Username di atas maupun alamat email Anda.</p>
          `
        ),
      });

      return jsonRes({
        success: true,
        maskedEmail: maskEmail(email),
        message: `Informasi Username Owner telah dikirim ke ${maskEmail(email)}.`,
      });
    }

    // =========================================================================
    // 7. LUPA ID OUTLET OWNER (PAKAI USERNAME ATAU EMAIL)
    // =========================================================================
    if (action === 'forgot_outlet_id') {
      const identifier = String(payload.identifier || '').trim();
      if (!identifier) {
        return jsonRes({ success: false, error: 'Masukkan Username atau Email Owner.' }, 400);
      }

      const owner = await findOwnerByIdentifier(sb, identifier);
      if (!owner) {
        return jsonRes(
          { success: false, error: 'Akun Owner dengan username atau email tersebut tidak ditemukan.' },
          404
        );
      }

      const ownerEmail = getEffectiveOwnerEmail(owner);
      if (!ownerEmail) {
        return jsonRes(
          {
            success: false,
            error: 'Akun Owner ini belum memiliki alamat email terdaftar untuk menerima ID Outlet.',
          },
          400
        );
      }

      const { data: outlet } = await sb
        .from('outlets')
        .select('nama_usaha')
        .eq('outlet_id', owner.outlet_id)
        .maybeSingle();

      const namaUsaha = (outlet as { nama_usaha?: string } | null)?.nama_usaha || 'Usaha Anda';

      await sendBrevoEmail({
        toEmail: ownerEmail,
        toName: owner.nama,
        subject: `[Lembayung] Informasi ID Outlet Anda: ${owner.outlet_id}`,
        htmlContent: wrapEmailLayout(
          'Pengingat ID Outlet',
          `
          <p style="margin-top:0;">Halo <strong>${escapeHtml(owner.nama)}</strong>,</p>
          <p>Berikut adalah <strong>ID Outlet (Kode Toko)</strong> untuk usaha <strong>${escapeHtml(namaUsaha)}</strong>:</p>
          <div style="text-align:center; margin:20px 0;">
            <span style="display:inline-block; font-size:24px; font-weight:800; letter-spacing:3px; color:#1F7A5A; background:#e4f1ea; padding:12px 24px; border-radius:12px;">${escapeHtml(owner.outlet_id)}</span>
          </div>
          <p style="font-size:13px; color:#4a4947;">Masukkan kode ini pada kolom <strong>Kode Toko</strong> saat login dari perangkat baru.</p>
          `
        ),
      });

      return jsonRes({
        success: true,
        maskedEmail: maskEmail(ownerEmail),
        message: `Informasi ID Outlet telah dikirim ke email ${maskEmail(ownerEmail)}.`,
      });
    }

    // =========================================================================
    // 8. EMAIL OTOMATIS REKAP TUTUP KASIR KE OWNER
    // =========================================================================
    if (action === 'send_shift_close_email') {
      const outletId = String(payload.outletId || '').trim().toUpperCase();
      const shift = payload.shift as {
        kasirNama?: string;
        waktuBuka?: string;
        waktuTutup?: string;
        modalAwal?: number;
        pendapatanCash?: number;
        pendapatanQris?: number;
        pendapatanTransfer?: number;
        pengeluaranKasir?: number;
        expectedCash?: number;
        uangFisikAkhir?: number;
        selisih?: number;
        catatan?: string;
      } | null;

      if (!outletId || !shift) {
        return jsonRes({ success: false, error: 'outletId dan data shift wajib diisi.' }, 200);
      }

      const [{ data: ownerRows }, { data: outletRow }] = await Promise.all([
        sb
          .from('users')
          .select('outlet_id, id, nama, username, email, role, active')
          .eq('outlet_id', outletId)
          .eq('role', 'owner')
          .eq('active', true),
        sb.from('outlets').select('nama_usaha').eq('outlet_id', outletId).maybeSingle(),
      ]);

      const recipients = ((ownerRows as OwnerRow[] | null) || [])
        .map((o) => ({ nama: o.nama, email: getEffectiveOwnerEmail(o) }))
        .filter((r) => Boolean(r.email));

      if (recipients.length === 0) {
        return jsonRes(
          { success: false, error: 'Tidak ada alamat email Owner aktif untuk outlet ini.' },
          200
        );
      }

      const namaUsaha = (outletRow as { nama_usaha?: string } | null)?.nama_usaha || outletId;
      const selisih = Number(shift.selisih || 0);
      const selisihBadgeBg = selisih === 0 ? '#e4f1ea' : selisih > 0 ? '#fef3c7' : '#fbe4e1';
      const selisihBadgeColor = selisih === 0 ? '#14532d' : selisih > 0 ? '#92400e' : '#9b1c12';
      const selisihLabel =
        selisih === 0
          ? 'Pas (Rp0)'
          : `${selisih > 0 ? '+' : ''}${formatRp(selisih)} (${selisih > 0 ? 'Lebih' : 'Kurang'})`;
      const totalOmzetShift =
        Number(shift.pendapatanCash || 0) +
        Number(shift.pendapatanQris || 0) +
        Number(shift.pendapatanTransfer || 0);

      const htmlContent = wrapEmailLayout(
        `Rekap Tutup Kasir · ${namaUsaha}`,
        `
        <p style="margin-top:0;">Kasir <strong>${escapeHtml(shift.kasirNama || 'Kasir')}</strong> baru saja menyelesaikan <strong>Tutup Kasir</strong> di <strong>${escapeHtml(namaUsaha)}</strong>.</p>
        <div style="font-size:12px; color:#6b6a68; margin-bottom:14px;">
          Buka: ${escapeHtml(formatWibDateTime(shift.waktuBuka))}<br/>
          Tutup: ${escapeHtml(formatWibDateTime(shift.waktuTutup))}
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:13px; margin-bottom:14px;">
          <tr><td style="padding:6px 0; color:#4a4947;">Modal Awal Laci</td><td style="padding:6px 0; text-align:right; font-weight:600;">${formatRp(shift.modalAwal || 0)}</td></tr>
          <tr><td style="padding:6px 0; color:#4a4947;">Pendapatan Cash</td><td style="padding:6px 0; text-align:right; font-weight:600; color:#1F7A5A;">+ ${formatRp(shift.pendapatanCash || 0)}</td></tr>
          <tr><td style="padding:6px 0; color:#4a4947;">Pengeluaran Kasir</td><td style="padding:6px 0; text-align:right; font-weight:600; color:#9b1c12;">- ${formatRp(shift.pengeluaranKasir || 0)}</td></tr>
          <tr style="border-top:1px solid #e2e0d8;"><td style="padding:8px 0; font-weight:700;">Seharusnya di Laci</td><td style="padding:8px 0; text-align:right; font-weight:700;">${formatRp(shift.expectedCash || 0)}</td></tr>
          <tr><td style="padding:6px 0; font-weight:700;">Uang Fisik Dihitung</td><td style="padding:6px 0; text-align:right; font-weight:700;">${formatRp(shift.uangFisikAkhir || 0)}</td></tr>
        </table>
        <div style="background:${selisihBadgeBg}; color:${selisihBadgeColor}; border-radius:10px; padding:12px 14px; font-weight:700; text-align:center; margin-bottom:14px;">
          Selisih Kas: ${escapeHtml(selisihLabel)}
        </div>
        <div style="background:#faf9f5; border:1px solid #e2e0d8; border-radius:10px; padding:12px 14px; font-size:12px;">
          <div style="font-weight:700; margin-bottom:6px;">Ringkasan Pembayaran Shift</div>
          <div>Cash: <strong>${formatRp(shift.pendapatanCash || 0)}</strong> · QRIS: <strong>${formatRp(shift.pendapatanQris || 0)}</strong> · Transfer: <strong>${formatRp(shift.pendapatanTransfer || 0)}</strong></div>
          <div style="margin-top:4px;">Total Penjualan Shift: <strong>${formatRp(totalOmzetShift)}</strong></div>
          ${shift.catatan ? `<div style="margin-top:6px; color:#4a4947;">Catatan kasir: <em>${escapeHtml(shift.catatan)}</em></div>` : ''}
        </div>
        `
      );

      for (const r of recipients) {
        await sendBrevoEmail({
          toEmail: r.email,
          toName: r.nama,
          subject: `[Lembayung] Tutup Kasir ${shift.kasirNama || ''} (${selisihLabel}) — ${namaUsaha}`,
          htmlContent,
        });
      }

      return jsonRes({
        success: true,
        sentCount: recipients.length,
        message: `Rekap Tutup Kasir dikirim ke ${recipients.length} email Owner.`,
      });
    }

    // =========================================================================
    // 9. RINGKASAN HARIAN / BULANAN OTOMATIS KE EMAIL OWNER (MANUAL & PG_CRON)
    // =========================================================================
    if (action === 'send_periodic_summary') {
      const period = payload.period === 'monthly' ? 'monthly' : 'daily';
      const targetOutletId = payload.outletId ? String(payload.outletId).trim().toUpperCase() : '';
      const todayWib = getWibDateStr();
      const datePrefix =
        String(payload.dateStr || '').trim() ||
        (period === 'daily' ? todayWib : todayWib.slice(0, 7));

      // Ambil daftar outlet target (1 outlet jika manual, atau semua outlet aktif jika via cron)
      let ownerQuery = sb
        .from('users')
        .select('outlet_id, id, nama, username, email, role, active')
        .eq('role', 'owner')
        .eq('active', true);
      if (targetOutletId) {
        ownerQuery = ownerQuery.eq('outlet_id', targetOutletId);
      }
      const { data: allOwners } = await ownerQuery;
      const ownersByOutlet = new Map<string, Array<{ nama: string; email: string }>>();
      for (const o of (allOwners as OwnerRow[] | null) || []) {
        const em = getEffectiveOwnerEmail(o);
        if (!em) continue;
        const list = ownersByOutlet.get(o.outlet_id) || [];
        list.push({ nama: o.nama, email: em });
        ownersByOutlet.set(o.outlet_id, list);
      }

      if (ownersByOutlet.size === 0) {
        return jsonRes(
          { success: false, error: 'Tidak ada akun Owner ber-email yang aktif untuk dikirimi ringkasan.' },
          200
        );
      }

      let totalEmailsSent = 0;
      const periodTitle = period === 'daily' ? `Ringkasan Harian (${datePrefix})` : `Ringkasan Bulanan (${datePrefix})`;

      for (const [outletId, recipients] of ownersByOutlet.entries()) {
        const [outletRes, txRes, expRes, catRes, shiftRes] = await Promise.all([
          sb.from('outlets').select('nama_usaha').eq('outlet_id', outletId).maybeSingle(),
          sb.from('transactions').select('waktu, total, metode_bayar, status, items').eq('outlet_id', outletId),
          sb.from('expenses').select('tanggal, category_id, nominal, dibatalkan').eq('outlet_id', outletId),
          sb.from('expense_categories').select('id, sudah_masuk_hpp').eq('outlet_id', outletId),
          sb.from('cashier_shifts').select('waktu_buka, status, selisih').eq('outlet_id', outletId),
        ]);

        const namaUsaha = (outletRes.data as { nama_usaha?: string } | null)?.nama_usaha || outletId;
        const hppCatIds = new Set(
          ((catRes.data as Array<{ id: string; sudah_masuk_hpp: boolean }> | null) || [])
            .filter((c) => c.sudah_masuk_hpp)
            .map((c) => c.id)
        );

        let omzet = 0;
        let hppTerjual = 0;
        let trxCount = 0;
        let voidCount = 0;
        let cashTotal = 0;
        let qrisTotal = 0;
        let transferTotal = 0;

        for (const tx of (txRes.data as Array<{
          waktu: string;
          total: number;
          metode_bayar: string;
          status: string;
          items: Array<{ jumlah?: number; snapshotHpp?: number }>;
        }> | null) || []) {
          const txDateWib = getWibDateStr(new Date(tx.waktu));
          if (!txDateWib.startsWith(datePrefix)) continue;
          if (tx.status === 'void') {
            voidCount += 1;
            continue;
          }
          trxCount += 1;
          const t = Number(tx.total || 0);
          omzet += t;
          if (tx.metode_bayar === 'Cash') cashTotal += t;
          else if (tx.metode_bayar === 'QRIS') qrisTotal += t;
          else if (tx.metode_bayar === 'Transfer') transferTotal += t;
          for (const it of Array.isArray(tx.items) ? tx.items : []) {
            hppTerjual += Number(it.snapshotHpp || 0) * Number(it.jumlah || 0);
          }
        }

        let biayaOperasional = 0;
        let totalPengeluaran = 0;
        for (const exp of (expRes.data as Array<{
          tanggal: string;
          category_id: string;
          nominal: number;
          dibatalkan: boolean;
        }> | null) || []) {
          if (exp.dibatalkan) continue;
          if (!String(exp.tanggal || '').startsWith(datePrefix)) continue;
          const nom = Number(exp.nominal || 0);
          totalPengeluaran += nom;
          if (!hppCatIds.has(exp.category_id)) {
            biayaOperasional += nom;
          }
        }

        let shiftClosedCount = 0;
        let totalSelisihShift = 0;
        for (const sh of (shiftRes.data as Array<{
          waktu_buka: string;
          status: string;
          selisih: number | null;
        }> | null) || []) {
          const shDateWib = getWibDateStr(new Date(sh.waktu_buka));
          if (!shDateWib.startsWith(datePrefix)) continue;
          if (sh.status === 'closed') {
            shiftClosedCount += 1;
            totalSelisihShift += Number(sh.selisih || 0);
          }
        }

        const labaKotor = omzet - hppTerjual;
        const labaBersih = labaKotor - biayaOperasional;
        const labaColor = labaBersih >= 0 ? '#1F7A5A' : '#9b1c12';

        const htmlContent = wrapEmailLayout(
          `${periodTitle} · ${namaUsaha}`,
          `
          <p style="margin-top:0;">Berikut ringkasan performa <strong>${escapeHtml(namaUsaha)}</strong> (${escapeHtml(outletId)}) untuk periode <strong>${escapeHtml(datePrefix)}</strong>:</p>
          <div style="background:#faf9f5; border:1px solid #e2e0d8; border-radius:12px; padding:14px; margin-bottom:14px; text-align:center;">
            <div style="font-size:12px; color:#6b6a68;">Laba Bersih Estimasi</div>
            <div style="font-size:24px; font-weight:800; color:${labaColor}; margin-top:2px;">${formatRp(labaBersih)}</div>
            <div style="font-size:12px; color:#6b6a68; margin-top:4px;">${trxCount} transaksi selesai${voidCount > 0 ? ` · ${voidCount} void` : ''}</div>
          </div>
          <table style="width:100%; border-collapse:collapse; font-size:13px; margin-bottom:14px;">
            <tr><td style="padding:6px 0; color:#4a4947;">Total Omzet</td><td style="padding:6px 0; text-align:right; font-weight:700;">${formatRp(omzet)}</td></tr>
            <tr><td style="padding:6px 0; color:#4a4947;">HPP Terjual</td><td style="padding:6px 0; text-align:right; color:#6b6a68;">- ${formatRp(hppTerjual)}</td></tr>
            <tr><td style="padding:6px 0; color:#4a4947;">Laba Kotor</td><td style="padding:6px 0; text-align:right; font-weight:600;">${formatRp(labaKotor)}</td></tr>
            <tr><td style="padding:6px 0; color:#4a4947;">Biaya Operasional (di luar HPP)</td><td style="padding:6px 0; text-align:right; color:#9b1c12;">- ${formatRp(biayaOperasional)}</td></tr>
            <tr style="border-top:1px solid #e2e0d8;"><td style="padding:8px 0; color:#4a4947;">Total Semua Pengeluaran</td><td style="padding:8px 0; text-align:right; font-weight:600;">${formatRp(totalPengeluaran)}</td></tr>
          </table>
          <div style="background:#faf9f5; border:1px solid #e2e0d8; border-radius:10px; padding:12px 14px; font-size:12px;">
            <div style="font-weight:700; margin-bottom:6px;">Pembayaran &amp; Shift Kasir</div>
            <div>Cash: <strong>${formatRp(cashTotal)}</strong> · QRIS: <strong>${formatRp(qrisTotal)}</strong> · Transfer: <strong>${formatRp(transferTotal)}</strong></div>
            <div style="margin-top:4px;">Shift ditutup: <strong>${shiftClosedCount}</strong> · Total selisih laci: <strong>${totalSelisihShift === 0 ? 'Pas (Rp0)' : formatRp(totalSelisihShift)}</strong></div>
          </div>
          `
        );

        for (const r of recipients) {
          await sendBrevoEmail({
            toEmail: r.email,
            toName: r.nama,
            subject: `[Lembayung] ${periodTitle} — ${namaUsaha} (Omzet ${formatRp(omzet)})`,
            htmlContent,
          });
          totalEmailsSent += 1;
        }
      }

      return jsonRes({
        success: true,
        sentCount: totalEmailsSent,
        message: `${periodTitle} berhasil dikirim ke email Owner.`,
      });
    }

    // =========================================================================
    // 10. KIRIM PUSH NOTIFICATION ANDROID VIA FIREBASE CLOUD MESSAGING (FCM v1)
    // =========================================================================
    if (action === 'send_fcm_push') {
      const outletId = String(payload.outletId || '').trim().toUpperCase();
      const title = String(payload.title || 'Lembayung').trim();
      const body = String(payload.body || '').trim();
      const excludeToken = String(payload.excludeToken || '').trim();
      const targetRoles = Array.isArray(payload.targetRoles)
        ? payload.targetRoles.map((r: unknown) => String(r).toLowerCase())
        : null;

      if (!outletId || !body) {
        return jsonRes({ success: false, error: 'outletId dan body wajib diisi.' }, 200);
      }

      const rawSa = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') || '';
      if (!rawSa) {
        return jsonRes(
          { success: false, error: 'Secret FIREBASE_SERVICE_ACCOUNT_JSON belum disetel di Supabase.' },
          200
        );
      }

      const sa = JSON.parse(rawSa) as {
        project_id: string;
        client_email: string;
        private_key: string;
      };
      if (!sa.project_id || !sa.client_email || !sa.private_key) {
        return jsonRes({ success: false, error: 'Format FIREBASE_SERVICE_ACCOUNT_JSON tidak valid.' }, 200);
      }

      const { data: tokenRows } = await sb
        .from('device_push_tokens')
        .select('token, role')
        .eq('outlet_id', outletId);

      const tokens = ((tokenRows as Array<{ token: string; role: string }> | null) || [])
        .filter((r) => r.token && r.token !== excludeToken)
        .filter((r) => !targetRoles || targetRoles.includes((r.role || '').toLowerCase()))
        .map((r) => r.token);

      if (tokens.length === 0) {
        return jsonRes({ success: true, sentCount: 0, message: 'Tidak ada perangkat penerima.' });
      }

      const accessToken = await getFirebaseAccessToken(sa);
      const fcmUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

      let sentCount = 0;
      const deadTokens: string[] = [];

      await Promise.all(
        tokens.map(async (token) => {
          const resp = await fetch(fcmUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                token,
                notification: { title, body },
                android: {
                  priority: 'HIGH',
                  notification: {
                    channel_id: 'cuanin_transactions_channel',
                    sound: 'default',
                  },
                },
              },
            }),
          });
          if (resp.ok) {
            sentCount += 1;
          } else {
            const errBody = await resp.text().catch(() => '');
            if (errBody.includes('UNREGISTERED') || errBody.includes('NOT_FOUND')) {
              deadTokens.push(token);
            }
          }
        })
      );

      if (deadTokens.length > 0) {
        await sb
          .from('device_push_tokens')
          .delete()
          .eq('outlet_id', outletId)
          .in('token', deadTokens);
      }

      return jsonRes({ success: true, sentCount });
    }

    // =========================================================================
    // 10b. KIRIM EMAIL KREDENSIAL KARYAWAN (BARU / PROMOSI MANAGER / RESET SANDI)
    // =========================================================================
    if (action === 'send_employee_credentials') {
      const email = String(payload.email || '').trim().toLowerCase();
      const nama = String(payload.nama || 'Karyawan').trim();
      const role = String(payload.role || 'kasir').trim().toLowerCase();
      const username = String(payload.username || '').trim();
      const pin = String(payload.pin || '').trim();
      const password = String(payload.password || '').trim();
      const namaUsaha = String(payload.namaUsaha || 'Lembayung').trim();
      const namaCabang = String(payload.namaCabang || 'Pusat').trim();
      const outletId = String(payload.outletId || '').trim().toUpperCase();
      const backofficeUrl = String(payload.backofficeUrl || 'https://lembayung-so1.pages.dev').trim();
      const reason = String(payload.reason || 'new').trim();

      if (!email || !username || !pin) {
        return jsonRes({ success: false, error: 'Email, username, dan PIN wajib diisi.' }, 200);
      }

      const roleLabel = role === 'manager' ? 'Manager' : 'Kasir';
      const heading =
        reason === 'promoted_to_manager'
          ? 'Selamat! Jabatan Anda Kini Manager'
          : reason === 'password_reset'
          ? 'Kata Sandi Manager Diperbarui'
          : `Akun ${roleLabel} Anda Sudah Aktif`;

      const introText =
        reason === 'promoted_to_manager'
          ? `Halo <strong>${escapeHtml(nama)}</strong>, jabatan Anda di <strong>${escapeHtml(namaUsaha)} (${escapeHtml(namaCabang)})</strong> telah dinaikkan menjadi <strong>Manager</strong>. Berikut informasi akun dan akses Website Backoffice Anda:`
          : reason === 'password_reset'
          ? `Halo <strong>${escapeHtml(nama)}</strong>, kata sandi akun <strong>Manager</strong> Anda di <strong>${escapeHtml(namaUsaha)} (${escapeHtml(namaCabang)})</strong> telah di-reset oleh Owner. Gunakan kata sandi baru berikut untuk masuk:`
          : `Halo <strong>${escapeHtml(nama)}</strong>, Anda telah didaftarkan sebagai <strong>${roleLabel}</strong> di <strong>${escapeHtml(namaUsaha)} (${escapeHtml(namaCabang)})</strong>. Berikut informasi akun pribadi Anda (mohon jaga kerahasiaannya):`;

      const subject =
        reason === 'promoted_to_manager'
          ? `[Lembayung] Selamat! Akses Manager & Web Backoffice ${namaUsaha}`
          : reason === 'password_reset'
          ? `[Lembayung] Kata Sandi Baru Manager di ${namaUsaha}`
          : `[Lembayung] Akun ${roleLabel} Anda di ${namaUsaha} — Username & PIN`;

      const passwordRow =
        role === 'manager' && password
          ? `
            <tr>
              <td style="padding:8px 0;color:#6b6a68;font-size:13px;">Kata Sandi Web Backoffice</td>
              <td style="padding:8px 0;font-weight:700;font-family:monospace;font-size:14px;color:#1f1e1d;text-align:right;">${escapeHtml(password)}</td>
            </tr>
          `
          : '';

      const backofficeSection =
        role === 'manager'
          ? `
            <div style="margin:16px 0;text-align:center;">
              <a href="${escapeHtml(backofficeUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#1F7A5A;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 22px;border-radius:10px;">
                Buka Website Backoffice
              </a>
              <div style="margin-top:8px;font-size:11px;color:#6b6a68;">
                Atau buka link: <a href="${escapeHtml(backofficeUrl)}" style="color:#1F7A5A;font-weight:600;">${escapeHtml(backofficeUrl)}</a>
              </div>
            </div>
          `
          : '';

      const htmlContent = `
        <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#faf9f5;color:#1f1e1d;">
          <div style="background:#ffffff;border:1px solid #e2e0d8;border-radius:16px;padding:24px;">
            <div style="font-size:12px;font-weight:700;color:#1F7A5A;text-transform:uppercase;letter-spacing:0.06em;">Lembayung POS</div>
            <h2 style="margin:8px 0 6px;font-size:20px;color:#1f1e1d;">${heading}</h2>
            <p style="margin:0 0 18px;font-size:13px;color:#4a4947;line-height:1.5;">
              ${introText}
            </p>
            <div style="background:#f4f9f6;border:1px solid #c5dfd1;border-radius:12px;padding:14px 16px;margin-bottom:16px;">
              <table style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="padding:8px 0;color:#6b6a68;font-size:13px;">Kode Toko (ID Outlet)</td>
                  <td style="padding:8px 0;font-weight:700;font-family:monospace;font-size:14px;color:#1F7A5A;text-align:right;">${escapeHtml(outletId || '-')}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#6b6a68;font-size:13px;">Email Login</td>
                  <td style="padding:8px 0;font-weight:600;font-size:13px;color:#1f1e1d;text-align:right;">${escapeHtml(email)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#6b6a68;font-size:13px;">Username</td>
                  <td style="padding:8px 0;font-weight:700;font-family:monospace;font-size:14px;color:#1f1e1d;text-align:right;">${escapeHtml(username)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#6b6a68;font-size:13px;">PIN Pribadi (6 Angka)</td>
                  <td style="padding:8px 0;font-weight:800;font-family:monospace;font-size:18px;letter-spacing:0.2em;color:#1F7A5A;text-align:right;">${escapeHtml(pin)}</td>
                </tr>
                ${passwordRow}
              </table>
            </div>
            ${backofficeSection}
            <p style="margin:0;font-size:12px;color:#6b6a68;line-height:1.5;">
              ${
                role === 'manager'
                  ? 'Gunakan Email & Kata Sandi di atas untuk masuk ke Website Backoffice atau konfirmasi login Manager di aplikasi. PIN pribadi tetap digunakan untuk absen & akses aplikasi.'
                  : 'Gunakan PIN 6 angka di atas untuk Absen Masuk/Pulang dan Buka Kasir pada perangkat kasir toko.'
              }
            </p>
          </div>
        </div>
      `;

      await sendBrevoEmail({
        toEmail: email,
        toName: nama,
        subject,
        htmlContent,
      });

      return jsonRes({
        success: true,
        message: `Informasi akun berhasil dikirim ke email ${email}.`,
      });
    }

    // =========================================================================
    // 10c. KIRIM EMAIL PEMBUATAN CABANG BARU KE OWNER (ID OUTLET + PIN OTORISASI)
    // =========================================================================
    if (action === 'send_new_branch_email') {
      const email = String(payload.email || '').trim().toLowerCase();
      const namaOwner = String(payload.namaOwner || 'Owner').trim();
      const namaUsaha = String(payload.namaUsaha || 'Lembayung').trim();
      const namaCabang = String(payload.namaCabang || 'Cabang Baru').trim();
      const alamatCabang = String(payload.alamatCabang || '-').trim();
      const outletId = String(payload.outletId || '').trim().toUpperCase();
      const kasirAuthPin = String(payload.kasirAuthPin || '').trim();
      const backofficeUrl = String(payload.backofficeUrl || 'https://lembayung-so1.pages.dev').trim();

      if (!email || !outletId) {
        return jsonRes({ success: false, error: 'Email Owner dan ID Outlet cabang wajib diisi.' }, 200);
      }

      await sendBrevoEmail({
        toEmail: email,
        toName: namaOwner,
        subject: `[Lembayung] Cabang Baru Aktif: ${namaUsaha} — ${namaCabang} (${outletId})`,
        htmlContent: wrapEmailLayout(
          'Cabang Baru Berhasil Dibuat',
          `
          <p style="margin-top:0;">Halo <strong>${escapeHtml(namaOwner)}</strong>,</p>
          <p>Cabang baru <strong>${escapeHtml(namaCabang)}</strong> untuk usaha <strong>${escapeHtml(namaUsaha)}</strong> telah berhasil dibuat. Simpan informasi akses perangkat kasir cabang ini:</p>
          <div style="background:#faf9f5; border:1px solid #e2e0d8; border-radius:12px; padding:16px; margin:16px 0;">
            <div style="font-size:12px; color:#6b6a68;">Nama Cabang</div>
            <div style="font-size:15px; font-weight:700; color:#1f1e1d; margin-bottom:6px;">${escapeHtml(namaCabang)}</div>
            <div style="font-size:12px; color:#6b6a68;">Alamat</div>
            <div style="font-size:13px; color:#4a4947; margin-bottom:10px;">${escapeHtml(alamatCabang)}</div>
            <div style="padding-top:10px; border-top:1px dashed #d6d3c8;">
              <div style="font-size:12px; color:#6b6a68;">ID Outlet Cabang (Kode Toko)</div>
              <div style="font-size:22px; font-weight:800; color:#1F7A5A; letter-spacing:2px; margin:2px 0 10px;">${escapeHtml(outletId)}</div>
              <div style="font-size:12px; color:#6b6a68;">PIN Otorisasi Mode Kasir (6 Angka)</div>
              <div style="font-size:22px; font-weight:800; color:#1F7A5A; letter-spacing:4px; margin:4px 0;">${escapeHtml(kasirAuthPin || '-')}</div>
              <div style="font-size:11px; color:#6b6a68;">Berlaku khusus untuk cabang ini (<strong>${escapeHtml(outletId)}</strong>). Digunakan untuk masuk Mode Kasir &amp; menghapus pesanan tersimpan (Open Bill). Dapat dilihat atau di-reset kapan saja melalui menu <strong>Pengaturan</strong>.</div>
            </div>
          </div>
          <div style="margin:16px 0; text-align:center;">
            <a href="${escapeHtml(backofficeUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block; background:#1F7A5A; color:#ffffff; text-decoration:none; font-weight:700; font-size:13px; padding:11px 22px; border-radius:10px;">
              Kelola di Website Backoffice
            </a>
          </div>
          <p style="font-size:12px; color:#6b6a68; margin-bottom:0;">Gunakan <strong>ID Outlet Cabang</strong> di atas saat menghubungkan tablet atau HP kasir di lokasi cabang baru Anda.</p>
          `
        ),
      });

      return jsonRes({
        success: true,
        message: `Informasi cabang baru berhasil dikirim ke email ${email}.`,
      });
    }

    // =========================================================================
    // 11. PLATFORM ADMINISTRATOR APIs (MULTI-ADMIN, SERVER-VERIFIED HMAC)
    // =========================================================================
    const ADMIN_STORE_ROW_ID = 'platform_admins';

    interface PlatformAdminRecord {
      id: string;
      nama: string;
      email: string;
      passwordHash: string;
      role: 'super_admin' | 'ops_support' | 'finance';
      active: boolean;
      createdAt: string;
      lastLoginAt?: string;
    }

    async function sha256Hex(text: string): Promise<string> {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }

    async function signAdminToken(admin: PlatformAdminRecord): Promise<string> {
      const exp = Date.now() + 24 * 60 * 60 * 1000;
      const bodyObj = { id: admin.id, email: admin.email, role: admin.role, nama: admin.nama, exp };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(bodyObj))));
      const sig = await sha256Hex(`${encoded}.${serviceRoleKey}`);
      return `${encoded}.${sig}`;
    }

    async function verifyAdminToken(token: string): Promise<PlatformAdminRecord | null> {
      if (!token || !token.includes('.')) return null;
      const [encoded, sig] = token.split('.');
      if (!encoded || !sig) return null;
      const expected = await sha256Hex(`${encoded}.${serviceRoleKey}`);
      if (sig !== expected) return null;
      try {
        const parsed = JSON.parse(decodeURIComponent(escape(atob(encoded)))) as {
          id: string;
          email: string;
          exp: number;
        };
        if (!parsed.exp || Date.now() > parsed.exp) return null;
        const admins = await loadPlatformAdmins();
        const found = admins.find(
          (a) => a.id === parsed.id && a.email.toLowerCase() === parsed.email.toLowerCase() && a.active
        );
        return found || null;
      } catch {
        return null;
      }
    }

    async function loadPlatformAdmins(): Promise<PlatformAdminRecord[]> {
      const { data } = await sb
        .from('app_versions')
        .select('release_notes')
        .eq('id', ADMIN_STORE_ROW_ID)
        .maybeSingle();
      const raw = (data as { release_notes?: string } | null)?.release_notes;
      if (!raw) return [];
      try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? (arr as PlatformAdminRecord[]) : [];
      } catch {
        return [];
      }
    }

    async function savePlatformAdmins(admins: PlatformAdminRecord[]): Promise<void> {
      await sb.from('app_versions').upsert(
        {
          id: ADMIN_STORE_ROW_ID,
          latest_version: '1.0.0',
          min_required_version: '1.0.0',
          release_notes: JSON.stringify(admins),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
    }

    // 11a. Cek apakah Super Admin pertama sudah dibuat
    if (action === 'admin_bootstrap_status') {
      const admins = await loadPlatformAdmins();
      return jsonRes({ success: true, needsBootstrap: admins.length === 0, adminCount: admins.length });
    }

    // 11b. Kirim OTP untuk setup Super Admin pertama (hanya jalan jika belum ada admin sama sekali)
    if (action === 'admin_bootstrap_send_otp') {
      const admins = await loadPlatformAdmins();
      if (admins.length > 0) {
        return jsonRes({ success: false, error: 'Super Admin sudah terdaftar. Silakan login.' }, 200);
      }
      const email = String(payload.email || '').trim().toLowerCase();
      const nama = String(payload.nama || 'Super Admin').trim();
      if (!email || !email.includes('@')) {
        return jsonRes({ success: false, error: 'Email Super Admin tidak valid.' }, 200);
      }
      const otp = generateOtp6();
      const otpHash = await hashOtp(otp, email);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await sb.from('email_verifications').insert({
        email,
        purpose: 'admin_bootstrap',
        otp_hash: otpHash,
        expires_at: expiresAt,
      });
      await sendBrevoEmail({
        toEmail: email,
        toName: nama,
        subject: `[Lembayung Admin] Kode Verifikasi Setup Super Admin: ${otp}`,
        htmlContent: wrapEmailLayout(
          'Aktivasi Super Admin Lembayung',
          `<p>Halo <strong>${escapeHtml(nama)}</strong>,</p>
           <p>Gunakan kode OTP berikut untuk mengaktifkan akun <strong>Super Admin</strong> pertama pada Dashboard Administrator Lembayung:</p>
           <div style="font-size:28px;font-weight:800;letter-spacing:6px;color:#1F7A5A;background:#f4f9f6;border:1px solid #c5dfd1;border-radius:12px;padding:14px;text-align:center;margin:16px 0;">${otp}</div>
           <p style="font-size:12px;color:#6b6a68;">Berlaku selama 10 menit. Abaikan email ini jika Anda tidak merasa melakukan aktivasi.</p>`
        ),
      });
      return jsonRes({ success: true, message: `Kode OTP aktivasi Super Admin dikirim ke ${email}.` });
    }

    // 11c. Verifikasi OTP & buat Super Admin pertama
    if (action === 'admin_bootstrap_confirm') {
      const admins = await loadPlatformAdmins();
      if (admins.length > 0) {
        return jsonRes({ success: false, error: 'Super Admin sudah terdaftar. Silakan login.' }, 200);
      }
      const email = String(payload.email || '').trim().toLowerCase();
      const nama = String(payload.nama || 'Super Admin').trim();
      const password = String(payload.password || '');
      const otp = String(payload.otp || '').trim();
      if (!email || !password || password.length < 8 || !/^\d{6}$/.test(otp)) {
        return jsonRes({ success: false, error: 'Lengkapi email, kata sandi minimal 8 karakter, dan OTP 6 digit.' }, 200);
      }
      const otpHash = await hashOtp(otp, email);
      const { data: rows } = await sb
        .from('email_verifications')
        .select('*')
        .eq('email', email)
        .eq('purpose', 'admin_bootstrap')
        .eq('otp_hash', otpHash)
        .is('used_at', null)
        .order('created_at', { ascending: false })
        .limit(1);
      const rec = Array.isArray(rows) ? rows[0] : null;
      if (!rec || new Date(rec.expires_at).getTime() < Date.now()) {
        return jsonRes({ success: false, error: 'Kode OTP salah atau sudah kedaluwarsa.' }, 200);
      }
      await sb.from('email_verifications').update({ used_at: new Date().toISOString() }).eq('id', rec.id);

      const nowIso = new Date().toISOString();
      const newAdmin: PlatformAdminRecord = {
        id: crypto.randomUUID(),
        nama,
        email,
        passwordHash: await sha256Hex(`lm_admin_v1:${email}:${password}`),
        role: 'super_admin',
        active: true,
        createdAt: nowIso,
        lastLoginAt: nowIso,
      };
      await savePlatformAdmins([newAdmin]);
      const token = await signAdminToken(newAdmin);
      return jsonRes({
        success: true,
        token,
        admin: { id: newAdmin.id, nama: newAdmin.nama, email: newAdmin.email, role: newAdmin.role },
      });
    }

    // 11d. Login Administrator
    if (action === 'admin_login') {
      const email = String(payload.email || '').trim().toLowerCase();
      const password = String(payload.password || '');
      if (!email || !password) {
        return jsonRes({ success: false, error: 'Email dan kata sandi wajib diisi.' }, 200);
      }
      const admins = await loadPlatformAdmins();
      const target = admins.find((a) => a.email.toLowerCase() === email);
      if (!target) {
        return jsonRes({ success: false, error: 'Akun Administrator tidak ditemukan.' }, 200);
      }
      if (!target.active) {
        return jsonRes({ success: false, error: 'Akun Administrator ini sedang non-aktif.' }, 200);
      }
      const hash = await sha256Hex(`lm_admin_v1:${email}:${password}`);
      if (hash !== target.passwordHash) {
        return jsonRes({ success: false, error: 'Kata sandi salah.' }, 200);
      }
      target.lastLoginAt = new Date().toISOString();
      await savePlatformAdmins(admins);
      const token = await signAdminToken(target);
      return jsonRes({
        success: true,
        token,
        admin: { id: target.id, nama: target.nama, email: target.email, role: target.role },
      });
    }

    // 11e. Dashboard Overview + Daftar Merchant, Versi Aplikasi, & Statistik DB
    if (action === 'admin_dashboard_overview') {
      const caller = await verifyAdminToken(String(payload.adminToken || ''));
      if (!caller) return jsonRes({ success: false, error: 'Sesi admin tidak valid atau kedaluwarsa.' }, 401);

      const [
        outletsRes,
        usersRes,
        menusRes,
        txRes,
        shiftsRes,
        tokensRes,
        verRes,
        expRes,
      ] = await Promise.all([
        sb.from('outlets').select('outlet_id, nama_usaha, nama_cabang, parent_outlet_id, owner_email, alamat_usaha, telepon_usaha, work_shifts, updated_at'),
        sb.from('users').select('outlet_id, id, nama, role, active'),
        sb.from('menus').select('outlet_id, id'),
        sb.from('transactions').select('outlet_id, id, nomor_struk, waktu, total, status, metode_bayar, kasir_nama').order('waktu', { ascending: false }).limit(2000),
        sb.from('cashier_shifts').select('outlet_id, status, kasir_nama, waktu_buka').eq('status', 'open'),
        sb.from('device_push_tokens').select('outlet_id, role, platform, updated_at'),
        sb.from('app_versions').select('*').eq('id', 'android').maybeSingle(),
        sb.from('expenses').select('outlet_id, id', { count: 'exact', head: true }),
      ]);

      const outlets = (outletsRes.data as Array<Record<string, any>>) || [];
      const users = (usersRes.data as Array<Record<string, any>>) || [];
      const menus = (menusRes.data as Array<Record<string, any>>) || [];
      const txs = (txRes.data as Array<Record<string, any>>) || [];
      const openShifts = (shiftsRes.data as Array<Record<string, any>>) || [];
      const tokens = (tokensRes.data as Array<Record<string, any>>) || [];

      const menuCountMap = new Map<string, number>();
      for (const m of menus) {
        const oid = String(m.outlet_id || '').toUpperCase();
        menuCountMap.set(oid, (menuCountMap.get(oid) || 0) + 1);
      }
      const userCountMap = new Map<string, number>();
      for (const u of users) {
        const oid = String(u.outlet_id || '').toUpperCase();
        userCountMap.set(oid, (userCountMap.get(oid) || 0) + 1);
      }
      const tokenCountMap = new Map<string, number>();
      for (const tk of tokens) {
        const oid = String(tk.outlet_id || '').toUpperCase();
        tokenCountMap.set(oid, (tokenCountMap.get(oid) || 0) + 1);
      }
      const openShiftSet = new Set(openShifts.map((s) => String(s.outlet_id || '').toUpperCase()));
      const txStatsMap = new Map<string, { count: number; omzet: number; lastTxAt?: string }>();
      let platformOmzet = 0;
      let platformTxCount = 0;
      for (const t of txs) {
        if (t.status === 'void') continue;
        const oid = String(t.outlet_id || '').toUpperCase();
        const val = Number(t.total || 0);
        platformOmzet += val;
        platformTxCount += 1;
        const prev = txStatsMap.get(oid) || { count: 0, omzet: 0, lastTxAt: t.waktu };
        prev.count += 1;
        prev.omzet += val;
        if (!prev.lastTxAt || (t.waktu && t.waktu > prev.lastTxAt)) prev.lastTxAt = t.waktu;
        txStatsMap.set(oid, prev);
      }

      const merchantRows = outlets.map((o) => {
        const oid = String(o.outlet_id || '').toUpperCase();
        const rawShifts = Array.isArray(o.work_shifts) ? o.work_shifts : [];
        const cfg = (rawShifts[0] as Record<string, any> | undefined)?.storeHoursConfig as
          | { branchActive?: boolean; storeManualOverride?: string; autoStoreHoursEnabled?: boolean }
          | undefined;
        const isActive = cfg?.branchActive !== false;
        const isPusat = !o.parent_outlet_id || String(o.parent_outlet_id).toUpperCase() === oid;
        const isStoreOpen =
          isActive &&
          (openShiftSet.has(oid) || cfg?.storeManualOverride === 'force_open');
        const st = txStatsMap.get(oid) || { count: 0, omzet: 0 };
        return {
          outletId: oid,
          namaUsaha: o.nama_usaha || '-',
          namaCabang: o.nama_cabang || 'Pusat',
          parentOutletId: o.parent_outlet_id || null,
          isPusat,
          ownerEmail: o.owner_email || '-',
          alamatUsaha: o.alamat_usaha || '-',
          teleponUsaha: o.telepon_usaha || '',
          isActive,
          isStoreOpen,
          menuCount: menuCountMap.get(oid) || 0,
          userCount: userCountMap.get(oid) || 0,
          deviceCount: tokenCountMap.get(oid) || 0,
          txCount: st.count,
          omzet: st.omzet,
          lastTxAt: st.lastTxAt || null,
          updatedAt: o.updated_at || null,
        };
      });

      const admins = await loadPlatformAdmins();

      return jsonRes({
        success: true,
        summary: {
          totalMerchants: merchantRows.filter((m) => m.isPusat).length,
          totalOutlets: merchantRows.length,
          activeOutlets: merchantRows.filter((m) => m.isActive).length,
          openOutlets: merchantRows.filter((m) => m.isStoreOpen).length,
          totalUsers: users.length,
          totalMenus: menus.length,
          totalDevices: tokens.length,
          totalTransactions: platformTxCount,
          totalOmzet: platformOmzet,
          totalExpenses: expRes.count || 0,
        },
        merchants: merchantRows,
        recentTransactions: txs.slice(0, 25),
        appVersion: verRes.data || null,
        admins: admins.map((a) => ({
          id: a.id,
          nama: a.nama,
          email: a.email,
          role: a.role,
          active: a.active,
          createdAt: a.createdAt,
          lastLoginAt: a.lastLoginAt || null,
        })),
      });
    }

    // 11f. Non-aktifkan / Aktifkan Outlet (super_admin & ops_support)
    if (action === 'admin_toggle_outlet_active') {
      const caller = await verifyAdminToken(String(payload.adminToken || ''));
      if (!caller) return jsonRes({ success: false, error: 'Sesi admin tidak valid.' }, 401);
      if (caller.role === 'finance') {
        return jsonRes({ success: false, error: 'Role Finance tidak memiliki izin mengubah status merchant.' }, 200);
      }
      const outletId = String(payload.outletId || '').trim().toUpperCase();
      const active = Boolean(payload.active);
      const { data: row } = await sb.from('outlets').select('work_shifts').eq('outlet_id', outletId).maybeSingle();
      if (!row) return jsonRes({ success: false, error: 'Outlet tidak ditemukan.' }, 200);

      const rawShifts = Array.isArray((row as Record<string, any>).work_shifts) && (row as Record<string, any>).work_shifts.length > 0
        ? (row as Record<string, any>).work_shifts.map((s: Record<string, any>) => ({ ...s }))
        : [{ id: 'shift-pagi', nama: 'Shift Pagi', jamMasuk: '08:00', jamPulang: '16:00' }];
      const prevCfg = (rawShifts[0]?.storeHoursConfig as Record<string, any>) || {};
      rawShifts[0].storeHoursConfig = {
        ...prevCfg,
        branchActive: active,
        storeManualOverride: active ? 'auto' : 'force_closed',
      };
      const nowIso = new Date().toISOString();
      await sb.from('outlets').update({ work_shifts: rawShifts, updated_at: nowIso }).eq('outlet_id', outletId);
      if (!active) {
        await sb
          .from('cashier_shifts')
          .update({ status: 'closed', waktu_tutup: nowIso, catatan: `Dinonaktifkan oleh Admin (${caller.nama})` })
          .eq('outlet_id', outletId)
          .eq('status', 'open');
      }
      return jsonRes({ success: true });
    }

    // 11g. Hapus Outlet Permanen (Khusus super_admin + wajib status Non-Aktif + verifikasi kata sandi Admin)
    if (action === 'admin_delete_outlet') {
      const caller = await verifyAdminToken(String(payload.adminToken || ''));
      if (!caller) return jsonRes({ success: false, error: 'Sesi admin tidak valid.' }, 401);
      if (caller.role !== 'super_admin') {
        return jsonRes({ success: false, error: 'Hanya Super Admin yang dapat menghapus outlet permanen.' }, 200);
      }
      const outletId = String(payload.outletId || '').trim().toUpperCase();
      const adminPassword = String(payload.adminPassword || '');
      const checkHash = await sha256Hex(`lm_admin_v1:${caller.email.toLowerCase()}:${adminPassword}`);
      if (checkHash !== caller.passwordHash) {
        return jsonRes({ success: false, error: 'Kata sandi Super Admin salah.' }, 200);
      }
      const { data: row } = await sb.from('outlets').select('work_shifts').eq('outlet_id', outletId).maybeSingle();
      if (!row) return jsonRes({ success: false, error: 'Outlet tidak ditemukan.' }, 200);
      const rawShifts = Array.isArray((row as Record<string, any>).work_shifts) ? (row as Record<string, any>).work_shifts : [];
      const cfg = (rawShifts[0] as Record<string, any> | undefined)?.storeHoursConfig as { branchActive?: boolean } | undefined;
      if (cfg?.branchActive !== false) {
        return jsonRes({ success: false, error: 'Outlet harus berstatus Non-Aktif terlebih dahulu sebelum dihapus.' }, 200);
      }
      const childTables = [
        'transactions', 'saved_orders', 'expenses', 'menu_hpp_history', 'menus',
        'recipes', 'purchases', 'ingredients', 'expense_categories', 'monthly_targets',
        'cashier_shifts', 'attendances', 'device_push_tokens', 'users', 'outlets',
      ];
      for (const tbl of childTables) {
        await sb.from(tbl).delete().eq('outlet_id', outletId);
      }
      return jsonRes({ success: true });
    }

    // 11h. Broadcast Push Notification (FCM) ke Semua Perangkat atau Outlet Tertentu
    if (action === 'admin_broadcast_push') {
      const caller = await verifyAdminToken(String(payload.adminToken || ''));
      if (!caller) return jsonRes({ success: false, error: 'Sesi admin tidak valid.' }, 401);
      if (caller.role === 'finance') {
        return jsonRes({ success: false, error: 'Role Finance tidak memiliki izin mengirim broadcast.' }, 200);
      }
      const targetOutletId = String(payload.targetOutletId || 'ALL').trim().toUpperCase();
      const title = String(payload.title || 'Pengumuman Lembayung').trim();
      const body = String(payload.body || '').trim();
      if (!body) return jsonRes({ success: false, error: 'Isi pesan notifikasi wajib diisi.' }, 200);

      const rawSa = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') || '';
      if (!rawSa) return jsonRes({ success: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON belum disetel.' }, 200);
      const sa = JSON.parse(rawSa) as { project_id: string; client_email: string; private_key: string };

      let q = sb.from('device_push_tokens').select('token, outlet_id');
      if (targetOutletId && targetOutletId !== 'ALL') {
        q = q.eq('outlet_id', targetOutletId);
      }
      const { data: rows } = await q;
      const uniqueTokens = Array.from(new Set(((rows as Array<{ token: string }> | null) || []).map((r) => r.token).filter(Boolean)));
      if (uniqueTokens.length === 0) {
        return jsonRes({ success: true, sentCount: 0, message: 'Tidak ada perangkat terdaftar pada target tersebut.' });
      }
      const accessToken = await getFirebaseAccessToken(sa);
      const fcmUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
      let sentCount = 0;
      await Promise.all(
        uniqueTokens.map(async (token) => {
          const resp = await fetch(fcmUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: {
                token,
                notification: { title, body },
                android: { priority: 'HIGH', notification: { channel_id: 'cuanin_transactions_channel', sound: 'default' } },
              },
            }),
          });
          if (resp.ok) sentCount += 1;
        })
      );
      return jsonRes({ success: true, sentCount, totalTargets: uniqueTokens.length });
    }

    // 11i. Update Info Versi Aplikasi (Khusus super_admin)
    if (action === 'admin_update_app_version') {
      const caller = await verifyAdminToken(String(payload.adminToken || ''));
      if (!caller || caller.role !== 'super_admin') {
        return jsonRes({ success: false, error: 'Hanya Super Admin yang dapat mengubah konfigurasi versi aplikasi.' }, 200);
      }
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (payload.minRequiredVersion) patch.min_required_version = String(payload.minRequiredVersion).trim();
      if (payload.releaseNotes !== undefined) patch.release_notes = String(payload.releaseNotes).trim();
      if (payload.apkDownloadUrl !== undefined) patch.apk_download_url = String(payload.apkDownloadUrl).trim() || null;
      const { error } = await sb.from('app_versions').update(patch).eq('id', 'android');
      if (error) return jsonRes({ success: false, error: error.message }, 200);
      return jsonRes({ success: true });
    }

    // 11j. Kelola Tim Administrator (Tambah / Non-Aktifkan / Hapus — Khusus super_admin)
    if (action === 'admin_manage_admins') {
      const caller = await verifyAdminToken(String(payload.adminToken || ''));
      if (!caller || caller.role !== 'super_admin') {
        return jsonRes({ success: false, error: 'Hanya Super Admin yang dapat mengelola tim Administrator.' }, 200);
      }
      const op = String(payload.op || '');
      const admins = await loadPlatformAdmins();

      if (op === 'create') {
        const nama = String(payload.nama || '').trim();
        const email = String(payload.email || '').trim().toLowerCase();
        const password = String(payload.password || '');
        const role = (['super_admin', 'ops_support', 'finance'].includes(String(payload.role))
          ? String(payload.role)
          : 'ops_support') as PlatformAdminRecord['role'];
        if (!nama || !email.includes('@') || password.length < 8) {
          return jsonRes({ success: false, error: 'Nama, email valid, dan kata sandi min. 8 karakter wajib diisi.' }, 200);
        }
        if (admins.some((a) => a.email.toLowerCase() === email)) {
          return jsonRes({ success: false, error: 'Email admin ini sudah terdaftar.' }, 200);
        }
        const newAdm: PlatformAdminRecord = {
          id: crypto.randomUUID(),
          nama,
          email,
          passwordHash: await sha256Hex(`lm_admin_v1:${email}:${password}`),
          role,
          active: true,
          createdAt: new Date().toISOString(),
        };
        admins.push(newAdm);
        await savePlatformAdmins(admins);
        // Kirim email undangan admin
        const portalUrl = String(payload.portalUrl || 'https://lembayung-so1.pages.dev/?admin=1');
        await sendBrevoEmail({
          toEmail: email,
          toName: nama,
          subject: `[Lembayung Admin] Akun Administrator Anda Aktif (${role})`,
          htmlContent: wrapEmailLayout(
            'Akses Dashboard Administrator Lembayung',
            `<p>Halo <strong>${escapeHtml(nama)}</strong>, Anda telah ditambahkan sebagai <strong>${escapeHtml(role)}</strong> oleh ${escapeHtml(caller.nama)}.</p>
             <div style="background:#faf9f5;border:1px solid #e2e0d8;border-radius:12px;padding:14px;margin:14px 0;">
               <div><strong>Email:</strong> ${escapeHtml(email)}</div>
               <div><strong>Kata Sandi:</strong> <code>${escapeHtml(password)}</code></div>
               <div><strong>Portal Admin:</strong> <a href="${escapeHtml(portalUrl)}">${escapeHtml(portalUrl)}</a></div>
             </div>`
          ),
        }).catch(() => {});
        return jsonRes({ success: true });
      }

      if (op === 'toggle_active') {
        const targetId = String(payload.targetAdminId || '');
        if (targetId === caller.id) {
          return jsonRes({ success: false, error: 'Tidak dapat menonaktifkan akun Anda sendiri.' }, 200);
        }
        const target = admins.find((a) => a.id === targetId);
        if (!target) return jsonRes({ success: false, error: 'Admin tidak ditemukan.' }, 200);
        target.active = Boolean(payload.active);
        await savePlatformAdmins(admins);
        return jsonRes({ success: true });
      }

      if (op === 'delete') {
        const targetId = String(payload.targetAdminId || '');
        if (targetId === caller.id) {
          return jsonRes({ success: false, error: 'Tidak dapat menghapus akun Anda sendiri.' }, 200);
        }
        const target = admins.find((a) => a.id === targetId);
        if (!target) return jsonRes({ success: false, error: 'Admin tidak ditemukan.' }, 200);
        if (target.active) {
          return jsonRes({ success: false, error: 'Non-aktifkan akun admin terlebih dahulu sebelum dihapus.' }, 200);
        }
        await savePlatformAdmins(admins.filter((a) => a.id !== targetId));
        return jsonRes({ success: true });
      }

      return jsonRes({ success: false, error: 'Operasi admin tidak dikenali.' }, 200);
    }

    return jsonRes({ success: false, error: `Aksi "${action}" tidak dikenali.` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Terjadi kesalahan pada server email.';
    return jsonRes({ success: false, error: msg }, 500);
  }
});

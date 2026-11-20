// Supabase Edge Function: cuanin-auth-email
// Mengirim email verifikasi OTP, ID Outlet, Lupa Username, Lupa ID Outlet, dan Reset Password khusus Owner
// Menggunakan Brevo Transactional Email API (https://api.brevo.com/v3/smtp/email)
//
// Secrets yang perlu diset di Supabase:
//   BREVO_API_KEY       = xkeysib-...
//   BREVO_SENDER_EMAIL  = email-pengirim-terverifikasi-di-brevo@gmail.com
//   BREVO_SENDER_NAME   = Cuanin POS

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

  const { data, error } = await sb
    .from('users')
    .select('username, email');

  if (error || !Array.isArray(data)) return null;

  const rows = data as Array<{ username: string | null; email: string | null }>;
  const usernameTaken = Boolean(
    cleanUser &&
      rows.some((r) => (r.username || '').trim().toLowerCase() === cleanUser)
  );
  const emailTaken = Boolean(
    cleanEmail &&
      rows.some((r) => {
        const rowEmail = (r.email || '').trim().toLowerCase();
        const rowUser = (r.username || '').trim().toLowerCase();
        return rowEmail === cleanEmail || rowUser === cleanEmail;
      })
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

      // Langsung kirim email ID Outlet di dalam request verifikasi yang sama agar pasti terkirim!
      let welcomeEmailSent = false;
      if (outletId) {
        try {
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
    // 3. KIRIM EMAIL SELAMAT DATANG + INFORMASI ID OUTLET
    // =========================================================================
    if (action === 'send_welcome_outlet') {
      const email = String(payload.email || '').trim().toLowerCase();
      const namaOwner = String(payload.namaOwner || '').trim();
      const namaUsaha = String(payload.namaUsaha || '').trim();
      const username = String(payload.username || '').trim();
      const outletId = String(payload.outletId || '').trim().toUpperCase();

      if (!email || !outletId) {
        return jsonRes({ success: false, error: 'Email dan ID Outlet wajib diisi.' }, 400);
      }

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

    return jsonRes({ success: false, error: `Aksi "${action}" tidak dikenali.` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Terjadi kesalahan pada server email.';
    return jsonRes({ success: false, error: msg }, 500);
  }
});

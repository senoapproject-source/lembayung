/**
 * Validasi Keamanan PIN & Kata Sandi Cuanin:
 * - PIN: wajib tepat 6 digit angka (contoh: 123456)
 * - Kata Sandi: wajib minimal 8 karakter dengan perpaduan
 *   huruf besar, huruf kecil, angka, dan simbol (contoh: aBcd3fgh!)
 */

export function validatePin(pin: string): string | null {
  const clean = pin.trim();
  if (!/^\d{6}$/.test(clean)) {
    return 'PIN wajib tepat 6 angka (contoh: 123456).';
  }
  return null;
}

export function validateEmail(email: string): string | null {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
    return 'Format email tidak valid (contoh: nama@gmail.com).';
  }
  return null;
}

export function validateOwnerUsername(username: string): string | null {
  const clean = username.trim();
  if (clean.length < 3 || clean.length > 30) {
    return 'Username wajib 3–30 karakter.';
  }
  if (clean.includes('@')) {
    return 'Username dipisah dari email (jangan gunakan karakter "@").';
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(clean)) {
    return 'Username hanya boleh berisi huruf, angka, titik (.), garis bawah (_), atau tanda hubung (-).';
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return 'Kata sandi minimal 8 karakter (contoh: aBcd3fgh!).';
  }
  if (!/[a-z]/.test(password)) {
    return 'Kata sandi wajib mengandung huruf kecil (a-z), contoh: aBcd3fgh!';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Kata sandi wajib mengandung huruf besar (A-Z), contoh: aBcd3fgh!';
  }
  if (!/\d/.test(password)) {
    return 'Kata sandi wajib mengandung angka (0-9), contoh: aBcd3fgh!';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Kata sandi wajib mengandung simbol (misal !@#$%^&*), contoh: aBcd3fgh!';
  }
  return null;
}

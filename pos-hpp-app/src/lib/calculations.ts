import type {
  Ingredient,
  Purchase,
  Recipe,
  PriceMethod,
  RoundingStep,
  Transaction,
  Expense,
  ExpenseCategory,
} from '../types/models';

/**
 * Format angka ke mata uang Rupiah Indonesia (contoh: Rp18.000)
 */
export function formatRupiah(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '−' : '';
  const formatted = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp${formatted}`;
}

export function formatRupiahCompact(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (abs >= 1_000_000) {
    return `${sign}Rp${(abs / 1_000_000).toFixed(2).replace('.', ',').replace(/,00$/, '')} jt`;
  }
  if (abs >= 1_000) {
    return `${sign}Rp${Math.round(abs / 1_000)} rb`;
  }
  return formatRupiah(amount);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals).replace('.', ',')}%`;
}

export function formatTanggalPendek(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

export function formatTanggalLengkap(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatJam(isoStr: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', '.');
}

/**
 * Bab 4: Harga per satuan dasar (per pembelian) = total harga ÷ jumlah satuan dasar didapat
 */
export function calcPurchaseUnitPrice(totalHarga: number, satuanDasarDidapat: number): number {
  if (satuanDasarDidapat <= 0) return 0;
  return totalHarga / satuanDasarDidapat;
}

/**
 * Bab 4 & FR-BHN-05:
 * - 'last': harga pembelian terakhir
 * - 'weighted_avg': jumlah total harga N pembelian terakhir ÷ jumlah total satuan dasar N pembelian terakhir
 */
export function calcActiveIngredientPrice(
  purchases: Purchase[],
  method: PriceMethod,
  nCount: number
): number {
  const valid = purchases
    .filter((p) => !p.dibatalkan && p.satuanDasarDidapat > 0)
    .sort((a, b) => {
      const dateCmp = b.tanggal.localeCompare(a.tanggal);
      if (dateCmp !== 0) return dateCmp;
      return b.createdAt.localeCompare(a.createdAt);
    });

  if (valid.length === 0) return 0;

  if (method === 'last') {
    return valid[0].totalHarga / valid[0].satuanDasarDidapat;
  }

  const slice = valid.slice(0, Math.max(1, nCount));
  const sumPrice = slice.reduce((acc, p) => acc + p.totalHarga, 0);
  const sumQty = slice.reduce((acc, p) => acc + p.satuanDasarDidapat, 0);
  return sumQty > 0 ? sumPrice / sumQty : 0;
}

/**
 * FR-HPP-04: Deteksi referensi melingkar pada sub-resep (DFS cycle check)
 */
export function hasCircularRecipeReference(
  targetRecipeId: string,
  candidateSubRecipeId: string,
  allRecipes: Recipe[]
): boolean {
  if (targetRecipeId === candidateSubRecipeId) return true;
  const recipeMap = new Map(allRecipes.map((r) => [r.id, r]));
  const visited = new Set<string>();

  function dfs(currentId: string): boolean {
    if (currentId === targetRecipeId) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const rec = recipeMap.get(currentId);
    if (!rec) return false;
    for (const item of rec.items) {
      if (item.type === 'sub_recipe') {
        if (dfs(item.refId)) return true;
      }
    }
    return false;
  }

  return dfs(candidateSubRecipeId);
}

/**
 * Bab 4:
 * - Biaya bahan dalam resep = takaran × harga per satuan dasar ÷ (1 − susut%)
 * - HPP per porsi = (total biaya bahan + biaya lain per batch) ÷ jumlah porsi hasil + biaya lain per porsi
 */
export interface RecipeHppBreakdown {
  hppPerPorsi: number;
  totalBiayaBahan: number;
  totalBiayaLainBatch: number;
  totalBiayaLainPorsi: number;
  hasMissingPrice: boolean;
  itemCosts: Record<string, number>;
}

export function calcRecipeHpp(
  recipe: Recipe,
  ingredientMap: Map<string, Ingredient>,
  recipeMap: Map<string, Recipe>,
  visited = new Set<string>()
): RecipeHppBreakdown {
  if (visited.has(recipe.id)) {
    return {
      hppPerPorsi: 0,
      totalBiayaBahan: 0,
      totalBiayaLainBatch: 0,
      totalBiayaLainPorsi: 0,
      hasMissingPrice: true,
      itemCosts: {},
    };
  }
  const nextVisited = new Set(visited);
  nextVisited.add(recipe.id);

  let totalBiayaBahan = 0;
  let hasMissingPrice = false;
  const itemCosts: Record<string, number> = {};

  for (const item of recipe.items) {
    let unitPrice = 0;
    if (item.type === 'ingredient') {
      const ing = ingredientMap.get(item.refId);
      if (!ing || ing.hargaAktif <= 0) {
        hasMissingPrice = true;
      } else {
        unitPrice = ing.hargaAktif;
      }
    } else {
      const sub = recipeMap.get(item.refId);
      if (!sub) {
        hasMissingPrice = true;
      } else {
        const subResult = calcRecipeHpp(sub, ingredientMap, recipeMap, nextVisited);
        if (subResult.hasMissingPrice || subResult.hppPerPorsi <= 0) {
          hasMissingPrice = true;
        }
        unitPrice = subResult.hppPerPorsi;
      }
    }

    const susutFactor = 1 - Math.min(Math.max(item.susutPersen, 0), 99) / 100;
    const cost = (item.takaran * unitPrice) / susutFactor;
    itemCosts[item.id] = cost;
    totalBiayaBahan += cost;
  }

  const totalBiayaLainBatch = recipe.biayaLain
    .filter((b) => b.mode === 'batch')
    .reduce((acc, b) => acc + b.nominal, 0);

  const totalBiayaLainPorsi = recipe.biayaLain
    .filter((b) => b.mode === 'porsi')
    .reduce((acc, b) => acc + b.nominal, 0);

  const porsi = Math.max(1, recipe.jumlahPorsiHasil || 1);
  const hppPerPorsi = (totalBiayaBahan + totalBiayaLainBatch) / porsi + totalBiayaLainPorsi;

  return {
    hppPerPorsi,
    totalBiayaBahan,
    totalBiayaLainBatch,
    totalBiayaLainPorsi,
    hasMissingPrice,
    itemCosts,
  };
}

/**
 * Bab 4 & FR-MNU-04:
 * Harga saran = HPP ÷ (1 − target margin%), dibulatkan ke atas ke kelipatan Rp500 atau Rp1.000
 */
export function calcSuggestedPrice(
  hpp: number,
  targetMarginPersen: number,
  roundingStep: RoundingStep
): number {
  if (hpp <= 0) return 0;
  const margin = Math.min(Math.max(targetMarginPersen, 0), 99);
  const raw = hpp / (1 - margin / 100);
  return Math.ceil(raw / roundingStep) * roundingStep;
}

/**
 * Bab 4: Margin aktual = (harga jual − HPP) ÷ harga jual × 100%
 */
export function calcActualMargin(hargaJual: number, hpp: number): number {
  if (hargaJual <= 0) return 0;
  return ((hargaJual - hpp) / hargaJual) * 100;
}

/**
 * Bab 4: Ringkasan Keuangan (Laba Bersih vs Arus Kas — Anti Hitung Ganda)
 */
export interface FinancialSummary {
  omzet: number;
  jumlahTransaksi: number;
  hppTerjual: number;
  labaKotor: number;
  totalPengeluaran: number;
  biayaOperasional: number; // hanya kategori !sudahMasukHpp
  biayaTetap: number;
  labaBersih: number; // labaKotor - biayaOperasional
  arusKas: number; // omzet - totalPengeluaran
  rataRataMarginKotorPersen: number;
}

export function calcFinancialSummary(
  transactions: Transaction[],
  expenses: Expense[],
  categories: ExpenseCategory[],
  fallbackMenuMarginPersen = 40
): FinancialSummary {
  const validTx = transactions.filter((t) => t.status !== 'void');
  const validExp = expenses.filter((e) => !e.dibatalkan);
  const catMap = new Map(categories.map((c) => [c.id, c]));

  let omzet = 0;
  let hppTerjual = 0;
  let labaKotor = 0;

  for (const tx of validTx) {
    omzet += tx.total;
    let txItemProfit = 0;
    for (const item of tx.items) {
      hppTerjual += item.snapshotHpp * item.jumlah;
      txItemProfit += (item.hargaJual - item.snapshotHpp) * item.jumlah;
    }
    labaKotor += txItemProfit - tx.diskonNominal;
  }

  let totalPengeluaran = 0;
  let biayaOperasional = 0;
  let biayaTetap = 0;

  for (const exp of validExp) {
    totalPengeluaran += exp.nominal;
    const cat = catMap.get(exp.categoryId);
    const sudahMasukHpp = cat ? cat.sudahMasukHpp : exp.sumber === 'pembelian';
    if (!sudahMasukHpp) {
      biayaOperasional += exp.nominal;
      if (exp.biayaTetap) {
        biayaTetap += exp.nominal;
      }
    }
  }

  const labaBersih = labaKotor - biayaOperasional;
  const arusKas = omzet - totalPengeluaran;
  const rataRataMarginKotorPersen =
    omzet > 0 ? (labaKotor / omzet) * 100 : fallbackMenuMarginPersen;

  return {
    omzet,
    jumlahTransaksi: validTx.length,
    hppTerjual,
    labaKotor,
    totalPengeluaran,
    biayaOperasional,
    biayaTetap,
    labaBersih,
    arusKas,
    rataRataMarginKotorPersen,
  };
}

/**
 * Bab 4 & FR-TGT: BEP dan Prediksi Akhir Bulan
 */
export type PredictionStatus = 'Untung' | 'Mepet BEP' | 'Rugi';

export interface BepPredictionResult {
  bepOmzet: number;
  proyeksiOmzet: number;
  proyeksiLaba: number;
  selisihBep: number;
  status: PredictionStatus;
  kebutuhanPerHari: number;
  rataRataOmzetHarian: number;
  sisaHari: number;
  hariDataTersedia: number;
}

export function calcBepAndPrediction(params: {
  omzetBerjalan: number;
  targetOmzet: number;
  biayaTetapBulanan: number;
  biayaOperasionalBerjalan: number;
  rataRataMarginKotorPersen: number;
  rataRataOmzetHarian: number;
  sisaHari: number;
  hariDataTersedia: number;
  ambangMepetBepPersen: number;
}): BepPredictionResult {
  const {
    omzetBerjalan,
    targetOmzet,
    biayaTetapBulanan,
    biayaOperasionalBerjalan,
    rataRataMarginKotorPersen,
    rataRataOmzetHarian,
    sisaHari,
    hariDataTersedia,
    ambangMepetBepPersen,
  } = params;

  const marginRatio = rataRataMarginKotorPersen > 0 ? rataRataMarginKotorPersen / 100 : 0;
  const bepOmzet = marginRatio > 0 ? biayaTetapBulanan / marginRatio : 0;
  const proyeksiOmzet = omzetBerjalan + rataRataOmzetHarian * sisaHari;
  const proyeksiLaba = proyeksiOmzet * marginRatio - biayaOperasionalBerjalan;
  const selisihBep = proyeksiOmzet - bepOmzet;

  const ambangMultiplier = 1 + ambangMepetBepPersen / 100;
  let status: PredictionStatus = 'Untung';
  if (proyeksiOmzet < bepOmzet) {
    status = 'Rugi';
  } else if (proyeksiOmzet < bepOmzet * ambangMultiplier) {
    status = 'Mepet BEP';
  }

  const sisaTarget = Math.max(0, targetOmzet - omzetBerjalan);
  const kebutuhanPerHari = sisaHari > 0 ? sisaTarget / sisaHari : sisaTarget;

  return {
    bepOmzet,
    proyeksiOmzet,
    proyeksiLaba,
    selisihBep,
    status,
    kebutuhanPerHari,
    rataRataOmzetHarian,
    sisaHari,
    hariDataTersedia,
  };
}

/**
 * Ambil hanya karakter angka dari input nominal Rupiah (misal "25.000" -> "25000")
 */
export function stripNonDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/^0+(?=\d)/, '');
}

/**
 * Format string/angka menjadi ribuan bertitik untuk input Rupiah (misal "245434848" -> "245.434.848")
 */
export function formatRibuanInput(value: string | number): string {
  const digits = stripNonDigits(String(value ?? ''));
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

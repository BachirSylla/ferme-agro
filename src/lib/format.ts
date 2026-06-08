// Helpers de formatage partagés (devises, dates, libellés enums).
import type { Enums } from '@/types/db';

export const xofFmt = new Intl.NumberFormat('fr-FR');
export const qtyFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });

// Intl.NumberFormat('fr-FR') sort une espace insécable étroite U+202F comme
// séparateur de milliers. Le DOM la rend correctement, mais la Helvetica
// standard de jsPDF (WinAnsi) ne la contient pas → elle s'affiche en "/" ou
// autre glyphe. On normalise sur une espace standard U+0020 pour rester
// safe partout (PDF + DOM identiques).
export function formatNumberFr(n: number): string {
  return Math.round(n).toLocaleString('fr-FR').replace(/[\u00A0\u202F]/g, ' ');
}

export function formatQty(n: number): string {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 3 }).replace(/[\u00A0\u202F]/g, ' ');
}

// Format unique des montants — un seul helper réutilisé par toute l'app et
// par l'export PDF. Sortie : "29 000 FCFA".
export function formatFCFA(n: number): string {
  return `${formatNumberFr(n)} FCFA`;
}
export const percentFmt = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function yesterdayIso(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

export function formatDayLabel(day: string): string {
  if (day === todayIso()) return "Aujourd'hui";
  if (day === yesterdayIso()) return 'Hier';
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${day}T00:00:00`));
}

export const dateShortFmt = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

// Date 100% numérique pour pieds de PDF, slugs, etc. — "08/06/2026".
export const dateNumericFmt = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const monthShortFmt = new Intl.DateTimeFormat('fr-FR', {
  month: 'short',
  year: '2-digit',
});
const monthLongFmt = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
});

export function firstOfMonthIso(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

// Renvoie le dernier jour du mois donné (YYYY-MM-DD).
export function lastOfMonthIso(yyyymm01: string): string {
  const [y, m] = yyyymm01.split('-').map(Number);
  const d = new Date(y, m, 0); // jour 0 du mois suivant = dernier jour du mois
  return d.toISOString().slice(0, 10);
}

// Décale d'un nombre de mois (positif ou négatif).
export function addMonthsIso(yyyymm01: string, n: number): string {
  const [y, m] = yyyymm01.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return firstOfMonthIso(d);
}

// 'janv. 26', 'févr. 26'… libellé court pour les axes/badges.
export function monthShortLabel(yyyymm01: string): string {
  return monthShortFmt.format(new Date(`${yyyymm01}T00:00:00`));
}

// 'juin 2026' — libellé complet.
export function monthLongLabel(yyyymm01: string): string {
  return monthLongFmt.format(new Date(`${yyyymm01}T00:00:00`));
}

// Abréviation pour graduations Y : 5k, 1.2M, etc. — utile sur petit écran.
export function abbreviateXof(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

// ─── Paiement ────────────────────────────────────────────────
type PaymentMethod = Enums<'payment_method'>;

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  wave: 'Wave',
  orange_money: 'Orange Money',
  autre: 'Autre',
};

export const PAYMENT_CLASS: Record<PaymentMethod, string> = {
  cash: 'bg-neutral-100 text-neutral-700 border-neutral-200',
  wave: 'bg-sky-100 text-sky-800 border-sky-200',
  orange_money: 'bg-orange-100 text-orange-800 border-orange-200',
  autre: 'bg-neutral-100 text-neutral-700 border-neutral-200',
};

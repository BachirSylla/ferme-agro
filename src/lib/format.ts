// Helpers de formatage partagés (devises, dates, libellés enums).
import type { Enums } from '@/types/db';

export const xofFmt = new Intl.NumberFormat('fr-FR');
export const qtyFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });

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

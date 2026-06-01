import type { Tables } from '@/types/db';

type Organization = Tables<'organizations'>;

// Convertit '#1f6e3a' → '31 110 58' (format attendu par rgb(var(--brand-rgb) / <alpha>)).
// Renvoie le défaut vert agricole si la valeur est invalide.
export function hexToRgbSpaceSeparated(hex: string): string {
  const m = hex.replace('#', '').match(/^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return '31 110 58';
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`;
}

// Pousse les couleurs de la ferme dans :root pour que tout le thème Tailwind
// (classes bg-brand, text-brand, etc.) bascule sans rerender côté React.
export function applyBranding(org: Pick<Organization, 'color_primary'>): void {
  const root = document.documentElement;
  root.style.setProperty('--brand-rgb', hexToRgbSpaceSeparated(org.color_primary));
  // --brand-fg-rgb laissé au défaut (blanc) ; à raffiner si une ferme choisit
  // une couleur primaire claire (calcul de contraste différé).
}

export function resetBranding(): void {
  const root = document.documentElement;
  root.style.removeProperty('--brand-rgb');
  root.style.removeProperty('--brand-fg-rgb');
}

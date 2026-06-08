// Génération du rapport mensuel d'une ferme en PDF côté navigateur.
//
// Ce module est CHARGÉ EN LAZY (await import('@/lib/pdf/...')) depuis le bouton
// "Exporter" de Stats → le chunk jsPDF + autoTable ne pèse RIEN sur les écrans
// quotidiens et n'arrive dans le bundle qu'au premier clic.
//
// Le rapport assemble des données existantes (vues SQL + tables) — rien n'est
// stocké, on respecte le principe "pilotage dérivé" de CLAUDE.md.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '@/lib/supabase';
import {
  dateNumericFmt,
  dateShortFmt,
  formatFCFA,
  formatQty,
  lastOfMonthIso,
  monthLongLabel,
} from '@/lib/format';
import type { Enums, Tables, Views } from '@/types/db';

type Organization = Tables<'organizations'>;
type Category = Enums<'production_category'>;
type PaymentMethod = Enums<'payment_method'>;

const CATEGORY_LABEL: Record<Category, string> = {
  ponte: 'Ponte',
  casse: 'Casse',
  consomme: 'Consommé',
  recolte: 'Récolte',
};
const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  wave: 'Wave',
  orange_money: 'Orange Money',
  autre: 'Autre',
};
const STATUS_LABEL: Record<string, string> = {
  payee: 'Payée',
  impayee: 'Impayée',
  partielle: 'Partielle',
};

const MM_PAGE_WIDTH = 210;
const MM_MARGIN = 15;
const MM_CONTENT_WIDTH = MM_PAGE_WIDTH - 2 * MM_MARGIN;
const HEADER_HEIGHT = 38;
const FOOTER_Y = 287;

// Couleurs neutres (RVB) utilisées sur tout le rapport.
const COLOR_TEXT: [number, number, number] = [38, 38, 38];
const COLOR_MUTED: [number, number, number] = [115, 115, 115];
const COLOR_POSITIVE: [number, number, number] = [21, 128, 61]; // emerald-700
const COLOR_NEGATIVE: [number, number, number] = [185, 28, 28]; // red-700

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return [31, 110, 58];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function slugify(s: string): string {
  return (
    s
      .toLocaleLowerCase('fr')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'ferme'
  );
}

// Récupère l'image (logo) en tant que dataURL utilisable par jsPDF.addImage.
// Renvoie null si CORS bloque, si l'image n'est pas accessible, etc.
async function fetchLogoAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(new Error('FileReader'));
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

type ReportData = {
  summary: Pick<Views<'v_financial_summary'>, 'revenus' | 'depenses' | 'benefice'> | null;
  productionByCategory: Record<Category, number>;
  activeLots: {
    code: string;
    speciesName: string;
    effective: number;
    initialCount: number;
    coutTotal: number;
  }[];
  sales: { day: string; total: number; payment_method: PaymentMethod; status: string }[];
  expenses: {
    day: string;
    category: string;
    amount: number;
    supplier: string | null;
  }[];
};

async function fetchReportData(monthIso: string): Promise<ReportData> {
  const monthStart = monthIso;
  const monthEnd = lastOfMonthIso(monthIso);

  const [sumRes, prodRes, vloRes, lotsRes, spRes, mortRes, salesRes, expRes] =
    await Promise.all([
      supabase
        .from('v_financial_summary')
        .select('revenus, depenses, benefice')
        .eq('mois', monthStart)
        .maybeSingle(),
      supabase
        .from('production_records')
        .select('category, quantity')
        .gte('day', monthStart)
        .lte('day', monthEnd)
        .is('deleted_at', null),
      supabase
        .from('v_lot_overview')
        .select('lot_id, code, initial_count, cout_total')
        .eq('status', 'actif'),
      // species_id n'est pas dans la vue → on relit la table lots pour le mapping.
      supabase
        .from('lots')
        .select('id, species_id')
        .eq('status', 'actif')
        .is('deleted_at', null),
      supabase.from('species').select('id, name').is('deleted_at', null),
      supabase
        .from('health_records')
        .select('lot_id, affected_count')
        .eq('type', 'mortalite')
        .is('deleted_at', null),
      supabase
        .from('sales')
        .select('day, total, payment_method, status')
        .gte('day', monthStart)
        .lte('day', monthEnd)
        .is('deleted_at', null)
        .order('day', { ascending: true }),
      supabase
        .from('expenses')
        .select('day, category, amount, supplier')
        .gte('day', monthStart)
        .lte('day', monthEnd)
        .is('deleted_at', null)
        .order('day', { ascending: true }),
    ]);

  // Production par catégorie (rempli même si vide pour avoir les 4 lignes).
  const productionByCategory: Record<Category, number> = {
    ponte: 0,
    casse: 0,
    consomme: 0,
    recolte: 0,
  };
  for (const r of prodRes.data ?? []) {
    productionByCategory[r.category as Category] += r.quantity;
  }

  // Espèces : map id → nom.
  const speciesById = new Map((spRes.data ?? []).map((s) => [s.id, s.name]));
  // Lot id → species_id depuis la table lots.
  const speciesIdByLot = new Map((lotsRes.data ?? []).map((l) => [l.id, l.species_id]));
  // Mortalité cumulée par lot (anti-double-comptage : on n'utilise que health_records).
  const mortalityByLot = new Map<string, number>();
  for (const h of mortRes.data ?? []) {
    mortalityByLot.set(h.lot_id, (mortalityByLot.get(h.lot_id) ?? 0) + h.affected_count);
  }

  const activeLots = (vloRes.data ?? [])
    .filter((l): l is typeof l & { lot_id: string; code: string; initial_count: number } =>
      Boolean(l.lot_id) && Boolean(l.code) && typeof l.initial_count === 'number',
    )
    .map((l) => {
      const speciesId = speciesIdByLot.get(l.lot_id);
      const speciesName = speciesId ? speciesById.get(speciesId) ?? '—' : '—';
      const mortality = mortalityByLot.get(l.lot_id) ?? 0;
      const initial = l.initial_count ?? 0;
      return {
        code: l.code,
        speciesName,
        effective: Math.max(0, initial - mortality),
        initialCount: initial,
        coutTotal: l.cout_total ?? 0,
      };
    });

  return {
    summary: sumRes.data ?? null,
    productionByCategory,
    activeLots,
    sales: (salesRes.data ?? []) as ReportData['sales'],
    expenses: (expRes.data ?? []) as ReportData['expenses'],
  };
}

// ─── Helpers de dessin ───────────────────────────────────────

function drawHeaderBand(
  doc: jsPDF,
  organization: Organization,
  logoDataUrl: string | null,
) {
  const [r, g, b] = hexToRgb(organization.color_primary);
  // Bandeau de marque pleine largeur.
  doc.setFillColor(r, g, b);
  doc.rect(0, 0, MM_PAGE_WIDTH, HEADER_HEIGHT, 'F');

  // Logo (carré 18×18 mm) ou initiale dans un rond blanc.
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, MM_MARGIN, 10, 18, 18, undefined, 'FAST');
    } catch {
      drawInitialBadge(doc, organization, r, g, b);
    }
  } else {
    drawInitialBadge(doc, organization, r, g, b);
  }

  // Nom de la ferme + slogan.
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(organization.name, MM_MARGIN + 24, 19);
  if (organization.slogan) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(organization.slogan, MM_MARGIN + 24, 26);
  }
}

function drawInitialBadge(
  doc: jsPDF,
  organization: Organization,
  r: number,
  g: number,
  b: number,
) {
  doc.setFillColor(255, 255, 255);
  doc.circle(MM_MARGIN + 9, 19, 9, 'F');
  doc.setTextColor(r, g, b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(organization.name.charAt(0).toUpperCase(), MM_MARGIN + 9, 22, {
    align: 'center',
  });
}

function drawTitle(doc: jsPDF, monthIso: string, brand: [number, number, number]) {
  doc.setTextColor(...COLOR_TEXT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  // Première lettre du mois en majuscule pour le titre.
  const label = monthLongLabel(monthIso);
  const titre = `Rapport mensuel — ${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  doc.text(titre, MM_MARGIN, HEADER_HEIGHT + 12);

  // Trait fin sous le titre, à la couleur brand.
  doc.setDrawColor(...brand);
  doc.setLineWidth(0.8);
  doc.line(MM_MARGIN, HEADER_HEIGHT + 15, MM_MARGIN + MM_CONTENT_WIDTH, HEADER_HEIGHT + 15);
}

function drawSectionHeading(doc: jsPDF, text: string, y: number, brand: [number, number, number]) {
  doc.setTextColor(...brand);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(text, MM_MARGIN, y);
}

function getFinalY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function drawFooter(doc: jsPDF, organization: Organization) {
  const total = doc.getNumberOfPages();
  const editedOn = dateNumericFmt.format(new Date());
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(`Édité le ${editedOn} · ${organization.name} (AGRO ELITE)`, MM_MARGIN, FOOTER_Y);
    doc.text(`${i} / ${total}`, MM_PAGE_WIDTH - MM_MARGIN, FOOTER_Y, { align: 'right' });
  }
}

// ─── Entrée publique ─────────────────────────────────────────

export async function generateMonthlyReport(input: {
  organization: Organization;
  monthIso: string; // 'YYYY-MM-01'
}): Promise<void> {
  const { organization, monthIso } = input;
  const brand = hexToRgb(organization.color_primary);

  const [data, logoDataUrl] = await Promise.all([
    fetchReportData(monthIso),
    organization.logo_url ? fetchLogoAsDataUrl(organization.logo_url) : Promise.resolve(null),
  ]);

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });

  drawHeaderBand(doc, organization, logoDataUrl);
  drawTitle(doc, monthIso, brand);

  // ─── Résumé financier ────────────────────────────────────
  let y = HEADER_HEIGHT + 22;
  drawSectionHeading(doc, 'Résumé financier', y, brand);
  y += 3;
  const revenus = data.summary?.revenus ?? 0;
  const depenses = data.summary?.depenses ?? 0;
  const benefice = data.summary?.benefice ?? 0;
  const beneficeColor: [number, number, number] =
    benefice > 0 ? COLOR_POSITIVE : benefice < 0 ? COLOR_NEGATIVE : COLOR_TEXT;

  autoTable(doc, {
    startY: y + 2,
    head: [['Revenus', 'Dépenses', 'Bénéfice']],
    body: [[formatFCFA(revenus), formatFCFA(depenses), formatFCFA(benefice)]],
    theme: 'grid',
    margin: { left: MM_MARGIN, right: MM_MARGIN },
    tableWidth: MM_CONTENT_WIDTH,
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 3, halign: 'right' },
    headStyles: { fillColor: brand, textColor: 255, halign: 'center', fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: MM_CONTENT_WIDTH / 3 },
      1: { cellWidth: MM_CONTENT_WIDTH / 3 },
      2: { cellWidth: MM_CONTENT_WIDTH / 3, textColor: beneficeColor, fontStyle: 'bold' },
    },
  });
  y = getFinalY(doc) + 8;

  // ─── Production du mois ──────────────────────────────────
  drawSectionHeading(doc, 'Production du mois', y, brand);
  y += 3;
  const prodEntries = Object.entries(data.productionByCategory) as [Category, number][];
  const totalProduction = prodEntries.reduce((s, [, v]) => s + v, 0);
  if (totalProduction === 0) {
    autoTable(doc, {
      startY: y + 2,
      body: [['Aucune saisie de production ce mois.']],
      theme: 'plain',
      margin: { left: MM_MARGIN, right: MM_MARGIN },
      styles: { fontSize: 9, fontStyle: 'italic', textColor: COLOR_MUTED, cellPadding: 2 },
    });
  } else {
    autoTable(doc, {
      startY: y + 2,
      head: [['Catégorie', 'Total quantités']],
      body: prodEntries.map(([cat, v]) => [CATEGORY_LABEL[cat], formatQty(v)]),
      theme: 'grid',
      margin: { left: MM_MARGIN, right: MM_MARGIN },
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 2.5 },
      headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 90 },
        1: { cellWidth: 90, halign: 'right' },
      },
    });
  }
  y = getFinalY(doc) + 8;

  // ─── Lots actifs ─────────────────────────────────────────
  drawSectionHeading(doc, 'Lots actifs', y, brand);
  y += 3;
  if (data.activeLots.length === 0) {
    autoTable(doc, {
      startY: y + 2,
      body: [['Aucun lot actif.']],
      theme: 'plain',
      margin: { left: MM_MARGIN, right: MM_MARGIN },
      styles: { fontSize: 9, fontStyle: 'italic', textColor: COLOR_MUTED, cellPadding: 2 },
    });
  } else {
    autoTable(doc, {
      startY: y + 2,
      head: [['Code', 'Espèce', 'Effectif', 'Coût total']],
      body: data.activeLots.map((l) => [
        l.code,
        l.speciesName,
        `${l.effective} / ${l.initialCount}`,
        formatFCFA(l.coutTotal),
      ]),
      theme: 'grid',
      margin: { left: MM_MARGIN, right: MM_MARGIN },
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 2.5 },
      headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 40 },
        2: { cellWidth: 30, halign: 'right' },
        3: { cellWidth: 45, halign: 'right' },
      },
    });
  }
  y = getFinalY(doc) + 8;

  // ─── Ventes du mois ──────────────────────────────────────
  drawSectionHeading(doc, 'Ventes du mois', y, brand);
  y += 3;
  if (data.sales.length === 0) {
    autoTable(doc, {
      startY: y + 2,
      body: [['Aucune vente ce mois.']],
      theme: 'plain',
      margin: { left: MM_MARGIN, right: MM_MARGIN },
      styles: { fontSize: 9, fontStyle: 'italic', textColor: COLOR_MUTED, cellPadding: 2 },
    });
  } else {
    const totalSales = data.sales.reduce((s, r) => s + r.total, 0);
    autoTable(doc, {
      startY: y + 2,
      head: [['Date', 'Total', 'Paiement', 'Statut']],
      body: data.sales.map((s) => [
        dateShortFmt.format(new Date(s.day)),
        formatFCFA(s.total),
        PAYMENT_LABEL[s.payment_method],
        STATUS_LABEL[s.status] ?? s.status,
      ]),
      foot: [[
        { content: 'Total', styles: { halign: 'left', fontStyle: 'bold' } },
        { content: formatFCFA(totalSales), styles: { halign: 'right', fontStyle: 'bold' } },
        { content: '', styles: {} },
        { content: '', styles: {} },
      ]],
      theme: 'grid',
      margin: { left: MM_MARGIN, right: MM_MARGIN },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [245, 245, 245], textColor: COLOR_TEXT },
      columnStyles: {
        0: { cellWidth: 32 },
        1: { cellWidth: 45, halign: 'right' },
        2: { cellWidth: 45 },
        3: { cellWidth: 30 },
      },
    });
  }
  y = getFinalY(doc) + 8;

  // ─── Dépenses du mois ────────────────────────────────────
  drawSectionHeading(doc, 'Dépenses du mois', y, brand);
  y += 3;
  if (data.expenses.length === 0) {
    autoTable(doc, {
      startY: y + 2,
      body: [['Aucune dépense ce mois.']],
      theme: 'plain',
      margin: { left: MM_MARGIN, right: MM_MARGIN },
      styles: { fontSize: 9, fontStyle: 'italic', textColor: COLOR_MUTED, cellPadding: 2 },
    });
  } else {
    const totalExp = data.expenses.reduce((s, r) => s + r.amount, 0);
    autoTable(doc, {
      startY: y + 2,
      head: [['Date', 'Catégorie', 'Fournisseur', 'Montant']],
      body: data.expenses.map((e) => [
        dateShortFmt.format(new Date(e.day)),
        e.category,
        e.supplier ?? '—',
        formatFCFA(e.amount),
      ]),
      foot: [[
        { content: 'Total', colSpan: 3, styles: { halign: 'left', fontStyle: 'bold' } },
        { content: formatFCFA(totalExp), styles: { halign: 'right', fontStyle: 'bold' } },
      ]],
      theme: 'grid',
      margin: { left: MM_MARGIN, right: MM_MARGIN },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [245, 245, 245], textColor: COLOR_TEXT },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 55 },
        2: { cellWidth: 50 },
        3: { cellWidth: 47, halign: 'right' },
      },
    });
  }

  // ─── Note d'activité vide ───────────────────────────────
  const nothingHappened =
    revenus === 0 &&
    depenses === 0 &&
    totalProduction === 0 &&
    data.sales.length === 0 &&
    data.expenses.length === 0;
  if (nothingHappened) {
    const finalY = getFinalY(doc) + 12;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(...COLOR_MUTED);
    doc.text('Aucune activité ce mois.', MM_PAGE_WIDTH / 2, finalY, { align: 'center' });
  }

  drawFooter(doc, organization);

  const filename = `rapport-${slugify(organization.name)}-${monthIso.slice(0, 7)}.pdf`;
  doc.save(filename);
}

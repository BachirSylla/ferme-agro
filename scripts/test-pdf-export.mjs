// Test e2e Export PDF : génère le rapport mensuel et le convertit en PNG.
// Reproduit la logique de src/lib/pdf/generateMonthlyReport.ts pour pouvoir
// vérifier visuellement le rendu sans navigateur.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { createCanvas } from 'canvas';

function loadEnvLocal() {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

// ─── Format helpers (copiés de src/lib/format.ts) ────────────
function formatNumberFr(n) {
  return Math.round(n).toLocaleString('fr-FR').replace(/[\u00A0\u202F]/g, ' ');
}
function formatQty(n) {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 3 }).replace(/[\u00A0\u202F]/g, ' ');
}
function formatFCFA(n) { return `${formatNumberFr(n)} FCFA`; }

const dateNumericFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const monthLongFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
function monthLongLabel(yyyymm01) { return monthLongFmt.format(new Date(`${yyyymm01}T00:00:00`)); }
function lastOfMonthIso(yyyymm01) {
  const [y, m] = yyyymm01.split('-').map(Number);
  const d = new Date(y, m, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hexToRgb(hex) {
  const m = hex.replace('#', '').match(/^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return [31, 110, 58];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
function slugify(s) {
  return s.toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ferme';
}
async function fetchLogoAsDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const b64 = Buffer.from(ab).toString('base64');
    const mime = res.headers.get('content-type') ?? 'image/png';
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

const CATEGORY_LABEL = { ponte: 'Ponte', casse: 'Casse', consomme: 'Consommé', recolte: 'Récolte' };
const PAYMENT_LABEL = { cash: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', autre: 'Autre' };
const STATUS_LABEL = { payee: 'Payée', impayee: 'Impayée', partielle: 'Partielle' };

const MM_PAGE_WIDTH = 210;
const MM_MARGIN = 15;
const MM_CONTENT_WIDTH = MM_PAGE_WIDTH - 2 * MM_MARGIN;
const HEADER_HEIGHT = 38;
const FOOTER_Y = 287;
const COLOR_TEXT = [38, 38, 38];
const COLOR_MUTED = [115, 115, 115];
const COLOR_POSITIVE = [21, 128, 61];
const COLOR_NEGATIVE = [185, 28, 28];

// ─── Setup ───
const env = loadEnvLocal();
if (!env.TEST_USER_EMAIL || !env.TEST_USER_PASSWORD) {
  console.error('TEST_USER_EMAIL/PASSWORD requis dans .env.local'); process.exit(1);
}
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

// Cible : mois en cours
const today = new Date().toISOString().slice(0, 10);
const monthIso = `${today.slice(0, 7)}-01`;
const monthEnd = lastOfMonthIso(monthIso);

console.log(`[1] signIn`);
const { data: si } = await sb.auth.signInWithPassword({ email: env.TEST_USER_EMAIL, password: env.TEST_USER_PASSWORD });
const orgId = (await sb.from('profiles').select('org_id').eq('id', si.user.id).single()).data.org_id;
const { data: organization } = await sb.from('organizations').select('*').eq('id', orgId).single();
console.log(`  org : ${organization.name} (${organization.color_primary})`);

console.log(`[2] fetch data sur ${monthIso} → ${monthEnd}`);
const [sumRes, prodRes, vloRes, lotsRes, spRes, mortRes, salesRes, expRes] = await Promise.all([
  sb.from('v_financial_summary').select('revenus, depenses, benefice').eq('mois', monthIso).maybeSingle(),
  sb.from('production_records').select('category, quantity').gte('day', monthIso).lte('day', monthEnd).is('deleted_at', null),
  sb.from('v_lot_overview').select('lot_id, code, initial_count, cout_total').eq('status', 'actif'),
  sb.from('lots').select('id, species_id').eq('status', 'actif').is('deleted_at', null),
  sb.from('species').select('id, name').is('deleted_at', null),
  sb.from('health_records').select('lot_id, affected_count').eq('type', 'mortalite').is('deleted_at', null),
  sb.from('sales').select('day, total, payment_method, status').gte('day', monthIso).lte('day', monthEnd).is('deleted_at', null).order('day'),
  sb.from('expenses').select('day, category, amount, supplier').gte('day', monthIso).lte('day', monthEnd).is('deleted_at', null).order('day'),
]);
console.log(`  v_financial_summary : ${sumRes.data ? 'présent' : '(null)'}`);
console.log(`  productions : ${prodRes.data?.length ?? 0}`);
console.log(`  lots actifs : ${vloRes.data?.length ?? 0}`);
console.log(`  ventes : ${salesRes.data?.length ?? 0}`);
console.log(`  dépenses : ${expRes.data?.length ?? 0}`);

// Production par catégorie
const productionByCategory = { ponte: 0, casse: 0, consomme: 0, recolte: 0 };
for (const r of prodRes.data ?? []) productionByCategory[r.category] += r.quantity;

// Espèces
const speciesById = new Map((spRes.data ?? []).map(s => [s.id, s.name]));
const speciesIdByLot = new Map((lotsRes.data ?? []).map(l => [l.id, l.species_id]));
const mortalityByLot = new Map();
for (const h of mortRes.data ?? []) {
  mortalityByLot.set(h.lot_id, (mortalityByLot.get(h.lot_id) ?? 0) + h.affected_count);
}
const activeLots = (vloRes.data ?? []).filter(l => l.lot_id && l.code).map(l => {
  const spId = speciesIdByLot.get(l.lot_id);
  return {
    code: l.code,
    speciesName: spId ? speciesById.get(spId) ?? '—' : '—',
    effective: Math.max(0, (l.initial_count ?? 0) - (mortalityByLot.get(l.lot_id) ?? 0)),
    initialCount: l.initial_count ?? 0,
    coutTotal: l.cout_total ?? 0,
  };
});

// Note : on désactive le logo en mode test Node car canvas-node ne sait pas
// re-rasteriser les images embarquées WebP du PDF. En navigateur, le logo
// s'affiche normalement. Mettre à `true` pour réactiver.
const ENABLE_LOGO_IN_TEST = false;
console.log(`[3] fetch logo${organization.logo_url ? '' : ' (aucun)'}`);
const logoDataUrl = ENABLE_LOGO_IN_TEST && organization.logo_url
  ? await fetchLogoAsDataUrl(organization.logo_url) : null;

// ─── PDF Generation ─────────────────────────────────────────
console.log(`[4] génération PDF`);
const brand = hexToRgb(organization.color_primary);
const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });

// Header band
doc.setFillColor(...brand);
doc.rect(0, 0, MM_PAGE_WIDTH, HEADER_HEIGHT, 'F');
if (logoDataUrl) {
  try { doc.addImage(logoDataUrl, MM_MARGIN, 10, 18, 18, undefined, 'FAST'); } catch {}
} else {
  doc.setFillColor(255, 255, 255);
  doc.circle(MM_MARGIN + 9, 19, 9, 'F');
  doc.setTextColor(...brand);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text(organization.name.charAt(0).toUpperCase(), MM_MARGIN + 9, 22, { align: 'center' });
}
doc.setTextColor(255, 255, 255);
doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
doc.text(organization.name, MM_MARGIN + 24, 19);
if (organization.slogan) {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(organization.slogan, MM_MARGIN + 24, 26);
}

// Title
doc.setTextColor(...COLOR_TEXT);
doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
const label = monthLongLabel(monthIso);
doc.text(`Rapport mensuel — ${label.charAt(0).toUpperCase()}${label.slice(1)}`, MM_MARGIN, HEADER_HEIGHT + 12);
doc.setDrawColor(...brand); doc.setLineWidth(0.8);
doc.line(MM_MARGIN, HEADER_HEIGHT + 15, MM_MARGIN + MM_CONTENT_WIDTH, HEADER_HEIGHT + 15);

let y = HEADER_HEIGHT + 22;
function heading(text) {
  doc.setTextColor(...brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text(text, MM_MARGIN, y); y += 3;
}
function finalY() { return doc.lastAutoTable.finalY; }

// Financial summary
heading('Résumé financier');
const revenus = sumRes.data?.revenus ?? 0;
const depenses = sumRes.data?.depenses ?? 0;
const benefice = sumRes.data?.benefice ?? 0;
const beneficeColor = benefice > 0 ? COLOR_POSITIVE : benefice < 0 ? COLOR_NEGATIVE : COLOR_TEXT;
autoTable(doc, {
  startY: y + 2,
  head: [['Revenus', 'Dépenses', 'Bénéfice']],
  body: [[formatFCFA(revenus), formatFCFA(depenses), formatFCFA(benefice)]],
  theme: 'grid', margin: { left: MM_MARGIN, right: MM_MARGIN }, tableWidth: MM_CONTENT_WIDTH,
  styles: { font: 'helvetica', fontSize: 10, cellPadding: 3, halign: 'right' },
  headStyles: { fillColor: brand, textColor: 255, halign: 'center', fontStyle: 'bold' },
  columnStyles: {
    0: { cellWidth: MM_CONTENT_WIDTH / 3 },
    1: { cellWidth: MM_CONTENT_WIDTH / 3 },
    2: { cellWidth: MM_CONTENT_WIDTH / 3, textColor: beneficeColor, fontStyle: 'bold' },
  },
});
y = finalY() + 8;

// Production
heading('Production du mois');
const prodEntries = Object.entries(productionByCategory);
const totalProduction = prodEntries.reduce((s, [, v]) => s + v, 0);
if (totalProduction === 0) {
  autoTable(doc, { startY: y + 2, body: [['Aucune saisie de production ce mois.']], theme: 'plain',
    margin: { left: MM_MARGIN, right: MM_MARGIN },
    styles: { fontSize: 9, fontStyle: 'italic', textColor: COLOR_MUTED, cellPadding: 2 } });
} else {
  autoTable(doc, {
    startY: y + 2, head: [['Catégorie', 'Total quantités']],
    body: prodEntries.map(([cat, v]) => [CATEGORY_LABEL[cat], formatQty(v)]),
    theme: 'grid', margin: { left: MM_MARGIN, right: MM_MARGIN },
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 2.5 },
    headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 90, halign: 'right' } },
  });
}
y = finalY() + 8;

// Lots actifs
heading('Lots actifs');
if (activeLots.length === 0) {
  autoTable(doc, { startY: y + 2, body: [['Aucun lot actif.']], theme: 'plain',
    margin: { left: MM_MARGIN, right: MM_MARGIN },
    styles: { fontSize: 9, fontStyle: 'italic', textColor: COLOR_MUTED, cellPadding: 2 } });
} else {
  autoTable(doc, {
    startY: y + 2, head: [['Code', 'Espèce', 'Effectif', 'Coût total']],
    body: activeLots.map(l => [l.code, l.speciesName, `${l.effective} / ${l.initialCount}`, formatFCFA(l.coutTotal)]),
    theme: 'grid', margin: { left: MM_MARGIN, right: MM_MARGIN },
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 2.5 },
    headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 50 }, 1: { cellWidth: 40 },
      2: { cellWidth: 30, halign: 'right' }, 3: { cellWidth: 45, halign: 'right' },
    },
  });
}
y = finalY() + 8;

// Ventes
heading('Ventes du mois');
const sales = salesRes.data ?? [];
if (sales.length === 0) {
  autoTable(doc, { startY: y + 2, body: [['Aucune vente ce mois.']], theme: 'plain',
    margin: { left: MM_MARGIN, right: MM_MARGIN },
    styles: { fontSize: 9, fontStyle: 'italic', textColor: COLOR_MUTED, cellPadding: 2 } });
} else {
  const totalSales = sales.reduce((s, r) => s + r.total, 0);
  autoTable(doc, {
    startY: y + 2, head: [['Date', 'Total', 'Paiement', 'Statut']],
    body: sales.map(s => [dateShortFmt.format(new Date(s.day)), formatFCFA(s.total), PAYMENT_LABEL[s.payment_method], STATUS_LABEL[s.status] ?? s.status]),
    foot: [[
      { content: 'Total', styles: { halign: 'left', fontStyle: 'bold' } },
      { content: formatFCFA(totalSales), styles: { halign: 'right', fontStyle: 'bold' } },
      { content: '', styles: {} }, { content: '', styles: {} },
    ]],
    theme: 'grid', margin: { left: MM_MARGIN, right: MM_MARGIN },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [245, 245, 245], textColor: COLOR_TEXT },
    columnStyles: {
      0: { cellWidth: 32 }, 1: { cellWidth: 45, halign: 'right' },
      2: { cellWidth: 45 }, 3: { cellWidth: 30 },
    },
  });
}
y = finalY() + 8;

// Dépenses
heading('Dépenses du mois');
const expenses = expRes.data ?? [];
if (expenses.length === 0) {
  autoTable(doc, { startY: y + 2, body: [['Aucune dépense ce mois.']], theme: 'plain',
    margin: { left: MM_MARGIN, right: MM_MARGIN },
    styles: { fontSize: 9, fontStyle: 'italic', textColor: COLOR_MUTED, cellPadding: 2 } });
} else {
  const totalExp = expenses.reduce((s, r) => s + r.amount, 0);
  autoTable(doc, {
    startY: y + 2, head: [['Date', 'Catégorie', 'Fournisseur', 'Montant']],
    body: expenses.map(e => [dateShortFmt.format(new Date(e.day)), e.category, e.supplier ?? '—', formatFCFA(e.amount)]),
    foot: [[
      { content: 'Total', colSpan: 3, styles: { halign: 'left', fontStyle: 'bold' } },
      { content: formatFCFA(totalExp), styles: { halign: 'right', fontStyle: 'bold' } },
    ]],
    theme: 'grid', margin: { left: MM_MARGIN, right: MM_MARGIN },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [245, 245, 245], textColor: COLOR_TEXT },
    columnStyles: {
      0: { cellWidth: 28 }, 1: { cellWidth: 55 },
      2: { cellWidth: 50 }, 3: { cellWidth: 47, halign: 'right' },
    },
  });
}

// Footer
const totalPages = doc.getNumberOfPages();
for (let i = 1; i <= totalPages; i++) {
  doc.setPage(i);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(`Édité le ${dateNumericFmt.format(new Date())} · ${organization.name} (AGRO ELITE)`, MM_MARGIN, FOOTER_Y);
  doc.text(`${i} / ${totalPages}`, MM_PAGE_WIDTH - MM_MARGIN, FOOTER_Y, { align: 'right' });
}

// Save
fs.mkdirSync('./tmp', { recursive: true });
const filename = `rapport-${slugify(organization.name)}-${monthIso.slice(0, 7)}.pdf`;
const pdfPath = path.join('./tmp', filename);
const arrayBuffer = doc.output('arraybuffer');
fs.writeFileSync(pdfPath, Buffer.from(arrayBuffer));
console.log(`  ✓ PDF sauvegardé : ${pdfPath} (${(fs.statSync(pdfPath).size / 1024).toFixed(1)} KB, ${totalPages} page(s))`);

// ─── Rendu PNG via pdfjs-dist + canvas ───
console.log(`[5] conversion PDF → PNG`);
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
const pdfData = new Uint8Array(fs.readFileSync(pdfPath));
const pdfDoc = await pdfjsLib.getDocument({
  data: pdfData,
  standardFontDataUrl: 'node_modules/pdfjs-dist/legacy/build/standard_fonts/',
}).promise;
for (let i = 1; i <= pdfDoc.numPages; i++) {
  const page = await pdfDoc.getPage(i);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  const pngPath = path.join('./tmp', `rapport-page-${i}.png`);
  fs.writeFileSync(pngPath, canvas.toBuffer('image/png'));
  console.log(`  ✓ ${pngPath} (${(fs.statSync(pngPath).size / 1024).toFixed(1)} KB)`);
}

await sb.auth.signOut();
console.log(`\n=== DONE ===`);

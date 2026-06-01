// Test end-to-end Stocks contre Supabase hébergé.
// Reproduit les 3 scénarios du brief :
//   A. Maïs (aliment) : achat 100 kg à 50 000 (entrée stock + dépense liée),
//      sortie 10 kg vers LOT-CAILLES-001 (coût 5000, AUCUNE nouvelle dépense),
//      stock final = 90 kg, alerte si seuil 20.
//   B. Mangue + Miel (négoce, MÊME circuit, sans logique spécifique) :
//      achat de chacun + revente de chacun. Aucun double comptage.
//   C. Juge de paix : le bénéfice mensuel ne BOUGE PAS après une consommation
//      vers un lot. Seul le coût du lot monte.

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

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

const env = loadEnvLocal();
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const email = `claude-stocks-test-${Date.now()}@mailinator.com`;
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

async function ensureSignup() {
  const { data: su, error } = await sb.auth.signUp({ email, password: 'TestPassword123!' });
  if (error || !su.session) {
    console.error('  ✗ signUp:', error?.message);
    process.exit(1);
  }
  const orgId = (
    await sb.from('profiles').select('org_id').eq('id', su.user.id).single()
  ).data.org_id;
  return { user: su.user, orgId };
}

async function fetchBenefice(orgId) {
  const { data } = await sb
    .from('v_financial_summary')
    .select('revenus, depenses, benefice')
    .eq('mois', monthStart)
    .maybeSingle();
  return data ?? { revenus: 0, depenses: 0, benefice: 0 };
}

async function fetchLotCost(orgId, lotId) {
  const { data } = await sb
    .from('v_lot_overview')
    .select('cout_total, cout_intrants, depenses_directes')
    .eq('lot_id', lotId)
    .maybeSingle();
  return data ?? { cout_total: 0, cout_intrants: 0, depenses_directes: 0 };
}

async function deriveStock(stockItemId) {
  const { data } = await sb
    .from('stock_movements')
    .select('direction, quantity')
    .eq('stock_item_id', stockItemId)
    .is('deleted_at', null);
  let entree = 0;
  let sortie = 0;
  for (const m of data ?? []) {
    if (m.direction === 'entree') entree += m.quantity;
    else sortie += m.quantity;
  }
  return entree - sortie;
}

console.log('[setup] signUp + catalogue + lot');
const { orgId } = await ensureSignup();
const { data: cailles } = await sb
  .from('species')
  .insert({ org_id: orgId, name: 'Cailles' })
  .select()
  .single();
const { data: lot } = await sb
  .from('lots')
  .insert({
    org_id: orgId,
    species_id: cailles.id,
    code: 'LOT-CAILLES-001',
    initial_count: 200,
    current_count: 196,
    status: 'actif',
  })
  .select()
  .single();
console.log('  ✓ setup ; lot', lot.id.slice(0, 8));

// ════════════════════════════════════════════════════════════
// SCÉNARIO A — MAÏS
// ════════════════════════════════════════════════════════════

console.log('\n══ Scénario A : Maïs (aliment) ══');

const { data: mais } = await sb
  .from('stock_items')
  .insert({
    org_id: orgId,
    name: 'Maïs',
    type: 'aliment',
    unit: 'kg',
    reorder_threshold: 20,
  })
  .select()
  .single();
console.log('  ✓ article Maïs créé (seuil 20 kg)');

// A1 : achat 100 kg à 50 000 (entrée + dépense liée)
console.log('\n[A1] achat 100 kg à 50 000 FCFA');
await sb.from('stock_movements').insert({
  org_id: orgId,
  stock_item_id: mais.id,
  day: today,
  direction: 'entree',
  quantity: 100,
  cost: 50000,
});
await sb.from('expenses').insert({
  org_id: orgId,
  stock_item_id: mais.id,
  day: today,
  category: 'aliment',
  amount: 50000,
  payment_method: 'cash',
});
let stock = await deriveStock(mais.id);
let benefice = await fetchBenefice(orgId);
console.log('  stock =', stock, 'kg ; bénéfice mois =', benefice.benefice, 'FCFA');
if (stock !== 100) { console.error('  ✗ stock attendu 100'); process.exit(1); }
if (benefice.depenses !== 50000) { console.error('  ✗ dépenses attendu 50000'); process.exit(1); }
const beneficeApresAchat = benefice.benefice;
console.log(`  ✓ stock=100, dépense=50000 enregistrée. Bénéfice = ${beneficeApresAchat}`);

// A2 : sortie 10 kg vers LOT (coût 5000, AUCUNE dépense)
console.log('\n[A2] sortie 10 kg vers LOT-CAILLES-001 (coût 5000) — juge de paix');
const beneficeAvantSortie = (await fetchBenefice(orgId)).benefice;
const coutLotAvant = (await fetchLotCost(orgId, lot.id)).cout_total ?? 0;
await sb.from('stock_movements').insert({
  org_id: orgId,
  stock_item_id: mais.id,
  lot_id: lot.id,
  day: today,
  direction: 'sortie',
  quantity: 10,
  cost: 5000,
});
const beneficeApresSortie = (await fetchBenefice(orgId)).benefice;
const coutLotApres = (await fetchLotCost(orgId, lot.id)).cout_total ?? 0;
stock = await deriveStock(mais.id);
console.log(`  stock = ${stock} kg`);
console.log(`  bénéfice mois : ${beneficeAvantSortie} → ${beneficeApresSortie}`);
console.log(`  coût lot      : ${coutLotAvant} → ${coutLotApres}`);
if (stock !== 90) { console.error('  ✗ stock attendu 90'); process.exit(1); }
if (beneficeApresSortie !== beneficeAvantSortie) {
  console.error(`  ✗ BÉNÉFICE A BOUGÉ : double comptage probable (${beneficeAvantSortie} → ${beneficeApresSortie})`);
  process.exit(1);
}
if (coutLotApres - coutLotAvant !== 5000) {
  console.error(`  ✗ coût lot devrait avoir augmenté de 5000, en fait ${coutLotApres - coutLotAvant}`);
  process.exit(1);
}
console.log('  ✓ stock=90, bénéfice INCHANGÉ, coût lot +5000. Anti-double-comptage OK.');

// A3 : alerte stock bas
console.log('\n[A3] descendre sous le seuil (sortie 75 kg)');
await sb.from('stock_movements').insert({
  org_id: orgId,
  stock_item_id: mais.id,
  lot_id: lot.id,
  day: today,
  direction: 'sortie',
  quantity: 75,
  cost: 37500,
});
stock = await deriveStock(mais.id);
console.log(`  stock = ${stock} kg ; seuil = 20 kg → alerte ${stock <= 20 ? 'OUI' : 'NON'}`);
if (stock !== 15 || stock > 20) { console.error('  ✗'); process.exit(1); }
console.log('  ✓ alerte stock bas active');

// ════════════════════════════════════════════════════════════
// SCÉNARIO B — DEUX NÉGOCES (Mangue + Miel)
// ════════════════════════════════════════════════════════════

console.log('\n══ Scénario B : Mangue + Miel (deux négoces, MÊME circuit) ══');

const { data: prodMangue } = await sb
  .from('products')
  .insert({ org_id: orgId, species_id: null, name: 'Mangue', unit: 'fruit', default_price: 500 })
  .select()
  .single();
const { data: prodMiel } = await sb
  .from('products')
  .insert({ org_id: orgId, species_id: null, name: 'Miel', unit: 'litre', default_price: 5000 })
  .select()
  .single();
const { data: stockMangue } = await sb
  .from('stock_items')
  .insert({
    org_id: orgId,
    product_id: prodMangue.id,
    name: 'Mangue',
    type: 'produit_fini',
    unit: 'fruit',
  })
  .select()
  .single();
const { data: stockMiel } = await sb
  .from('stock_items')
  .insert({
    org_id: orgId,
    product_id: prodMiel.id,
    name: 'Miel',
    type: 'produit_fini',
    unit: 'litre',
  })
  .select()
  .single();
console.log('  ✓ articles Mangue & Miel créés');

const beneficeAvantNegoce = (await fetchBenefice(orgId)).benefice;

// B1 : achat Mangue 5 fruits à 1500 (entrée stock + expense)
console.log('\n[B1] achat Mangue : 5 fruits à 1500 FCFA');
await sb.from('stock_movements').insert({
  org_id: orgId, stock_item_id: stockMangue.id, day: today,
  direction: 'entree', quantity: 5, cost: 1500,
});
await sb.from('expenses').insert({
  org_id: orgId, stock_item_id: stockMangue.id, day: today,
  category: 'achat marchandise', amount: 1500, payment_method: 'cash',
});

// B2 : achat Miel 1 L à 4000
console.log('[B2] achat Miel : 1 L à 4000 FCFA');
await sb.from('stock_movements').insert({
  org_id: orgId, stock_item_id: stockMiel.id, day: today,
  direction: 'entree', quantity: 1, cost: 4000,
});
await sb.from('expenses').insert({
  org_id: orgId, stock_item_id: stockMiel.id, day: today,
  category: 'achat marchandise', amount: 4000, payment_method: 'cash',
});

// B3 : revente Mangue 5 fruits à 500 = 2500 + sortie stock 5 fruits
console.log('[B3] revente Mangue : 5 fruits à 500 = 2500');
const saleMangueId = crypto.randomUUID();
await sb.from('sales').insert({
  id: saleMangueId, org_id: orgId, day: today, total: 2500,
  payment_method: 'cash', status: 'payee',
});
await sb.from('sale_items').insert({
  org_id: orgId, sale_id: saleMangueId, product_id: prodMangue.id,
  quantity: 5, unit_price: 500,
});
await sb.from('stock_movements').insert({
  org_id: orgId, stock_item_id: stockMangue.id, day: today,
  direction: 'sortie', quantity: 5, cost: 0,
});

// B4 : revente Miel 1 L à 5000
console.log('[B4] revente Miel : 1 L à 5000');
const saleMielId = crypto.randomUUID();
await sb.from('sales').insert({
  id: saleMielId, org_id: orgId, day: today, total: 5000,
  payment_method: 'cash', status: 'payee',
});
await sb.from('sale_items').insert({
  org_id: orgId, sale_id: saleMielId, product_id: prodMiel.id,
  quantity: 1, unit_price: 5000,
});
await sb.from('stock_movements').insert({
  org_id: orgId, stock_item_id: stockMiel.id, day: today,
  direction: 'sortie', quantity: 1, cost: 0,
});

const stockMangueFinal = await deriveStock(stockMangue.id);
const stockMielFinal = await deriveStock(stockMiel.id);
const beneficeApresNegoce = (await fetchBenefice(orgId)).benefice;

console.log(`  Mangue : stock = ${stockMangueFinal} fruits`);
console.log(`  Miel   : stock = ${stockMielFinal} L`);
console.log(`  Bénéfice : ${beneficeAvantNegoce} → ${beneficeApresNegoce}`);
console.log(`    delta = ${beneficeApresNegoce - beneficeAvantNegoce}`);
const expectedDelta = (2500 - 1500) + (5000 - 4000); // marges agrégées
console.log(`    attendu = (2500-1500) + (5000-4000) = ${expectedDelta}`);

if (stockMangueFinal !== 0 || stockMielFinal !== 0) {
  console.error('  ✗ stocks devraient être à 0 après revente complète');
  process.exit(1);
}
if (beneficeApresNegoce - beneficeAvantNegoce !== expectedDelta) {
  console.error(`  ✗ DOUBLE COMPTAGE PROBABLE : delta ${beneficeApresNegoce - beneficeAvantNegoce} ≠ attendu ${expectedDelta}`);
  process.exit(1);
}
console.log(`  ✓ Mangue et Miel suivent le MÊME circuit, aucun double comptage.`);

await sb.auth.signOut();
console.log('\n=== TEST STOCKS PASS ===');
console.log('Maïs : achat (entrée + expense), sortie vers lot (anti-double-comptage), alerte.');
console.log('Mangue + Miel : même circuit générique, marge nette = revente − achat.');
console.log('Bénéfice mensuel INCHANGÉ après consommation vers un lot (juge de paix).');

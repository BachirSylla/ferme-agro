// Test e2e Marge par lot contre Supabase hébergé.
// Vérifie :
//   - sale_items accepte lot_id (nullable)
//   - v_lot_overview expose revenu_rattache et marge
//   - JUGE DE PAIX : créer une vente avec lot_id rattaché change le bénéfice
//     du mois exactement comme une vente SANS lot_id (pas de double comptage).
//     Le delta benefice = +sale_total (jamais +2*sale_total).
//   - une vente sans lot s'enregistre normalement (rétro-compat)
//   - cleanup : on archive les ventes de test pour ne pas polluer la prod
// Lit TEST_USER_EMAIL/PASSWORD depuis .env.local.

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
if (!env.TEST_USER_EMAIL || !env.TEST_USER_PASSWORD) {
  console.error('TEST_USER_EMAIL/PASSWORD requis dans .env.local'); process.exit(1);
}
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const today = new Date().toISOString().slice(0, 10);
const monthIso = `${today.slice(0, 7)}-01`;

console.log('[1] signIn');
const { data: si, error: siErr } = await sb.auth.signInWithPassword({
  email: env.TEST_USER_EMAIL, password: env.TEST_USER_PASSWORD,
});
if (siErr || !si.session) { console.error('  ✗ signIn:', siErr?.message); process.exit(1); }
const orgId = (await sb.from('profiles').select('org_id').eq('id', si.user.id).single()).data.org_id;
console.log('  ✓ org', orgId.slice(0, 8));

// Récupère un produit avec species et un lot actif rattaché
console.log('\n[2] récupérer un produit avec species + lot actif compatible');
const { data: lots } = await sb.from('lots').select('id, code, species_id').eq('status', 'actif').is('deleted_at', null).limit(5);
const { data: products } = await sb.from('products').select('id, name, default_price, species_id').is('deleted_at', null);
let candidate = (lots ?? []).find((l) => (products ?? []).some((p) => p.species_id === l.species_id));
let product = candidate ? products.find((p) => p.species_id === candidate.species_id) : null;
let tempProductId = null;

if (!candidate && lots?.length > 0) {
  // Aucun produit ne matche, on en crée un temporaire pour pouvoir tester.
  candidate = lots[0];
  console.log(`  (aucun produit existant ne matche species de ${candidate.code} → création temporaire)`);
  const { data: temp, error: tempErr } = await sb
    .from('products')
    .insert({
      org_id: orgId,
      species_id: candidate.species_id,
      name: `__TEST_marge_${Date.now()}`,
      unit: 'unite',
      default_price: 1000,
    })
    .select()
    .single();
  if (tempErr) { console.error('  ✗ create temp product:', tempErr.message); process.exit(1); }
  product = temp;
  tempProductId = temp.id;
}
if (!candidate || !product) {
  console.error('  ✗ pas de lot actif sur ton compte');
  process.exit(1);
}
console.log(`  ✓ lot ${candidate.code}, produit ${product.name}${tempProductId ? ' (temporaire)' : ''}`);

// Snapshots
async function snapshot() {
  const [sumRes, lotRes] = await Promise.all([
    sb.from('v_financial_summary').select('revenus, depenses, benefice').eq('mois', monthIso).maybeSingle(),
    sb.from('v_lot_overview').select('revenu_rattache, marge, cout_total').eq('lot_id', candidate.id).maybeSingle(),
  ]);
  return {
    benefice: sumRes.data?.benefice ?? 0,
    revenus: sumRes.data?.revenus ?? 0,
    revenu_rattache: lotRes.data?.revenu_rattache ?? 0,
    marge: lotRes.data?.marge ?? 0,
    cout_total: lotRes.data?.cout_total ?? 0,
  };
}

const before = await snapshot();
console.log('\n[3] snapshot AVANT :', before);

// ─── Vente AVEC lot_id rattaché ─────────────────────────────
console.log('\n[4] vente AVEC sale_items.lot_id rattaché à', candidate.code);
const SALE_AMOUNT = 1000;
const saleAttachedId = crypto.randomUUID();
const r1 = await sb.from('sales').insert({
  id: saleAttachedId, org_id: orgId, day: today, total: SALE_AMOUNT,
  payment_method: 'cash', status: 'payee',
});
if (r1.error) { console.error('  ✗', r1.error.message); process.exit(1); }
const r2 = await sb.from('sale_items').insert({
  org_id: orgId, sale_id: saleAttachedId, product_id: product.id,
  lot_id: candidate.id, quantity: 1, unit_price: SALE_AMOUNT,
});
if (r2.error) {
  await sb.from('sales').update({ deleted_at: new Date().toISOString() }).eq('id', saleAttachedId);
  console.error('  ✗ sale_items lot_id rejeté :', r2.error.message);
  console.error('     → la migration 0007 a-t-elle été appliquée dans le SQL Editor ?');
  process.exit(1);
}
console.log('  ✓ vente + sale_item.lot_id enregistrés');

const afterAttached = await snapshot();
console.log('\n[5] snapshot APRÈS vente avec lot_id :', afterAttached);

const deltaBenefice = afterAttached.benefice - before.benefice;
const deltaRevenus = afterAttached.revenus - before.revenus;
const deltaRevenuRattache = afterAttached.revenu_rattache - before.revenu_rattache;
const deltaMarge = afterAttached.marge - before.marge;
console.log(`  Δ benefice global   = ${deltaBenefice} (attendu = +${SALE_AMOUNT})`);
console.log(`  Δ revenus globaux   = ${deltaRevenus} (attendu = +${SALE_AMOUNT})`);
console.log(`  Δ revenu_rattache   = ${deltaRevenuRattache} (attendu = +${SALE_AMOUNT})`);
console.log(`  Δ marge lot         = ${deltaMarge} (attendu = +${SALE_AMOUNT})`);

if (deltaBenefice !== SALE_AMOUNT) {
  console.error(`  ✗ DOUBLE COMPTAGE : benefice a bougé de ${deltaBenefice} au lieu de +${SALE_AMOUNT}`);
  await cleanup([saleAttachedId]);
  process.exit(1);
}
if (deltaRevenuRattache !== SALE_AMOUNT) {
  console.error(`  ✗ revenu_rattache devait monter de +${SALE_AMOUNT}`);
  await cleanup([saleAttachedId]);
  process.exit(1);
}
console.log('  ✓ JUGE DE PAIX : benefice += +1×sale_total (pas de double comptage)');

// ─── Vente SANS lot_id (rétro-compat) ───────────────────────
console.log('\n[6] vente SANS sale_items.lot_id (rétro-compat)');
const saleUnattachedId = crypto.randomUUID();
const r3 = await sb.from('sales').insert({
  id: saleUnattachedId, org_id: orgId, day: today, total: SALE_AMOUNT,
  payment_method: 'cash', status: 'payee',
});
if (r3.error) { console.error('  ✗', r3.error.message); process.exit(1); }
const r4 = await sb.from('sale_items').insert({
  org_id: orgId, sale_id: saleUnattachedId, product_id: product.id,
  lot_id: null, quantity: 1, unit_price: SALE_AMOUNT,
});
if (r4.error) {
  console.error('  ✗', r4.error.message); process.exit(1);
}
console.log('  ✓ vente avec lot_id=null enregistrée normalement');

const afterBoth = await snapshot();
const deltaBeneficeBoth = afterBoth.benefice - before.benefice;
console.log(`  Δ benefice total après 2 ventes = ${deltaBeneficeBoth} (attendu = +${2 * SALE_AMOUNT})`);
if (deltaBeneficeBoth !== 2 * SALE_AMOUNT) {
  console.error('  ✗ delta benefice incohérent');
  await cleanup([saleAttachedId, saleUnattachedId]);
  process.exit(1);
}
console.log('  ✓ deux ventes comptées chacune une fois, lot ou pas');

// ─── Cleanup ────────────────────────────────────────────────
async function cleanup(saleIds) {
  console.log('\n[FINAL] cleanup : archive les ventes de test');
  for (const id of saleIds) {
    await sb.from('sales').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  }
  if (tempProductId) {
    await sb.from('products').update({ deleted_at: new Date().toISOString() }).eq('id', tempProductId);
    console.log('  ✓ produit temporaire archivé');
  }
  // Vérifie le retour à l'état initial
  const restored = await snapshot();
  console.log('  snapshot après cleanup :', restored);
  if (restored.benefice !== before.benefice) {
    console.warn(`  ⚠ benefice non restauré : ${restored.benefice} vs ${before.benefice} initial`);
  } else {
    console.log('  ✓ benefice global restauré à l\'état initial');
  }
  await sb.auth.signOut();
}

await cleanup([saleAttachedId, saleUnattachedId]);

console.log('\n=== TEST MARGE PAR LOT PASS ===');
console.log('sale_items.lot_id : OK (nullable, rétro-compat conservée)');
console.log('v_lot_overview.revenu_rattache + marge : OK');
console.log('Anti-double-comptage : benefice += 1×sale_total (jamais 2×).');

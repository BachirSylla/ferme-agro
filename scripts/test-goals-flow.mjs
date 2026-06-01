// Test end-to-end Objectifs : reproduit le scénario utilisateur.
//   - production_oeufs = 5000 mensuel → progression cohérente avec la ponte du mois
//   - benefice = 100000 mensuel → progression cohérente avec le tableau de bord
//   - édition + archivage OK

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
const email = `claude-goals-test-${Date.now()}@mailinator.com`;
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

function lastOfMonthIso(yyyymm01) {
  const [y, m] = yyyymm01.split('-').map(Number);
  const d = new Date(y, m, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const monthEnd = lastOfMonthIso(monthStart);

console.log(`[setup] signUp + données du mois`);
const { data: su, error: suErr } = await sb.auth.signUp({ email, password: 'TestPassword123!' });
if (suErr || !su.session) { console.error('  ✗', suErr?.message); process.exit(1); }
const orgId = (await sb.from('profiles').select('org_id').eq('id', su.user.id).single()).data.org_id;

const { data: cailles } = await sb.from('species').insert({ org_id: orgId, name: 'Cailles' }).select().single();
const { data: oeufs } = await sb.from('products').insert({ org_id: orgId, species_id: cailles.id, name: 'Œufs de caille', unit: 'unite', default_price: 100 }).select().single();
const { data: lot } = await sb.from('lots').insert({ org_id: orgId, species_id: cailles.id, code: 'LOT-CAILLES-001', initial_count: 200, current_count: 196, status: 'actif' }).select().single();

// Vente 7000 + dépenses 49000 + ponte 162 (= scénario dashboard)
const saleId = crypto.randomUUID();
await sb.from('sales').insert({ id: saleId, org_id: orgId, day: today, total: 7000, payment_method: 'wave', status: 'payee' });
await sb.from('sale_items').insert({ org_id: orgId, sale_id: saleId, product_id: oeufs.id, quantity: 30, unit_price: 100 });
await sb.from('expenses').insert([
  { org_id: orgId, lot_id: lot.id, day: today, category: 'aliment', amount: 46000, payment_method: 'cash' },
  { org_id: orgId, lot_id: null, day: today, category: 'achat marchandise', amount: 3000, payment_method: 'cash' },
]);
await sb.from('production_records').insert({
  org_id: orgId, lot_id: lot.id, product_id: oeufs.id, day: today, quantity: 162, category: 'ponte',
});
console.log('  ✓ setup');

// ─── G1 : production_oeufs = 5000, mensuel ─────────────────
console.log('\n[G1] créer objectif "production_oeufs = 5000, mensuel"');
const { data: g1, error: g1Err } = await sb.from('goals').insert({
  org_id: orgId,
  metric: 'production_oeufs',
  target_value: 5000,
  period: 'mensuel',
}).select().single();
if (g1Err) { console.error('  ✗', g1Err.message); process.exit(1); }
console.log('  ✓ goal créé', g1.id.slice(0, 8));

console.log('  → calcul réalisé (somme ponte sur', monthStart, '→', monthEnd, ')');
const { data: pontes } = await sb
  .from('production_records')
  .select('quantity')
  .eq('category', 'ponte')
  .gte('day', monthStart)
  .lte('day', monthEnd)
  .is('deleted_at', null);
const ponteSum = (pontes ?? []).reduce((s, r) => s + r.quantity, 0);
const ponteProgress = (ponteSum / 5000) * 100;
console.log(`  → réalisé = ${ponteSum}, soit ${ponteProgress.toFixed(1)} % de 5000`);
if (ponteSum !== 162) { console.error('  ✗ ponte attendue 162'); process.exit(1); }

// ─── G2 : benefice = 100000, mensuel ───────────────────────
console.log('\n[G2] créer objectif "benefice = 100000, mensuel"');
const { data: g2, error: g2Err } = await sb.from('goals').insert({
  org_id: orgId,
  metric: 'benefice',
  target_value: 100000,
  period: 'mensuel',
}).select().single();
if (g2Err) { console.error('  ✗', g2Err.message); process.exit(1); }
console.log('  ✓ goal créé', g2.id.slice(0, 8));

console.log('  → calcul réalisé (v_financial_summary sur le mois)');
const { data: sumRows } = await sb
  .from('v_financial_summary')
  .select('revenus, benefice')
  .gte('mois', monthStart)
  .lte('mois', monthStart);
const beneficeSum = (sumRows ?? []).reduce((s, r) => s + (r.benefice ?? 0), 0);
console.log(`  → bénéfice réalisé = ${beneficeSum} FCFA (cohérent avec dashboard)`);
if (beneficeSum !== -42000) { console.error('  ✗ bénéfice attendu -42000'); process.exit(1); }

// ─── G3 : édition + archivage ──────────────────────────────
console.log('\n[G3] éditer g1 : cible 5000 → 4000');
const { error: uErr } = await sb.from('goals').update({ target_value: 4000 }).eq('id', g1.id);
if (uErr) { console.error('  ✗', uErr.message); process.exit(1); }
const { data: g1b } = await sb.from('goals').select('target_value').eq('id', g1.id).single();
if (Number(g1b.target_value) !== 4000) { console.error('  ✗ target_value non mis à jour'); process.exit(1); }
console.log('  ✓ target_value = 4000');

console.log('\n[G4] archiver g2');
await sb.from('goals').update({ deleted_at: new Date().toISOString() }).eq('id', g2.id);
const { data: actifs } = await sb.from('goals').select('id, metric').is('deleted_at', null);
console.log('  objectifs actifs :', actifs);
if (actifs.length !== 1) { console.error('  ✗ 1 objectif attendu'); process.exit(1); }

// ─── Projection linéaire (logique UI reproduite) ───────────
console.log('\n[projection] simulation linéaire pour production_oeufs');
const startD = new Date(`${monthStart}T00:00:00`);
const endD = new Date(`${monthEnd}T00:00:00`);
const todayD = new Date(`${today}T00:00:00`);
const totalDays = Math.round((endD.getTime() - startD.getTime()) / 86_400_000) + 1;
const elapsed = Math.round((todayD.getTime() - startD.getTime()) / 86_400_000) + 1;
const projection = Math.round((ponteSum / elapsed) * totalDays);
console.log(`  jours : ${elapsed}/${totalDays}`);
console.log(`  réalisé : ${ponteSum} → projection fin de mois : ${projection}`);

await sb.auth.signOut();
console.log('\n=== TEST OBJECTIFS PASS ===');
console.log(`production_oeufs : 162 / 4000 (~${ponteProgress.toFixed(1)}% de la cible initiale 5000)`);
console.log(`benefice : -42000 / 100000 (cohérent avec dashboard)`);
console.log('Soft delete OK.');

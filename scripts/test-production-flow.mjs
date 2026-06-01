// Test end-to-end Production contre Supabase hébergé.
// Reproduit le scénario utilisateur :
//   - lot "LOT-CAILLES-001" + produits "Œufs de caille" et "Miel" (sans espèce)
//   - saisir 150 ponte sur ce lot
//   - saisir 8 casse sur ce lot
//   - saisir 1 recolte de Miel SANS lot
//   - éditer la première saisie (150 → 162)
//   - archiver la saisie de Miel

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
const email = `claude-prod-test-${Date.now()}@mailinator.com`;

console.log(`[1] signUp ${email} + setup catalogue + lot`);
const { data: su, error: suErr } = await sb.auth.signUp({ email, password: 'TestPassword123!' });
if (suErr || !su.session) { console.error('  ✗', suErr?.message); process.exit(1); }
const orgId = (await sb.from('profiles').select('org_id').eq('id', su.user.id).single()).data.org_id;

const { data: cailles } = await sb.from('species').insert({ org_id: orgId, name: 'Cailles', category: 'volaille' }).select().single();
const { data: oeufs } = await sb.from('products').insert({ org_id: orgId, species_id: cailles.id, name: 'Œufs de caille', unit: 'unite', default_price: 100 }).select().single();
const { data: miel } = await sb.from('products').insert({ org_id: orgId, species_id: null, name: 'Miel', unit: 'litre', default_price: 5000 }).select().single();
const { data: lot } = await sb.from('lots').insert({ org_id: orgId, species_id: cailles.id, code: 'LOT-CAILLES-001', initial_count: 200, current_count: 200, status: 'actif' }).select().single();
console.log('  ✓ setup', { species: cailles.id.slice(0, 8), oeufs: oeufs.id.slice(0, 8), miel: miel.id.slice(0, 8), lot: lot.id.slice(0, 8) });

const today = new Date().toISOString().slice(0, 10);

console.log('[2] saisir 150 ponte (Œufs de caille, lot LOT-CAILLES-001, today)');
const { data: r1, error: r1Err } = await sb
  .from('production_records')
  .insert({ org_id: orgId, day: today, product_id: oeufs.id, lot_id: lot.id, quantity: 150, category: 'ponte' })
  .select()
  .single();
if (r1Err) { console.error('  ✗', r1Err.message); process.exit(1); }
console.log('  ✓ rec', r1.id.slice(0, 8), '-', r1.quantity, 'ponte');

console.log('[3] saisir 8 casse (Œufs de caille, lot LOT-CAILLES-001, today)');
const { data: r2, error: r2Err } = await sb
  .from('production_records')
  .insert({ org_id: orgId, day: today, product_id: oeufs.id, lot_id: lot.id, quantity: 8, category: 'casse' })
  .select()
  .single();
if (r2Err) { console.error('  ✗', r2Err.message); process.exit(1); }
console.log('  ✓ rec', r2.id.slice(0, 8), '-', r2.quantity, 'casse');

console.log('[4] saisir 1 recolte de Miel SANS lot (lot_id = null)');
const { data: r3, error: r3Err } = await sb
  .from('production_records')
  .insert({ org_id: orgId, day: today, product_id: miel.id, lot_id: null, quantity: 1, category: 'recolte' })
  .select()
  .single();
if (r3Err) { console.error('  ✗', r3Err.message); process.exit(1); }
if (r3.lot_id !== null) { console.error('  ✗ lot_id devrait être null'); process.exit(1); }
console.log('  ✓ rec', r3.id.slice(0, 8), '-', r3.quantity, 'recolte (lot_id =', String(r3.lot_id) + ')');

console.log('[5] lister les saisies du jour');
const { data: list } = await sb
  .from('production_records')
  .select('quantity, category, lot_id, product_id')
  .is('deleted_at', null)
  .eq('day', today)
  .order('created_at', { ascending: true });
console.log('  saisies :', list);
if (list.length !== 3) { console.error('  ✗ devrait avoir 3 saisies'); process.exit(1); }

console.log('[6] éditer la saisie ponte : 150 → 162');
const { error: u1 } = await sb.from('production_records').update({ quantity: 162 }).eq('id', r1.id);
if (u1) { console.error('  ✗', u1.message); process.exit(1); }
const { data: r1b } = await sb.from('production_records').select('quantity').eq('id', r1.id).single();
if (r1b.quantity !== 162) { console.error('  ✗ quantity attendu 162, reçu', r1b.quantity); process.exit(1); }
console.log('  ✓ quantity = 162');

console.log('[7] archiver la saisie Miel');
const { error: arch } = await sb.from('production_records').update({ deleted_at: new Date().toISOString() }).eq('id', r3.id);
if (arch) { console.error('  ✗', arch.message); process.exit(1); }

console.log('[8] liste après archivage : 2 saisies attendues');
const { data: after } = await sb
  .from('production_records')
  .select('quantity, category')
  .is('deleted_at', null)
  .eq('day', today)
  .order('created_at', { ascending: true });
console.log('  visibles :', after);
if (after.length !== 2) { console.error('  ✗ devrait avoir 2 saisies'); process.exit(1); }

console.log('[9] miel toujours en base (soft delete) ?');
const { data: mielRow } = await sb.from('production_records').select('deleted_at').eq('id', r3.id).single();
if (!mielRow.deleted_at) { console.error('  ✗ deleted_at vide'); process.exit(1); }
console.log('  ✓ conservée, deleted_at =', mielRow.deleted_at);

await sb.auth.signOut();
console.log('\n=== TEST PRODUCTION PASS ===');
console.log('Saisies multiples sur un même lot, saisie sans lot, édition, soft delete — OK.');

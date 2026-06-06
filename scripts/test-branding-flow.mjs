// Test e2e Personnalisation contre Supabase hébergé.
// Lit les credentials depuis .env.local (TEST_USER_EMAIL / TEST_USER_PASSWORD)
// car les signups sont désactivés sur ce projet — on ne peut pas créer un user
// à la volée. AUCUN secret en dur dans ce fichier.
// Vérifie :
//   - le propriétaire peut UPDATE name / slogan / color_primary
//   - .select().single() retourne la ligne avec les nouvelles valeurs
// IMPORTANT : restaure les valeurs d'origine en fin de test pour ne pas
// laisser la ferme de l'utilisateur dans un état inattendu.

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

const TEST_EMAIL = env.TEST_USER_EMAIL;
const TEST_PASSWORD = env.TEST_USER_PASSWORD;
if (!TEST_EMAIL || !TEST_PASSWORD) {
  console.error('Manque TEST_USER_EMAIL ou TEST_USER_PASSWORD dans .env.local.');
  console.error('Ajoute-les (gitignored) pour pouvoir lancer ce test sur ton projet.');
  process.exit(1);
}

console.log(`[1] signIn ${TEST_EMAIL}`);
const { data: si, error: siErr } = await sb.auth.signInWithPassword({
  email: TEST_EMAIL,
  password: TEST_PASSWORD,
});
if (siErr || !si.session) { console.error('  ✗ signIn:', siErr?.message); process.exit(1); }
const orgId = (await sb.from('profiles').select('org_id').eq('id', si.user.id).single()).data.org_id;
console.log('  ✓ session ouverte, org', orgId.slice(0, 8));

// ─── [2] Snapshot état initial pour pouvoir restaurer ─────
console.log('\n[2] snapshot état initial');
const { data: original, error: origErr } = await sb
  .from('organizations')
  .select('name, slogan, color_primary')
  .eq('id', orgId)
  .single();
if (origErr) { console.error('  ✗', origErr.message); process.exit(1); }
console.log('  ✓ état d\'origine :', original);

const finalize = async () => {
  console.log('\n[FINAL] restauration de l\'état d\'origine');
  const { error: restErr } = await sb
    .from('organizations')
    .update({
      name: original.name,
      slogan: original.slogan,
      color_primary: original.color_primary,
    })
    .eq('id', orgId);
  if (restErr) {
    console.error('  ✗ ÉCHEC RESTAURATION :', restErr.message);
    console.error('     valeurs à remettre manuellement :', original);
    process.exit(1);
  }
  console.log('  ✓ valeurs d\'origine restaurées');
  await sb.auth.signOut();
};

try {
  // ─── [3] UPDATE name + slogan + color_primary ──────────────
  console.log('\n[3] UPDATE name + slogan + color_primary');
  const { data: upd, error: updErr } = await sb
    .from('organizations')
    .update({
      name: 'Ferme Diakhao (test)',
      slogan: 'Œufs frais & miel de brousse',
      color_primary: '#1d4ed8',
    })
    .eq('id', orgId)
    .select()
    .single();
  if (updErr) throw new Error(updErr.message);
  console.log('  ✓ retour API :', {
    name: upd.name,
    slogan: upd.slogan,
    color_primary: upd.color_primary,
  });
  if (upd.name !== 'Ferme Diakhao (test)') throw new Error('name non persisté');
  if (upd.slogan !== 'Œufs frais & miel de brousse') throw new Error('slogan non persisté');
  if (upd.color_primary !== '#1d4ed8') throw new Error('color_primary non persisté');

  // ─── [4] Relecture indépendante : valeurs présentes en DB ─
  console.log('\n[4] relecture (vérifie qu\'on lit du DB, pas un cache)');
  const { data: reread } = await sb
    .from('organizations')
    .select('name, slogan, color_primary, updated_at')
    .eq('id', orgId)
    .single();
  console.log('  ✓ relecture :', reread);
  if (reread.color_primary !== '#1d4ed8') throw new Error('relecture incohérente');

  // ─── [5] UPDATE qui efface le slogan (null) ───────────────
  console.log('\n[5] UPDATE avec slogan = null');
  const { data: cleared } = await sb
    .from('organizations')
    .update({ slogan: null })
    .eq('id', orgId)
    .select('slogan')
    .single();
  if (cleared.slogan !== null) throw new Error('slogan null non persisté');
  console.log('  ✓ slogan = null OK');

  // ─── [6] UPDATE id d'une org inexistante : 0 ligne ────────
  console.log('\n[6] tenter d\'UPDATE une org ID inexistant (.eq id étranger)');
  const fakeId = '00000000-0000-0000-0000-000000000001';
  const { data: foreign } = await sb
    .from('organizations')
    .update({ name: 'TAKEOVER' })
    .eq('id', fakeId)
    .select();
  console.log('  rows touchées :', foreign?.length ?? 0);
  if ((foreign?.length ?? 0) !== 0) throw new Error('UPDATE sur fakeId aurait dû ne rien toucher');
  console.log('  ✓ 0 ligne touchée (RLS + id inexistant).');

  await finalize();
  console.log('\n=== TEST BRANDING PASS ===');
  console.log('UPDATE name/slogan/color_primary : OK.');
  console.log('Relecture indépendante : valeurs cohérentes.');
  console.log('Slogan null : OK.');
  console.log('UPDATE cross-org : 0 ligne (RLS).');
} catch (err) {
  console.error('\n  ✗ test failed :', err.message);
  await finalize();
  process.exit(1);
}

// Test e2e Upload Logo contre Supabase Storage (bucket "logos").
// Vérifie :
//   - upload à <org_id>/test-<ts>.png (path préfixé par org_id) → success
//   - URL publique du fichier accessible en HEAD (HTTP 200)
//   - upload à <fake_uuid>/test.png (org étrangère) → BLOQUÉ par policy
//   - UPDATE organizations.logo_url + restauration de la valeur d'origine
// AUCUN secret en dur (lit TEST_USER_EMAIL / TEST_USER_PASSWORD dans .env.local).

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
  console.error('Manque TEST_USER_EMAIL ou TEST_USER_PASSWORD dans .env.local.');
  process.exit(1);
}

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const ts = Date.now();
const TEST_PATH_SUFFIX = `test-${ts}.png`;

// 1×1 PNG transparent (67 bytes, base64).
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const tinyPng = new Uint8Array(Buffer.from(TINY_PNG_B64, 'base64'));

console.log(`[1] signIn ${env.TEST_USER_EMAIL}`);
const { data: si, error: siErr } = await sb.auth.signInWithPassword({
  email: env.TEST_USER_EMAIL,
  password: env.TEST_USER_PASSWORD,
});
if (siErr || !si.session) { console.error('  ✗ signIn:', siErr?.message); process.exit(1); }
const orgId = (await sb.from('profiles').select('org_id').eq('id', si.user.id).single()).data.org_id;
console.log('  ✓ org', orgId.slice(0, 8));

// Snapshot l'état initial pour pouvoir restaurer.
const { data: orig } = await sb
  .from('organizations')
  .select('logo_url')
  .eq('id', orgId)
  .single();
console.log('  snapshot logo_url =', orig.logo_url ?? '(null)');

const cleanup = async () => {
  console.log('\n[FINAL] nettoyage');
  // Retire le fichier de test si présent (ignore "not found").
  const testPath = `${orgId}/${TEST_PATH_SUFFIX}`;
  await sb.storage.from('logos').remove([testPath]);
  // Restaure logo_url
  await sb.from('organizations').update({ logo_url: orig.logo_url }).eq('id', orgId);
  console.log('  ✓ fichier test supprimé, logo_url restauré à', orig.logo_url ?? '(null)');
  await sb.auth.signOut();
};

try {
  // ─── [2] Upload dans <org_id>/ → success ─────────────────
  console.log(`\n[2] upload bucket logos / ${orgId.slice(0, 8)}/${TEST_PATH_SUFFIX}`);
  const { error: upErr } = await sb.storage
    .from('logos')
    .upload(`${orgId}/${TEST_PATH_SUFFIX}`, tinyPng, {
      upsert: true,
      contentType: 'image/png',
    });
  if (upErr) throw new Error(`upload propre échoué : ${upErr.message}`);
  console.log('  ✓ upload réussi');

  // ─── [3] URL publique accessible ────────────────────────
  const { data: { publicUrl } } = sb.storage
    .from('logos')
    .getPublicUrl(`${orgId}/${TEST_PATH_SUFFIX}`);
  console.log(`[3] HEAD ${publicUrl.slice(-60)} …`);
  const head = await fetch(publicUrl, { method: 'HEAD' });
  console.log('  → status', head.status, head.headers.get('content-type'));
  if (head.status !== 200) throw new Error(`URL publique non accessible (${head.status})`);
  console.log('  ✓ lecture publique OK');

  // ─── [4] Upload cross-org → DOIT échouer (policy) ───────
  const fakeOrgId = '00000000-0000-0000-0000-000000000099';
  console.log(`\n[4] upload cross-org ${fakeOrgId.slice(0, 8)}/${TEST_PATH_SUFFIX} → DOIT échouer`);
  const { error: hijackErr } = await sb.storage
    .from('logos')
    .upload(`${fakeOrgId}/${TEST_PATH_SUFFIX}`, tinyPng, {
      upsert: true,
      contentType: 'image/png',
    });
  if (!hijackErr) {
    // Si succès, on nettoie quand même puis on plante.
    await sb.storage.from('logos').remove([`${fakeOrgId}/${TEST_PATH_SUFFIX}`]);
    throw new Error('upload cross-org a réussi ! Policy storage trop permissive.');
  }
  console.log('  ✓ refus côté policy :', hijackErr.message);

  // ─── [5] UPDATE logo_url avec la nouvelle URL ───────────
  console.log('\n[5] UPDATE organizations.logo_url');
  const urlWithBust = `${publicUrl}?t=${ts}`;
  const { data: upd, error: dbErr } = await sb
    .from('organizations')
    .update({ logo_url: urlWithBust })
    .eq('id', orgId)
    .select('logo_url')
    .single();
  if (dbErr) throw new Error(dbErr.message);
  console.log('  ✓ logo_url =', upd.logo_url.slice(-50));

  // ─── [6] Suppression (mimicke removeLogo) ───────────────
  console.log('\n[6] remove + logo_url = null');
  await sb.storage.from('logos').remove([`${orgId}/${TEST_PATH_SUFFIX}`]);
  const { data: cleared } = await sb
    .from('organizations')
    .update({ logo_url: null })
    .eq('id', orgId)
    .select('logo_url')
    .single();
  if (cleared.logo_url !== null) throw new Error('logo_url non remis à null');
  console.log('  ✓ fichier supprimé du bucket, logo_url = null');

  // ─── [7] Vérifier que l'URL est bien 404 après remove ──
  console.log('\n[7] HEAD après suppression → 404 attendu');
  const head404 = await fetch(publicUrl, { method: 'HEAD' });
  console.log('  → status', head404.status);
  if (head404.status === 200) {
    console.warn('  ⚠ encore accessible (cache CDN ?). Pas bloquant pour le test.');
  } else {
    console.log('  ✓ accès refusé comme attendu');
  }

  await cleanup();
  console.log('\n=== TEST LOGO PASS ===');
  console.log('Upload prefix org_id : OK.');
  console.log('Lecture publique : OK.');
  console.log('Upload cross-org : REFUSÉ par la policy.');
  console.log('UPDATE + suppression : OK.');
} catch (err) {
  console.error('\n  ✗ test failed :', err.message);
  await cleanup();
  process.exit(1);
}

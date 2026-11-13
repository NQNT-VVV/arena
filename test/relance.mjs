/**
 * Relancer une session : tout le monde suit.
 *
 * Une nouvelle edition reinscrit les participants de l'ancienne (pseudo, role,
 * meme jeton) et annonce a chacun — et a l'ecran — ou se joue la suite. Ce
 * test passe par de vraies sockets, sur un serveur deja lance :
 *
 *     ARENA_URL=http://localhost:3000 node test/relance.mjs
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

const BASE = process.env.ARENA_URL;
if (!BASE) {
  console.error('\n  Ce test vise un serveur deja lance :\n\n      ARENA_URL=http://localhost:3000 node test/relance.mjs\n');
  process.exit(1);
}

const sockets = [];
const ouvrir = () => new Promise((resolve, reject) => {
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  s.once('connect', () => resolve(s));
  s.once('connect_error', reject);
});
const appel = (s, evenement, charge = {}) => new Promise((resolve) => s.emit(evenement, charge, resolve));
const attendre = (s, evenement, ms = 4000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`« ${evenement} » jamais recu`)), ms);
  s.once(evenement, (charge) => { clearTimeout(t); resolve(charge); });
});
const dernier = (s, evenement) => { let v = null; s.on(evenement, (c) => { v = c; }); return () => v; };

try {
  // --- Une session ouverte, un createur, un spectateur, un ecran -----------
  const regie = await ouvrir();
  const cree = await appel(regie, 'host:create', { name: 'Relance', mediaType: 'audio', brief: 'essai' });
  assert.equal(cree.ok, true, cree.error);
  const code = cree.code;
  assert.equal((await appel(regie, 'host:publish')).ok, true);

  const createur = await ouvrir();
  const jc = await appel(createur, 'play:join', { code, pseudo: 'Nour' });
  assert.equal(jc.ok, true, jc.error);
  const spectateur = await ouvrir();
  const js = await appel(spectateur, 'play:join', { code, pseudo: 'Camille', spectator: true });
  assert.equal(js.ok, true, js.error);
  const ecran = await ouvrir();
  assert.equal((await appel(ecran, 'screen:attach', { code })).ok, true);

  // --- L'animateur relance : chacun apprend ou aller ------------------------
  const annonces = [attendre(createur, 'session:moved'), attendre(spectateur, 'session:moved'), attendre(ecran, 'session:moved')];
  const relance = await appel(regie, 'host:duplicate', { copyAssets: true });
  assert.equal(relance.ok, true, relance.error);
  const suite = relance.code;
  assert.notEqual(suite, code, 'la nouvelle edition a son propre code');
  const [ac, as, ae] = await Promise.all(annonces);
  assert.equal(ac.code, suite);
  assert.equal(as.code, suite);
  assert.equal(ae.code, suite);
  assert.ok(ac.participantId && as.participantId, 'chaque participant recoit son nouvel identifiant');
  assert.notEqual(ac.participantId, jc.participantId, 'un identifiant neuf, pas celui de l’ancienne session');
  assert.equal(ae.participantId, undefined, 'l’ecran ne recoit que le code');

  // La regie voit deja ses deux inscrits, avant meme qu'ils aient suivi.
  const inscrits = relance.state.roster ?? [];
  assert.equal(inscrits.length, 2, 'les deux participants sont reinscrits');
  assert.deepEqual(inscrits.map((p) => p.pseudo).sort(), ['Camille', 'Nour']);

  // --- Chacun reprend sa place avec le MEME jeton, sans rien retaper --------
  const createur2 = await ouvrir();
  const moiC = dernier(createur2, 'you');
  const rc = await appel(createur2, 'play:join', { code: suite, pseudo: 'Nour', participantId: ac.participantId, token: jc.token });
  assert.equal(rc.ok, true, rc.error);
  assert.equal(rc.participantId, ac.participantId, 'c’est une reprise, pas une nouvelle inscription');

  const spectateur2 = await ouvrir();
  const moiS = dernier(spectateur2, 'you');
  const rs = await appel(spectateur2, 'play:join', { code: suite, pseudo: 'Camille', participantId: as.participantId, token: js.token });
  assert.equal(rs.ok, true, rs.error);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(moiS()?.spectator, true, 'le spectateur reste spectateur');
  assert.equal(!!moiC()?.spectator, false, 'le createur reste createur');

  // Le jeton d'un autre ne donne pas sa place.
  const intrus = await ouvrir();
  const ri = await appel(intrus, 'play:join', { code: suite, pseudo: 'Nour', participantId: ac.participantId, token: js.token });
  assert.equal(ri.ok, false, 'un mauvais jeton ne reprend pas la place de Nour');

  // --- Qui revient plus tard sur l'ancienne session est renvoye vers la suite
  const retardataire = await ouvrir();
  const tard = attendre(retardataire, 'session:moved');
  await appel(retardataire, 'play:join', { code, pseudo: 'Nour', participantId: jc.participantId, token: jc.token });
  assert.equal((await tard).code, suite);
  assert.equal((await tard).participantId, ac.participantId);

  const ecranTard = await ouvrir();
  const tardE = attendre(ecranTard, 'session:moved');
  await appel(ecranTard, 'screen:attach', { code });
  assert.equal((await tardE).code, suite);

  console.log('relance : 17 verifications, tout le monde suit');
} finally {
  for (const s of sockets) s.close();
}

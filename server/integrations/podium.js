'use strict';

/**
 * Podium, le hub : comptes, classement Elo, defis hebdo.
 *
 * Module optionnel : sans `PODIUM_URL`, il ne s'attache a rien et ne coute
 * rien. Avec, il fait trois choses, et rien de plus :
 *
 *   - lire l'identite du joueur connecte au hub, portee par un cookie signe
 *     que tous les sous-domaines recoivent ;
 *   - envoyer le classement au hub une fois qu'il est devoile a la salle ;
 *   - relayer aux ecrans les variations d'Elo que le hub renvoie.
 *
 * Le coeur ignore que ce module existe : il emet `results:complete`, et qui
 * veut ecoute. Un hub injoignable est un classement non transmis, jamais une
 * soiree arretee. Zero dependance : `crypto` et `fetch` de Node 22.
 */

const crypto = require('crypto');

const config = require('../config');
const views = require('../views');

const SLUG = 'arena';
const CACHE_MS = 5 * 60 * 1000;

const enabled = () => Boolean(config.podium.url);

/* ------------------------------------------------------------------ */
/* Identite                                                            */
/* ------------------------------------------------------------------ */

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Verifie et decode le cookie d'identite Podium. Null si absent ou invalide.
 *
 * Le pid n'est jamais accepte du client : il est lu ici, cote serveur, dans le
 * cookie signe. Comparaison HMAC en temps constant, expiration en secondes.
 */
function readIdentity(cookieHeader) {
  const { ssoSecret, cookie } = config.podium;
  if (!ssoSecret) return null;
  const raw = parseCookies(cookieHeader)[cookie];
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = b64url(crypto.createHmac('sha256', ssoSecret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.v !== 1 || typeof payload.pid !== 'string' || !payload.pid) return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return {
      pid: payload.pid.slice(0, 64),
      pseudo: String(payload.pseudo || '').slice(0, 24),
      avatar: String(payload.avatar || '').slice(0, 8),
    };
  } catch {
    return null;
  }
}

/** Identite portee par une requete HTTP ou un handshake Socket.IO. */
const identityOf = (headers) => (enabled() ? readIdentity(headers?.cookie) : null);

/* ------------------------------------------------------------------ */
/* Reseau                                                              */
/* ------------------------------------------------------------------ */

async function fetchJson(url, init, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Envoie un classement. Une nouvelle tentative apres 5 s en cas d'echec
 * reseau ou 5xx, puis abandon en journal. Rend la reponse JSON ou null.
 */
async function postResults(slug, payload) {
  if (!enabled() || !config.podium.gameKey) return null;
  const url = `${config.podium.url}/api/v1/games/${encodeURIComponent(slug)}/results`;
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.podium.gameKey}` },
    body: JSON.stringify(payload),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchJson(url, init);
      if (res.ok) return res.json;
      // 4xx : inutile de reessayer, le payload ou la cle sont en cause.
      if (res.status < 500) {
        console.warn(`[arena] podium : resultats refuses (${res.status}) : ${res.json?.error || 'sans detail'}`);
        return null;
      }
      console.warn(`[arena] podium : hub en erreur (${res.status}), tentative ${attempt + 1}/2`);
    } catch (err) {
      console.warn(`[arena] podium : hub injoignable (${err.message}), tentative ${attempt + 1}/2`);
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

const challengeCache = new Map(); // slug -> { at, list }

/** Defis actifs pour ce jeu. Tableau vide si le hub est injoignable. */
async function activeChallenges(slug = SLUG) {
  if (!enabled()) return [];
  const hit = challengeCache.get(slug);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  try {
    const res = await fetchJson(`${config.podium.url}/api/v1/games/${encodeURIComponent(slug)}/challenges/active`, {}, 5000);
    const list = res.ok && Array.isArray(res.json?.challenges) ? res.json.challenges : [];
    challengeCache.set(slug, { at: Date.now(), list });
    return list;
  } catch (err) {
    console.warn(`[arena] podium : defis indisponibles (${err.message})`);
    return hit?.list ?? [];
  }
}

/* ------------------------------------------------------------------ */
/* Classement                                                          */
/* ------------------------------------------------------------------ */

/**
 * Le classement d'une session, au format du hub.
 *
 * Seuls les rendus revelees avec un auteur comptent. Les mis hors classement
 * (rendu hors delai, politique « unranked ») partagent le rang qui suit le
 * dernier classe : ils ont joue, ils apparaissent, mais derriere tout le monde.
 */
function resultsPayload(session) {
  const podium = views.podiumView({ ...session, revealedRank: Number.MAX_SAFE_INTEGER });
  const rows = (podium?.rows ?? []).filter((r) => !r.hidden && r.author);
  const lastRank = rows.reduce((max, r) => (r.rank ? Math.max(max, r.rank) : max), 0);

  const players = rows.map((r) => ({
    pid: session.participants.get(r.author.id)?.podiumPid ?? null,
    nickname: r.author.pseudo,
    avatar: r.author.avatar,
    score: r.score ?? r.raw ?? 0,
    rank: r.unranked || r.rank == null ? lastRank + 1 : r.rank,
  }));

  return {
    matchId: session.id,
    mode: session.mediaType,
    challengeId: null,
    playedAt: session.endedAt ?? Date.now(),
    durationS: Math.round((session.config?.durationMs ?? 0) / 1000),
    meta: {
      name: session.name,
      code: session.code,
      scale: session.config?.scale,
      participants: [...session.participants.values()].filter((p) => !p.isHost).length,
    },
    players,
  };
}

/**
 * Variations d'Elo, indexees par participant.
 *
 * Le hub raisonne en comptes (`pid`) ; les ecrans raisonnent en participants.
 * La traduction se fait ici, pour que le client n'ait jamais a connaitre le
 * pid de qui que ce soit.
 */
function ratingsPayload(session, ratings) {
  const byPid = new Map();
  for (const p of session.participants.values()) if (p.podiumPid) byPid.set(p.podiumPid, p);
  const out = [];
  for (const r of Array.isArray(ratings) ? ratings : []) {
    const p = byPid.get(r?.pid);
    if (!p || typeof r.after !== 'number') continue;
    const before = typeof r.before === 'number' ? r.before : r.after;
    out.push({
      participantId: p.id,
      pseudo: p.pseudo,
      before: Math.round(before),
      after: Math.round(r.after),
      delta: Math.round(r.after - before),
      tier: typeof r.tier === 'string' ? r.tier : null,
    });
  }
  return out;
}

async function sendResults(battle, session) {
  const payload = resultsPayload(session);
  // Sans joueur classe, il n'y a rien a ranker : le hub ignorerait l'envoi.
  if (!payload.players.length) return null;
  const res = await postResults(SLUG, payload);
  if (!res?.ok) return res;
  const ratings = ratingsPayload(session, res.ratings);
  if (ratings.length) {
    const { roomAll, roomHost, roomScreen } = require('../battle');
    for (const room of [roomAll, roomHost, roomScreen]) {
      battle.io.to(room(session.code)).emit('podium:ratings', { ratings });
    }
  }
  return res;
}

/** Branche le module sur le coeur. Rend vrai s'il est actif. */
function attach(battle) {
  if (!enabled()) return false;
  if (!config.podium.gameKey) console.warn('[arena] podium : PODIUM_GAME_KEY absent, les classements ne seront pas transmis');
  if (!config.podium.ssoSecret) console.warn('[arena] podium : PODIUM_SSO_SECRET absent, les joueurs ne seront pas reconnus');
  battle.events.on('results:complete', ({ session }) => {
    sendResults(battle, session).catch((err) => console.warn(`[arena] podium : ${err.message}`));
  });
  return true;
}

module.exports = {
  SLUG, enabled, attach, readIdentity, identityOf, parseCookies,
  postResults, activeChallenges, resultsPayload, ratingsPayload, sendResults,
};

'use strict';

/**
 * Annonces Discord, par webhook.
 *
 * Module optionnel : sans `DISCORD_WEBHOOK_URL`, il ne s'attache a rien et ne
 * coute rien. Avec, il ecoute les evenements du coeur et poste trois messages
 * dans la soiree — le lobby s'ouvre, la creation demarre, le classement est
 * devoile. Rien de plus : pas de bot, pas de jeton, pas de connexion
 * permanente. Un webhook suffit a annoncer, et c'est tout ce qu'on lui demande.
 *
 * Il ne fait jamais echouer une transition. Un Discord injoignable est un
 * message perdu, pas une soiree arretee.
 */

const config = require('../config');
const views = require('../views');

const MEDIA = { audio: 'Audio', image: 'Image', video: 'Video', text: 'Texte', file: 'Libre' };
const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

function inviteLine(session) {
  return config.publicUrl
    ? `Rejoindre : ${config.publicUrl}/j/${session.code}`
    : `Code de session : **${session.code}**`;
}

function minutes(ms) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`;
}

async function post(payload) {
  const url = config.discord.webhookUrl;
  if (!url) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Arena', ...payload }),
      signal: ctrl.signal,
    });
    if (!res.ok) console.warn(`[arena] discord : reponse ${res.status}`);
    return res.ok;
  } catch (err) {
    console.warn(`[arena] discord : ${err.message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function announceOpen(session) {
  return post({
    embeds: [{
      title: `\u{1F3A8} ${session.name}`,
      description: [
        `Le lobby est ouvert — rendu attendu : **${MEDIA[session.mediaType] ?? session.mediaType}**.`,
        `Temps de creation : **${minutes(session.config.durationMs)}**.`,
        '',
        inviteLine(session),
      ].join('\n'),
      color: 0x8b5cf6,
    }],
  });
}

function announceStart(session) {
  return post({
    embeds: [{
      title: `\u{23F1}\u{FE0F} ${session.name} — c'est parti`,
      description: `${session.participants.size} participant(s). Fin de la creation dans **${minutes(session.config.durationMs)}**.`,
      color: 0x22d3ee,
    }],
  });
}

function announceResults(session) {
  const podium = views.podiumView({ ...session, revealedRank: Number.MAX_SAFE_INTEGER });
  const lines = (podium?.rows ?? [])
    .filter((r) => !r.hidden && r.author)
    .map((r) => {
      const place = r.unranked ? 'HC' : (MEDALS[(r.rank ?? 99) - 1] ?? `${r.rank}.`);
      const score = r.score === null ? `(${r.raw})` : `**${r.score}**`;
      return `${place} ${r.author.pseudo} — ${score} / ${session.config.scale}`;
    });

  return post({
    embeds: [{
      title: `\u{1F3C6} ${session.name} — Classement`,
      description: lines.length ? lines.join('\n') : 'Aucun rendu n\u2019a ete depose.',
      color: 0xfbbf24,
    }],
  });
}

/** Branche le module sur le coeur. Rend vrai s'il est actif. */
function attach(battle) {
  if (!config.discord.webhookUrl) return false;
  battle.events.on('phase', ({ session, to }) => {
    if (to === 'lobby') void announceOpen(session);
    if (to === 'creation') void announceStart(session);
  });
  battle.events.on('results:complete', ({ session }) => { void announceResults(session); });
  return true;
}

module.exports = { attach, announceOpen, announceStart, announceResults };

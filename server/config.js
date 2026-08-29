'use strict';

/**
 * Toute la configuration du serveur, lue une fois au demarrage.
 *
 * C'est le seul fichier autorise a lire `process.env` : partout ailleurs on
 * importe `config`. Une valeur de reglage ecrite en dur dans un module metier
 * est un bug — elle devient invisible depuis le manifeste de deploiement.
 */

const path = require('path');
const crypto = require('crypto');

const str = (name, fallback) => {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
};

const int = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const bool = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
};

/** Liste de nombres separes par des virgules : "600,120,60,30". */
const ints = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const out = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return out.length ? out : fallback;
};

const dev = process.env.NODE_ENV !== 'production';
const DATA_DIR = path.resolve(str('DATA_DIR', path.join(__dirname, '..', 'data')));

/**
 * Secret de signature des jetons participant.
 *
 * En production il doit venir de l'environnement : un secret tire au hasard au
 * demarrage invaliderait tous les jetons a chaque redemarrage de pod, et les
 * participants perdraient leur place au pire moment. En developpement on
 * tolere l'aleatoire pour ne pas imposer un fichier .env au premier lancement.
 */
const SESSION_SECRET = str('SESSION_SECRET', null) || (() => {
  if (!dev) {
    throw new Error('SESSION_SECRET est obligatoire en production : sans lui, un redemarrage deconnecte tous les participants.');
  }
  return crypto.randomBytes(32).toString('hex');
})();

const config = {
  dev,
  port: int('PORT', 3000),
  metricsPort: int('METRICS_PORT', 9464),

  /** Origine publique, pour les liens d'invitation et les QR codes. Vide = deduite de la requete. */
  publicUrl: str('PUBLIC_URL', '').replace(/\/+$/, ''),

  dataDir: DATA_DIR,
  dbPath: str('DB_PATH', path.join(DATA_DIR, 'arena.db')),

  storage: {
    driver: str('STORAGE_DRIVER', 'local'),
    localDir: str('STORAGE_LOCAL_DIR', path.join(DATA_DIR, 'media')),
    // Renseignes seulement quand le driver s3 sera branche (increment ulterieur).
    s3: {
      bucket: str('S3_BUCKET', ''),
      region: str('S3_REGION', ''),
      endpoint: str('S3_ENDPOINT', ''),
      prefix: str('S3_PREFIX', 'arena/'),
    },
  },

  secret: SESSION_SECRET,

  /** Combien de sessions terminees on garde avant purge automatique. */
  retentionHours: int('RETENTION_HOURS', 24 * 14),
  /** Une session abandonnee en LOBBY ou CONFIGURATION finit par disparaitre. */
  staleHours: int('STALE_HOURS', 12),

  limits: {
    maxSessions: int('MAX_SESSIONS', 200),
    maxParticipants: int('MAX_PARTICIPANTS', 200),
    maxAssets: int('MAX_ASSETS', 30),
    /** Taille d'un rendu, en octets. 200 Mo par defaut. */
    maxFileBytes: int('MAX_FILE_BYTES', 200 * 1024 * 1024),
    /** Poids cumule du pack d'assets impose. 500 Mo par defaut. */
    maxAssetsBytes: int('MAX_ASSETS_BYTES', 500 * 1024 * 1024),
    maxBriefChars: int('MAX_BRIEF_CHARS', 4000),
    maxTextBodyChars: int('MAX_TEXT_BODY_CHARS', 20000),
  },

  /** Reglages par defaut d'une session ; l'animateur les ecrase a la creation. */
  defaults: {
    mediaType: str('DEFAULT_MEDIA_TYPE', 'audio'),
    durationMs: int('DEFAULT_DURATION_S', 3600) * 1000,
    graceMs: int('DEFAULT_GRACE_S', 120) * 1000,
    /** Seuils d'alerte sonore, en secondes restantes. */
    alerts: ints('DEFAULT_ALERTS_S', [600, 120, 60, 30]),
    endSound: bool('DEFAULT_END_SOUND', true),
    /** Duree de lecture maximale d'un rendu audio ou video, en secondes. */
    playMaxS: int('DEFAULT_PLAY_MAX_S', 45),
    /** Fondu de sortie applique sur la fin de cette lecture. */
    fadeOutS: int('DEFAULT_FADE_OUT_S', 3),
    scale: int('DEFAULT_SCALE', 5),
    /** Note appliquee quand un votant a saute un rendu. */
    defaultVote: int('DEFAULT_VOTE', 3),
    criteria: [],
    latePolicy: str('DEFAULT_LATE_POLICY', 'reject'),
    latePenalty: Number(str('DEFAULT_LATE_PENALTY', '1')),
    hostVotes: bool('DEFAULT_HOST_VOTES', false),
    /** L'animateur avance-t-il seul, ou la diffusion enchaine-t-elle quand tous ont vote ? */
    autoAdvance: bool('DEFAULT_AUTO_ADVANCE', false),
    allowedExt: [],
  },

  transcode: {
    concurrency: int('TRANSCODE_CONCURRENCY', 2),
    ffmpeg: str('FFMPEG_PATH', 'ffmpeg'),
    ffprobe: str('FFPROBE_PATH', 'ffprobe'),
  },

  /** Module Discord : inerte tant que l'URL n'est pas fournie. */
  discord: {
    webhookUrl: str('DISCORD_WEBHOOK_URL', ''),
  },
};

module.exports = config;

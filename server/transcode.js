'use strict';

/**
 * Transcodage des rendus.
 *
 * Trois raisons, et la premiere est l'anonymat : un fichier est **re-encode**,
 * jamais copie. C'est ce qui garantit que les tags ID3, l'EXIF, le XMP et le
 * « cree par » disparaissent — pas un nettoyeur de metadonnees qu'on
 * oublierait de mettre a jour au prochain format.
 *
 * Ensuite la diffusion : un format unique en sortie quel que soit celui
 * d'entree, un extrait deja tronque a la duree d'ecoute avec son fondu — donc
 * un fondu qui marche aussi sur iOS, ou la page n'a pas le droit de toucher au
 * volume — et la duree reelle du rendu, pour ne pas faire ecouter du silence.
 *
 * Enfin la forme d'onde : le serveur decode le son de toute facon, autant lui
 * faire calculer les crêtes plutot que d'imposer le decodage a chaque telephone.
 *
 * La file vit en base et les ouvriers tournent dans ce process. Si ffmpeg
 * manque, rien ne casse : le rendu est marque pret sans variantes, et la
 * diffusion sert l'original avec la coupure faite par la page.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const config = require('./config');
const repo = require('./repo');
const storage = require('./storage');
const { uuid } = require('./util');

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

/** Lance un binaire et rend sa sortie standard ; echoue avec la sortie d'erreur. */
function run(bin, args, { timeoutMs = 10 * 60 * 1000, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(bin)} a depasse ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { if (err.length < 200) err.push(d); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const tail = Buffer.concat(err).toString('utf8').trim().split('\n').slice(-4).join(' | ');
        reject(new Error(`${path.basename(bin)} a echoue (${code}) : ${tail.slice(0, 400)}`));
        return;
      }
      const buf = Buffer.concat(out);
      resolve(binary ? buf : buf.toString('utf8'));
    });
  });
}

let available = null;

/** ffmpeg et ffprobe repondent-ils ? Mesure une fois, au premier besoin. */
async function ffmpegAvailable() {
  if (available !== null) return available;
  try {
    await run(config.transcode.ffmpeg, ['-version'], { timeoutMs: 10000 });
    await run(config.transcode.ffprobe, ['-version'], { timeoutMs: 10000 });
    available = true;
  } catch (err) {
    available = false;
    console.warn(`[arena] ffmpeg indisponible (${err.message}) : les rendus seront servis tels quels, sans fondu serveur ni forme d'onde.`);
  }
  return available;
}

async function probe(file) {
  const raw = await run(config.transcode.ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height,duration',
    '-of', 'json',
    file,
  ], { timeoutMs: 60000 });
  const data = JSON.parse(raw);
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const durationS = Number(data.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  return {
    durationMs: Number.isFinite(durationS) && durationS > 0 ? Math.round(durationS * 1000) : null,
    hasVideo: !!video,
    hasAudio: !!audio,
    width: video?.width ?? null,
    height: video?.height ?? null,
  };
}

/**
 * Crêtes de la forme d'onde.
 *
 * Le son est ramene en mono a 4 kHz — largement assez pour une silhouette — et
 * decoupe en `bins` tranches dont on garde l'amplitude maximale. Huit cents
 * valeurs entre 0 et 1 : quelques kilo-octets, pour n'importe quelle duree.
 */
async function peaks(file, cutS, bins = 800) {
  const pcm = await run(config.transcode.ffmpeg, [
    '-v', 'error', '-nostdin',
    '-i', file,
    '-t', String(cutS),
    '-map', '0:a:0', '-vn',
    '-ac', '1', '-ar', '4000',
    '-f', 's16le', '-',
  ], { binary: true, timeoutMs: 120000 });

  const samples = pcm.length >> 1;
  if (!samples) return [];
  const per = Math.max(1, Math.ceil(samples / bins));
  const out = [];
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    const v = Math.abs(pcm.readInt16LE(i * 2));
    if (v > peak) peak = v;
    if ((i + 1) % per === 0 || i === samples - 1) {
      out.push(peak);
      peak = 0;
    }
  }
  const max = Math.max(1, ...out);
  return out.map((v) => Math.round((v / max) * 100) / 100);
}

/** Filtre de fondu de sortie, seulement si l'extrait est coupe avant sa fin. */
function fadeFilter(kind, cutS, fadeS, truncated) {
  if (!truncated || fadeS <= 0) return null;
  const start = Math.max(0, cutS - fadeS);
  return `${kind}fade=t=out:st=${start}:d=${fadeS}`;
}

/* ------------------------------------------------------------------ */
/* Recettes par type                                                   */
/* ------------------------------------------------------------------ */

async function transcodeAudio({ input, dir, playMaxS, fadeS }) {
  const info = await probe(input);
  if (!info.hasAudio) throw new Error('aucune piste audio');

  const durationS = info.durationMs ? info.durationMs / 1000 : playMaxS;
  const truncated = durationS > playMaxS + 0.25;
  const cutS = truncated ? playMaxS : durationS;
  const afade = fadeFilter('a', cutS, fadeS, truncated);

  // Version complete, nettoyee : c'est elle qu'on telecharge apres la revelation.
  const full = path.join(dir, 'full.mp3');
  await run(config.transcode.ffmpeg, [
    '-v', 'error', '-nostdin', '-y',
    '-i', input,
    '-map_metadata', '-1', '-map', '0:a:0', '-vn',
    '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100',
    '-id3v2_version', '0', '-write_xing', '1',
    full,
  ]);

  // Extrait de diffusion : tronque, fondu, nettoye.
  const preview = path.join(dir, 'preview.mp3');
  await run(config.transcode.ffmpeg, [
    '-v', 'error', '-nostdin', '-y',
    '-i', input,
    '-map_metadata', '-1', '-map', '0:a:0', '-vn',
    ...(truncated ? ['-t', String(cutS)] : []),
    ...(afade ? ['-af', afade] : []),
    '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100',
    '-id3v2_version', '0',
    preview,
  ]);

  const wave = await peaks(input, cutS);

  return {
    durationMs: info.durationMs,
    previewMs: Math.round(cutS * 1000),
    truncated,
    files: {
      full: { path: full, mime: 'audio/mpeg', ext: '.mp3' },
      preview: { path: preview, mime: 'audio/mpeg', ext: '.mp3' },
    },
    peaks: wave,
  };
}

async function transcodeVideo({ input, dir, playMaxS, fadeS }) {
  const info = await probe(input);
  if (!info.hasVideo) throw new Error('aucune piste video');

  const durationS = info.durationMs ? info.durationMs / 1000 : playMaxS;
  const truncated = durationS > playMaxS + 0.25;
  const cutS = truncated ? playMaxS : durationS;
  const vfade = fadeFilter('', cutS, fadeS, truncated);
  const afade = info.hasAudio ? fadeFilter('a', cutS, fadeS, truncated) : null;

  // On ne produit que l'extrait : re-encoder une video entiere de deux minutes
  // pour un telechargement d'apres-soiree n'en vaut pas le cout processeur.
  // L'original, nettoye de ses metadonnees par remultiplexage, tient ce role.
  const preview = path.join(dir, 'preview.mp4');
  await run(config.transcode.ffmpeg, [
    '-v', 'error', '-nostdin', '-y',
    '-i', input,
    '-map_metadata', '-1', '-map', '0:v:0', ...(info.hasAudio ? ['-map', '0:a:0'] : []),
    ...(truncated ? ['-t', String(cutS)] : []),
    '-vf', [`scale='min(1280,iw)':-2`, vfade].filter(Boolean).join(','),
    ...(afade ? ['-af', afade] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-movflags', '+faststart',
    preview,
  ], { timeoutMs: 20 * 60 * 1000 });

  // Remultiplexage sans re-encodage : les metadonnees partent, les images restent.
  const full = path.join(dir, 'full.mp4');
  let fullOk = true;
  try {
    await run(config.transcode.ffmpeg, [
      '-v', 'error', '-nostdin', '-y',
      '-i', input, '-map_metadata', '-1', '-map', '0', '-c', 'copy', '-movflags', '+faststart',
      full,
    ]);
  } catch {
    // Conteneur incompatible avec mp4 en copie : on se passe de la version complete.
    fullOk = false;
  }

  const wave = info.hasAudio ? await peaks(input, cutS).catch(() => []) : [];

  return {
    durationMs: info.durationMs,
    previewMs: Math.round(cutS * 1000),
    truncated,
    width: info.width,
    height: info.height,
    files: {
      preview: { path: preview, mime: 'video/mp4', ext: '.mp4' },
      ...(fullOk ? { full: { path: full, mime: 'video/mp4', ext: '.mp4' } } : {}),
    },
    peaks: wave,
  };
}

async function transcodeImage({ input, dir }) {
  // Chargement paresseux : sharp est un module natif lourd, inutile aux
  // sessions qui n'ont pas d'images.
  const sharp = require('sharp');
  const src = sharp(input, { failOn: 'none', limitInputPixels: 80e6 });
  const meta = await src.metadata();

  // `rotate()` sans argument applique l'orientation EXIF **avant** que
  // l'EXIF ne disparaisse : sinon une photo de telephone se retrouve couchee.
  const preview = path.join(dir, 'preview.webp');
  const out = await sharp(input, { failOn: 'none', limitInputPixels: 80e6 })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(preview);

  const thumb = path.join(dir, 'thumb.webp');
  await sharp(input, { failOn: 'none', limitInputPixels: 80e6 })
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(thumb);

  return {
    durationMs: null,
    width: out.width,
    height: out.height,
    // Format d'origine conserve pour l'archive : un designer veut son PNG.
    // Mais re-encode par sharp, donc sans EXIF ni XMP.
    files: {
      preview: { path: preview, mime: 'image/webp', ext: '.webp' },
      thumb: { path: thumb, mime: 'image/webp', ext: '.webp' },
      ...(await reencodeOriginalImage(input, dir, meta.format)),
    },
    peaks: [],
  };
}

async function reencodeOriginalImage(input, dir, format) {
  const sharp = require('sharp');
  const known = { png: ['png', 'image/png', '.png'], jpeg: ['jpeg', 'image/jpeg', '.jpg'], webp: ['webp', 'image/webp', '.webp'], gif: ['gif', 'image/gif', '.gif'] };
  const pick = known[format];
  if (!pick) return {};
  const [method, mime, ext] = pick;
  const full = path.join(dir, `full${ext}`);
  try {
    await sharp(input, { failOn: 'none', limitInputPixels: 80e6, animated: format === 'gif' })
      .rotate()[method]()
      .toFile(full);
    return { full: { path: full, mime, ext } };
  } catch {
    return {};
  }
}

const RECIPES = { audio: transcodeAudio, video: transcodeVideo, image: transcodeImage };

/* ------------------------------------------------------------------ */
/* Ouvriers                                                            */
/* ------------------------------------------------------------------ */

let battleRef = null;
let running = 0;
let stopped = false;

/** Un rendu televerse : on le met en file s'il y a quelque chose a en faire. */
function enqueue(submission) {
  if (!RECIPES[submission.kind] || !submission.originalKey) {
    // Texte, fichier libre, ou rien a transcoder : pret tel quel.
    repo.setSubmissionStatus(submission.id, 'ready', null, null);
    return false;
  }
  repo.removeJobsOf(submission.id);
  repo.setSubmissionStatus(submission.id, 'pending', null, null);
  repo.enqueueJob({ id: uuid(), submissionId: submission.id, kind: submission.kind });
  setImmediate(pump);
  return true;
}

/** Lance autant d'ouvriers que la configuration l'autorise. */
function pump() {
  if (stopped) return;
  while (running < config.transcode.concurrency) {
    const job = repo.claimJob();
    if (!job) return;
    running++;
    work(job).finally(() => { running--; setImmediate(pump); });
  }
}

async function work(job) {
  const submission = repo.submission(job.submission_id);
  if (!submission || !submission.originalKey) {
    repo.finishJob(job.id, 'done', 'rendu disparu');
    return;
  }
  const session = repo.sessionById(submission.sessionId);
  if (!session) {
    repo.finishJob(job.id, 'done', 'session disparue');
    return;
  }

  repo.setSubmissionStatus(submission.id, 'transcoding', null, null);
  notify(submission);

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'arena-'));
  try {
    if (!(await ffmpegAvailable()) && submission.kind !== 'image') {
      throw new Error('ffmpeg indisponible');
    }

    const input = path.join(dir, `input${path.extname(submission.originalKey) || ''}`);
    await pipeToFile(storage.createReadStream(submission.originalKey), input);

    const result = await RECIPES[submission.kind]({
      input, dir,
      playMaxS: session.config.playMaxS,
      fadeS: session.config.fadeOutS,
    });

    // Les variantes vont au stockage sous des clefs opaques, a cote de l'original.
    const base = submission.originalKey.replace(/\.[^./]+$/, '');
    const renditions = {
      durationMs: result.durationMs ?? null,
      previewMs: result.previewMs ?? null,
      truncated: !!result.truncated,
      width: result.width ?? null,
      height: result.height ?? null,
      files: {},
    };
    for (const [name, file] of Object.entries(result.files)) {
      const key = `${base}.${name}${file.ext}`;
      const { bytes } = await storage.put(key, fs.createReadStream(file.path));
      renditions.files[name] = { key, mime: file.mime, bytes };
    }
    if (result.peaks?.length) {
      const key = `${base}.peaks.json`;
      await storage.putBuffer(key, Buffer.from(JSON.stringify(result.peaks)));
      renditions.files.peaks = { key, mime: 'application/json' };
    }

    repo.setSubmissionStatus(submission.id, 'ready', renditions, null);
    repo.finishJob(job.id, 'done');
  } catch (err) {
    // Le rendu concourt quand meme : un echec de transcodage ne doit pas
    // eliminer un participant. Il sera servi tel quel, coupe par la page.
    const message = String(err.message || err).slice(0, 500);
    console.warn(`[arena] transcodage ${submission.id.slice(0, 8)} : ${message}`);
    repo.setSubmissionStatus(submission.id, 'ready', null, message);
    repo.finishJob(job.id, 'failed', message);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    notify(repo.submission(submission.id) ?? submission);
  }
}

function pipeToFile(readable, file) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    readable.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    readable.pipe(out);
  });
}

/** Previent la session : le participant voit son etat, la regie son compteur. */
function notify(submission) {
  if (!battleRef || !submission) return;
  try {
    battleRef.onSubmissionChanged(submission);
  } catch (err) {
    console.error('[arena] notification transcodage :', err);
  }
}

/** Efface les variantes d'un rendu remplace ou retire. */
async function removeRenditions(submission) {
  const files = submission?.renditions?.files ?? {};
  await Promise.all(Object.values(files).map((f) => storage.remove(f.key).catch(() => {})));
}

/** Demarrage : reprend ce qui etait en cours au moment de l'arret. */
function start(battle) {
  battleRef = battle;
  stopped = false;
  const requeued = repo.requeueRunningJobs();
  if (requeued) console.log(`[arena] ${requeued} transcodage(s) repris`);
  void ffmpegAvailable();
  setImmediate(pump);
}

function stop() {
  stopped = true;
}

module.exports = { enqueue, start, stop, removeRenditions, ffmpegAvailable, probe, peaks };

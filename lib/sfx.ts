/**
 * Sons synthetises a la volee : aucun fichier a charger, rien a precharger.
 *
 * Repris de Refrain, avec les timbres d'une battle plutot que ceux d'un blind
 * test. Le contexte audio doit etre debloque par un geste utilisateur — d'ou
 * `unlock()`, appele au premier clic de chaque page.
 */

type ToneOptions = {
  freq?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  slide?: number;
  delay?: number;
};

class Sfx {
  private ctx: AudioContext | null = null;
  enabled = true;

  unlock(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  private tone({ freq = 440, dur = 0.16, type = 'sine', gain = 0.16, slide = 0, delay = 0 }: ToneOptions = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  private chord(freqs: number[], step = 0.09, opts: ToneOptions = {}) {
    freqs.forEach((freq, i) => this.tone({ freq, dur: 0.22, gain: 0.15, ...opts, delay: i * step }));
  }

  /** Depart de la creation. */
  start() { this.chord([392, 523, 784], 0.09, { type: 'triangle', dur: 0.3, gain: 0.15 }); }

  /**
   * Alerte de seuil.
   *
   * Le timbre monte a mesure que le temps manque : a dix minutes de la fin on
   * ne veut pas le meme signal qu'a trente secondes. Deux notes sous la minute,
   * une seule au-dessus — de quoi distinguer l'urgence sans regarder l'ecran.
   */
  alert(secondsLeft: number) {
    if (secondsLeft <= 30) {
      this.tone({ freq: 880, dur: 0.13, type: 'square', gain: 0.17 });
      this.tone({ freq: 1174, dur: 0.16, type: 'square', gain: 0.15, delay: 0.15 });
    } else if (secondsLeft <= 120) {
      this.tone({ freq: 660, dur: 0.15, type: 'triangle', gain: 0.15 });
      this.tone({ freq: 880, dur: 0.18, type: 'triangle', gain: 0.13, delay: 0.16 });
    } else {
      this.tone({ freq: 523, dur: 0.22, type: 'sine', gain: 0.13 });
    }
  }

  /** Fin du temps de creation. */
  end() { this.chord([440, 349, 262], 0.13, { type: 'sawtooth', dur: 0.42, gain: 0.16 }); }

  /** Changement de phase discret. */
  phase() { this.tone({ freq: 587, dur: 0.18, type: 'sine', gain: 0.1, slide: 180 }); }

  /** Quelqu'un rejoint le lobby. */
  join() { this.tone({ freq: 784, dur: 0.1, type: 'triangle', gain: 0.09 }); }

  /** Note enregistree : discret, il sera joue des dizaines de fois. */
  vote() { this.tone({ freq: 920, dur: 0.07, type: 'triangle', gain: 0.07 }); }

  /** Revelation du classement. */
  reveal() { this.chord([392, 587], 0.1, { dur: 0.4, gain: 0.13 }); }

  win() { this.chord([523, 659, 784, 1046, 1318], 0.11, { type: 'triangle', dur: 0.5, gain: 0.14 }); }
}

export const sfx = new Sfx();

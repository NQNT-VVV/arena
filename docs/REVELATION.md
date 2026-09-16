# LE CHAMP ET LE MOT — spécification de la révélation

Lecture faite de `components/Roulette.tsx`, `components/Roulette.module.css`, `server/roulette.js`, `server/views.js`, `server/repo.js`, `server/db.js`, `lib/types.ts`, `lib/roulette.ts`, `lib/clock.ts`, `lib/hex.ts`, `lib/useBattleSocket.ts`, `app/screen/ScreenClient.tsx`, `app/screen/screen.module.css`, `app/agartha.css`, `app/globals.css`, `components/Icon.tsx`, `components/RouletteHost.tsx`, `test/roulette.mjs`, et `~/podium/design/agartha/GUIDE.md` en entier.

---

## 0. LES QUATRE FAITS VÉRIFIÉS QUI COMMANDENT LA SPÉCIFICATION

Avant le principe, parce que trois d'entre eux rendent l'implémentation actuelle infaisable et non seulement laide.

**0.1 — La charge ne contient pas de quoi faire une roulette.** `rouletteView()` (`server/views.js:355-385`) envoie `id, wheelName, target, howMany, shared, phase, at, fates[]`. Rien d'autre. Ni le vivier, ni les cases de la roue, ni `epuise`. Le rouleau de noms n'est pas un choix de mise en scène : c'est la seule liste de plusieurs éléments dont la page disposait. **Le suspense a suivi les données, pas le drame.** En mode D il n'y a strictement rien à animer — pas par négligence, par impossibilité.

**0.2 — La roue actuelle affiche des noms qui ne peuvent pas sortir.** `Roulette.tsx:90-92` construit le rouleau depuis `roster`. `rosterView()` (`views.js:119-131`) ne filtre que `!p.isHost`. `eligibles()` (`server/roulette.js:244-248`) écarte en plus les disqualifiés et, par défaut, les spectateurs, et `includeSpectators` n'est reporté nulle part dans la charge. C'est un faux témoignage, pas un détail.

**0.3 — Le premier tirage de chaque session ne s'anime jamais.** `ScreenClient.tsx:187` ne monte `RouletteScreen` que sous `state.roulette.last &&`. Au premier rendu du composant, `useRef(roulette.last?.id ?? null)` (`Roulette.tsx:65`) capture donc l'identifiant du tirage qui vient d'arriver ; l'effet prend la branche « déjà connu » (`:104-110`) et supprime le spectacle. La garde anti-rejeu avale le seul tirage qu'il fallait jouer.

**0.4 — La roue est pondérée et rien ne le dit.** `tirerCase()` (`roulette.js:83-93`) tire au poids, `weight` va de 0 à 99, et la régie affiche déjà `POIDS 5 · 40 %` (`RouletteHost.tsx:411-414`). Un champ de cases égales ment sur les chances.

**0.5 — Il y a cinq modes atteignables, pas quatre.** `RouletteHost.tsx:547` propose « Le même pour tous / Un chacun » dès que `targeted > 1`. Donc `target='some'` + `shared=true` — plusieurs personnes, le même sort — existe, et le serveur l'exécute. Le brief en énumère quatre ; la spécification les **dérive** des deux axes pour que le cinquième soit traité sans branche spéciale.

---

## 1. LE PRINCIPE, EN CINQ LIGNES

> **Deux registres, toujours les deux à l'écran.**
> **LE CHAMP** montre tout ce qui pouvait sortir : une plaque par personne, un cran par case de la roue — et le cran est large en proportion de son poids. Il est muet.
> **LE MOT** porte, en très grand et en pleine largeur, ce qui est pointé à l'instant. C'est la seule chose qui change.
> Le mot saute d'une possibilité à l'autre **en ralentissant** : les premiers paliers sont du mouvement, les derniers sont des mots qu'on lit.
> Et il ne court que sur une variable que le serveur a réellement tirée. Les autres sont **posées**, d'une coupe, sans faire semblant.

**Ce que ça promet à la salle.** Que le hasard a un terrain visible et dénombrable : on voit combien de gens, combien de cases, et laquelle est grosse. Une roue au-delà de huit noms ne montre plus la salle ; le champ la montre toujours en entier.

**Ce que ça promet au stream.** Que n'importe quelle image isolée du flux porte un mot lisible. Un spectateur qui décroche trois secondes retrouve l'information sans rien avoir à reconstituer.

**L'inversion qui rend tout possible, et qui n'est pas une exception.** Le commentaire de `Roulette.tsx:18-22` — « une roue qui décélère demande un mouvement fluide, que le système interdit » — est faux. La décélération est une propriété de la **cadence**, pas de l'interpolation. Neuf coupes franches à 150, 150, 150, 190, 250, 320, 410, 530, 680 ms décélèrent violemment et sont 100 % `steps()`. Le code actuel utilise `setInterval(…, STEP_MS)` — cadence constante — et en a déduit un renoncement de conception. La promesse était disponible depuis le début, gratuitement.

---

## 2. CE QUI EST ANIMÉ, MODE PAR MODE

### 2.1 L'invariant

> **Le mot ne court que sur une variable que le serveur a tirée. Zéro fois pour les autres.**

C'est la phrase qui répare le défaut diagnostiqué. Elle traite d'un coup le mode D, le participant unique et la roue à une seule case, sans cas particulier — et c'est la règle qui, appliquée dès le départ, aurait interdit le rouleau de noms.

### 2.2 Les trois gestes

| Geste | Quand | Ce qui bouge |
|---|---|---|
| **LA PASSE** | une variable tirée dont le résultat est **unique** | le marqueur court le champ, ralentit, s'arrête. Le mot suit le marqueur. |
| **LA DONNE** | une variable tirée **k fois, sans remise** | la réglette se vide, un cran par dépôt ; chaque nom tombe dans sa plaque. |
| **LA POSE** | la variable **n'a pas été tirée** | une coupe, puis on tient. Le champ s'allume en entier. |

### 2.3 La dérivation (cinq modes, deux axes)

```
LE QUI est TIRÉ   ssi  target !== 'all'  ET  nbVisés < pool.length  ET  pool.length > 1
                  →  PASSE si nbVisés === 1, PASSE À k ARRÊTS sinon
LE QUI est POSÉ   sinon

LE QUOI est TIRÉ  toujours (il n'y a pas de tirage sans case)
                  →  PASSE  si shared, OU si le nombre de sorts distincts vaut 1
                  →  DONNE  sinon
```

| | cible | distribution | LE QUI | LE QUOI |
|---|---|---|---|---|
| **A** | une personne | un sort | **PASSE** (1950 ms) | **PASSE LONGUE** (2830 ms) |
| **B** | k personnes | un chacun | **PASSE À k ARRÊTS** | **DONNE** |
| **C** | tout le monde | un chacun | **POSE** | **DONNE** |
| **D** | tout le monde | le même | **POSE** | **PASSE SOLENNELLE** (3800 ms) |
| **E** | k personnes | le même | **PASSE À k ARRÊTS** | **PASSE LONGUE** |

### 2.4 Pourquoi c'est la bonne variable, mode par mode

**A — la roulette russe.** Deux inconnues, deux passes, en série. **Le nom d'abord**, et je tranche contre l'ordre inverse : un sort sans propriétaire est une abstraction, un nom sans sort est quelqu'un en danger ; le canon se pose sur une tempe avant la détente. Deuxième raison : quand le nom tombe, la salle gronde et la personne réagit en caméra — le second tirage donne à la régie le temps de filmer cette réaction, qui *est* le spectacle. Troisième : en B et E la phase nom est nécessairement première, en C et D elle n'existe pas ; sort-d'abord ferait de A le seul mode qui tourne à l'envers. **Le climax reste sur la charge utile** : la passe du sort est plus longue que celle du nom (2830 contre 1950), et le nom tiré ne quitte plus l'écran.

**B — plusieurs, un chacun.** Le marqueur fait **une seule passe** et colle k fois en chemin : la salle voit le groupe se constituer, avec le décompte `0x02 SUR 0x03 DÉSIGNÉ`. L'inconnue est « combien, et qui encore ». Puis la donne met le suspense sur **l'appariement** — la seule chose qui reste à savoir — et la réglette qui se vide montre que les chances se resserrent.
**Réparation d'un défaut identifié par un juge** : dans une passe à arrêts multiples, les k−1 premiers dépôts tombent d'ordinaire dans la zone rapide, c'est-à-dire là où la règle d'encodage interdit de poser quoi que ce soit d'important. Ici les paliers de dépôt sont **construits longs** (400, puis 500, puis 600 ms) et s'allongent à mesure qu'il reste moins de places. Aucun dépôt n'est sacrifié.

**C — la distribution.** **Zéro inconnue de nom.** Le champ des sujets s'allume **entier, en une coupe** : cela *énonce* « toute la salle » au lieu de faire semblant de la tirer. C'est le défaut principal réglé à la racine. Tout le budget de mouvement passe dans la donne, et la donne répond exactement à la question que chacun se pose en mode C : non pas « suis-je choisi » (tout le monde l'est), mais **« dans quelle case je tombe »**. La réglette qui se vide rend visible la règle sans remise du serveur (`restantes = restantes.filter(...)`, `roulette.js:298`) ; quand le vivier se recharge, **les crans se rallument d'un coup** et le pied affiche `LA ROUE A REFAIT UN TOUR`. Le seul moment où une répétition est légitime devient le moment le plus spectaculaire, au lieu d'un bug apparent.

**D — la règle collective.** **Zéro mouvement sur les noms.** Le champ des sujets est inversé et immobile : il est l'auditoire du sort, pas son sujet. Toute la cérémonie est sur la réglette, et c'est **la plus longue des cinq** (3800 ms, dernier palier 820 ms) parce qu'il n'y a qu'une inconnue, qu'elle touche tout le monde, et qu'elle le mérite entière. Aujourd'hui ce mode n'anime rien du tout.

**E — plusieurs, le même sort.** Le cinquième mode, atteignable et jamais traité. Sa forme se déduit sans effort : la passe à k arrêts de B pour le QUI, la passe de D pour le QUOI. Sans cette dérivation, la règle de B (un tirage de case par personne) ferait tourner la roue k fois pour s'arrêter k fois sur la même case, et la salle verrait le hasard produire trois fois de suite le même résultat.

---

## 3. LES ÉTATS, MAQUETTÉS AUX PROPORTIONS 1920 × 1080

**Géométrie, fixe de la première à la dernière image.** Seuls les remplissages et le contenu texte changent — un changement de gabarit est un changement plein cadre, donc une image-clé arrachée à l'encodeur. Règle dure.

```
voile          position: fixed; inset: 0;  fond --veil (dither 4 px), CMP 0x0A
.stage         width: min(1792px, 94vw) → x = 64 … 1856 ; padding var(--sp-8) = 32
contenu        x = 96 … 1824, largeur utile 1728
marges vert.   56 en haut, 56 en bas ; hauteur de scène 792 (N ≤ 6) à 968 (N ≤ 12)
```

### 3.1 — MODE A, t = 1,1 s · la passe sur les sujets, zone rapide

```
 y=0   ┌────────────────────────── voile dither, plein cadre ─────────────────────────┐
 56    │ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ .stage, filet 3 px ━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
 88    │ ┃ LA ROULETTE · SORTS CRUELS · UNE PERSONNE · UN SORT                       ┃ │  .legende  --t-ui-l 27
       │ ┃ CREATION 04:12 · TIRAGES 0x0B                                             ┃ │
128    │ ┠───────────────────────────────────────────────────────────────────────────┨ │  filet 1 px
176    │ ┃ ┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐        ┃ │  .tableau
       │ ┃ │ KEVIN   ││ MARGOT  ││▓SOLEDAD▓││  NOE    ││ ILYES   ││  TAM    │        ┃ │  plaques 272×160
       │ ┃ │         ││         ││▓▓▓▓▓▓▓▓▓││         ││         ││         │        ┃ │  nom --t-h1 40.5
336    │ ┃ └─────────┘└─────────┘└─────────┘└─────────┘└─────────┘└─────────┘        ┃ │  ▓ = .marque, sang
       │ ┃ ┌─────────┐┌─────────┐                                                    ┃ │  (--accent-deep +
512    │ ┃ │ JUN     ││ NAWEL   │                                                    ┃ │   --border-live)
       │ ┃ └─────────┘└─────────┘                                                    ┃ │
552    │ ┃ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ (la reglette n'existe pas encore) ─ ─ ─ ─ ─ ─ ─ ─ ─ ┃ │
608    │ ┃ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ┃ │  .mot.vivant
       │ ┃ ┃ ON TIRE QUI                                                           ┃ ┃ │  filet sang 3 px
       │ ┃ ┃                                                                       ┃ ┃ │  .sur --t-ui-l 27
       │ ┃ ┃   SOLEDAD                                                             ┃ ┃ │  .texte --t-display
912    │ ┃ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ┃ │  (jusqu'a 205 px)
944    │ ┃ 0x08 SUJETS DANS LA ROUE · 0x00 / 0x01 DESIGNE                            ┃ │  .pied --t-ui 18
1008   │ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
1080   └──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 — MODE A, t = 2,35 s · l'arrêt sur le nom

```
       │ ┃ ┌─────────┐┌─────────┐██████████┌─────────┐┌─────────┐┌─────────┐        ┃ │
       │ ┃ │ KEVIN   ││ MARGOT  │█SOLEDAD █│  NOE    ││ ILYES   ││  TAM    │        ┃ │  .tiree :
       │ ┃ └─────────┘└─────────┘██████████└─────────┘└─────────┘└─────────┘        ┃ │  inversion --ink/--bg
       │ ┃ ┌─────────┐┌─────────┐   ↑ flash 80 ms, puis le sang QUITTE l'ecran      ┃ │
       │ ┃ │ JUN     ││ NAWEL   │                                                   ┃ │
       │ ┃ └─────────┘└─────────┘                                                   ┃ │
       │ ┃ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ filet os 3 px ━━━━━━━━━━━━━━━━━━━━━━━━━┓ ┃ │
       │ ┃ ┃ TIRE                                                                  ┃ ┃ │
       │ ┃ ┃   SOLEDAD                                                             ┃ ┃ │
       │ ┃ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ┃ │
       │ ┃ 0x08 SUJETS DANS LA ROUE · 0x01 / 0x01 DESIGNE                            ┃ │
```

### 3.3 — MODE A, t = 4,6 s · la passe sur les cases, zone lente (palier 410 ms)

```
       │ ┃ ┌─────────┐┌─────────┐██████████┌─────────┐┌─────────┐┌─────────┐        ┃ │  le QUI est acquis
       │ ┃ │ KEVIN   ││ MARGOT  │█SOLEDAD █│  NOE    ││ ILYES   ││  TAM    │        ┃ │  et NE BOUGE PLUS
       │ ┃ └─────────┘└─────────┘██████████└─────────┘└─────────┘└─────────┘        ┃ │
552    │ ┃ ▮▮ ▮▮▮▮▮▮▮▮ ▮▮▮ ▮▮▮▮▮ ▓▓▓▓ ▮▮▮▮▮▮▮▮▮▮▮▮ ▮▮ ▮▮▮▮▮▮ ▮ ▮▮▮▮▮▮▮▮▮▮           ┃ │  .reglette h=16
       │ ┃  ↑ un cran par case, LARGE EN PROPORTION DU POIDS ; ▓ = marqueur sang    ┃ │  gap 4
608    │ ┃ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ filet sang 3 px ━━━━━━━━━━━━━━━━━━━━━━━━━┓ ┃ │
       │ ┃ ┃ ON TIRE QUOI POUR SOLEDAD                                             ┃ ┃ │  .sur
       │ ┃ ┃                                                                       ┃ ┃ │
       │ ┃ ┃   TU NE PEUX PLUS UTILISER TA MAIN DROITE                             ┃ ┃ │  .texte --t-data
       │ ┃ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ┃ │  60.75 mono
       │ ┃ 0x0C CASES JOUABLES · POIDS TOTAL 0x2A · 0x01 / 0x01 DESIGNE              ┃ │
```

### 3.4 — MODE A, t = 5,86 → 7,86 s · la tenue de lecture

```
       │ ┃ ┌─────────┐┌─────────┐██████████┌─────────┐┌─────────┐┌─────────┐        ┃ │
       │ ┃ │ KEVIN   ││ MARGOT  │█SOLEDAD █│  NOE    ││ ILYES   ││  TAM    │        ┃ │
       │ ┃ └─────────┘└─────────┘██████████└─────────┘└─────────┘└─────────┘        ┃ │
       │ ┃ ▮▮ ▮▮▮▮▮▮▮▮ ▮▮▮ ▮▮▮▮▮ ▮▮▮▮ ████████████ ▮▮ ▮▮▮▮▮▮ ▮ ▮▮▮▮▮▮▮▮▮▮           ┃ │  ███ = .tiree, os plein
       │ ┃ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ┃ │
       │ ┃ ┃ SOLEDAD                                                               ┃ ┃ │
       │ ┃ ┃   TU NE PEUX PLUS UTILISER TA MAIN DROITE                             ┃ ┃ │
       │ ┃ ┃                                                                       ┃ ┃ │
       │ ┃ ┃   ┃ −2 POINTS ┃   ┃ A RESPECTER ┃                                     ┃ ┃ │  .effect / .status
       │ ┃ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ┃ │  existants, h=40
       │ ┃ 0x0C CASES JOUABLES · POIDS TOTAL 0x2A · TIRAGES 0x0B                     ┃ │
```

### 3.5 — MODE C, t = 2,4 s · la donne, quatrième dépôt sur huit

```
 88    │ ┃ LA ROULETTE · DOUCEURS · TOUTE LA SALLE · UN SORT CHACUN · TIRAGES 0x0C   ┃ │
128    │ ┠───────────────────────────────────────────────────────────────────────────┨ │
176    │ ┃ ██████████ ██████████ ██████████ ██████████ ██████████ ██████████         ┃ │  TOUT est inverse,
       │ ┃ █ KEVIN   █ █ MARGOT █ █SOLEDAD █ █  NOE   █ █ ILYES  █ █  TAM   █        ┃ │  d'une seule coupe :
       │ ┃ █+2 POINTS█ █CHANTE   █ █RIEN DU █ █MODE   █ █        █ █        █        ┃ │  « personne n'a ete
       │ ┃ █         █ █ TOUT    █ █ TOUT   █ █MINEUR █ █        █ █        █        ┃ │    tire »
       │ ┃ ██████████ ██████████ ██████████ ██████████ ██████████ ██████████         ┃ │  nom --t-h1 40.5
       │ ┃ ██████████ ██████████                                                     ┃ │  sort --t-ui-l 27
       │ ┃ █  JUN    █ █ NAWEL  █          ← les deux dernieres plaques attendent    ┃ │  (N <= 12 seulement)
       │ ┃ ██████████ ██████████                                                     ┃ │
552    │ ┃ ▮▮ ░░░░░░░░ ▮▮▮ ░░░░░ ▓▓▓▓ ░░░░░░░░░░░░ ▮▮ ▮▮▮▮▮▮ ▮ ▮▮▮▮▮▮▮▮▮▮           ┃ │  ░ = .usee (dither 25)
       │ ┃  ↑ les cases consommees s'eteignent : SANS REMISE, rendu visible          ┃ │
608    │ ┃ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ filet sang 3 px ━━━━━━━━━━━━━━━━━━━━━━━━━┓ ┃ │
       │ ┃ ┃ LA DONNE                                                              ┃ ┃ │
       │ ┃ ┃   0x04 / 0x08                                                         ┃ ┃ │  .texte --t-data
       │ ┃ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ┃ │
944    │ ┃ 0x0C CASES JOUABLES · 0x04 CONSOMMEES · POIDS TOTAL 0x2A                  ┃ │
```

### 3.6 — MODE D, t = 3,1 s · la passe solennelle sur les cases

```
 88    │ ┃ LA ROULETTE · REGLES · TOUTE LA SALLE · LE MEME SORT · TIRAGES 0x0D       ┃ │
176    │ ┃ ██████████ ██████████ ██████████ ██████████ ██████████ ██████████         ┃ │  le tableau est
       │ ┃ █ KEVIN   █ █ MARGOT █ █SOLEDAD █ █  NOE   █ █ ILYES  █ █  TAM   █        ┃ │  inverse ET IMMOBILE
       │ ┃ ██████████ ██████████ ██████████ ██████████ ██████████ ██████████         ┃ │  — il est l'enjeu,
       │ ┃ ██████████ ██████████                                                     ┃ │    pas le tirage
       │ ┃ █  JUN    █ █ NAWEL  █      PERSONNE N'A ETE TIRE · C'EST POUR TOUS       ┃ │
       │ ┃ ██████████ ██████████                                                     ┃ │
552    │ ┃ ▮▮ ▮▮▮▮▮▮▮▮ ▮▮▮ ▮▮▮▮▮ ▮▮▮▮ ▮▮▮▮▮▮▮▮▮▮▮▮ ▓▓ ▮▮▮▮▮▮ ▮ ▮▮▮▮▮▮▮▮▮▮           ┃ │
608    │ ┃ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ filet sang 3 px ━━━━━━━━━━━━━━━━━━━━━━━━━┓ ┃ │  LE SEUL MOUVEMENT
       │ ┃ ┃ ON TIRE QUOI POUR TOUTE LA SALLE                                      ┃ ┃ │  DE L'ECRAN
       │ ┃ ┃                                                                       ┃ ┃ │
       │ ┃ ┃   PLUS AUCUN KICK JUSQU'A LA FIN                                      ┃ ┃ │  .texte --t-data
       │ ┃ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ┃ │
944    │ ┃ 0x0C CASES JOUABLES · POIDS TOTAL 0x2A · 0x08 SUJETS TOUCHES              ┃ │
```

### 3.7 — MODE B (k = 3), t = 2,0 s · deuxième arrêt de la passe à k arrêts

```
176    │ ┃ ██████████ ┌─────────┐ ▓▓▓▓▓▓▓▓▓▓ ┌─────────┐ ┌─────────┐ ┌─────────┐    ┃ │
       │ ┃ █ KEVIN   █ │ MARGOT  │ ▓SOLEDAD ▓ │  NOE    │ │ ILYES   │ │  TAM    │    ┃ │  ███ deja designe
       │ ┃ ██████████ └─────────┘ ▓▓▓▓▓▓▓▓▓▓ └─────────┘ └─────────┘ └─────────┘    ┃ │  ▓▓▓ marqueur sang
608    │ ┃ ┃ ON TIRE QUI · 0x02 SUR 0x03                                           ┃ ┃ │
       │ ┃ ┃   SOLEDAD                                                             ┃ ┃ │
944    │ ┃ 0x08 SUJETS DANS LA ROUE · 0x01 / 0x03 DESIGNE                            ┃ │
```

### 3.8 — LA LIGNE FINALE, invariante des cinq modes (ici C, t = 3,74 s)

```
608    │ ┃ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ┃ │
       │ ┃ ┃ LE PLUS LOURD                                                         ┃ ┃ │
       │ ┃ ┃   KEVIN · TU CHANTES TOUT                                             ┃ ┃ │
       │ ┃ ┃   ┃ −3 POINTS ┃   ┃ APPLIQUE ┃                                        ┃ ┃ │
       │ ┃ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ┃ │
```
Si aucun sort du tirage ne porte d'effet mécanique, le surtitre n'est pas `LE PLUS LOURD` mais `0x08 SORTS DISTRIBUES · AUCUN EFFET MECANIQUE · TOUT EST CONSIGNE`, et le mot porte alors le décompte, pas un nom. En cas d'égalité stricte sur `|points|` et `|chronoMs|`, le surtitre est `PARMI LES PLUS LOURDS`. **On ne sacre jamais au hasard en prétendant classer.**

### 3.9 — PENDANT LA DIFFUSION · bandeau bas, jamais de plein écran

```
 y=0   ┌──────────────────────────── le rendu en cours d'ecoute ─────────────────────┐
       │                                                                             │
 800   ╞═════════════════════════════════════════════════════════════════════════════╡  filet 3 px
       │ LA ROULETTE · SORTS CRUELS · UNE PERSONNE · TIRAGES 0x0E                     │  .stage.bandeau
       │ ▮▮ ▮▮▮▮▮▮▮▮ ▮▮▮ ▮▮▮▮▮ ▓▓▓▓ ▮▮▮▮▮▮▮▮▮▮▮▮ ▮▮ ▮▮▮▮▮▮ ▮ ▮▮▮▮▮▮▮▮▮▮               │  h = 280
       │ ██ MARGOT ██   TU NE PEUX PLUS UTILISER TA MAIN DROITE    ┃ −2 POINTS ┃      │  --t-data 60.75
1080   └─────────────────────────────────────────────────────────────────────────────┘
```
Même chronologie, mêmes durées, même code. Le tableau des plaques est remplacé par une seule plaque de nom. **On ne coupe jamais le contenu en cours de jugement** — le code actuel pose un voile `z-index: 60` par-dessus une vidéo qu'on est en train de noter.

### 3.10 — APRÈS LE VOILE · la carte persistante

Le bloc `.block` reste sur la page : c'est la consigne en cours, on doit pouvoir la relire. Une seule correction, mais elle porte sur **l'état le plus vu de toute la fonctionnalité** — dix minutes contre sept secondes :

> **Quand `spin.shared` est vrai, la liste ne rend pas N lignes identiques.** Elle rend une ligne : le libellé, la bande de pseudos, les puces d'effet. `spin.fates` contient en mode D une `Fate` identique par personne (`roulette.js:293`) ; les afficher toutes est une redite de sept lignes en `--t-h2`.

---

## 4. LE DÉCOUPAGE TEMPOREL, CHIFFRÉ

### 4.1 Les constantes

```
POSE              400 ms
TENUE_SALLE       700 ms
TENUE_NOM         520 ms
TENUE_GROUPE      500 ms
FLASH              80 ms      = --dur-flash, jeton existant
PALIER_MIN        150 ms      plancher absolu, jamais moins
TENUE_LECTURE   clamp(2000 + 400 × floor(max(0, len − 40) / 40), 2000, 3200)
PLAFOND          9000 ms      total, tous modes, tous effectifs
```

### 4.2 Les rampes

| Rampe | Paliers | Séquence (ms) | Total |
|---|---|---|---|
| `PASSE` | 7 | 150 · 150 · 180 · 230 · 300 · 400 · 540 | **1 950** |
| `PASSE_LONGUE` | 9 | 150 · 150 · 150 · 190 · 250 · 320 · 410 · 530 · 680 | **2 830** |
| `PASSE_SOLENNELLE` | 11 | 150 ×4 · 190 · 250 · 320 · 410 · 530 · 680 · 820 | **3 800** |
| `ARRÊT j` (passe à k arrêts) | 3 rapides + 1 dépôt | 150 ×3, puis `d_j = 400 + 200 × (j−1)/(k−1)`, `d_k = 600` | 850 → 1 050 |
| `DONNE` | N dépôts | `clamp(round(2600 / N), 150, 320)` par dépôt ; par paires au-delà de 16 | ≈ **2 600** |

### 4.3 La justification de chaque nombre

**Le plancher à 150 ms.** À 30 i/s — la cadence par défaut d'une source navigateur OBS, et celle du rung transcodé — 150 ms fait 4,5 images. `STEP_MS = 70` (`Roulette.tsx:26`) en fait 2,1 : un changement plein-région à fort contraste qui ne vit que deux images est lissé par l'estimation de mouvement de l'encodeur et arrive gris. Le commentaire qui accompagne `STEP_MS` raisonne sur l'œil devant un écran local ; sur un rung 480p, ce n'est pas l'œil la limite, c'est le quantificateur.

**La rampe est une rampe de netteté, et c'est son vrai rôle.** Un rung 480p à ~700 kbps / 30 i/s donne 2,9 ko par image. Le mot occupe 1728 × 304 px, soit 29 % du cadre. Un palier à 150 ms lui alloue ~13 ko : c'est un mot flou, et c'est **voulu** — les premiers paliers disent « ça tourne », ils ne se lisent pas. Un palier à 530 ou 680 ms lui alloue 46 à 59 ko : l'encodeur a le temps d'affiner les arêtes des glyphes. **Les trois derniers paliers de chaque passe sont donc les seuls garantis nets, et ce sont exactement ceux qui portent les trois derniers candidats** — la lecture à voix haute par la salle avant l'arrêt. C'est ça, la roulette russe, et c'est de l'allocation de débit avant d'être de la dramaturgie.

**Le dernier palier de D à 820 ms.** 24 images. C'est l'image que le clip gardera. Le seul tirage du mode, le plus lourd de tous, reçoit la seule tenue maximale.

**La durée est constante pour un champ donné.** L'arrivée est connue ; on ne cherche donc pas combien de crans il faut pour y tomber (ce que fait `Roulette.tsx:94-97`, et qui fait varier la durée selon qui est tiré). **On fixe le nombre de paliers et on calcule le départ :** `depart = ((cible − (nb − 1)) % n + n) % n`. Personne ne sait où le marqueur « devrait » démarrer, et l'animateur sait combien de temps ça prend.

**La tenue de lecture à 2 000 ms, et pas 5 000.** `HOLD_MS = 5000` est 2,5× trop long, et c'est la raison n°1 pour laquelle un streamer trouvera la révélation longue. Une ligne de 2 à 6 mots à 60,75 px se lit en ~0,6 s en local ; dégradée au 480p, compter ×2 ≈ 1,2 s de fixation, plus ~0,8 s pour que l'animateur réagisse. Le terme adaptatif (+400 ms par tranche de 40 signes) couvre les libellés longs que `LONGUEUR_LIBELLE = 120` autorise. Et rien n'est perdu au retrait du voile : la carte reste sur la page, et le sort est déjà sur le téléphone de l'intéressé.

**La donne bornée à ~2 600 ms.** La durée ne dépend pas de l'effectif : 8 personnes → 320 ms par dépôt, 15 personnes → 173 ms. Le mot n'écrit rien pendant la donne (il porterait alors un texte sous le plancher de netteté) : il tient un décompte stable `0x04 / 0x08`. Ce qui bouge, ce sont les plaques et la réglette — de l'information de *forme*, qui survit au flou.

### 4.4 Les totaux

| | déroulé (ms) | total |
|---|---|---|
| **A** (N=8, libellé 34) | 400 + 1950 + 80 + 520 + 2830 + 80 + 2000 | **7,86 s** |
| **A** (libellé 120) | idem, tenue 2800 | **8,66 s** |
| **B** (k=3, N=8) | 400 + [850+80 + 950+80 + 1050+80] + 500 + 960 + 80 + 2000 | **7,03 s** |
| **C** (N=8) | 400 + 700 + 2560 + 80 + 2000 | **5,74 s** |
| **C** (N=15) | 400 + 700 + 2595 + 80 + 2000 | **5,78 s** |
| **D** (N=8) | 400 + 700 + 3800 + 80 + 2000 | **6,98 s** |
| **E** (k=3, N=8) | 400 + 3090 + 500 + 2830 + 80 + 2000 | **8,90 s** |

**Ce que ça remplace.** `MIN_STEPS × STEP_MS + (n−1) × FATE_MS + HOLD_MS` :

| mode C, N = | 6 | 8 | 12 | 15 |
|---|---|---|---|---|
| actuel | 12,8 s | 15,4 s | **20,6 s** | 24,5 s |
| spécifié | 5,7 s | 5,7 s | 5,8 s | 5,8 s |

### 4.5 La dégradation, si le total dépasse 9 000 ms

Elle ne supprime **jamais** un registre ni un mécanisme — elle raccourcit la course, dans cet ordre :
1. les paliers rapides de chaque arrêt passent de 3 à 2, puis à 1 ;
2. la donne tombe à son plancher de 150 ms et dépose par paires ;
3. `PASSE_LONGUE` redevient `PASSE`.

Jamais : retirer la réglette, retirer le mot, raccourcir `TENUE_LECTURE`. Une révélation dégradée reste la même révélation, plus courte.

---

## 5. LA TECHNIQUE

### 5.1 Ce qui disparaît

`.window`, `.strip`, `.sight`, `.active`, `.spinning`, la variable `--i`, `transform: translateY(...)`, `transition: transform var(--dur-tap) steps(1, end)` (`Roulette.module.css:31-65`), les constantes `STEP_MS` / `MIN_STEPS` / `FATE_MS` / `HOLD_MS`, la construction du ruban (`Roulette.tsx:90-101`), le tableau de minuteurs pré-armés (`:113-125`), le `setInterval` (`:137`), et **`knownRef` (`:65`)**.

Le ruban translate un élément long : le navigateur le promeut en couche et recompose tout le bloc à chaque cran. C'est bon marché pour le compositeur et ruineux pour l'encodeur, qui reçoit du mouvement plein-fenêtre 14 fois par seconde. L'optimisation habituelle est exactement le mauvais choix sur ce médium.

### 5.2 Le marqueur est une classe, pas une transformation

```css
.tableau { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--sp-4); }
.plaque  { height: 160px; padding: var(--sp-4); border: var(--stage-rule); contain: layout paint;
           display: grid; align-content: center; gap: var(--sp-2); }
.plaque .nom  { font: var(--t-h1); letter-spacing: var(--ls-display); }
.plaque .sort { font: var(--t-ui-l); letter-spacing: var(--ls-mono); color: var(--ink-60); }
/* Buzzer 0x02, etat « presse » : le sang dit ce qui vit, et une seule chose a la fois. */
.plaque.marque { background: var(--accent-deep); border-color: var(--accent); }
/* L'arret : inversion pleine d'os, et le sang quitte l'ecran. */
.plaque.tiree  { background: var(--ink); color: var(--bg); border-color: var(--ink);
                 animation: flash var(--dur-flash) var(--ease-hold) 1; }
.plaque.tiree .sort { color: var(--bg); }

/* Progression 0x09 fermee : un segment par case, large en proportion du poids. */
.reglette { display: flex; gap: var(--sp-1); height: 16px; }
.reglette > i { flex: var(--w) 1 0; min-width: 4px; border: var(--border-ui); }
.reglette > i.marque { background: var(--accent-deep); border-color: var(--accent); }
.reglette > i.tiree  { background: var(--ink); border-color: var(--ink);
                       animation: flash var(--dur-flash) var(--ease-hold) 1; }
.reglette > i.usee   { border-color: var(--ink-25);
                       background-image: var(--dither-25); background-size: var(--dither-size); }

.mot { border: var(--stage-rule); padding: var(--sp-8); min-height: 304px;
       display: grid; align-content: center; gap: var(--sp-4); contain: layout paint; }
.mot.vivant { border-color: var(--accent); }
.mot .sur    { font: var(--t-ui-l); letter-spacing: var(--ls-mono); color: var(--ink-60); }
.mot .texte  { overflow-wrap: anywhere; }
.mot .texte.s1 { font: var(--t-display); letter-spacing: var(--ls-display); }   /* <= 16 signes */
.mot .texte.s2 { font: var(--t-data);    letter-spacing: var(--ls-mono); }      /* <= 96 signes */
.mot .texte.s3 { font: var(--t-ui-l);    letter-spacing: var(--ls-mono); }      /* au-dela */
```

**Le palier de taille est discret et se calcule sans mesurer.** `s1 / s2 / s3` sont choisis par `texte.length`, en ligne, sans `ResizeObserver` et sans boucle de mesure : l'échelle du système est discrète, l'ajustement doit l'être aussi.

**Pourquoi la mono pour un libellé, et Archivo pour un pseudo.** `--t-display` (Archivo, jusqu'à 205 px) est le niveau que le GUIDE §5 assigne nommément à cet écran ; un pseudo est un nom, donc une affiche. Un libellé est un texte imposé par l'animateur, de longueur inconnue jusqu'à 120 signes : `--t-data` est le jeton que l'échelle d'usage du système réserve à la **donnée vivante**, et l'avance constante de Departure Mono rend la mise en boîte calculable sans mesure. Ce n'est pas une exception, c'est la lecture des rôles déjà écrits dans `agartha.css:36-47`.

### 5.3 Le coût au rendu, chiffré

Un palier de passe repeint : la plaque quittée + la plaque prise (2 × 272 × 160 = 87 kpx), **ou** deux crans de réglette (négligeable), **plus** le bloc du mot (1728 × 304 = 525 kpx). Soit ~612 kpx par palier. À la cadence moyenne d'une passe (~4,5 paliers/s), **2,8 Mpx/s**. Une animation plein écran 1080p60 en fait 124 Mpx/s : la révélation coûte **2,3 %**. Zéro reflow (géométrie fixe, `contain: layout paint` sur chaque plaque et sur le mot), zéro couche composite, zéro `will-change` — une source navigateur OBS paie les couches en VRAM sur une machine qui encode en même temps.

### 5.4 Le moteur : une chorégraphie pure, pas une cascade de minuteurs

**Nouveau fichier `lib/reveal.ts`**, sans React, sans horloge :

```ts
export type Champ = 'tableau' | 'reglette' | null;

/** Un instant de la revelation, entierement calcule : le rendu n'en deduit rien. */
export interface Frame {
  champ: Champ;                 // ou vit le marqueur, s'il vit
  marque: number | null;        // index du marqueur dans ce champ
  plaques: ('vide' | 'marque' | 'tiree')[];
  sorts: (string | null)[];     // le libelle tombe dans chaque plaque, N <= 12
  crans: ('libre' | 'marque' | 'tiree' | 'usee')[];
  sur: string;                  // le surtitre du mot
  texte: string;                // le mot
  taille: 's1' | 's2' | 's3';
  vivant: boolean;              // filet sang sur le mot
  chips: boolean;               // les puces d'effet sont posees
  pied: string;
}

export interface Revelation { frames: Frame[]; at: number[]; totalMs: number; }

export function planDeTirage(spin: Spin): Plan;
export function paliers(kind: PasseKind, k?: number): number[];
export function departPour(cible: number, n: number, nb: number): number;
export function ligneFinale(spin: Spin): { sur: string; texte: string };
export function revelation(spin: Spin, reduit: boolean): Revelation;
```

`revelation()` produit **la liste complète des images et leurs horodatages relatifs** — au plus une quarantaine. Le composant ne fait que rendre `frames[k]`.

**La boucle, dans `components/Roulette.tsx` :**

```ts
const [k, setK] = useState(0);
const [veil, setVeil] = useState(false);

useEffect(() => {
  const s = spinRef.current;
  if (!s) return;
  const r = revelation(s, reduit);
  const fini = () => { setK(r.frames.length - 1); setVeil(false); };
  if (clock.now() - s.at >= r.totalMs) { fini(); return; }   // deja joue : etat pose, pas de voile
  setVeil(true);
  let raf = 0;
  const tick = () => {
    const e = clock.now() - s.at;
    if (e >= r.totalMs) { fini(); return; }
    let i = r.at.length - 1;
    while (i > 0 && r.at[i] > e) i--;
    setK((p) => (p === i ? p : i));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}, [spin?.id, reduit]);
```

**`requestAnimationFrame` et pas `setInterval`** : une source OBS passée en arrière-plan (changement de scène, « shutdown when not visible ») voit ses `setInterval` bridés à 1 Hz — le rouleau actuel continuerait d'avancer d'un cran par seconde et ressortirait déphasé. Avec rAF et des horodatages **absolus**, la reprise se recale d'elle-même. Et `setState` n'est appelé que lorsque l'indice de frame change : ~25 rendus React pour tout un mode A, pas 60 par seconde.

**`knownRef` est supprimé.** Une seule règle le remplace, et elle corrige trois bugs à la fois :

```
ecoule = clock.now() - spin.at          (spin.at est une heure serveur ; clock est deja aligne)
ecoule >= totalMs   ->  etat pose, pas de voile        (contrainte 4 : on ne rejoue pas)
ecoule <  totalMs   ->  on entre a `ecoule` dans la choregraphie
```
Conséquences : le premier tirage de la session se joue (bug 0.3 mort) ; deux écrans branchés à deux instants différents affichent le même palier au même moment, puisque tout dérive du même `spin.at` ; une source OBS créée au changement de scène ne rate pas la révélation en cours. **Aucune marge de tolérance** : un écran qui rend 300 ms en retard perd 300 ms de pose, ce qui est exactement ce qui s'est passé. Une marge remettrait deux écrans hors phase, c'est-à-dire le bug qu'on répare.

### 5.5 La charge : ce qu'il faut ajouter au serveur

Tout existe déjà dans `tirer()` au moment du tirage ; il suffit de **recopier**, ce qui est le troisième principe écrit en tête du module (`roulette.js:18` — « CE QUI EST TIRE EST RECOPIE »). Instantané figé, jamais lecture vive : une roue renommée ou repondérée ne doit pas réécrire ce qui s'est passé.

**Migration 10** (`server/db.js` compte exactement 9 entrées dans `MIGRATIONS`, vérifié ; `user_version = 10`) :
```sql
ALTER TABLE spin      ADD COLUMN pool       TEXT    NOT NULL DEFAULT '[]';
ALTER TABLE spin      ADD COLUMN slots      TEXT    NOT NULL DEFAULT '[]';
ALTER TABLE spin      ADD COLUMN epuise     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE spin_fate ADD COLUMN pool_index INTEGER NOT NULL DEFAULT -1;
ALTER TABLE spin_fate ADD COLUMN slot_index INTEGER NOT NULL DEFAULT -1;
```
`-1` et `'[]'` veulent dire « tirage d'avant le champ » : la page affiche l'état posé, sans champ, sans mentir. Rétrocompatible par construction.

**`server/roulette.js`**, dans `tirer()`, à l'appel `repo.addSpin({...})` (l. 316) :
```js
pool:   JSON.stringify(monde.map((p) => p.pseudo)),
slots:  JSON.stringify(cases.map((c) => ({ label: c.label, weight: c.weight }))),
epuise: epuise ? 1 : 0,
```
`epuise` est calculé dans la boucle des sorts, qui précède `repo.addSpin` — il est disponible. Et dans `repo.addFate({...})` : `poolIndex: monde.indexOf(participant)`, `slotIndex: cases.indexOf(caseTiree)`.

**Des index, pas des `indexOf(label)` côté page** : deux cases peuvent porter le même texte, deux pseudos peuvent se ressembler.

**`server/repo.js`** : `insertSpin`, `insertFate`, `toSpin` (l. 594), `toFate` (l. 610). **`server/views.js`** : `rouletteView()` ajoute `pool`, `slots`, `epuise` sur `last`, et `poolIndex` / `slotIndex` sur chaque fate. **`lib/types.ts`** : cinq champs sur `Spin` et `Fate`. La graine reste absente, comme aujourd'hui.

`pool` est l'ordre stable de `eligibles()` (`joinedAt`), donc **le champ des sujets est le même d'un tirage à l'autre dans une session** : la salle apprend la roue. C'est gratuit et ça vaut beaucoup.

### 5.6 Les autres fichiers touchés

| Fichier | Ce qui change |
|---|---|
| `/home/alexis/arena/.claude/worktrees/roulette/lib/reveal.ts` | **nouveau**, pur |
| `.../components/Roulette.tsx` | `RouletteScreen` réécrit : signature `{ roulette, phase, chrono }` (la prop `roster` disparaît, `pool` la remplace) ; sous-composants `Stage`, `Plaques`, `Reglette`, `Mot`, `Pied`, `BlocPersistant` ; `FateRead` et `OwnFate` **inchangés** |
| `.../components/Roulette.module.css` | bloc rouleau (l. 31-65) supprimé ; `.stage`, `.stage.bandeau`, `.legende`, `.tableau`, `.plaque`, `.reglette`, `.mot`, `.pied` ajoutés ; `.veil` conservé tel quel |
| `.../app/screen/ScreenClient.tsx` | **montage inconditionnel** de `RouletteScreen` (le composant rend déjà `null` sans `spin`), et passage de `state.phase` et `chrono` |
| `.../app/globals.css` | `body.reveal-on .grain { display: none; }` — une ligne, la seule mutation globale |
| `.../test/roulette.mjs` | assertions serveur : `pool` = `eligibles()` et jamais le roster ; `slots` porte les poids ; `poolIndex`/`slotIndex` cohérents ; `epuise` persisté ; une roue à une case donne `slots.length === 1` |

**Note d'honnêteté sur les tests.** Aucun test du dépôt n'importe `lib/` (vérifié : `test/*.mjs` sont des modules Node qui font `createRequire` sur `server/`). `lib/reveal.ts` ne sera donc **pas** couvert par `npm test` sans ajouter un exécuteur TypeScript. Il est couvert par `npm run typecheck`, et les invariants testables côté serveur (la charge) le sont dans `test/roulette.mjs`. Je le signale plutôt que de prétendre le contraire.

---

## 6. LE RAPPORT AU SYSTÈME

### 6.1 Ce qui reste en `steps()` — c'est-à-dire tout

**Aucune `transition` dans toute la révélation.** Pas une seule, pas même en `steps()`. Chaque changement d'état est une bascule de classe, donc un repeint instantané. La seule `@keyframes` employée est `flash`, déjà au socle (`agartha.css:132`), en `var(--dur-flash) var(--ease-hold) 1`. Aucun `cubic-bezier`, aucun `ease-*`, aucune `opacity` animée, aucun `blur`, aucun dégradé, aucune ombre, aucun `border-radius`. Les deux greps du GUIDE §6 restent vides.

**La cadence variable n'est PAS une exception, et je ne la plaide pas.** Le système interdit l'**interpolation** : une valeur qui prend, image après image, tous les états intermédiaires entre deux états lisibles. Ici aucune propriété n'est interpolée — le marqueur ne se déplace pas, il **change d'hôte** : une classe quitte un nœud et arrive sur un autre. Ce qui varie dans le temps, c'est l'intervalle entre deux coupes, pas le contenu d'une coupe. **Un métronome qui ralentit n'est pas un glissando** : un `ease` produit des états intermédiaires illisibles, une cadence qui passe de 150 à 820 ms ne produit que des états pleinement tenus, de plus en plus longtemps. La règle du GUIDE — le cran se voit, il ne se suit pas — est renforcée à chaque palier, pas contournée. C'est exactement ce que fait déjà le Timer 0x06 : une barre qui *saute* par pas, `transition: none`.

**La limite, nommée et refusée.** La vraie exception commencerait sous 150 ms : une course à 67 ou 33 ms donnerait une traînée, c'est-à-dire du mouvement. Elle est refusée. Pour les grands champs, la course fait **moins de paliers**, jamais des paliers plus courts.

**Le seul objet non orthogonal est refusé aussi.** Pas d'anneau, pas d'arc, pas de disque. Le système a déjà répondu à la question « à quoi ressemble une roue ici » : `components/Icon.tsx:78`, icône `roue` = `M2 2h12v12H2z` plus quatre rectangles cardinaux et un moyeu carré. **Zéro arc.** Dans un système dont toutes les textures sont déclarées `shape-rendering='crispEdges'` et dont la règle est `--radius: 0`, un disque serait le seul objet anticrénelé de l'écran, donc le seul flou en 720p. La réglette est une **Progression 0x09 fermée**, orthogonale, sur la grille de base 4.

### 6.2 Le registre des exceptions — exhaustif, une ligne par déviation

Toutes vivent sur le sous-arbre `.stage`, sauf la n° 5 qui est nommée globale parce qu'elle l'est.

| # | Déviation | Où elle commence | Où elle s'arrête | Défense |
|---|---|---|---|---|
| **1** | Largeur de la modale 0x0A : max 440 → `min(1792px, 94vw)` | `.stage` | retrait du voile | 0x0A est écrit pour une modale de téléphone. Le GUIDE §5 assigne déjà à cet écran `--t-display` « jusqu'à 205 px », et `screen.module.css:33` y pose `.wide` à `min(1100px, 94vw)`. Un vidéoprojecteur n'est pas un téléphone. Le voile dither, le filet os et les repères de coin de 0x0A sont **conservés**. |
| **2** | Filets de scène 3 px au lieu de 1 px, jeton local `--stage-rule: 3px solid var(--ink)` | `.stage` et ses descendants | idem | Le 1 px du système n'est pas une valeur de goût, c'est « le trait le plus fin qui reste visible ». Chaîne de livraison 1920 → 720p (×0,667) → 480p (×0,445) : 1 px livre 0,45 px, il disparaît. Garder l'intention oblige à changer le nombre. En complément, la structure est portée par des **aplats pleins** (inversion `--ink`/`--bg`), jamais par des filets seuls. |
| **3** | Réglette 16 px de haut au lieu des 8 px de 0x09 (le `gap: 4px` est conservé) | `.reglette` | idem | Même arithmétique : 8 px livrent 3,6 px à 480p. |
| **4** | « 40 % de vide minimum » (GUIDE §5) suspendu | `.stage` | idem | La hiérarchie y est portée par le rapport de taille (27 px contre 60,75 à 205, soit 2,2× à 7,6×) et par l'inversion pleine, pas par le vide. Bornée : **jamais plus de deux grands registres à la fois** — la réglette n'existe pas pendant une passe sur les sujets, et le tableau se replie en une ligne au-delà de 24 sujets. |
| **5** | Le grain est éteint pendant la révélation | classe `reveal-on` posée sur `<body>` par le même `useEffect` que le voile | retirée dans le `return` de cet effet, donc au démontage comme au changement de tirage | Un bruit statique plein cadre est une taxe de débit permanente : il neutralise les macroblocs *skip* même sur une image gelée, exactement là où il faut des bits pour les arêtes des grandes glyphes. **Frontière vérifiée** : `.grain` est rendu par `components/Aurora.tsx` depuis `app/layout.tsx`, en frère de niveau racine, `position: fixed; z-index: 100` (`agartha.css:150`) — un sélecteur descendant de `.stage` ne l'atteindrait pas. C'est donc une mutation globale, et elle est déclarée comme telle. Précédent au socle : le bloc `prefers-reduced-motion` l'éteint déjà (`agartha.css:142`). |

### 6.3 Ce qui n'est ni exception ni extension

Aucun jeton de taille n'est inventé. `--fs-6` vaut `clamp(60.75px, 12vw, 205.03px)` (`agartha.css:24`) et le GUIDE §5 l'assigne nommément à cet écran : l'échelle ne s'arrête pas à 60,75, et lui ajouter des crans intermédiaires en créerait deux **plus petits que `--fs-6` et nommés au-dessus**. Le lexique temporel emprunte `--dur-flash` tel quel ; les autres durées vivent en JavaScript, où le système n'a rien à dire, et non en CSS. Le sang suit la grammaire du Buzzer 0x02 (« pressé = `--accent-deep` + filet sang + flash 80 ms ») : la salle a déjà appris ce geste ailleurs. Aucun or nulle part — **le champ ne sacre pas, il condamne** —, ce qui règle trivialement la règle « un seul élément d'or par écran ».

### 6.4 Ce qu'on ne fait pas, bien qu'on en ait eu l'idée

`.seats` (les carrés 12×12 de CMP 0x0C) **reste la présence** et ne devient jamais une jauge de progression. `ScreenClient.tsx:127-131` la rend déjà dans la barre système avec ce sens-là ; lui en donner un second à quarante pixels de distance est pire que d'inventer un signe, parce que la salle a déjà appris à lire celui-ci. La progression est portée par la réglette et par le pied `0x03 / 0x08`.

Et partout où le dither est employé (`.reglette > i.usee`), il l'est avec **sa paire de jetons** : `background-image: var(--dither-25)` **et** `background-size: var(--dither-size)`. Sans le second, la trame tombe à 4 px au lieu de 8, visiblement plus fine que toutes les autres surfaces ditherées de l'application.

---

## 7. LES CAS LIMITES

### 7.1 `prefers-reduced-motion: reduce`

`revelation(spin, true)` renvoie **une autre liste d'images, pas un autre moteur** : toutes les images de marqueur disparaissent, chaque arrêt est posé directement avec son flash, la donne s'écrit d'un coup. Restent la pose, l'inversion de salle, tous les arrêts, et **toutes les tenues, allongées de 1 200 ms** — on ne donne pas *moins* de temps de lecture à qui a besoin de plus de calme. Mode A : 400 + 800 + 800 + 3 200 ≈ **5,2 s**. La révélation ne disparaît pas : c'est le seul endroit où le collectif voit le résultat, elle se comprime, elle ne s'annule pas.

Correctif obligatoire au passage : la préférence est lue **une seule fois** aujourd'hui (`Roulette.tsx:129`). Il faut garder la `MediaQueryList` et écouter son événement `change` — une source OBS peut être rechargée avec d'autres réglages.

### 7.2 Reconnexion

Trois régimes, une seule formule (§ 5.4). `ecoule >= totalMs` → état posé, pas de voile : un tirage d'il y a dix minutes ne se rejoue pas par-dessus une diffusion en cours (contrainte 4). `0 <= ecoule < totalMs` → on entre dans la chorégraphie à `ecoule`, champ chargé, marqueur au bon cran, images restantes à leur heure absolue. Un nouveau `spin.id` pendant une révélation en cours annule la boucle et repart de la pose : l'animateur a relancé, et c'est correct. Une republication d'état portant le même `id` ne relance rien — la dépendance est `[spin?.id, reduit]`.

### 7.3 Un seul participant

> **Le marqueur ne court jamais sur un champ de un.**

`pool.length === 1` : pas de passe sur le tableau. La plaque unique est inversée dès la pose, le pied porte `0x01 SUJET DANS LA ROUE · AUCUN CHOIX`, et la passe sur les cases se déroule normalement. Le suspense se reporte tout seul sur la seule inconnue réelle, sans code spécial — c'est la même règle que celle du mode D. L'instinct du code actuel (`names.length < 2`, l. 132) était bon ; il lui manquait de **dire pourquoi** à la salle, qui sinon croit que l'animation a planté.

Même règle quand `howMany === pool.length` en cible `some` : tout le monde est visé, donc rien n'a été tiré sur le QUI, donc pose — le mode E dégénère proprement en D, et B en C.

### 7.4 Zéro participant

Inatteignable par le haut : `tirer()` lève `RouletteError('Personne a tirer : la salle est vide, ou tout le monde regarde.')` avant qu'aucun `spin` n'existe, et la régie reçoit l'erreur. Le seul chemin par lequel l'écran peut voir `pool.length === 0` est une **ligne d'avant la migration 10** (`pool` par défaut `'[]'`). Comportement : aucun champ de sujets, aucune passe sur le QUI, le tableau est remplacé par la bande des pseudos tirés (`spin.fates`), le pied porte `CHAMP NON ENREGISTRE · TIRAGE ANTERIEUR`. La réglette suit la même règle avec `slots`. **Un tirage ancien s'affiche posé et se tait sur ce qu'il ignore.**

### 7.5 Une roue à une seule case jouable

`slots.length === 1` : pas de passe sur la réglette. Le cran unique est inversé dès la pose, le mot porte le libellé directement, le pied porte `0x01 CASE JOUABLE · AUCUN CHOIX`. Si `pool.length === 1` **et** `slots.length === 1`, rien ne tourne : deux coupes et une tenue, ≈ **3,2 s**. Ce qui est juste — rien n'a été tiré, rien ne doit être dramatisé.

### 7.6 Quinze personnes touchées

Mode C, N = 15, roue de 12 cases. Trois choses se déclenchent, toutes prévues :

1. **Le tableau passe à trois rangées** de cinq plaques de 120 px, et **au-delà de 12 sujets les plaques ne portent plus le libellé du sort** : seulement le pseudo, plus une puce d'effet (`−2`, `+1`, `·`) quand il y en a une. Le libellé à 27 px sur une plaque de 330 px serait de la bouillie sur le rung 480p, et l'appariement complet vit ailleurs (carte persistante, téléphone de chacun). Au-delà de **24 sujets**, le tableau se replie en une ligne de pseudos en `--t-ui` avec les tirés inversés, et la scène n'a plus que deux registres.
2. **La donne reste bornée à ~2 600 ms** : palier `clamp(round(2600/15), 150, 320)` = 173 ms. La durée totale du mode C est quasi indépendante de l'effectif (5,74 s à N=8, 5,78 s à N=15).
3. **La roue s'épuise, et ça se voit.** 15 personnes pour 12 cases : `restantes` se vide au douzième dépôt et se recharge (`roulette.js:298`). Au moment où un `slotIndex` déjà marqué `usee` revient, **tous les crans éteints se rallument dans la même image**, et le pied passe à `LA ROUE A REFAIT UN TOUR · 0x03 SORTS SE REPETENT`. Le seul moment où une répétition est légitime devient le plus spectaculaire de la séquence, au lieu de passer pour un bug. C'est calculable depuis `slotIndex` seul ; `spin.epuise` sert à l'annoncer dans la légende dès la pose.

---

## 8. CE QUI EST SACRIFIÉ

1. **Il n'y a ni roue, ni bille, ni rotation.** Qui attend une roue de fête foraine sera déçu au premier coup d'œil. La compensation — voir la salle entière et les vraies chances, ce qu'aucune roue ne fait au-delà de huit noms — est réelle mais ne se perçoit qu'à la deuxième seconde.
2. **Les premiers paliers ne sont pas lisibles, par construction.** On ne peut plus vérifier à l'œil « mon nom est passé » ; on peut seulement le compter dans le champ. Seuls les trois derniers paliers de chaque passe sont garantis nets après réencodage.
3. **Les cases cessent d'être secrètes, et leurs poids avec.** Un animateur qui aimait cacher sa liste de malus perd ça, et la surprise sur *l'ensemble* disparaît dès le deuxième tirage d'une session. C'est le prix assumé : une roue dont on ne peut pas compter les cases ne permet pas d'évaluer le risque, et sans risque évaluable il n'y a pas de roulette, seulement une annonce.
4. **`detail` (jusqu'à 280 signes) quitte le grand écran pendant la révélation.** Il reste sur la carte persistante et sur le téléphone de l'intéressé (`OwnFate`, déjà correct). Si un sort a besoin de sa précision pour être compris, l'animateur devra la lire à voix haute.
5. **Au-delà de 12 sujets, l'appariement complet n'est plus lisible sur le grand écran pendant la révélation.** Le stream reçoit la **forme** de la distribution ; le contenu vit sur le téléphone de la personne qui doit obéir. C'est une limite transformée en cadrage, mais c'en est une.
6. **Ce n'est pas une proposition purement front.** Migration 10 et quatre touches serveur. Refusées, les modes D et E n'ont aucun champ à animer et retombent sur une pose — nettement plus faible que ce qui est décrit ici.
7. **Le voile confisque l'écran 6 à 9 s.** `TIRAGES` et le chrono sont repris dans la légende ; **le brief et le compteur de rendus disparaissent** pendant ce temps en pleine création. Le bandeau ne couvre que la diffusion.
8. **La règle des 40 % de vide est suspendue sur la scène**, et sur le projecteur la révélation paraîtra plus dense et plus frontale que le reste de l'application.
9. **Le frein est du théâtre.** Le serveur avait tranché avant que quoi que ce soit ne bouge ; ralentir à la fin promet une hésitation qui n'a jamais eu lieu. Je le défends comme allocation de débit et comme aide de lecture, et je maintiens le choix, mais c'est une mise en scène et il faut l'appeler ainsi.
10. **En mouvement réduit, il n'y a aucun suspense — seulement la réponse, tenue plus longtemps.** Il n'existe pas d'équivalent accessible du suspense, et en inventer une version lente serait pire.
11. **Aucun signal sonore n'est possible.** Qui détourne les yeux deux secondes rate l'atterrissage. Le seul rattrapage est la règle « rien de ce qui est révélé ne disparaît avant la fin de la tenue », puis la carte qui reste sur la page.
12. **Le téléphone spoile toujours.** `youFateView` pousse le sort à l'intéressé à l'instant du tirage : il le lit avant la salle, et sa réaction précède l'arrêt. La même fonction `revelation()` permettrait au téléphone de retenir l'affichage jusqu'à `spin.at + totalMs` — je le signale, je ne l'inclus pas : c'est une autre décision, sur une autre surface.

---

## 9. CE QUI RESTE INCERTAIN, ET NE SERA TRANCHÉ QUE SUR UN VIDÉOPROJECTEUR

Chaque point ci-dessous a une valeur par défaut dans la spécification ; ce sont des constantes, pas des choix de conception, et ils se règlent en une ligne.

1. **Le plancher de 150 ms.** Il est calculé pour l'encodeur (4,5 images), pas pour l'œil à trois mètres dans une salle éclairée. Si la zone rapide se lit comme un scintillement pénible plutôt que comme « ça tourne », monter à 190 ms et retirer un palier.
2. **La rampe de netteté.** L'affirmation « les paliers ≥ 400 ms arrivent nets, ceux à 150 ms arrivent flous » est arithmétique sur un rung 480p à 700 kbps. Elle se vérifie sur un **clip enregistré**, pas sur un écran local — où tout sera net et où la démonstration est impossible.
3. **La largeur proportionnelle des crans.** Une case de poids 1 contre une de poids 40 donne 4 px contre ~700 px. Est-ce lu comme une probabilité, ou comme une erreur de mise en page ? Repli prévu si c'est illisible : largeur en √poids, ou largeurs égales plus le pourcentage écrit dans le pied.
4. **`--t-display` à 205 px pour un pseudo.** L'avance d'Archivo 900 expanded n'est pas mesurée ici, et `--fs-6` est un `clamp` en `12vw`. Un pseudo de 12 signes peut déborder. Le seuil `s1` est fixé à 16 signes par prudence ; il se règle au premier essai.
5. **L'inversion pleine du tableau en C et D.** Huit à quinze plaques en aplat d'os sur un projecteur, c'est un mur de lumière. Si c'est agressif : inversion des plaques mais nom en `--ink` sur `--ink-25`, ou inversion du seul filet.
6. **La tenue de 2 000 ms.** Assez pour recopier une consigne ? Cela dépend de la pièce, de la distance et de l'animateur. C'est la constante qui bougera le plus, et elle est isolée dans `TENUE_LECTURE`.
7. **La donne à 173 ms par dépôt (N = 15).** La salle suit-elle quinze plaques qui se remplissent, ou ne voit-elle qu'un frémissement ? Repli : dépôts par paires dès N > 10.
8. **Le grain éteint.** Gain de netteté réellement visible sur le stream, ou imperceptible pour une mutation globale ? Si c'est imperceptible, retirer l'exception n° 5 — la spécification fonctionne sans elle.
9. **Le bandeau de diffusion à 280 px.** Mange-t-il le rendu qu'on est en train de juger, ou se lit-il comme un bas de page ? À vérifier sur un rendu vidéo réel, pas sur une image fixe.
10. **La légende à 27 px.** Elle livre 18 px en 720p et 12 px en 480p : lisible sur le projecteur et sur le rung haut, marginale sur le rung bas. Si `TIRAGES` doit vraiment survivre au 480p, il faut le sortir de la légende et lui donner sa propre ligne en `--t-ui-l`, au prix d'une bande de plus.

---

## 10. LES DÉSACCORDS ENTRE LES TROIS PROPOSITIONS, ET COMMENT ILS SONT TRANCHÉS

| # | Le désaccord | La tranche, et pourquoi |
|---|---|---|
| **1** | **La forme du champ** : anneau circulaire · grille de cases étiquetées · tableau de plaques + volet. | **Aucun arc, jamais.** Le système a déjà dessiné sa roue et elle est orthogonale (`Icon.tsx:78`, zéro courbe) ; un disque serait le seul objet anticrénelé de l'écran, et il flouterait en 720p. Le champ est un **tableau de plaques** (personnes) et une **Progression 0x09 fermée** (cases). Le mot « roulette » est porté par le champ clos plus le marqueur qui décélère, pas par un disque. |
| **2** | **Ce qui porte le suspense visuel** : le champ (crans anonymes) ou le mot. | **Le mot.** Deux juges qui ne se sont pas parlé ont convergé sur la même correction — rendre le centre au texte, dès le premier palier. Un cran de 6×40 px en sang livre 4×27 px à 720p et c'est la première chose que la chroma 4:2:0 perd. Le champ reste **muet** ; il porte le dénombrement, pas la lecture. |
| **3** | **Anneau étiqueté ou champ muet** (le juge de la première proposition demandait des secteurs étiquetés). | **Champ muet + mot énorme.** Étiqueter seize secteurs de 100 px avec des libellés de 120 signes donne seize troncatures illisibles. Le juge avait raison sur le diagnostic (« l'anneau ne porte pas son contenu ») et la réponse correcte n'est pas d'étiqueter le champ, c'est de donner son contenu au mot. |
| **4** | **Durée** : 5–6 s · 8,5–11,5 s · 13–25 s. | **Plafond dur 9,0 s, typique 5,7 à 8,9 s.** Les 6 s de la troisième proposition mesuraient la tolérance à une interruption *vide* ; ici chaque image porte un mot lisible et un champ visible, donc le temps est du contenu. Mais dix tirages doivent coûter 80 s, pas 3 min 26 (le mode C actuel à N=12 coûte 20,6 s). |
| **5** | **Mode C** : N tirages en série · une donne groupée. | **La donne.** N cérémonies pour un seul tirage mentent sur ce qui s'est passé, contredisent le compteur `TIRAGES`, et la dégradation en cascade de la deuxième proposition finissait par servir la moitié de la salle sous forme de liste — exactement le défaut qu'on répare. La donne montre en plus la règle sans remise et l'épuisement, que rien ne montrait. |
| **6** | **Mode B** : partage cardinalité (5,5 s pour le QUI, 0,6 s pour le QUOI) · k circuits successifs · une passe à k arrêts collants. | **Une passe à k arrêts, réparée.** Le défaut relevé — les k−1 premiers dépôts tombent dans la zone rapide, donc dans la zone illisible — est corrigé en **construisant** les paliers de dépôt longs (400 → 600 ms) et croissants. Aucun dépôt n'est sacrifié, et le QUOI reçoit une vraie donne, pas une note de bas de page. |
| **7** | **Le cinquième mode** (`some` + `shared`), manqué par les trois propositions. | **On dérive au lieu d'énumérer.** Le QUI et le QUOI sont deux questions indépendantes, chacune avec sa règle « tiré ou posé ». E se déduit alors sans branche spéciale, et B/E dégénèrent proprement en C/D quand `howMany === pool.length`. |
| **8** | **Les poids**, ignorés par les trois. | **La réglette donne à chaque case une largeur proportionnelle à son poids**, et le pied affiche `POIDS TOTAL`. Sans cela, un champ de cases égales annonce « une chance sur douze » pendant que la régie affiche 40 % (`RouletteHost.tsx:411-414`) — la même faute qu'on reproche au rouleau, un étage plus bas. |
| **9** | **Le sang** : absent · sur le curseur en `--accent` · grammaire du Buzzer. | **Grammaire du Buzzer 0x02** : marqueur en `--accent-deep` + `--border-live` pendant la course, inversion pleine d'os au flash, et **le sang quitte l'écran**. L'arrêt devient chromatique et non seulement temporel : il survit à la perte des 80 ms de flash dans le réencodage. Et la salle a déjà appris ce geste ailleurs dans l'univers. |
| **10** | **L'exception AGARTHA** : aucune · une (la cadence) · trois. | **La cadence n'est pas une exception** (démontré, § 6.1) et elle n'est pas plaidée. **Cinq exceptions réelles**, dans un registre exhaustif, avec leur frontière vérifiée — dont celle du grain, qui avait été annoncée comme un sous-arbre alors que `.grain` est un frère de niveau racine rendu par `app/layout.tsx`. Une exception non défendue est rejetée ; une frontière annoncée et inexistante l'est deux fois. |
| **11** | **L'échelle typographique** : inventer `--fs-7` / `--fs-8` parce que « le système s'arrête à 60,75 ». | **Aucun jeton de taille inventé.** `--fs-6` vaut `clamp(60.75px, 12vw, 205.03px)` et le GUIDE §5 l'assigne nommément à cet écran (« jusqu'à 205 px »). Deux crans nommés au-dessus de `--fs-6` et plus petits que lui transformeraient une échelle monotone en dialecte. |
| **12** | **`.seats`** resignifié en jauge de progression. | **Refusé.** 0x0C en fixe le sens (présence), `ScreenClient.tsx:127-131` le rend déjà ainsi, et le voile reprend la barre système : les deux sens cohabiteraient à quarante pixels. La progression est portée par la réglette et le pied. |
| **13** | **Le voile pendant la diffusion.** | **Bandeau bas de 280 px.** On ne coupe jamais un rendu en cours de jugement, et `PHASES_POINTS` autorise bien un tirage en diffusion. |
| **14** | **`knownRef`** : « la seule partie juste du composant » · à remplacer par l'horloge. | **Supprimé.** Il est la **cause** du bug le plus grave de la livraison : `ScreenClient.tsx:187` ne monte le composant qu'à l'arrivée du premier tirage, donc la ref capture cet identifiant-là et la branche « déjà connu » avale la seule révélation qu'il fallait jouer. La règle `clock.now() - spin.at >= totalMs` le remplace et corrige trois choses d'un coup : le premier tirage se joue, deux écrans sont en phase, un tirage ancien ne se rejoue pas. |
| **15** | **`detail` sur le grand écran.** | **Coupé pendant la révélation**, conservé sur la carte persistante et sur le téléphone. 280 signes sont illisibles à 480p à toute taille qui tienne dans la bande. |
| **16** | **La tenue de lecture** : 2,2 s · 4 s · 4 s + par sort. | **2 000 ms, plus 400 par tranche de 40 signes au-delà de 40, plafond 3 200.** L'argument court gagne parce que la carte reste sur la page et que le sort est déjà sur le téléphone ; le terme adaptatif vient des propositions longues, qui avaient raison sur les libellés de 120 signes. |
| **17** | **La réglette : 8 px (0x09) ou 16 px.** | **16 px, déclaré au registre.** Les 8 px de 0x09 sont une valeur de chrome ; à ×0,445 ils livrent 3,6 px. Le `gap: 4px` de 0x09 est conservé tel quel. |
| **18** | **Le voile** : dither 0x0A conservé · fond opaque · 0x0A supprimé entièrement. | **0x0A conservé** (voile dither, filet, repères de coin), avec deux déviations déclarées : la largeur et l'épaisseur du filet. Supprimer le composant que le système désigne pour ce cas exact — « révélation » est écrit dans le GUIDE §4 — est une exception d'un autre ordre que celle qui était plaidée, et elle passait en contrebande sous une ligne de tableau. |
| **19** | **`transition ... steps()`** : interdit par le §2 · toléré parce que le socle le fait. | **Zéro `transition` dans toute la révélation.** Le débat n'a pas à être arbitré si le besoin n'existe pas : chaque changement est une bascule de classe. Ce qui retire d'un coup la seule ambiguïté que deux propositions ont dû plaider. |
| **20** | **Le mode D après le voile** : « le bloc reste inchangé, et c'est bien ». | **Faux, et corrigé.** `spin.fates` contient en mode D une `Fate` identique par personne : sept lignes rigoureusement identiques en `--t-h2`, pour dix minutes de phase contre sept secondes de révélation. C'est l'état le plus vu de toute la fonctionnalité. Quand `spin.shared`, le bloc rend **une** ligne plus la bande des pseudos. |
| **21** | **La tête d'affiche du mode C**, classée par `|points|`. | **Conservée comme ligne finale invariante des cinq modes, mais jamais mensongère.** Le critère intègre `chronoMs` ; si aucun sort ne porte d'effet mécanique — le cas exact d'une roue de contraintes pures, c'est-à-dire la moitié des roues que fera le propriétaire — le mot ne prétend pas classer : il porte `AUCUN EFFET MECANIQUE · TOUT EST CONSIGNE`. En cas d'égalité, `PARMI LES PLUS LOURDS`. |
| **22** | **La liste des noms affichés.** | **`pool` figé au tirage**, jamais `roster`. Les trois propositions ont vu le bug ; une seule en tirait la conséquence complète — sans `pool` dans la charge, la page ne peut même pas savoir si les spectateurs étaient inclus, puisque `includeSpectators` n'est reporté nulle part. |
| **23** | **`epuise`**, annoncé à l'écran par deux propositions sans être dans la charge. | **Ajouté à la charge** (colonne `spin.epuise`, champ sur `last`). Il vit aujourd'hui dans `SpinAck` (`lib/types.ts:325`), la réponse privée à la régie. Sans lui, la mention « la roue a refait un tour » n'était pas implémentable. |
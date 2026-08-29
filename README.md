# 🎨 Arena

Battles creatives en temps reel. Un animateur impose des contraintes et un
chrono, les participants creent, puis tout le monde note en aveugle avant que
le classement revele les auteurs.

Le type de rendu est un **reglage de session**, pas une version differente de
l'outil : la meme base fait tourner une beat battle, un concours de montage
video, une battle d'affiches ou un exercice d'ecriture.

> Cousin de [Refrain](https://github.com/NQNT-VVV/refrain), dont Arena reprend
> l'architecture, le socle visuel et le principe d'horloge serveur.

---

## Etat du chantier

Le projet avance par increments. Ce qui suit est **fait et teste** :

| # | Increment | Etat |
|---|---|---|
| 0 | Socle : Next + Express + Socket.IO, base SQLite, stockage abstrait, metriques | ✅ |
| 1 | **Le coeur** : sessions, machine a etats, chrono serveur, lobby, temps reel, trois surfaces | ✅ |
| 2 | **Elements imposes** : depot animateur, consultation dans la page, pack ZIP | ✅ |
| 3 | **Rendus** : depot participant, relecture, remplacement, retrait, hors delai | ✅ |
| 4 | Transcodage ffmpeg/sharp, forme d'onde, troncature 45 s, nettoyage des metadonnees | ⏳ |
| 5 | Diffusion et vote : ordre aleatoire, anonymat, blocage de l'auto-vote | ⏳ |
| 6 | Resultats, revelation, export JSON/CSV, duplication de session | ⏳ |
| 7 | Module Discord optionnel | ⏳ |

Les phases pas encore construites existent deja dans la machine a etats : elles
s'affichent et se traversent, avec un ecran d'attente a la place du contenu.

---

## Demarrage

**Node 22 est obligatoire** — la meme version que l'image Docker. La base est un
module natif, compile pour une interface C++ precise : un Node 18 ou 20 produit
un binaire inutilisable. `npm install` refuse d'ailleurs de s'executer sous une
version incompatible, et `npm run dev` verifie avant de charger quoi que ce soit.

```bash
nvm use                # lit .nvmrc
npm install
export SESSION_SECRET=$(openssl rand -hex 32)
npm run dev            # http://localhost:3000
```

Si `nvm` n'est pas disponible, la version installee suffit :

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
```

En developpement `SESSION_SECRET` est facultatif : un secret aleatoire est tire
au demarrage. En production il est **obligatoire** et le serveur refuse de
demarrer sans lui — sans valeur fixe, chaque redemarrage invaliderait les
jetons et deconnecterait tous les participants au pire moment.

Avec Docker, aucune de ces precautions ne s'applique : l'image embarque la bonne
version.

```bash
SESSION_SECRET=$(openssl rand -hex 32) docker compose up --build
```

---

## Les trois surfaces

| Page | Pour qui | Ce qu'elle fait |
|---|---|---|
| `/host` | l'animateur | Cree et regle la session, pilote les phases, ajoute du temps, voit qui est la |
| `/play` | les participants | Chrono, consigne, depot du rendu, vote, classement — pense pour le telephone |
| `/screen` | le videoprojecteur | Code et QR, chrono geant, rendu en cours. Aucun controle |

`/j/ABC123` est le lien court d'invitation ; il redirige vers `/play`.

Le grand ecran n'herite d'aucun privilege : il finit souvent en partage d'ecran
Discord, parfois devant des gens qui ne participent pas.

---

## Deroule d'une session

```
CONFIGURATION ──publier──▶ LOBBY ──lancer──▶ CREATION ⇄ pause / ± temps
                                                │ echeance atteinte
                                                ▼
                                            UPLOAD  (fenetre de grace)
                                                │ cloturer
                                                ▼
                                        DIFFUSION + VOTE
                                                │ dernier rendu
                                                ▼
                                            RESULTATS
                                                │
                                            ARCHIVEE
```

Le tableau `TRANSITIONS` dans `server/battle.js` est la specification : une
transition qui n'y figure pas est refusee, y compris a l'animateur. `archived`
est joignable depuis partout — il faut toujours pouvoir arreter une soiree qui
derape. `lobby → config` existe pour la raison inverse : tant que personne n'a
commence, revenir sur un reglage rate ne doit pas obliger a tout refaire.

Trois choses valent d'etre sues :

- **Le depot est ouvert des la phase CREATION.** `UPLOAD` n'est pas « la phase
  ou l'on depose » mais la fenetre de grace. Le meme point d'entree sert dans
  les deux, et c'est l'horloge du serveur qui decide seule du drapeau « hors
  delai ».
- **La pause** range le temps restant et efface l'echeance ; la reprise repose
  une echeance a `maintenant + reste`. Le client lit deux champs, il n'a aucune
  arithmetique de pause a faire.
- **Ajouter du temps marche aussi sur la fenetre de grace.** « Je vous laisse
  deux minutes de plus pour finir vos depots » est la meme intention que
  « je rallonge la creation ».

---

## Le chrono fait autorite

Une session ne stocke jamais « il reste douze minutes » mais « la creation
s'arrete a tel instant ». Une duree se perime pendant son trajet reseau et se
falsifie en avancant l'horloge de son telephone ; un instant absolu ne se
negocie pas.

Chaque client mesure sa derive contre le serveur (`lib/clock.ts` : quatre
allers-retours, mediane des ecarts) et affiche `endAt − clock.now()`. Deux
telephones desynchronises d'une seconde affichent quand meme la meme.

Consequence utile : **le serveur ne diffuse rien entre deux changements de
phase**. Pas de battement de coeur, pas de tick par seconde. Une session avec
deux cents participants est silencieuse pendant l'heure de creation, sauf quand
l'animateur agit.

Les alertes sonores sont detectees par franchissement de seuil plutot que par
une liste de « deja joue » : quand l'animateur rallonge le temps, le compte a
rebours repasse au-dessus du seuil et l'alerte se redeclenche a la seconde
traversee, ce qui est bien le comportement attendu.

---

## L'anonymat

C'est le point le plus fragile du produit, donc celui qui a le moins de code.

**Une seule fonction decide.** `server/views.js` est le seul module autorise a
construire ce qui part vers un client, et `authorOf()` est le seul endroit ou
un rendu peut recevoir le nom de son auteur. La condition tient en une ligne :
la phase est-elle `results` ou `archived` ?

**L'animateur n'y echappe pas.** Il regarde la diffusion en meme temps que les
autres, souvent en partage d'ecran : lui accorder une vue nominative ferait
fuiter tout le monde d'un coup.

**Le trombinoscope reste public.** Savoir qui participe ne dit rien de qui a
fait quoi. C'est la correspondance rendu → auteur qui est protegee ; masquer la
liste des presents priverait le lobby de son interet sans rien proteger.

**Le nom du fichier est cache.** « beat-alexis-v3.wav » annulerait tout le
reste du dispositif. Pendant la diffusion, un rendu se telecharge sous le nom
`rendu.wav` ; le nom d'origine ne revient qu'aux resultats — et a son auteur,
qui le connait deja.

**Identifiant de rendu opaque.** L'URL ne porte ni le nom d'origine ni
l'identifiant du participant, et un remplacement en tire un nouveau : deux
versions du meme rendu ne se correlent pas. Un rendu n'est servi que si la
phase l'autorise, ou si l'appelant presente la signature remise a son auteur
— faute de quoi la reponse est 404, jamais 403 : confirmer l'existence d'un
rendu a qui n'y a pas droit est deja une information de trop.

**Pas de dossier statique.** Les fichiers sortent par une route qui verifie la
phase avant de servir le moindre octet, et qui decide seule des entetes.

Une defense reste a construire, avec l'increment transcodage :
**le re-encodage systematique**, jamais de copie directe. C'est ce qui fera
disparaitre les tags ID3, EXIF et XMP — plutot qu'un nettoyeur de tags qu'on
oublierait de mettre a jour au prochain format.

---

## Identite des participants

Pas de compte : un pseudo suffit. A la premiere entree le serveur remet un
jeton porteur, dont il ne conserve que l'empreinte ; le navigateur le range
dans `localStorage`, **par code de session** — quelqu'un peut suivre deux
battles dans deux onglets, et un animateur teste souvent la sienne en
participant.

Un rafraichissement, une mise en veille ou un tunnel de metro ne coutent pas sa
place : la reconnexion rejoue l'entree avec le jeton et retrouve la phase, le
chrono et l'etat exact.

> **Limite connue.** Quelqu'un qui perd son jeton — navigation privee, cache
> vide, autre appareil — ne peut pas reprendre son pseudo : le serveur refuse,
> sinon n'importe qui pourrait s'approprier une identite en la tapant. La
> reprise mediee par l'animateur viendra avec l'increment depot, quand perdre
> son identite commencera a couter un rendu.

---

## Configuration

Tout se regle par variables d'environnement — voir `.env.example`, qui les
liste toutes avec leur valeur par defaut. `server/config.js` est le seul fichier
autorise a lire `process.env` : une valeur de reglage ecrite en dur dans un
module metier devient invisible depuis le manifeste de deploiement.

Ce que l'animateur choisit par session : nom, type de rendu, consigne, duree,
fenetre de grace, seuils d'alerte, bareme, note par defaut, criteres, politique
des depots hors delai, enchainement automatique.

Tout ce qui vient du reseau est borne dans `sanitizeConfig()`, y compris ce que
seul l'animateur peut envoyer : un champ laisse a un humain finit toujours par
contenir autre chose que ce qu'on attendait, et une duree de creation de neuf
ans arme un `setTimeout` que Node tronque silencieusement.

---

## Structure

```
app/            pages Next (App Router)
  host/         la regie
  play/         le participant
  screen/       le videoprojecteur
  globals.css   socle visuel, repris de Refrain
components/     briques partagees (chrono, rail de phases, QR, marque)
lib/            client : horloge, socket, types, sons, hooks
server/
  config.js     toute la configuration, seul lecteur de process.env
  db.js         connexion SQLite et migrations
  repo.js       tout le SQL, et rien d'autre
  battle.js     sessions, machine a etats, chrono            ← le coeur
  views.js      serialisation par audience                   ← l'anonymat
  util.js       codes, jetons, nettoyage des saisies
  api.js        routes HTTP : fichiers, pack, sante, QR
  upload.js     reception en flux, plafonds appliques pendant le transfert
  files.js      service des fichiers : entetes, requetes partielles
  mime.js       reconnaissance par les octets, et refus d'affichage
  storage/      interface de stockage, driver local
  metrics.js    Prometheus, sur un port distinct
  index.js      Express + Next + Socket.IO
test/
  state.mjs     machine a etats et chrono, sans reseau
  e2e.mjs       vrai serveur, vraies sockets
deploy/         manifeste Kubernetes
```

Trois modules portent tout le poids conceptuel : `battle.js` (le temps et les
transitions), `views.js` (ce qui sort), `repo.js` (ce qui reste). Le reste est
du cablage.

### Pourquoi une base, alors que Refrain n'en a pas

Refrain garde ses parties en memoire et l'assume : un blind test meurt avec
l'onglet, et personne ne veut operer une base pour une soiree. Une battle dure
deux heures et porte des fichiers televerses — un redemarrage de conteneur ne
peut pas les volatiliser.

D'ou SQLite, mais le plus discret possible : un fichier, aucun service. L'etat
vit en memoire pour la vitesse de diffusion et se recopie en base a chaque
mutation, via une seule methode (`LiveSession.patch()`) qui bouge les deux
ensemble. Au demarrage les sessions non archivees reviennent et leurs echeances
sont rearmees.

Tout le SQL tient dans `repo.js` : passer a Postgres, si le besoin apparait, se
fait en reecrivant ce seul fichier.

---

## Tests

```bash
npm run typecheck          # types partages front/serveur
npm run test:state         # machine a etats et chrono, en memoire   (13)
npm run test:mime          # reconnaissance de type et refus d'affichage (22)
npm run build              # necessaire aux suites qui suivent
npm run test:assets        # elements imposes, par le reseau         (13)
npm run test:submissions   # depot des rendus, par le reseau         (16)
npm test                   # parcours complet, vraies sockets        (15)
```

`test/state.mjs` attaque les objets directement : transitions interdites,
pause qui ne perd pas de secondes, echeance qui se declenche seule, reprise
apres redemarrage. Une seconde d'execution, rejouable a chaque modification.

`test/e2e.mjs` demarre le serveur et le pilote avec de vraies sockets : noms
d'evenements, contenu des salons, refus d'une socket de participant qui tente
une action de regie, coupure de connexion rattrapee, absence de fuite d'auteur
dans la charge utile de diffusion et dans les metriques.

`test/mime.mjs` verifie qu'aucun fichier depose par un tiers ne peut etre servi
avec un type que le navigateur accepte d'interpreter. `test/assets.mjs` et
`test/submissions.mjs` font passer de vrais fichiers par le reseau : plafonds
appliques pendant le flux, fragments nettoyes apres un refus, requetes
partielles, et les deux verifications d'anonymat qui comptent — un rendu est
introuvable pour qui n'en est pas l'auteur avant la diffusion, et son nom de
fichier ne reapparait qu'a la revelation.

---

## Deploiement

### Image

`Dockerfile` multi-etages sur `node:22-bookworm-slim`. Debian plutot qu'Alpine
pour deux raisons concretes : `better-sqlite3` publie des binaires precompiles
pour la glibc (sur musl il faudrait embarquer un compilateur), et `ffmpeg`
s'installe en une ligne d'apt avec les codecs attendus.

### Kubernetes

```bash
kubectl create secret generic arena -n arena \
  --from-literal=SESSION_SECRET=$(openssl rand -hex 32)
kubectl apply -f deploy/arena.yaml
```

Une seule instance, `strategy: Recreate`, volume persistant. Deux pods ecrivant
la meme base SQLite se marcheraient dessus — c'est l'ecart assume avec Refrain,
qui peut se permettre d'etre sans etat.

L'Ingress porte trois annotations qui comptent : deux delais longs, sans
lesquels nginx coupe les connexions Socket.IO au bout de soixante secondes, et
une taille de corps relevee, sans laquelle la limite d'un mega-octet par defaut
rejetterait la quasi-totalite des rendus video.

### Supervision

`arena_sessions` par phase, `arena_participants_connected`,
`arena_phase_transitions_total`, `arena_socket_errors_total` par motif, sur
`METRICS_PORT`. Le port n'est pas publie par l'Ingress : pas besoin de proteger
`/metrics` par un filtre d'URL.

---

## En cas de pepin

### `nvm : commande introuvable`, alors que `~/.nvm` existe

nvm est une fonction de shell definie par `~/.bashrc`. Un terminal qui ouvre un
**shell de connexion** — c'est le cas par defaut sous WSL et dans plusieurs
terminaux integres — lit `~/.profile`, pas `~/.bashrc`. Le `.profile` de Debian
fait normalement le pont ; certains installeurs l'ecrasent et le pont disparait.

Verifier :

```bash
bash -lc 'type -t nvm'    # vide  -> le pont manque
bash -ic 'type -t nvm'    # function -> nvm est bien installe
```

Retablir, une fois pour toutes et pour tous vos projets :

```bash
printf '\nif [ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi\n' >> ~/.profile
```

puis rouvrir le terminal.

### `npm error code EBADENGINE`

C'est le refus attendu : Node est trop ancien. Le message donne la version
requise et la version en cours. Passez en Node 22 avant de reinstaller.

### `NODE_MODULE_VERSION 127 ... requires 109`

Les dependances ont ete installees sous une version de Node, et sont executees
sous une autre. Repassez sur la bonne version, puis :

```bash
npm ci
```

À noter : le Node 18 empaquete par Debian et Ubuntu annonce l'interface native
**109** la ou le Node 18 officiel annonce 108. Aucun binaire precompile publie
ne lui correspond, quel que soit le paquet — raison de plus pour rester sur la
version de `.nvmrc`.

### Le serveur redemarre en boucle en developpement

`node --watch` surveille les modules charges par le process — et le serveur de
developpement de Next charge ses chunks compiles depuis `.next/`. Chaque
compilation a la demande y reecrit des fichiers, Node redemarre, et les
requetes en vol tombent.

D'ou `--watch-path=./server` dans le script `dev` : seuls les fichiers serveur
justifient un redemarrage. Les pages et les composants sont rechargés par Next
lui-meme, sans couper les sockets ni les sessions en cours.

### `@img/sharp-wasm32 extraneous` dans `npm ls`

Sans consequence. `sharp` arrive en dependance optionnelle de Next ; sur
linux-x64 c'est la variante native qui sert, et npm etiquette le repli WebAssembly
comme superflu tout en l'installant. Rien a corriger.

---

## Module Discord

Prevu, pas developpe. L'idee est un module optionnel qui s'abonne aux evenements
de session (`session:published`, `session:results`) et reste inerte tant que
`DISCORD_WEBHOOK_URL` est vide. Aucun couplage avec le coeur.

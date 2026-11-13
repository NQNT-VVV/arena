# Journal des changements

## Branche `arena-bureau` — novembre 2026 (locale, non déployée)

### Nouveau visage
- Arena passe au style « Bureau » : papier, encre, vert, jaune ; boutons qui s’enfoncent, petites animations.
- Mode sombre, avec un interrupteur à côté du logo (il suit le réglage du système par défaut).
- Accueil refait autour d’une console verte et d’un chrono.
- Tous les textes sont en français accentué, en casse normale, et tutoient.

### Relancer une session
- « Nouvelle édition » emmène tout le monde : créateurs, spectateurs et écran de projection basculent seuls sur la nouvelle session, sans retaper de code ni de pseudo.

### Rendus et résultats
- « Télécharger » donne le rendu entier, à tout le monde, spectateurs compris (c’était un extrait coupé).
- Le podium reste visible après la fin de la session, sur les téléphones et en régie.
- Les rendus des manches précédentes restent accessibles au classement.
- L’export CSV / JSON contient toutes les manches et le classement général.
- Terminer la session dévoile les places encore cachées.

### Régie
- Une coupure réseau ne fait plus perdre la session à l’animateur.
- Ouvrir le lobby ou lancer enregistre d’abord les réglages affichés.
- Confirmation avant de quitter en pleine partie, et avant d’afficher les résultats s’il reste des rendus à passer.
- Entre deux manches, la consigne et le pack d’éléments se changent.
- Compteurs séparés : créateurs, spectateurs, en ligne.
- En Rebuild The Track, la régie ne voit plus qui a quel extrait pendant le vote.
- Une ligne prévient quand un rendu est diffusé sans nettoyage de ses métadonnées.

### Joueurs et spectateurs
- Quitter après le lancement garde ta place : le même lien te ramène.
- Arrivé après le début de la diffusion ? Une explication claire et un lien « Suivre sans noter ».
- Une note ratée se rattrape : la liste des rendus pas encore notés reste affichée pendant la diffusion.
- Après la fin du délai, le dépôt dit ce qui va se passer au lieu d’inviter à remplacer.
- Spectateurs : un mini-jeu de mémoire (« les pads ») pendant que les créateurs travaillent ; la chaîne d’écriture passe la main correctement et repart à chaque manche.

### Justesse du classement
- Les notes d’un participant écarté ne comptent plus (une moyenne pouvait dépasser le barème).
- Écarter ou réintégrer quelqu’un ne bloque plus le dévoilement du podium.

### Ménage
- Nombres en décimal partout (le rang 16 s’affichait « 0x10 »).
- Un seul mot par notion : créateurs, spectateurs, session, rendu, dépôt.
- Sessions terminées conservées après un redémarrage ; sessions abandonnées purgées.
- Règles partagées envoyées par le serveur au lieu d’être recopiées dans les pages ; réglage et code morts retirés.

### À savoir
- Vérifié par les tests automatiques et une session jouée jusqu’à la création. La diffusion, le vote et le podium n’ont pas encore été revus à l’écran dans ce style.
- Les captures du guide de l’animateur montrent encore l’ancien habillage.
- Le détail, point par point, est dans la revue du 13 novembre.

# Velvet TCG — Site public

Démo publique du jeu de cartes Velvet TCG. Les portraits utilisés sont provisoires ou attribués à leur source. Les statistiques sont fictives et la collection est enregistrée localement dans le navigateur.

Ce dépôt ne contient ni données personnelles ni secrets. Le développement se poursuit dans un dépôt privé distinct.

## Fondations et tests locaux

Node.js 22 ou plus récent suffit. Aucune installation de dépendances n’est nécessaire.

```sh
node --test
node scripts/serve.cjs
```

Ouvrir ensuite <http://127.0.0.1:8080>. Arrêter le serveur avec Ctrl+C.
Les alias `npm test` et `npm start` sont disponibles ; sous PowerShell si `npm.ps1` est bloqué, utiliser `npm.cmd test` et `npm.cmd start`.

Les tests natifs Node exécutent le script réel du jeu dans un DOM simulé, sans appels réseau. Ils couvrent les identités et volumes, les seuils et groupes exacts du tirage, les lots et interruptions, le paiement, les tickets, les crédits gratuits/DEBUG, la compatibilité, les exports/imports et les erreurs de stockage. Ils ne remplacent pas une vérification visuelle dans un navigateur.

## Sauvegardes

Les boutons en bas de page permettent d’exporter la partie en JSON, d’importer un export ou un ancien objet `velvet-v03`, et de récupérer la sauvegarde initialement lue au démarrage. L’import demande confirmation : il remplace la partie, sans fusionner les collections. Il est refusé pendant une ouverture de boosters.

Avant un import valide, la valeur précédemment stockée est copiée dans `velvet-v03-before-import`. Le bouton « Exporter la partie avant le dernier import » permet de la récupérer. Un nouvel import remplace cette copie de secours ; conserver aussi des exports sur disque. Si cette copie ou l’écriture principale échoue, l’import est refusé et la partie en mémoire n’est pas remplacée.

La clé de jeu reste `velvet-v03`. Les IDs 1 à 100, exemplaires, crédits, favoris, tickets et date de recharge sont conservés. Les anciens fichiers sans favoris ni champs de tickets restent acceptés. Les champs inconnus sont préservés. Les nouvelles sauvegardes exportées portent une enveloppe `format: "velvet-save"`, `version: 1` ; la valeur stockée dans le navigateur garde le format historique.

Une sauvegarde existante invalide ou inaccessible n’est jamais automatiquement écrasée. La page affiche une alerte textuelle et suspend les écritures de jeu ; la partie temporaire en mémoire reste exportable. Exporter la sauvegarde initiale avant de récupérer les données ou d’importer un fichier valide. Si une écriture échoue en cours de jeu, les gains restent en mémoire et exportables, mais il faut les exporter avant de fermer ou recharger la page.

Pour vérifier manuellement, sur une partie locale :

1. Ouvrir des lots x1, x3, x5 et x10 dans chaque volume, puis quitter une révélation et vérifier les cartes dans la collection.
2. Ajouter un favori, exporter la partie, gagner des cartes puis réimporter l’export : vérifier crédits, exemplaires et favoris après rechargement.
3. Importer un JSON invalide : la partie doit rester intacte. Vérifier l’export de secours après un import valide.
4. Vider la réserve par des ouvertures, vérifier le complément de 100 crédits par booster manquant et la recharge d’un ticket après cinq minutes.

Le stockage dépend de l’origine du navigateur : la version locale ne retrouve pas automatiquement la partie du site publié. Exporter depuis le site d’origine, puis importer localement. Aucun déploiement n’est nécessaire.

Limites conservées pour cette mission : raretés du Volume II inchangées (toutes communes malgré les groupes de tirage pondérés), absence de synchronisation entre onglets, services de portraits/biographies distants et structure principale monolithique. Éviter de jouer simultanément dans plusieurs onglets.

En x1, les cinq cartes sont révélées une par une, de la commune à la légendaire. Les lots x3, x5 et x10 utilisent une seule animation d’ouverture, puis réunissent leurs 15, 25 ou 50 cartes dans une même pile, également révélée une carte à la fois de la commune à la légendaire. Le compteur et la barre de progression couvrent tout le lot, sans nouvelle ouverture entre deux paquets. Le bilan final regroupe les doublons et compte les exemplaires par rareté ; le bouton « Tout révéler et voir le bilan » permet d’y accéder directement. Le tri porte uniquement sur l’affichage et conserve les tirages enregistrés. Les probabilités par carte sont calculées depuis les groupes de tirage et les raretés réelles du volume sélectionné : 45 % / 35 % / 16 % / 4 % (commune / rare / épique / légendaire) au Volume I, et 100 % de communes au Volume II, dont les raretés restent inchangées.

Les effets de déchirure et les notes de rareté sont synthétisés localement dans `booster-audio.js`. Le bouton ♪, disponible sur la page et pendant l’ouverture, mémorise la coupure du son dans une préférence distincte (`velvet-audio-muted`), sans toucher à `velvet-v03`. Le son démarre après une interaction et une indisponibilité audio ne bloque pas le jeu.

## Fiches encyclopédiques

Les fiches sont organisées en Présentation, Mensurations, Carrière et notoriété, et Sources. Seuls les champs documentés et les rubriques contenant des informations sont affichés. Le catalogue documentaire est indépendant des sauvegardes joueur ; les divergences restent signalées pour vérification. Aucun résumé biographique n’est inventé. L’ancien chargement automatique Wikipédia est remplacé par le catalogue sourcé ; les portraits Commons restent indépendants.

Voir [le modèle et l’import local des métadonnées ThePornDB](docs/encyclopedia.md), ainsi que le format pour des sources documentaires autorisées ultérieurement. L’âge se calcule à l’affichage ; `known_for` exige un texte étayé de deux à quatre phrases.

Pour activer la récupération API, renseigner `TPDB_TOKEN=` dans `.env.local` (modèle : `.env.example`), puis exécuter `node scripts/sync-tpdb.cjs --id 1` pour une simulation. `node scripts/sync-tpdb.cjs --all --apply` récupère et importe les correspondances uniques, avec une copie de secours du catalogue. Les clés et fichiers `.local/` restent privés ; le site et son dossier `dist/` ne contiennent pas la clé. Voir la documentation pour consulter le compte rendu et traiter les fiches ambiguës.

Les portraits approuvés sont inclus localement dans `assets/portraits/`, avec leurs crédits dans `data/portraits.json`. Le navigateur ne relance plus de recherche de photos. Les cartes gardent un visuel neutre si une image est absente ou échoue. La collecte et la validation visuelle des nouveaux portraits sont décrites dans [la documentation](docs/encyclopedia.md#vérifications).

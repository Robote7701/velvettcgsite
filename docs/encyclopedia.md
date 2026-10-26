# Fiches encyclopédiques

Cette version permet l’enrichissement des 100 fiches depuis ThePornDB avec une clé locale, ou par import documentaire hors ligne. Les nouveaux champs du catalogue sont vides tant qu’une information documentée n’a pas été importée. Les identifiants, noms de scène et raretés du jeu restent ceux du catalogue. Aucune écriture des sauvegardes `velvet-v03` ne provient de cette intégration.

## Configurer la clé et récupérer les fiches

1. Ouvrir `.env.local` à la racine du projet. S’il n’existe pas, copier `.env.example` sous ce nom.
2. Coller la clé après `TPDB_TOKEN=` et enregistrer. Ne pas partager ce fichier. La clé est lue par Node.js, jamais par la page web. Une variable d’environnement `TPDB_TOKEN` définie dans le terminal est prioritaire sur le fichier.
3. Tester une fiche en simulation, puis récupérer les 100 fiches si le test réussit :

```sh
node scripts/sync-tpdb.cjs --id 1
node scripts/sync-tpdb.cjs --all
```

Ces commandes consultent l’API mais ne modifient pas le catalogue. Les résultats sont écrits dans `.local/tpdb/batch.json` et le compte rendu dans `.local/tpdb/review.json`. Ces fichiers sont remplacés lors de chaque nouvelle collecte. Le compte rendu indique les identités prêtes, absentes, ambiguës et invalides. Aucun jeton ni biographie brute n’y est enregistré.

Pour récupérer et importer directement les correspondances sûres :

```sh
node scripts/sync-tpdb.cjs --all --apply
node --test
```

Une copie du catalogue précédent est créée dans `.local/tpdb/catalogue-before-*.json` avant l’écriture. Les profils absents, ambigus ou invalides restent inchangés. L’outil indique leur nombre ; l’import peut donc être partiel. Un échec réseau ou d’authentification interrompt la collecte avant l’import. Une modification concurrente du catalogue annule son remplacement. Les divergences documentaires suivent les règles décrites plus bas.

Pour importer un lot déjà récupéré après sa vérification, sans nouvelle requête API, utiliser `node scripts/enrich-profiles.cjs .local/tpdb/batch.json --apply`. Ce dernier outil est l’import hors ligne historique : la copie `catalogue-before-*` est créée par `sync-tpdb.cjs --apply`, pas par l’import hors ligne.

Le collecteur attend entre les requêtes, gère les réponses 429/502/503/504 avec des reprises limitées et applique un délai maximal de 20 secondes par requête. Il refuse les redirections afin de conserver la clé sur l’origine API officielle. Les erreurs affichées ne recopient ni les en-têtes ni le corps des réponses.

`.env.local`, les autres fichiers `.env` privés, `.local/` et `dist/` sont exclus de Git. `node scripts/build-site.cjs` prépare uniquement les fichiers nécessaires au site et les portraits approuvés dans `dist/`. Le workflow Pages utilise ce dossier ; aucune collecte API n’est exécutée en CI et la clé n’est pas nécessaire au site publié. Cette commande de préparation ne publie rien.

## Données et affichage

Le schéma `data/personalities.json` passe à la version 2 de façon additive. L’ancien contenu est conservé. Ce numéro concerne le catalogue documentaire, pas le format des sauvegardes joueur.

| Groupe | Champs |
| --- | --- |
| Identité | `stage_name`, `aliases`, `nationalities`, `birth_country`, `birth_city`, `birth_place`, `birth_date`, `birth_date_precision`, `death_date` |
| Mensurations | `height`, `weight`, `body_measurements`, `cup_size`, `waist`, `hips` |
| Carrière | `career_start_year`, `activities`, `notable_works`, `awards`, `nominations`, `collaborations`, `career_status` |
| Notoriété | `known_for` |
| Traçabilité | `sources`, `field_sources`, `conflicts` |

Les listes sont des tableaux de textes. Les champs simples sont des textes ou `null`, sauf `career_start_year` qui est un entier. Les champs non renseignés restent `null` ou `[]` dans le catalogue, mais ne sont pas affichés. Les rubriques entièrement vides et le titre du résumé `known_for` absent sont également masqués. Le nom de scène intégré au jeu reste visible même sans source documentaire supplémentaire.

Un champ documentaire n’est affiché que s’il possède une source référencée. Les sources doivent avoir un identifiant unique, un fournisseur, une URL HTTP(S) et une date de récupération ISO avec heure. Une URL mentionnée dans un texte ou dans un lien externe ThePornDB n’est pas une preuve que cette autre source a été consultée.

L’âge est calculé lors de l’ouverture de la fiche à partir de la date du jour à Paris. Il n’est pas stocké. Une naissance documentée au mois ou à l’année ne donne pas d’âge exact. Une date de décès documentée permet d’afficher l’âge au décès ; elle ne sert pas à déduire un statut professionnel.

Les mensurations conservent la notation de la source. Aucune unité implicite n’est convertie. Aucun renseignement, y compris une mensuration ou une nationalité, n’est déduit d’une photographie.

## ThePornDB

Référence vérifiée le 23 octobre 2026 : [documentation officielle](https://api.theporndb.net/docs), [spécification OpenAPI](https://api.theporndb.net/specs?openapi.json).

L’adaptateur suit `PerformerResource` : `name`, `aliases` et les propriétés de `extras` telles que `nationality`, `birthplace`, `birthplace_code`, `birthday`, `birthday_type`, `deathday`, `career_start_year`, `height`, `weight`, `measurements`, `cupsize`, `waist`, `hips`.

Une réponse doit être associée explicitement à un ID Velvet et à sa date réelle de récupération. Le collecteur parcourt les pages de recherche et exige une seule correspondance exacte du nom, sans tenir compte de la casse. Il récupère ensuite la fiche détaillée et recontrôle l’UUID et le nom. Plusieurs homonymes exacts ou une absence de correspondance sont consignés pour vérification, sans choisir arbitrairement un résultat. Une correspondance de nom seule reste une aide au rapprochement, pas une preuve indépendante d’identité : les sources doivent être revues, notamment pour les homonymes. L’UUID ThePornDB est conservé dans la source, jamais à la place de l’ID Velvet.

Le lieu libre `birthplace` est conservé tel quel : l’adaptateur n’en déduit pas une ville. Le code documenté `birthplace_code` peut être traduit en libellé de pays en français. Les valeurs `birthday_type: YEAR` et `MONTH_YEAR` limitent la précision affichée ; `DAY_MONTH` ne permet pas d’établir une date complète.

Les biographies brutes, photos, liens de sites, notes et listes de scènes ne sont pas utilisés pour inventer une notoriété, une activité, une collaboration « marquante » ou un statut de carrière. Une année de fin n’établit pas à elle seule un statut « retraitée ». L’ancien chargement automatique de biographies Wikipédia dans les fiches est remplacé par les champs documentaires sourcés ; les futures sources se préparent par lots explicites.

## Import local de métadonnées

Ce mécanisme est distinct de l’import des sauvegardes joueur. L’import hors ligne ne réalise aucun appel API. Conserver la clé dans `.env.local` et les lots dans `.local/`, tous deux ignorés par Git et exclus du dossier publié. Ne jamais mettre de jeton dans `index.html`, dans le catalogue, dans une URL de source ou dans un lot importé.

Préparer un lot ThePornDB de cette forme, en remplaçant les indications entre chevrons par les valeurs réellement récupérées :

```json
{
  "provider": "ThePornDB",
  "profiles": [
    {
      "id": 1,
      "retrieved_at": "<date réelle au format ISO, par exemple 2026-10-23T12:00:00.000Z>",
      "data": {
        "id": "<UUID ThePornDB vérifié>",
        "name": "<nom exact du catalogue Velvet>",
        "aliases": [],
        "extras": {}
      }
    }
  ]
}
```

Le champ `data` est la ressource de la réponse officielle `GET /performers/{identifier}`. Seuls les champs documentés ci-dessus sont repris ; les clés inconnues du fournisseur ne sont pas recopiées. La date de récupération n’est jamais fabriquée à partir de la date du fichier.

```sh
node scripts/enrich-profiles.cjs chemin/lot-documentaire.json
node scripts/enrich-profiles.cjs chemin/lot-documentaire.json --apply
node --test
```

La première commande simule l’import et indique le nombre de profils modifiés et de divergences. Vérifier les données, puis utiliser `--apply` pour enregistrer. Un lot invalide est refusé avant l’écriture. Examiner ensuite le diff Git. Cet outil n’ajoute aucune personnalité et ne modifie ni les règles ni les sauvegardes du jeu.

## Autres sources documentaires et `known_for`

Les trois sources proposées sont utilisables dans le format de lot documentaire ci-dessous ; elles n’exigent pas la clé ThePornDB, qui ne doit jamais leur être envoyée. Leur disponibilité a été vérifiée le 23 octobre 2026 :

| Source | Vérification et usage actuel |
| --- | --- |
| [AdultFilmDatabase](https://www.adultfilmdatabase.com/) | Fiches publiques accessibles. Les [règles de consultation](https://www.adultfilmdatabase.com/robots.txt) demandent 30 secondes entre les requêtes et excluent `/modules/actor/performedwith.cfm`. Pas de collecte massive ajoutée. La fiche d’Angela White a servi à documenter sa carrière, un film et un résumé `known_for`. |
| [IAFD](https://www.iafd.com/) | Une protection d’accès renvoie HTTP 403 dans l’environnement utilisé. Aucun contournement ni import de faits supposés ; cette source reste une référence à consulter manuellement ou via un accès autorisé. Un lien IAFD fourni par ThePornDB ne compte pas comme une consultation de sa page. |
| [Boobpedia](https://www.boobpedia.com/) | Les articles publics `/boobs/…` sont accessibles par une requête HTTP ordinaire. Les [règles de consultation](https://www.boobpedia.com/robots.txt) excluent notamment l’API et les espaces internes ; ils n’ont pas été utilisés. Les articles de Belladonna, Autumn Falls et Tory Lane ont été lus pour un enrichissement ciblé. |

Le lot relu est conservé dans `data/documentary-evidence.json`. Il précise les valeurs, pages et dates réelles de récupération, et peut être simulé avec `node scripts/enrich-profiles.cjs data/documentary-evidence.json`. Son import est idempotent. Les copies précédentes du catalogue et les pages consultées restent dans `.local/documentary/`, hors Git et hors site publié. Le lot n’est pas un collecteur automatique de ces trois sites ; de nouvelles fiches demandent une lecture et une vérification avant import.

La fiche Velvet **Tori Lane (#88)** garde son nom et son identifiant : l’article [Tory Lane](https://www.boobpedia.com/boobs/Tory_Lane) cite explicitement « Tori Lane » parmi les autres noms. Les fiches [Belladonna](https://www.boobpedia.com/boobs/Belladonna) et [Autumn Falls](https://www.boobpedia.com/boobs/Autumn_Falls) disposent désormais d’informations documentaires sans choisir arbitrairement un homonyme ThePornDB. Le rapport de collecte ThePornDB initial reste inchangé : il décrit sa collecte propre et non les ajouts documentaires ultérieurs.

La page [Sasha Rose](https://www.boobpedia.com/boobs/Sasha_Rose) est une désambiguïsation entre une personnalité britannique et une personnalité russe. Aucun choix n’a été fait pour l’ID Velvet #77. Les champs manquants y restent vides dans le catalogue et sont masqués dans la fiche.

Une divergence réelle de mensurations entre [AdultFilmDatabase](https://www.adultfilmdatabase.com/actor/angela-white-42938/) et ThePornDB est enregistrée pour Angela White. Les deux valeurs et leurs références sont conservées ; le champ est masqué en attendant vérification, selon le fonctionnement des divergences. Aucun portrait ni élément privé concernant des proches n’a servi à renseigner une fiche.

Pour une future source autorisée, préparer un lot `format: "velvet-documentary-evidence"`, `version: 1`, avec `profiles: [{id, stage_name, claims: [...]}]`. Chaque élément de `claims` décrit une seule valeur :

```json
{
  "field": "known_for",
  "value": "<Résumé factuel rédigé et vérifié de deux à quatre phrases.>",
  "source": {
    "id": "<identifiant unique de la consultation>",
    "provider": "<nom de la source autorisée>",
    "url": "<URL de la page qui étaye le résumé>",
    "retrieved_at": "<date réelle ISO avec heure>"
  }
}
```

`known_for` répond à « Pourquoi cette personnalité est-elle connue ? ». Il reste vide si aucun résumé de deux à quatre phrases n’a été rédigé et étayé. Le validateur contrôle la structure et les références ; la vérification de la véracité et de la portée des sources reste éditoriale. Pour plusieurs sources étayant la même valeur, répéter la même valeur avec leurs identifiants distincts.

## Divergences

Si deux consultations donnent des valeurs différentes pour un même champ, aucune n’écrase silencieusement l’autre. `conflicts` conserve les valeurs et leurs sources avec `status: "pending"`. La fiche signale la divergence dans « Sources » et masque le champ concerné jusqu’à vérification. Les différences entre listes sont également signalées, sans fusion automatique.

La résolution est une opération éditoriale : vérifier les pages, conserver les sources et l’historique dans le suivi de version, renseigner la valeur et ses `field_sources`, puis retirer le conflit résolu du tableau après revue. Un import identique n’ajoute pas de doublon ; une nouvelle consultation doit avoir un nouvel identifiant de source si sa date change.

## Vérifications

Les portraits sont maintenant chargés depuis `data/portraits.json` et `assets/portraits/`, sans recherche Commons dans le navigateur. Le manifeste contient les pages sources, auteurs, licences et dates de récupération. Seuls les fichiers téléchargés, contrôlés visuellement et approuvés sont utilisés. Un échec de chargement laisse le visuel neutre de la carte ; aucune image manquante ne devient une zone vide. Les anciens caches photo du navigateur restent intacts mais ne servent plus à choisir les portraits. Aucune donnée biographique n’est déduite des images.

Pour compléter la collection : `node scripts/sync-portraits.cjs --all` télécharge les candidats dans `.local/portraits/`. La collecte conserve ses résultats entre deux exécutions. Elle respecte les réponses de limitation de Wikimedia et enregistre les pauses dans `.local/portraits/rate-limit.json` ; une relance pendant une pause ne contacte pas le serveur. Après vérification du sujet, de l’image et des crédits, `node scripts/sync-portraits.cjs --approve 1,2` copie les fichiers approuvés et met à jour le manifeste. Les fichiers non contrôlés restent hors du site. Les titres rejetés sont conservés dans `rejected_titles` du compte rendu local. Aucun portrait n’est choisi pour Sasha Rose tant que l’identité reste ambiguë.

L’examen doit notamment écarter les photos de groupe dont le sujet n’est pas clairement isolé, les homonymes et les fichiers où le nom recherché désigne le photographe. Il ne suffit pas qu’une recherche retourne le nom pour approuver un fichier. Les portraits de ThePornDB, IAFD ou Boobpedia ne sont pas automatiquement repris comme fichiers sous licence Commons.

`node --test` vérifie le catalogue, les règles de jeu et les sauvegardes historiques, ainsi que le calcul d’âge, les dates partielles, le mapping ThePornDB, les champs manquants, l’échappement HTML, les sources, les divergences et l’absence de mutation du joueur lors de l’ouverture des fiches. Les tests du collecteur simulent l’API : authentification, erreurs, limitations de débit, pagination, homonymes, simulation, import avec copie de secours et exclusion des secrets du dossier public. Les données de test encyclopédiques sont fictives et ne sont pas ajoutées aux 100 personnalités.

Pour vérifier l’interface : lancer `node scripts/serve.cjs`, ouvrir `http://127.0.0.1:8080`, choisir « Ma collection », puis une carte. Seules les rubriques contenant des informations documentées doivent apparaître. Les champs sans documentation, les âges qui ne peuvent pas être calculés et les dates de récupération de portraits inconnues sont masqués ; un crédit photographique seul ne renseigne aucun champ biographique. Les alertes de divergence restent visibles dans « Sources ».

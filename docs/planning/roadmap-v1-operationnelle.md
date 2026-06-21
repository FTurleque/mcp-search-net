# Feuille de route vers une V1 pleinement opérationnelle

> Audit réalisé le 21 juin 2026 à partir du cahier des charges
> `Cahier_des_charges_MCP_Search_Net_V1_V2.docx` et de l'état du dépôt.

## Verdict

Le dépôt contient un **prototype V1 bien structuré**, mais il ne satisfait pas encore le contrat V1 complet du cahier des charges. Les fondations sont présentes : architecture hexagonale, serveur MCP STDIO, deux outils, adaptateurs SearXNG et Crawl4AI, cache SQLite, registre YAML, protection SSRF de base, installation Windows et documentation.

Les principaux écarts bloquants concernent :

- le contrat public des deux outils et l'enveloppe commune de réponse ;
- la sécurité des redirections, les limites de téléchargement et les délais absolus ;
- les statuts de source, les politiques `strict` / `prefer` / `any` et le classement borné ;
- la sélection des sections, BM25 et les budgets de `fetch_url` ;
- le cache dégradé, les validateurs HTTP et `STALE_FALLBACK` ;
- le lancement complet à trois services avec Docker Compose ;
- la couverture de tests, la CI et les preuves d'acceptation en environnement réel.

La V2 (catalogue documentaire, FTS5, synchronisation, versions, embeddings) doit rester hors de cette feuille de route.

## Suivi d'avancement

| Phase                              | Statut                      | Validation                                              |
| ---------------------------------- | --------------------------- | ------------------------------------------------------- |
| Phase 0 — Validation reproductible | ✅ Terminée le 21 juin 2026 | Node 24.17.0, `npm ci`, CI, SearXNG épinglé et sain     |
| Phase 1 — Contrat MCP commun       | ✅ Terminée le 21 juin 2026 | 51 tests déterministes et test réel `search_web` réussi |
| Phase 2 — `search_web`             | ✅ Terminée le 21 juin 2026 | 67 tests déterministes et test SearXNG réel réussi      |
| Phase 3 — `fetch_url`              | ✅ Terminée le 21 juin 2026 | 87 tests déterministes, extraction multi-format et BM25 |
| Phase 4 — Sécurité réseau          | ✅ Terminée le 21 juin 2026 | Passerelle épinglée, redirections/limites testées       |
| Phase 5 — Cache résilient          | ✅ Terminée le 21 juin 2026 | SQLite typé, revalidation et stale fallback             |
| Phase 6 — Observabilité            | ✅ Terminée le 21 juin 2026 | Événements corrélés et redaction récursive              |
| Phase 7 — Déploiement              | ✅ Terminée le 21 juin 2026 | Compose complet/hybride et cycle Windows validés        |
| Phase 8 et suivantes               | ⏳ À réaliser               | Non démarrées                                           |

Le détail des preuves est conservé dans les rapports de validation des [phases 0 et 1](validation-phase-0-1.md), de la [phase 2](validation-phase-2.md), des [phases 3 et 4](validation-phase-3-4.md) et des [phases 5 à 7](validation-phase-5-7.md).

## État vérifié au moment de l'audit

### Ce qui est déjà en place

- TypeScript strict, découpage domaine/application/infrastructure/présentation/bootstrap.
- Exactement deux outils déclarés : `search_web` et `fetch_url`.
- Transport MCP STDIO ; logs écrits sur `stderr`.
- Clients SearXNG JSON et Crawl4AI 0.9.
- Cache SQLite générique avec migrations, TTL et limite du nombre d'entrées.
- Registre YAML de quelques sources officielles.
- Contrôle des protocoles, ports, noms locaux et plages IPv4/IPv6 non publiques.
- Dockerfile, Compose pour SearXNG/Crawl4AI, installateur utilisateur Windows et exemple Copilot.
- Guides d'installation, configuration, utilisation, sécurité, tests et dépannage.

### Validation locale observée

- `typecheck`, ESLint, Prettier et la compilation TypeScript réussissent.
- `npm run check` n'arrive pas au terme de Vitest dans le terminal audité : Node.js 18.16.1 est actif alors que le projet exige Node.js 24. Le runtime utilisateur Node 24 n'est pas installé à l'emplacement attendu.
- `docker compose config --quiet` valide la syntaxe du fichier Compose.
- Crawl4AI est démarré et sain.
- SearXNG est seulement à l'état `created`, n'a jamais démarré et ne possède aucun log. La recherche n'est donc pas opérationnelle dans l'état observé.
- Aucun workflow de CI n'est présent dans `.github/workflows`.
- Le test réel de `fetch_url` est conditionné par `RUN_LIVE_CRAWL4AI=1`. Il n'existe pas de test réel équivalent pour `search_web`.

## Matrice des critères d'acceptation

Légende : ✅ satisfait par le code actuel ; 🟡 partiel ; ❌ non satisfait ; ⚪ non prouvé en environnement réel.

| Critère                                                  | État | Écart principal                                                                                                               |
| -------------------------------------------------------- | :--: | ----------------------------------------------------------------------------------------------------------------------------- |
| AC-01 — démarrage avec Docker Compose                    |  ✅  | Trois services définis ; image MCP, dépendances saines et initialisation STDIO conteneurisée validées.                        |
| AC-02 — détection par Copilot dans IntelliJ              |  ⚪  | Installation et exemple documentés, mais aucune preuve de test réel conservée.                                                |
| AC-03 — seulement deux outils                            |  ✅  | Les deux outils sont déclarés et un test STDIO vérifie leurs noms.                                                            |
| AC-04 — cinq résultats de recherche par défaut           |  ✅  | Défaut configuré à 5 et maximum configuré à 10.                                                                               |
| AC-05 — cinq sections et 12 000 caractères par défaut    |  ✅  | Défauts et maxima absolus validés par schéma et tests.                                                                         |
| AC-06 — conservation des URL sources                     |  ✅  | Les sorties actuelles conservent les URL demandée/finale et les URL de recherche ; à préserver lors de la refonte du contrat. |
| AC-07 — classification des sources officielles           |  ✅  | Quatre statuts, registre de référence et organisations GitHub contrôlées.                                                      |
| AC-08 — suppression des doublons                         |  ✅  | Canonicalisation, retrait du tracking et déduplication déterministe testés.                                                    |
| AC-09 — HTML, Markdown et PDF textuel                    |  ✅  | Corpus multi-format, PDF textuel et erreurs OCR/type testés sans LLM.                                                          |
| AC-10 — cache SQLite et statut exposé                    |  ✅  | `HIT`, `MISS`, `STALE_FALLBACK`, `DISABLED`, validateurs et modes dégradés testés.                                             |
| AC-11 — blocage local, privé et redirections dangereuses |  ✅  | Passerelle épinglée validant chaque saut avant connexion, avec limites et tests SSRF.                                          |
| AC-12 — aucun LLM/API payante requis                     |  ✅  | Aucun LLM ni SDK commercial dans le code ou les dépendances.                                                                  |
| AC-13 — lecture seule et aucun accès au projet           |  ✅  | Seuls la configuration et le cache local sont lus/écrits par le serveur.                                                      |
| AC-14 — tests unitaires, sécurité et E2E au vert         |  ❌  | Suite non exécutée avec le bon Node et couverture très inférieure aux scénarios du cahier des charges.                        |
| AC-15 — installation et exemples IntelliJ documentés     |  🟡  | Pages présentes ; leur contenu devra être réaligné et validé après les changements de contrat/déploiement.                    |

## Ordre de réalisation recommandé

Toutes les cases ci-dessous appartiennent à la V1. Les priorités indiquent l'ordre, pas un caractère optionnel.

### Phase 0 — Rendre la validation reproductible (P0)

**Statut : ✅ TERMINÉE — validée le 21 juin 2026.**

- [x] Activer Node.js 24 LTS avant toute validation et vérifier `node --version`.
- [x] Ajouter un précontrôle explicite du runtime pour que `npm run check` échoue immédiatement avec un message utile si Node 24 n'est pas actif.
- [x] Exécuter `npm ci`, puis conserver un premier rapport complet de `npm run check`.
- [x] Ajouter une CI sous Node 24 exécutant au minimum `npm ci` et `npm run check`.
- [x] Épingler SearXNG sur une version ou un digest validé au lieu de `latest`.
- [x] Démarrer SearXNG, vérifier son healthcheck et effectuer une requête JSON directe.

**Condition de sortie :** un clone propre peut compiler et exécuter la suite déterministe avec une seule version documentée de Node.

### Phase 1 — Aligner le contrat MCP commun (P0)

**Statut : ✅ TERMINÉE — validée le 21 juin 2026.**

Zones principales : `src/domain/models`, `src/presentation/mcp/schemas`, `src/presentation/mcp/mcp-server.ts`.

- [x] Créer l'enveloppe `ToolResponse<T>` avec `schemaVersion: "1.0"`, `requestId`, `status`, `warnings`, `metadata` et `data`.
- [x] Générer un `requestId` unique pour chaque appel et le propager aux logs, avertissements et erreurs.
- [x] Mesurer `durationMs` avec une horloge monotone.
- [x] Exposer `cacheStatus` avec exactement `HIT`, `MISS`, `STALE_FALLBACK` ou `DISABLED`.
- [x] Séparer les avertissements des erreurs et implémenter tous les codes stables des annexes A.1/A.2.
- [x] Mapper les erreurs Zod, DNS, HTTP, timeout, taille, type de contenu, cache et fournisseurs vers les codes V1 ; ne jamais convertir une erreur attendue en `INTERNAL_ERROR`.
- [x] Produire, en plus de `structuredContent`, un repli textuel compact et lisible plutôt qu'une simple sérialisation JSON complète.
- [x] Ajouter des tests de schéma et de contrat MCP pour les succès, succès partiels, avertissements et erreurs.

**Condition de sortie :** les deux outils partagent la même enveloppe versionnée et chaque branche d'erreur possède un code stable testé.

### Phase 2 — Terminer `search_web` (P0)

**Statut : ✅ TERMINÉE — validée le 21 juin 2026.**

#### Entrée et politiques

- [x] Remplacer `officialOnly` par `sourcePolicy: strict | prefer | any`, défaut `prefer`.
- [x] Ajouter `allowedDomains` et `excludedDomains`, limités à 20, avec comparaison DNS par frontière de domaine ; les exclusions restent prioritaires.
- [x] Ajouter `week` à `timeRange`.
- [x] Appliquer `fr-FR` par défaut et le repli anglais avec `FALLBACK_LANGUAGE_USED` lorsque nécessaire.
- [x] Rejeter les caractères de contrôle dans `query` et normaliser tous les champs avant de créer la clé de cache.

#### Normalisation, classification et classement

- [x] Retirer les fragments et les paramètres de suivi connus (`utm_*`, `gclid`, `fbclid`, etc.).
- [x] Canonicaliser hôte, port implicite, slash final et paramètres avant déduplication, sans modifier abusivement les paramètres fonctionnels.
- [x] Remplacer le booléen `official` par `VERIFIED_OFFICIAL`, `LIKELY_OFFICIAL`, `THIRD_PARTY` ou `UNKNOWN`.
- [x] Considérer un domaine passé dans `allowedDomains` comme `VERIFIED_OFFICIAL` pour l'appel courant.
- [x] Étendre le registre aux sources du benchmark : JetBrains, Java/OpenJDK, Maven, Quarkus, JavaFX, Oracle et Sonar, en plus des entrées existantes.
- [x] Ajouter la reconnaissance contrôlée des organisations GitHub officielles.
- [x] Produire un score déterministe borné entre 0 et 1 ; documenter bonus/malus et rappeler qu'il ne s'agit pas d'une probabilité de vérité.
- [x] Appliquer les politiques de source après classement et générer `NO_RESULTS`, `NO_VERIFIED_OFFICIAL_SOURCE`, `NON_OFFICIAL_RESULTS_INCLUDED` et `RESULTS_TRUNCATED` aux bons endroits.

#### Sortie

- [x] Aligner chaque résultat sur le cahier des charges : `domain`, `sourceStatus`, score borné, dates uniquement lorsqu'elles existent et langue détectée lorsqu'elle est disponible.
- [x] Vérifier que `search_web` ne récupère jamais automatiquement les pages trouvées.
- [x] Tester toutes les clés de cache influentes, les trois politiques, les filtres de domaines, la déduplication et le classement stable en cas d'égalité.

**Condition de sortie :** les scénarios du chapitre 7 et AC-04/06/07/08 passent avec fixtures SearXNG enregistrées.

### Phase 3 — Terminer `fetch_url` et la réduction du contexte (P0)

**Statut : ✅ TERMINÉE — validée le 21 juin 2026.**

#### Contrat et formats

- [x] Renommer `maxChars` en `maxCharacters` et ajouter `maxSections` (défaut 5, maximum absolu 10).
- [x] Ajouter `renderMode: static | auto`, défaut `static`, sans accepter de JavaScript, hook, cookie, proxy, fichier ou authentification fourni par l'appelant.
- [x] Retourner `requestedUrl`, `finalUrl`, `canonicalUrl`, `domain`, `contentType`, `sourceStatus`, `fetchedAt`, `extractionMode`, `truncated`, `sectionCount` et un tableau de sections structurées.
- [x] Définir et tester le comportement HTML, Markdown, texte, JSON, XML, YAML, README, PDF textuel, `robots.txt`, `sitemap.xml` et `llms.txt`.
- [x] Retourner explicitement `UNSUPPORTED_CONTENT_TYPE` ou `OCR_REQUIRED_NOT_SUPPORTED` pour les formats hors V1.

#### Extraction et sélection

- [x] En mode `auto`, tenter `static`, puis seulement le rendu natif Crawl4AI si le contenu est inexploitable ; produire `JAVASCRIPT_FALLBACK_USED`.
- [x] Nettoyer ou vérifier la suppression des scripts, styles, menus, publicités, iframes, formulaires, contenu invisible et bannières répétitives.
- [x] Découper selon les titres tout en gardant les blocs de code avec leur section.
- [x] Implémenter une sélection locale BM25, avec bonus titre/sous-titre, bloc de code et version explicitement demandée.
- [x] Appliquer 5 000 caractères maximum par section, puis les limites globales de sections et de caractères.
- [x] Ne plus retourner silencieusement les trois premières sections lorsqu'aucune section n'est pertinente ; utiliser le comportement et l'avertissement `NO_RELEVANT_SECTION` défini par le contrat.
- [x] Produire `CONTENT_TRUNCATED` et `SECTION_TRUNCATED` séparément.
- [x] Conserver la date réelle de récupération dans le cache au lieu de recréer `fetchedAt` à chaque lecture.

**Condition de sortie :** AC-05/06/09 passent sur un corpus multi-format sans aucun appel de LLM.

### Phase 4 — Fermer les risques de sécurité réseau (P0)

**Statut : ✅ TERMINÉE — validée le 21 juin 2026.**

Zone principale : `src/infrastructure/security` et chemin complet jusqu'à Crawl4AI.

- [x] Contrôler chaque redirection **avant** la connexion suivante : protocole, identifiants, port, nom, toutes les réponses DNS et adresse IP.
- [x] Ne pas considérer la validation actuelle de `resolvedUrl` comme suffisante : Crawl4AI ne reçoit plus l'URL publique.
- [x] Choisir et documenter le mécanisme effectif : suivi de redirections dans une passerelle contrôlée avec connexion épinglée.
- [x] Réduire le risque de DNS rebinding entre le processus MCP et Crawl4AI par épinglage de l'adresse approuvée ; Crawl4AI traite uniquement une URL `data:` neutralisée.
- [x] Imposer 5 redirections maximum.
- [x] Imposer une taille de téléchargement de 10 Mo par défaut et interrompre le transfert avant dépassement.
- [x] Imposer un timeout absolu de 20 secondes par défaut.
- [x] Activer explicitement le respect de `robots.txt` pour les opérations concernées.
- [x] Limiter la concurrence et ajouter une temporisation raisonnable pour les sites cibles.
- [x] Vérifier que les liens retournés sont eux aussi normalisés et qu'aucune donnée locale, variable d'environnement ou secret ne peut apparaître dans la réponse.
- [x] Ajouter les tests protocoles interdits, IPv4/IPv6 réservées, DNS mixte public/privé, redirection privée à chaque saut, rebinding simulé, taille, timeout et injection dans le contenu.

**Condition de sortie :** AC-11 passe avec des tests démontrant qu'aucune requête n'atteint la cible bloquée.

### Phase 5 — Compléter le cache et les modes dégradés (P0)

**Statut : ✅ TERMINÉE — validée le 21 juin 2026.**

- [x] Séparer clairement les enregistrements de recherche et de contenu, ou fournir une couche typée équivalente aux tables du chapitre 11.
- [x] Stocker URL finale, titre, type, contenu nettoyé, sections, code HTTP, date de récupération, expiration, `ETag`, `Last-Modified` et hash.
- [x] Utiliser les validateurs HTTP lorsque disponibles et recalculer le hash en leur absence.
- [x] Aligner les TTL par défaut : recherche 60 min, documentation 24 h, README 6 h, sitemap 24 h, erreur temporaire 5 min.
- [x] Ajouter `cache.enabled` et un mode de poursuite sans cache configurable.
- [x] Ne plus supprimer immédiatement toute entrée expirée : permettre sa lecture contrôlée pour `STALE_FALLBACK`.
- [x] En cas de fournisseur indisponible, retourner une entrée expirée autorisée avec `STALE_CACHE_USED` et `status: partial`.
- [x] Masquer les détails SQLite dans les réponses tout en journalisant un événement sûr.
- [x] Ajouter des tests SQLite réels : migrations, HIT/MISS, expiration, corruption de payload, pruning, concurrence, cache indisponible et stale fallback.

**Condition de sortie :** AC-10 passe et chaque réponse expose un statut de cache exact.

### Phase 6 — Journalisation et observabilité (P1)

**Statut : ✅ TERMINÉE — validée le 21 juin 2026.**

- [x] Émettre les événements stables : `server_started`, `tool_call_started`, `tool_call_completed`, `tool_call_failed`, `cache_hit`, `cache_miss`, `search_provider_called`, `content_fetcher_called`, `url_blocked`, `response_truncated`.
- [x] Inclure `requestId`, outil, durée, domaine, statut HTTP, cache, tailles, nombre de résultats/sections et code d'erreur selon l'événement.
- [x] Vérifier récursivement la suppression des secrets, pas seulement les clés de premier niveau.
- [x] Ne jamais journaliser le contenu complet, les en-têtes d'autorisation, les variables d'environnement ou une stack trace sur la sortie MCP.
- [x] Ajouter un test capturant séparément `stdout` et `stderr` afin de prouver que `stdout` reste exclusivement JSON-RPC.

**Condition de sortie :** un appel peut être suivi de bout en bout par `requestId` sans fuite de contenu ou de secret.

### Phase 7 — Achever configuration, Compose et installation (P0)

**Statut : ✅ TERMINÉE — validée le 21 juin 2026.**

- [x] Implémenter la priorité de configuration : valeurs internes sûres, YAML, variables d'environnement, paramètres d'outil bornés.
- [x] S'assurer que les maxima absolus ne peuvent pas être augmentés par YAML ; le maximum de contenu est désormais 30 000 caractères.
- [x] Ajouter au Compose un service `mcp-search-net` construit depuis le Dockerfile.
- [x] En exécution complète, placer SearXNG et Crawl4AI sur un réseau interne non publié ; persister séparément cache MCP et données des composants.
- [x] Ajouter les dépendances de santé et un comportement explicite lorsque SearXNG ou Crawl4AI est indisponible.
- [x] Définir un lanceur STDIO conteneurisé utilisable par Copilot, sans TTY et sans texte parasite sur `stdout`.
- [x] Conserver aussi le mode développement hybride : façade depuis IntelliJ, services liés uniquement à `127.0.0.1`.
- [x] Valider l'installation utilisateur sur un profil propre, puis une seconde installation en prouvant la conservation de la configuration et des données.
- [x] Tester la désinstallation avec et sans `-KeepData`.

**Condition de sortie :** le mode hybride et le mode Compose complet sont tous deux documentés, reproductibles et testés.

### Phase 8 — Construire la stratégie de tests complète (P0)

- [ ] **Unitaires :** objets-valeurs, contrôle des caractères, clés de cache, normalisation d'URL, scoring, BM25, budgets et codes d'erreur.
- [ ] **Contrat :** fixtures SearXNG/Crawl4AI valides, champs absents/supplémentaires, schémas invalides, HTTP non JSON et réponses partielles.
- [ ] **Intégration :** Compose, services réels et SQLite réel dans une suite séparée et activable en CI.
- [ ] **Sécurité :** SSRF, DNS, chaque redirection, tailles, protocoles, contenu injecté et refus de toute configuration exécutable.
- [ ] **E2E STDIO :** lister exactement deux outils, puis appeler réellement `search_web` et `fetch_url`, y compris une erreur stable de chaque outil.
- [ ] **Formats :** HTML, Markdown, README GitHub, JSON, XML/YAML et PDF textuel ; vérifier l'échec OCR explicite.
- [ ] **Résilience :** SearXNG arrêté, Crawl4AI arrêté, SQLite indisponible et cache expiré utilisable.
- [ ] **Performance :** MISS/HIT, page proche de 10 Mo, appels successifs et concurrence limitée.
- [ ] Publier les rapports de test et interdire une livraison si un test requis est ignoré ou conditionnel sans preuve d'exécution.

**Condition de sortie :** `npm run check`, la suite d'intégration et la suite de sécurité passent sous Node 24 sur un clone propre.

### Phase 9 — Documentation, ADR, benchmark et recette (P1)

- [ ] Mettre à jour `docs/reference/tools.md` avec les contrats exacts, avertissements, erreurs et exemples de réponses compactes.
- [ ] Mettre à jour configuration, sécurité, tests, dépannage et installation après validation réelle.
- [ ] Ajouter `docs/adr/ADR-001` à `ADR-010` conformément à l'annexe B.
- [ ] Ajouter une matrice de traçabilité exigences → code → tests → critères d'acceptation.
- [ ] Exécuter le benchmark de l'annexe D sur GitHub Copilot/MCP, JetBrains, Java, Maven, Quarkus, JavaFX, Oracle, Sonar et Docker.
- [ ] Mesurer taux officiel, pertinence, fraîcheur, qualité d'extraction, taille de contexte, latence MISS/HIT et résilience.
- [ ] Effectuer la recette manuelle dans IntelliJ : détection des deux outils, recherche officielle, extraction ciblée, cache HIT et affichage d'un avertissement.
- [ ] Archiver les versions des images, de Node, du SDK MCP et des dépendances utilisées pour la recette.

**Condition de sortie :** les quinze critères AC-01 à AC-15 sont verts et accompagnés d'une preuve reproductible.

## Checklist finale de livraison

- [x] Node 24 actif ; `npm ci` et `npm run check` réussissent.
- [ ] CI verte sur le commit candidat.
- [ ] Les trois services Compose sont présents ; leurs healthchecks sont verts.
- [x] `search_web` et `fetch_url` passent les tests E2E réels.
- [x] Tous les scénarios SSRF prouvent l'absence de connexion vers la cible interdite.
- [x] Les limites absolues restent effectives malgré une configuration ou une entrée hostile.
- [x] Chaque réponse contient `schemaVersion`, `requestId`, avertissements séparés, métadonnées et statut de cache.
- [x] Aucune sortie libre n'est écrite sur `stdout`.
- [x] L'installation Windows et la mise à jour conservatrice sont validées sur un profil propre.
- [ ] Copilot dans IntelliJ détecte uniquement les deux outils et peut les appeler.
- [ ] La documentation, les ADR, la traçabilité et le rapport de benchmark correspondent au binaire livré.
- [x] Aucun composant V2 n'a été introduit dans la base V1.

## Définition de « V1 pleinement opérationnelle »

La V1 est terminée lorsque le dépôt ne se contente plus de compiler : un utilisateur Windows peut l'installer, démarrer les dépendances, la déclarer dans Copilot/IntelliJ et utiliser les deux outils avec des contrats stables, des limites strictes, une protection SSRF effective à chaque connexion, un cache résilient, des logs traçables et une suite automatisée démontrant AC-01 à AC-15.

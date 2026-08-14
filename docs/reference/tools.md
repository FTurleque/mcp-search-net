# Contrats des outils MCP

## Enveloppe commune

Tout succès, complet ou partiel, utilise la même enveloppe :

```ts
interface ToolResponse<T> {
  schemaVersion: '1.0';
  requestId: string;
  status: 'success' | 'partial';
  warnings: Array<{
    code: ToolWarningCode;
    message: string;
    requestId: string;
  }>;
  metadata: {
    tool:
      | 'search_web'
      | 'fetch_url'
      | 'search_docs'
      | 'list_docs'
      | 'read_doc_section'
      | 'list_search_history';
    durationMs: number;
    cacheStatus: 'HIT' | 'MISS' | 'STALE_FALLBACK' | 'DISABLED';
    provider: string;
    contentTrust: 'EXTERNAL_UNTRUSTED_CONTENT';
    contentSafetyNotice: string;
  };
  data: T;
}
```

`durationMs` est mesuré avec une horloge monotone. Le même `requestId` relie la réponse, les avertissements et les événements structurés écrits sur `stderr`.

`cacheStatus` vaut `HIT` pour une entrée fraîche ou revalidée en HTTP 304, `MISS` après appel
fournisseur, `STALE_FALLBACK` lorsqu'une entrée expirée remplace une panne transitoire (timeout,
réseau, HTTP 408/425/429 ou 5xx), et `DISABLED` lorsque le cache est désactivé ou que le mode
dégradé poursuit après une panne SQLite. Un HTTP permanent comme 400, 401, 403, 404 ou 410 ne
déclenche pas de stale fallback. Pour `search_docs`, le provider est `catalog` et le cache
applicatif V1 est désactivé. Pour `list_search_history`, le provider est `history` et
`cacheStatus` vaut toujours `DISABLED`.

Le champ textuel MCP est volontairement compact. Il ne doit pas recopier tout `structuredContent` afin de limiter la consommation de contexte dans Copilot.

Les titres, extraits, métadonnées et textes provenant du Web ou du catalogue sont
des données hostiles potentielles. `contentTrust` et `contentSafetyNotice` sont
présents sur toute réponse réussie ; les resources JSON portent les mêmes champs
au premier niveau. Une instruction trouvée dans une page ne modifie jamais le
contrôle du serveur ou de l'agent.

## `search_web`

Entrées :

| Champ             | Défaut   | Contraintes                                             |
| ----------------- | -------- | ------------------------------------------------------- |
| `query`           | —        | 2 à 500 caractères, sans caractère de contrôle          |
| `sourcePolicy`    | `prefer` | `strict`, `prefer` ou `any`                             |
| `allowedDomains`  | `[]`     | 20 domaines maximum ; agit comme liste blanche          |
| `excludedDomains` | `[]`     | 20 domaines maximum ; prioritaire sur les autorisations |
| `language`        | `fr-FR`  | langue BCP-47 ; repli anglais si aucun résultat         |
| `timeRange`       | absente  | `day`, `month` ou `year`, selon l’API SearXNG           |
| `maxResults`      | `5`      | de 1 à 10                                               |

Les domaines sont comparés par frontière DNS : `docs.example.com` correspond à `example.com`,
contrairement à `example.com.attacker.test`. `allowedDomains` filtre les résultats mais ne rend
jamais un domaine officiel ; seul le registre `official-sources.yml`, pour une URL résultat HTTPS,
peut produire `VERIFIED_OFFICIAL`.

Politiques :

- `strict` conserve uniquement les sources `VERIFIED_OFFICIAL` ; une liste vide reste un succès accompagné de `NO_VERIFIED_OFFICIAL_SOURCE` ;
- `prefer` classe les sources officielles en premier et signale l'inclusion de sources non vérifiées ;
- `any` ne filtre aucun statut, tout en conservant les filtres de domaines et le classement local.

Chaque résultat contient `title`, `url`, `domain`, `snippet`, `sourceStatus`, `score`, les moteurs et, uniquement lorsqu'elles existent, les dates et la langue détectée. Les statuts possibles sont `VERIFIED_OFFICIAL`, `LIKELY_OFFICIAL`, `THIRD_PARTY` et `UNKNOWN`. La métadonnée de données expose aussi `sourceProvider: searxng` et le vrai instant `retrievedAt`; une réponse de cache conserve l'instant de récupération initial.

Les URL sont normalisées avant déduplication : fragment et paramètres de suivi connus supprimés, port implicite et slash final harmonisés, paramètres fonctionnels conservés et triés. `search_web` ne télécharge jamais les pages trouvées.

### Classement déterministe

Le score est borné entre 0 et 1. Il combine :

- un signal borné issu du score SearXNG ;
- un bonus fort pour une source vérifiée, plus faible pour une source probablement officielle ;
- un malus pour les plateformes tierces reconnues ;
- la correspondance des termes dans le titre et l'URL ;
- un bonus d'URL documentaire et un petit bonus de priorité du registre.

Les égalités sont départagées par titre puis URL, sans dépendre de l'ordre du fournisseur. Ce score sert uniquement au classement local : **il ne constitue pas une probabilité de vérité**.

Le nombre demandé ne peut pas dépasser la limite applicative. La langue et la période dépendent aussi des moteurs SearXNG actifs ; elles constituent des filtres, pas une garantie absolue.

## `fetch_url`

Entrées :

| Champ           | Défaut   | Contraintes                                                 |
| --------------- | -------- | ----------------------------------------------------------- |
| `url`           | —        | URL HTTP(S) publique connue                                 |
| `query`         | absente  | 2 à 500 caractères, utilisés par le sélecteur lexical local |
| `maxCharacters` | `12000`  | de 1 000 à 30 000                                           |
| `maxSections`   | `5`      | de 1 à 10                                                   |
| `renderMode`    | `static` | `static` ou `auto`                                          |

La sortie contient `requestedUrl`, `finalUrl`, `canonicalUrl`, `domain`, `contentType`, `sourceStatus`, `fetchedAt`, `extractionMode`, `truncated`, `sectionCount`, `sections`, le Markdown assemblé et les liens publics validés. L'enveloppe identifie le provider effectif. Chaque section expose son titre, son Markdown, son score local et son état de troncature.

Le sélecteur local utilise une pertinence lexicale déterministe bornée entre 0 et 1, renforce les correspondances dans les titres, les blocs de code et les versions demandées, limite chaque section à 5 000 caractères, puis applique les budgets globaux. Une requête sans correspondance renvoie une liste vide et `NO_RELEVANT_SECTION`, jamais les premières sections arbitraires.

Les formats V1 sont HTML, Markdown/README, texte, JSON, XML, YAML, `robots.txt`, `sitemap.xml`, `llms.txt` et PDF textuel. Un PDF sans couche texte produit `OCR_REQUIRED_NOT_SUPPORTED`; un autre format non textuel produit `UNSUPPORTED_CONTENT_TYPE`.

En mode `auto`, le rendu natif n'est tenté qu'après une extraction statique insuffisante. Crawl4AI reçoit alors un document `raw://` contenant le HTML déjà téléchargé et neutralisé, jamais l'URL publique. Ce transport natif ne déclenche aucune requête réseau. L'avertissement `JAVASCRIPT_FALLBACK_USED` rend ce chemin visible.

## `search_docs`

Recherche dans le catalogue documentaire local V2. L'outil est read-only, idempotent et n'appelle ni Web, ni Crawl4AI, ni API payante.

Entrées :

| Champ             | Défaut               | Contraintes                                                  |
| ----------------- | -------------------- | ------------------------------------------------------------ |
| `query`           | —                    | 1 à 500 caractères, sans caractère de contrôle               |
| `sourceKey`       | absente              | clé de source catalogue optionnelle                          |
| `language`        | absente              | filtre langue BCP-47 simplifié, exemple `fr`                 |
| `maxResults`      | limite par défaut V2 | de 1 à la limite applicative, 10 au maximum                  |
| `maxSnippetChars` | `500`                | budget borné appliqué à chaque extrait                       |
| `compact`         | `false`              | réduit encore les extraits pour un usage agent à faible coût |

Sortie `data` :

| Champ         | Description                                |
| ------------- | ------------------------------------------ |
| `query`       | requête normalisée                         |
| `resultCount` | nombre de résultats retournés              |
| `results`     | sections documentaires classées localement |

Chaque résultat contient `sourceKey`, `sourceName`, `documentPublicId`, `title`, `url`, `language`, `heading`, `headingPath`, `anchor`, `snippet` et `score`.

Le texte MCP de fallback reste compact : nombre de résultats, requestId, cache, puis pour chaque résultat le titre, la section, l'URL et le snippet. Le contenu complet des sections n'est pas renvoyé par `search_docs`.

Bonnes pratiques Copilot :

- utiliser `maxResults: 3` pour une question ciblée ;
- utiliser `maxResults: 5` pour une recherche exploratoire ;
- éviter `maxResults: 10` sauf diagnostic ;
- filtrer par `sourceKey` si possible ;
- utiliser les resources MCP uniquement après avoir identifié un document ou une section pertinente.

Exemple compact :

```text
search_docs success: 3 result(s)
requestId=… cache=DISABLED
1. Roadmap V2 — V2.4 — Exposition MCP V2
   https://local.mcp-search-net/docs/planning/roadmap-v2-documentaire
   Outil MCP search_docs, resources read-only catalogue/sources/documents/sections…
```

## `list_docs`

Liste les documents sans contenu de section. La sélection, les filtres et la pagination sont
exécutés en SQL avec un ordre stable par identifiant.

| Champ       | Défaut | Contraintes                                                 |
| ----------- | ------ | ----------------------------------------------------------- |
| `sourceKey` | absent | clé source optionnelle                                      |
| `language`  | absent | langue optionnelle                                          |
| `status`    | absent | `ACTIVE`, `STALE`, `REDIRECTED`, `REMOVED` ou `UNAVAILABLE` |
| `limit`     | `20`   | de 1 à 50                                                   |
| `offset`    | `0`    | entier positif ou nul                                       |

La sortie expose `count`, `total`, `offset`, `limit`, `nextOffset`, `truncated` et une liste de
documents compacts. Le champ `data` sérialisé est limité à 20 000 caractères, indépendamment de
`limit`. Si ce budget coupe une page, `nextOffset` reprend exactement au premier document non
retourné ; aucun identifiant, titre ou URL n'est tronqué silencieusement.

## `read_doc_section`

Lit directement une section courante par `sectionId`, sans charger toutes les sections du
catalogue. `maxCharacters` vaut 3 000 par défaut et accepte de 200 à 8 000 caractères. La sortie
signale explicitement `found` et `truncated`.

## `list_search_history`

Liste l’historique local persistant des appels validés à `search_web` et `search_docs`. L’outil est
read-only, idempotent, closed-world et n’effectue aucun appel Web. Il consulte uniquement
`history.sqlite` via le port applicatif dédié.

Entrées :

| Champ           | Défaut | Contraintes                                                 |
| --------------- | ------ | ----------------------------------------------------------- |
| `tool`          | absent | `search_web` ou `search_docs`                               |
| `status`        | absent | `success`, `partial` ou `failed`                            |
| `cacheStatus`   | absent | `HIT`, `MISS`, `STALE_FALLBACK` ou `DISABLED`               |
| `from`          | absent | date/heure ISO interprétable                                |
| `to`            | absent | date/heure ISO interprétable, postérieure ou égale à `from` |
| `queryContains` | absent | sous-chaîne insensible à la casse, 1 à 200 caractères       |
| `limit`         | `20`   | de 1 à 50                                                   |
| `beforeId`      | absent | curseur keyset positif retourné par la page précédente      |

Sortie `data` :

| Champ          | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| `enabled`      | indique si l’historisation est activée                          |
| `available`    | indique si le stockage d’historique est actuellement lisible    |
| `count`        | nombre d’entrées retournées sur la page                         |
| `total`        | nombre total d’entrées correspondant aux filtres, hors curseur  |
| `nextBeforeId` | curseur de la page suivante ou `null`                           |
| `searches`     | occurrences de recherche, de la plus récente à la plus ancienne |

Chaque occurrence contient `id`, `requestId`, `tool`, `query`, les paramètres de recherche non
secrets dans `request`, `executedAt`, `durationMs`, `status`, `cacheStatus`, `provider`,
`resultCount`, `warningCodes` et `errorCode`.

Deux appels strictement identiques restent deux occurrences distinctes. L’historique est séparé du
cache : expiration ou éviction de `search_cache` ne supprime pas l’occurrence enregistrée. Une
panne d’écriture d’historique n’échoue jamais la recherche principale. Si l’historique est désactivé
ou indisponible, l’outil retourne une réponse bornée explicite avec respectivement
`HISTORY_DISABLED` ou `HISTORY_UNAVAILABLE`.

Exemple :

```text
list_search_history success: 2/42 entrie(s)
enabled=true available=true nextBeforeId=103
1. [search_web] SonarCloud GitHub Actions
   2026-08-14T18:22:17.000Z · success · MISS · 5 result(s)
2. [search_docs] architecture cache sqlite
   2026-08-14T18:20:02.000Z · success · DISABLED · 3 result(s)
```

## Resources MCP V2 et budget contexte

Les resources V2 sont read-only. Les collections de sources, documents, versions et sections
retournent 20 éléments au maximum et fournissent `nextOffset` et `nextUri`. Les templates paginés
sont :

```text
mcp-search-net://sources/page/{offset}
mcp-search-net://documents/page/{offset}
mcp-search-net://documents/{documentId}/versions/page/{offset}
mcp-search-net://sections/page/{offset}
```

Les resources ciblées par identifiant utilisent des requêtes SQL dédiées. Une réponse resource est
limitée à 24 000 caractères, une section détaillée à 8 000 caractères et les métadonnées de version
à 2 000 caractères ; `contentTruncated` ou `metadataTruncated` rendent toute réduction explicite.

Pour Copilot, la stratégie recommandée est :

```text
search_docs -> choisir le résultat utile -> lire uniquement la resource ciblée si le client MCP le permet
```

Éviter :

```text
Lis toutes les sections du catalogue.
```

Préférer :

```text
Utilise search_docs avec maxResults 3 pour trouver les sections sur la synchronisation V2.
```

Le benchmark V2.11 à 10 000 sections mesure la page de sections à 15 636 caractères au p95
(~3 909 tokens), contre 4 733 639 caractères (~1 183 410 tokens) pour la simulation historique non
bornée.

## Annotations et erreurs

Les outils sont déclarés en lecture seule et non destructifs. Les erreurs de validation, sécurité, dépendance indisponible et délai sont converties en erreurs MCP lisibles, tandis que les détails techniques sont journalisés sur `stderr`.

Une erreur MCP expose son code et son `requestId` dans le contenu textuel. Sa structure complète est placée dans la métadonnée MCP namespacée `mcp-search-net/error` ; elle n'est pas placée dans `structuredContent`, réservé au schéma de succès annoncé par l'outil.

### Avertissements stables

| Code                              | Signification                                           |
| --------------------------------- | ------------------------------------------------------- |
| `NO_RESULTS`                      | aucun résultat après filtrage                           |
| `NO_VERIFIED_OFFICIAL_SOURCE`     | aucune source officielle vérifiée en mode strict        |
| `NON_OFFICIAL_RESULTS_INCLUDED`   | le résultat inclut une source non vérifiée              |
| `RESULTS_TRUNCATED`               | la limite de résultats est atteinte                     |
| `CONTENT_TRUNCATED`               | le budget global de caractères est atteint              |
| `SECTION_TRUNCATED`               | au moins une section dépasse 5 000 caractères           |
| `FALLBACK_LANGUAGE_USED`          | la recherche a été rejouée en anglais                   |
| `STALE_CACHE_USED`                | une donnée expirée remplace un fournisseur indisponible |
| `REDIRECTED_URL`                  | l’URL finale diffère de l’URL demandée                  |
| `JAVASCRIPT_FALLBACK_USED`        | le rendu Crawl4AI a complété l’extraction statique      |
| `NO_RELEVANT_SECTION`             | aucune section n’est pertinente pour la requête         |
| `DATE_UNAVAILABLE`                | les moteurs actifs n’ont fourni aucune date             |
| `UNVERIFIED_SOURCE`               | la page n’est pas reconnue comme officielle             |
| `SEARCH_PROVIDER_PARTIAL_FAILURE` | au moins un moteur SearXNG était indisponible           |
| `HISTORY_DISABLED`                | l’historique persistant est désactivé                   |
| `HISTORY_UNAVAILABLE`             | l’historique persistant est temporairement indisponible |

### Erreurs stables

| Famille      | Codes                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Entrée       | `INVALID_ARGUMENT`, `INVALID_URL`, `UNSUPPORTED_PROTOCOL`                                                               |
| Réseau sûr   | `BLOCKED_ADDRESS`, `DNS_RESOLUTION_FAILED`, `TOO_MANY_REDIRECTS`, `REQUEST_TIMEOUT`, `RESPONSE_TOO_LARGE`, `HTTP_ERROR` |
| Fournisseurs | `SEARCH_PROVIDER_UNAVAILABLE`, `CONTENT_PROVIDER_UNAVAILABLE`                                                           |
| Contenu      | `UNSUPPORTED_CONTENT_TYPE`, `EXTRACTION_FAILED`, `NO_RELEVANT_CONTENT`, `OCR_REQUIRED_NOT_SUPPORTED`                    |
| Exploitation | `CACHE_UNAVAILABLE`, `INTERNAL_ERROR`                                                                                   |

Les détails inattendus ne sont jamais renvoyés au client.

### Exemples de repli textuel compact

`search_web` :

```text
1. Maven – Introduction to the Build Lifecycle
   https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html
   VERIFIED_OFFICIAL · score 0.94
```

`fetch_url` :

```text
Source: https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html

## Build Lifecycle Basics
Maven repose sur trois cycles de vie intégrés…
```

Erreur :

```text
UNSUPPORTED_PROTOCOL [requestId: …] Only HTTP and HTTPS URLs are supported.
```

La métadonnée MCP `mcp-search-net/error` suit ce contrat minimal :

```json
{
  "schemaVersion": "1.0",
  "requestId": "…",
  "code": "UNSUPPORTED_PROTOCOL",
  "message": "Only HTTP and HTTPS URLs are supported.",
  "retryable": false
}
```

Le serveur n’expose aucune option Crawl4AI permettant scripts arbitraires, hooks navigateur, fichiers locaux, proxy fourni par l’appelant, cookies, authentification ou configuration LLM.

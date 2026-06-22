# Contrats des outils MCP

## Enveloppe commune V1

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
    tool: 'search_web' | 'fetch_url';
    durationMs: number;
    cacheStatus: 'HIT' | 'MISS' | 'STALE_FALLBACK' | 'DISABLED';
    provider: string;
  };
  data: T;
}
```

`durationMs` est mesuré avec une horloge monotone. Le même `requestId` relie la réponse, les avertissements et les événements structurés écrits sur `stderr`.

`cacheStatus` vaut `HIT` pour une entrée fraîche ou revalidée en HTTP 304, `MISS` après appel fournisseur, `STALE_FALLBACK` lorsqu'une entrée expirée remplace un fournisseur indisponible, et `DISABLED` lorsque le cache est désactivé ou que le mode dégradé poursuit après une panne SQLite. Le stale fallback ajoute `STALE_CACHE_USED` et force `status: partial`.

Le champ textuel MCP est un résumé compact : liste numérotée avec URL pour `search_web`, ou source suivie du Markdown sélectionné pour `fetch_url`. Il ne s'agit plus d'une copie JSON de `structuredContent`.

## `search_web`

Entrées :

| Champ             | Défaut   | Contraintes                                             |
| ----------------- | -------- | ------------------------------------------------------- |
| `query`           | —        | 2 à 500 caractères, sans caractère de contrôle          |
| `sourcePolicy`    | `prefer` | `strict`, `prefer` ou `any`                             |
| `allowedDomains`  | `[]`     | 20 domaines maximum ; agit comme liste blanche          |
| `excludedDomains` | `[]`     | 20 domaines maximum ; prioritaire sur les autorisations |
| `language`        | `fr-FR`  | langue BCP-47 ; repli anglais si aucun résultat         |
| `timeRange`       | absente  | `day`, `week`, `month` ou `year`                        |
| `maxResults`      | `5`      | de 1 à 10                                               |

Les domaines sont comparés par frontière DNS : `docs.example.com` correspond à `example.com`, contrairement à `example.com.attacker.test`. Un domaine autorisé est considéré comme `VERIFIED_OFFICIAL` pour l'appel courant.

Politiques :

- `strict` conserve uniquement les sources `VERIFIED_OFFICIAL` ; une liste vide reste un succès accompagné de `NO_VERIFIED_OFFICIAL_SOURCE` ;
- `prefer` classe les sources officielles en premier et signale l'inclusion de sources non vérifiées ;
- `any` ne filtre aucun statut, tout en conservant les filtres de domaines et le classement local.

Chaque résultat contient `title`, `url`, `domain`, `snippet`, `sourceStatus`, `score`, les moteurs et, uniquement lorsqu'elles existent, les dates et la langue détectée. Les statuts possibles sont `VERIFIED_OFFICIAL`, `LIKELY_OFFICIAL`, `THIRD_PARTY` et `UNKNOWN`.

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

| Champ           | Défaut   | Contraintes                                    |
| --------------- | -------- | ---------------------------------------------- |
| `url`           | —        | URL HTTP(S) publique connue                    |
| `query`         | absente  | 2 à 500 caractères, utilisés par le BM25 local |
| `maxCharacters` | `12000`  | de 1 000 à 30 000                              |
| `maxSections`   | `5`      | de 1 à 10                                      |
| `renderMode`    | `static` | `static` ou `auto`                             |

La sortie contient `requestedUrl`, `finalUrl`, `canonicalUrl`, `domain`, `contentType`, `sourceStatus`, `fetchedAt`, `extractionMode`, `truncated`, `sectionCount`, `sections`, le Markdown assemblé et les liens publics validés. Chaque section expose son titre, son Markdown, son score local et son état de troncature.

Le sélecteur local utilise BM25, renforce les correspondances dans les titres, les blocs de code et les versions demandées, limite chaque section à 5 000 caractères, puis applique les budgets globaux. Une requête sans correspondance renvoie une liste vide et `NO_RELEVANT_SECTION`, jamais les premières sections arbitraires.

Les formats V1 sont HTML, Markdown/README, texte, JSON, XML, YAML, `robots.txt`, `sitemap.xml`, `llms.txt` et PDF textuel. Un PDF sans couche texte produit `OCR_REQUIRED_NOT_SUPPORTED`; un autre format non textuel produit `UNSUPPORTED_CONTENT_TYPE`.

En mode `auto`, le rendu natif n'est tenté qu'après une extraction statique insuffisante. Crawl4AI reçoit alors un document `raw://` contenant le HTML déjà téléchargé et neutralisé, jamais l'URL publique. Ce transport natif ne déclenche aucune requête réseau. L'avertissement `JAVASCRIPT_FALLBACK_USED` rend ce chemin visible.

## Annotations et erreurs

Les outils sont déclarés en lecture seule et non destructifs. Les erreurs de validation, sécurité, dépendance indisponible et délai sont converties en erreurs MCP lisibles, tandis que les détails techniques sont journalisés sur `stderr`.

Une erreur MCP expose son code et son `requestId` dans le contenu textuel. Sa structure complète est placée dans la métadonnée MCP namespacée `mcp-search-net/error` ; elle n'est pas placée dans `structuredContent`, réservé au schéma de succès annoncé par l'outil.

### Avertissements stables

| Code                            | Signification                                           |
| ------------------------------- | ------------------------------------------------------- |
| `NO_RESULTS`                    | aucun résultat après filtrage                           |
| `NO_VERIFIED_OFFICIAL_SOURCE`   | aucune source officielle vérifiée en mode strict        |
| `NON_OFFICIAL_RESULTS_INCLUDED` | le résultat inclut une source non vérifiée              |
| `RESULTS_TRUNCATED`             | la limite de résultats est atteinte                     |
| `CONTENT_TRUNCATED`             | le budget global de caractères est atteint              |
| `SECTION_TRUNCATED`             | au moins une section dépasse 5 000 caractères           |
| `FALLBACK_LANGUAGE_USED`        | la recherche a été rejouée en anglais                   |
| `STALE_CACHE_USED`              | une donnée expirée remplace un fournisseur indisponible |
| `REDIRECTED_URL`                | l’URL finale diffère de l’URL demandée                  |
| `JAVASCRIPT_FALLBACK_USED`      | le rendu Crawl4AI a complété l’extraction statique      |
| `NO_RELEVANT_SECTION`           | aucune section n’est pertinente pour la requête         |
| `UNVERIFIED_SOURCE`             | la page n’est pas reconnue comme officielle             |

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

Le serveur n’expose aucune option Crawl4AI permettant scripts arbitraires, hooks navigateur, fichiers locaux, proxy fourni par l’appelant, cookies, authentification ou configuration LLM.

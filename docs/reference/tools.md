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

Entrées conceptuelles : URL publique obligatoire, termes de pertinence optionnels et budget de caractères borné. Sortie structurée : URL finale, titre, Markdown sélectionné, liens conservés et métadonnées d’extraction/cache.

Une URL peut être refusée avant tout accès réseau. Une page dynamique peut nécessiter plus de temps qu’une page HTML statique. Les PDF textuels sont possibles selon les capacités de Crawl4AI ; l’OCR est hors périmètre.

## Annotations et erreurs

Les outils sont déclarés en lecture seule et non destructifs. Les erreurs de validation, sécurité, dépendance indisponible et délai sont converties en erreurs MCP lisibles, tandis que les détails techniques sont journalisés sur `stderr`.

Une erreur MCP expose son code et son `requestId` dans le contenu textuel. Sa structure complète est placée dans la métadonnée MCP namespacée `mcp-search-net/error` ; elle n'est pas placée dans `structuredContent`, réservé au schéma de succès annoncé par l'outil.

Les codes V1 stables couvrent les arguments et URL invalides, les protocoles/adresses bloqués, le DNS, les redirections, délais et tailles, HTTP, l'indisponibilité des deux fournisseurs, les types de contenu, l'extraction/OCR, le cache et l'erreur interne. Les détails inattendus ne sont jamais renvoyés au client.

Le serveur n’expose aucune option Crawl4AI permettant scripts arbitraires, hooks navigateur, fichiers locaux, proxy fourni par l’appelant, cookies, authentification ou configuration LLM.

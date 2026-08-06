# ADR-018 — Évaluer les embeddings locaux sans les intégrer avant preuve

- **Statut** : Proposé — protocole implémenté, décision d'adoption suspendue à une mesure exact-head
- **Date** : 2026-08-06
- **Décisions liées** : ADR-015, ADR-016, ADR-017
- **Issue** : #32

## Contexte

ADR-017 conserve FTS5/BM25 comme baseline produit : la recherche exacte, les identifiants, les
configurations et les API sont bonnes et très rapides, tandis que les paraphrases et questions
multi-document restent les principales faiblesses. Le reranker lexical hashé historique n'a fourni
aucun gain mesuré.

L'étude autorisée par ADR-017 doit donc répondre à une question précise : un modèle **local**, sans
API commerciale et redistribuable, améliore-t-il assez le rappel sémantique pour justifier le coût
d'un index vectoriel local ?

## Décision de méthode

Le benchmark #32 reste séparé du runtime produit. Il :

- conserve le corpus synthétique reproductible de 10 sources / 100 documents / environ 10 000
  sections ;
- renforce le jeu de 50 à 60 requêtes, avec dix nouveaux cas concentrés sur `paraphrase` et
  `multi-document` ;
- exécute d'abord le benchmark Node/SQLite actuel afin de conserver une baseline produit exacte ;
- compare ensuite une baseline lexicale, des embeddings statiques locaux et une fusion Reciprocal
  Rank Fusion ;
- mesure MRR@10, nDCG@10, Recall@10, Precision@5 et zero-result rate globalement et par catégorie ;
- mesure p50/p95/p99/max, mémoire RSS, taille du snapshot modèle, taille de l'index en mémoire, temps
  de construction et coût d'un lot incrémental ;
- enregistre le modèle, sa révision, sa licence et la dimension des vecteurs.

Le candidat de recherche initial est `minishlab/potion-multilingual-128M`, évalué uniquement par le
workflow de benchmark. Ni Python, ni `model2vec`, ni le modèle, ni un moteur vectoriel ne deviennent
une dépendance de `mcp-search-net` par cette ADR.

## Gates

Un résultat peut uniquement autoriser un **prototype produit séparé** si :

```text
gain absolu Recall@10 ou nDCG@10 >= 0,02
ET
(gain Recall paraphrase >= 0,10 OU gain Recall multi-document >= 0,10)
ET
p95 fusion <= 150 ms à environ 10 000 sections
```

Même si ces gates passent, l'intégration runtime reste `NON` tant qu'un prototype ne prouve pas en
plus :

- persistance et reconstruction de l'index ;
- comportement de sync incrémentale ;
- packaging Windows et Docker ;
- licence et redistribution du modèle ;
- fonctionnement hors ligne après installation ;
- absence de régression majeure sur exact-api, identifiants et configuration ;
- budget mémoire acceptable sur une machine développeur.

Si les gates de qualité ne passent pas, FTS5/BM25 reste la stratégie produit et #32 est clôturée sans
ajout vectoriel.

## État de qualification

Le protocole et le workflow exact-head sont présents sur la branche de remédiation. Au 6 août 2026,
les jobs GitHub Actions de cette branche terminent avant toute première étape et ne fournissent ni
steps ni logs. Le benchmark n'a donc **pas encore produit de résultat mesuré**. Cet état n'autorise
aucune conclusion de qualité et cet ADR reste `Proposé`.

## Conséquences

- La recherche produit reste FTS5/BM25 tant qu'une preuve contraire n'existe pas.
- Le benchmark peut évoluer sans alourdir le serveur ou son installation.
- Une performance prometteuse du modèle ne suffit pas à elle seule à modifier l'architecture.
- La décision finale sera ajoutée à cet ADR seulement à partir d'un rapport versionné relié au SHA
  exact exécuté.

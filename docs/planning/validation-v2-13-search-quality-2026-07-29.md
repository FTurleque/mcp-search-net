# Validation V2.13 — Search quality, benchmark et décision d’architecture

- **Date** : 2026-07-29
- **Issue** : #16
- **PR** : #24
- **Branche qualifiée** : `fix/v2-13-search-quality`
- **SHA fonctionnel qualifié exact** : `aeb49b1f6a7f035779e726a9db641710f172819f`
- **Merge dans `feat/v2-catalog-storage`** : `c9ba09345cebb1a9f9dfa63f98e0352c33dcefd2`
- **Environnement de référence** : Windows x64, Node.js 24.17.0

## Verdict

V2.13 est **PASS** sur le SHA exact `aeb49b1f6a7f035779e726a9db641710f172819f`.

Le merge de #24 a été réalisé sous garde `expected_head_sha` et la comparaison GitHub entre le SHA qualifié et le commit de merge retourne `files: []`. Le commit de merge n’introduit donc aucun changement de contenu par rapport au tree localement qualifié.

Aucun GitHub Actions n’a été déclenché ni utilisé comme gate pendant la restriction de quota de juillet 2026.

## Benchmark exact-head

Commande :

```powershell
npm run benchmark:v2:search-quality -- --output .data/benchmark-v2-search-quality-final.json
```

Protocole :

```text
10 sources
100 documents
10 000 sections
50 requêtes annotées
2 warm-ups
6 répétitions
ordre lexical/reranker alterné
anglais + français
```

### FTS5/BM25

```text
MRR@10        0,74
nDCG@10       0,74
Recall@10     0,74
Precision@5   0,148
zero-result   0,26
p50           0,792 ms
p95           17,246 ms
p99           21,211 ms
max           24,792 ms
```

Seuils : MRR@10 atteint ; nDCG@10 et Recall@10 manqués ; p95 largement dans le budget de 150 ms.

### Reranker lexical hashé

```text
MRR@10        0,74
nDCG@10       0,74
Recall@10     0,74
Precision@5   0,148
zero-result   0,26
p50           3,623 ms
p95           17,939 ms
p99           21,234 ms
max           24,094 ms
gain qualité  0
ratio p95     1,0402
```

Le reranker ne modifie aucune métrique qualité et n’atteint pas le gain minimal de 0,02.

### Échecs dominants

- `paraphrase` : zero-result rate = 1,00 ;
- `multi-document` : zero-result rate = 1,00 ;
- quelques échecs `concept` et `errors`.

Le problème observé est un problème de rappel lexical, pas de latence.

### Performance catalogue

```text
rebuild FTS complet     95,94 ms
sync incrémentale        1,59 ms
RSS                    95 924 224 octets
catalog.db              9 986 048 octets
FTS                     2 506 752 octets
sections indexées       10 000
```

## Décision d’architecture

Décision du runner : `evaluate-local-embeddings`.

Interprétation retenue par ADR-017 :

1. conserver FTS5/BM25 comme baseline opérationnelle actuelle ;
2. ne pas généraliser le reranker lexical hashé, son gain mesuré étant nul ;
3. autoriser une étude séparée d’embeddings locaux pour les paraphrases et le rappel multi-document ;
4. ne pas intégrer d’embeddings au produit sans benchmark comparatif dédié sur corpus réel ou plus représentatif ;
5. ne pas introduire d’API commerciale obligatoire.

Le corpus V2.13 est synthétique et reproductible. Il permet une décision interne mesurée mais ne constitue pas une preuve de qualité externe sur tous les corpus réels.

## Qualification exact-head

`npm run check` : **PASS complet** :

- runtime Node.js : PASS ;
- configuration Copilot : PASS ;
- supply-chain : `SUPPLY_CHAIN_CHECK_PASSED` ;
- Prettier : PASS ;
- ESLint : PASS ;
- typecheck : PASS ;
- build : PASS ;
- coverage : 221 PASS, 0 skip.

Couverture globale :

```text
Statements  78,23 %
Branches    64,56 %
Functions   84,54 %
Lines       80,72 %
```

Suites spécialisées :

```text
required       221 PASS / 0 skip
unit           100 PASS / 0 skip
contract         6 PASS / 0 skip
security        68 PASS / 0 skip
resilience      25 PASS / 0 skip
performance      2 PASS / 0 skip
integration     35 PASS / 0 skip
E2E déterministe 2 PASS
```

Audits :

```text
npm audit --audit-level=moderate            0 vulnérabilité
npm audit --omit=dev --audit-level=moderate 0 vulnérabilité
```

Worktree final : clean.

## Réconciliation post-merge

- PR #24 : mergée dans `feat/v2-catalog-storage` ;
- issue #16 : peut être clôturée `completed` ;
- V2.13 : terminée ;
- prochaine tranche : V2.14 / #17 ;
- PR d’intégration #8 : doit rester draft jusqu’à V2.15 / #18 et sa qualification finale.

# Rapport de validation — Phases 3 et 4

Date : 21 juin 2026

## Résultat

Les phases 3 et 4 sont terminées. La validation complète sous Node.js 24.14.0 produit :

- 14 fichiers de tests réussis et 2 suites réseau optionnelles ignorées par défaut ;
- 87 tests déterministes réussis ;
- typecheck, ESLint, Prettier, compilation et validation de la configuration Copilot réussis ;
- aucune vulnérabilité signalée par `npm install` après l'ajout de `pdfjs-dist` 6.0.227.
- le test réseau réel `fetch_url` via MCP STDIO a réussi contre `https://example.com` en 2,79 s.

## Phase 3 — `fetch_url`

- contrat `maxCharacters`, `maxSections` et `renderMode` ;
- réponse structurée avec provenance, type, statut de source, date réelle et sections ;
- extraction HTML, Markdown, texte, JSON, XML, YAML et PDF textuel ;
- traitement explicite de README, `robots.txt`, `sitemap.xml` et `llms.txt` ;
- erreur OCR dédiée pour les PDF sans texte et erreur de type non pris en charge ;
- sélection lexicale locale, bonus de titre/code/version et budgets par section/globaux ;
- rendu Crawl4AI de secours uniquement sur un document `raw://` déjà téléchargé et neutralisé, sans requête réseau.

## Phase 4 — sécurité réseau

Le chemin réseau public passe désormais par `SecureHttpGateway` :

1. validation de l'URL et de toutes les réponses DNS ;
2. connexion épinglée sur l'adresse approuvée avec conservation du nom TLS ;
3. redirections suivies manuellement et revalidées avant la connexion suivante ;
4. arrêt après 5 redirections, 10 Mio ou 20 secondes ;
5. contrôle de `robots.txt`, concurrence bornée et temporisation par origine.

Les tests prouvent le blocage d'une redirection privée avant la seconde connexion, le refus du DNS mixte, l'épinglage d'adresse, les limites de taille et de temps, le respect de `robots.txt`, la suppression du contenu actif et le filtrage des liens bloqués et métadonnées sensibles.

## Commande de validation

```powershell
npm run check
```

Les deux suites ignorées dans la chaîne déterministe sont activables par `RUN_LIVE_SEARXNG=1` et `RUN_LIVE_CRAWL4AI=1`. La seconde a été exécutée et validée séparément pour ce rapport.

---
name: RTK Token-Optimized CLI
description: >-
  Convention RTK pour toutes les commandes shell de ce projet : préfixer chaque
  commande avec rtk pour compresser les sorties et économiser 60-90 % de tokens.
  S'applique à tous les fichiers du workspace.
applyTo: '*'
owner: mcp-search-net
version: 1.0.0
lastReviewed: '2026-06-21'
---

# RTK — Token-Optimized CLI

**rtk** is a CLI proxy that filters and compresses command outputs, saving 60-90% tokens.

## Rule

Always prefix shell commands with `rtk`:

```bash
# Instead of:              Use:
git status                 rtk git status
git log -10                rtk git log -10
docker ps                  rtk docker ps
npm run check              rtk npm run check
npx vitest run             rtk vitest run
```

## Meta commands (use directly)

```bash
rtk gain              # Token savings dashboard
rtk gain --history    # Per-command savings history
rtk discover          # Find missed rtk opportunities
rtk proxy <cmd>       # Run raw (no filtering) but track usage
```

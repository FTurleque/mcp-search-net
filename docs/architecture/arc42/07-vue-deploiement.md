# Section 7 — Vue de déploiement

> arc42 · mcp-search-net v1.1.0 · 2026-08-08

---

## 7.1 Environnements

| Environnement | Description | Spécificités |
|---|---|---|
| **Développement local** | Source + `npm run dev` + Docker Compose hybrid | Mode overlay `compose.hybrid.yaml`, SearXNG sur `127.0.0.1:8888`, relais Crawl4AI sur `127.0.0.1:11235` |
| **Conteneurisé Docker** | `docker compose --profile stdio run mcp-search-net` | Réseau `backend` interne, réseau `egress` pour le Web |
| **Windows portable** | ZIP `mcp-search-net-1.1.0-windows-x64.zip` | Node.js 24.18.0 embarqué, installateur Inno Setup |
| **CI GitHub Actions** | Ubuntu + Node 24 + Docker | Jobs : Node.js validation, Docker integration, Windows packaging |

---

## 7.2 Diagramme de déploiement — Mode développement hybride

```mermaid
flowchart TB
    subgraph host["«node»\nPoste développeur (Windows / Linux / macOS)"]
        subgraph ide["IDE (IntelliJ IDEA)"]
            copilot["GitHub Copilot\n«Software System»"]
        end

        subgraph nodeproc["«node»\nProcessus Node.js 24"]
            mcp["mcp-search-net v1.1.0\n(npm run dev / node build/bootstrap/main.js)"]
        end

        subgraph files["«node»\nSystème de fichiers"]
            configYaml["config/application.yml\n«file»"]
            officialSrc["config/official-sources.yml\n«file»"]
            dotenv[".env (secrets locaux)\n«file»"]
            cacheDb[("cache.sqlite\n«database»\nCache Web V1")]
            catalogDb[("catalog.db\n«database»\nCatalogue V2")]
        end

        subgraph docker["«node»\nDocker Desktop"]
            subgraph backendNet["Réseau backend (interne)"]
                searxng["SearXNG\n«Container»\nport interne 8080"]
                crawl4ai["Crawl4AI\n«Container»\nport interne 11235"]
                relay["crawl4ai-loopback\n«Container»\nNode.js TCP relay"]
            end
        end
    end

    internet["🌐 Internet\n«node externe»"]

    copilot -- "MCP STDIO\nstdin/stdout" --> mcp
    mcp -- "lit" --> configYaml
    mcp -- "lit" --> officialSrc
    mcp -- "lit" --> dotenv
    mcp -- "lit/écrit" --> cacheDb
    mcp -- "lit/écrit" --> catalogDb
    mcp -- "HTTP 127.0.0.1:8888" --> searxng
    mcp -- "HTTP 127.0.0.1:11235" --> relay
    relay -- "TCP backend" --> crawl4ai
    searxng -- "HTTPS" --> internet
    mcp -- "HTTPS" --> internet
```

---

## 7.3 Diagramme de déploiement — Mode Docker conteneurisé

```mermaid
flowchart TB
    subgraph host["«node»\nHôte Docker"]
        subgraph docker["Docker Compose — mcp-search-net"]
            subgraph backend["Réseau backend (internal: true)"]
                mcpC["mcp-search-net\n«Container»\nNode.js 24 · user:node\nread_only · cap_drop:ALL\nprofile: stdio"]
                searxngC["SearXNG\n«Container»\nuser:977:977\nread_only · cap_drop:ALL"]
                crawl4aiC["Crawl4AI\n«Container»\nuser:appuser\ncap_drop:ALL"]
            end
            subgraph egress["Réseau egress (accès Internet)"]
                mcpC2["mcp-search-net\n(membre egress)"]
                searxngC2["SearXNG\n(membre egress)"]
            end
            subgraph volumes["Volumes nommés"]
                cacheVol[("mcp-cache\n«volume»\n.data/")]
                searxngVol[("searxng-cache\n«volume»")]
                crawl4aiVol[("crawl4ai-data\n«volume»")]
            end
        end
    end

    internet["🌐 Internet"]

    mcpC -- "HTTP /search\nréseau backend" --> searxngC
    mcpC -- "HTTP raw://\nréseau backend" --> crawl4aiC
    mcpC -- "lit/écrit" --> cacheVol
    searxngC -- "écrit" --> searxngVol
    crawl4aiC -- "écrit" --> crawl4aiVol
    mcpC2 -- "HTTPS" --> internet
    searxngC2 -- "HTTPS" --> internet
```

---

## 7.4 Diagramme de déploiement — Distribution Windows portable

```mermaid
flowchart TB
    subgraph zip["ZIP mcp-search-net-1.1.0-windows-x64"]
        subgraph runtime["runtime/node-v24.18.0-win-x64/"]
            nodeExe["node.exe\n«file»\nSHA-256 vérifié + signature OpenJS"]
        end
        subgraph app["app/"]
            buildJs["build/bootstrap/main.js\n«file»"]
            configDir["config/\n«directory»"]
            docker["docker/compose.yaml\n«file»"]
        end
        license["LICENSE\n«file»"]
    end

    subgraph installer["Installateur Inno Setup 6.7.1"]
        setup["setup.exe\n«file»"]
    end

    subgraph user["Poste utilisateur Windows"]
        inno["Inno Setup\nExtraction + enregistrement MCP client"]
        mcpJson["mcp-client-integrations.json\n«file» (managed / preexisting)"]
        cacheLocal[("cache.sqlite\n«database»")]
        catalogLocal[("catalog.db\n«database»")]
    end

    setup -- "extrait" --> zip
    inno -- "modifie (managed)" --> mcpJson
    nodeExe -- "exécute" --> buildJs
    buildJs -- "lit/écrit" --> cacheLocal
    buildJs -- "lit/écrit" --> catalogLocal
```

---

## 7.5 Protocoles et ports

| Connexion | Protocole | Port(s) | Remarque |
|---|---|---|---|
| Client MCP → mcp-search-net | STDIO (JSON-RPC 2.0) | — | Pas de port réseau |
| mcp-search-net → SearXNG (local) | HTTP | 8080 (Docker) / 8888 (hybride) | Réseau Docker `backend` interne |
| mcp-search-net → Crawl4AI (local) | HTTP | 11235 | Réseau Docker `backend` / relais loopback |
| mcp-search-net → Web public | HTTPS | 80, 443 | Via réseau `egress` ou hôte direct |
| SearXNG → Web public | HTTPS | 443 | Via réseau `egress` |

---

## 7.6 Sécurité du déploiement

| Mesure | Détail |
|---|---|
| Images figées par digest | `searxng@sha256:d0f6ccf9…` / `crawl4ai@sha256:385042cb…` / `node@sha256:6f7b03f7…` |
| Moindre privilège | `user: node` / `user: 977:977` / `user: appuser` ; `cap_drop: ALL` ; `no-new-privileges: true` |
| Filesystem en lecture seule | `read_only: true` sur `mcp-search-net` et `searxng` ; tmpfs dédié |
| Crawl4AI sans egress | Confiné au réseau `backend` ; accès Internet uniquement via relais minimal (mode hybride) |
| Runtime Node.js signé | SHA-256 officiel + signature OpenJS vérifiés avant activation (installateur Windows) |
| Label OCI propriétaire | `LicenseRef-mcp-search-net-Proprietary` + `LICENSE` embarqué dans l'image |

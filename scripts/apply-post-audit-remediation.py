from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise SystemExit(f'EXPECTED_BLOCK_NOT_FOUND:{path}:{old[:80]!r}')
    write(path, text.replace(old, new, 1))


def append_once(path: str, marker: str, addition: str) -> None:
    text = read(path)
    if marker in text:
        return
    write(path, text.rstrip() + '\n\n' + addition.strip() + '\n')


# Restore the exact Node lint/type quality fixes that the failed historical one-shot never pushed.
replace_once(
    'src/infrastructure/fetch/secure-http-gateway.ts',
    "      let settled = false;\n      let absoluteTimer: NodeJS.Timeout | undefined;\n\n",
    "      let settled = false;\n\n",
)
replace_once(
    'src/infrastructure/fetch/secure-http-gateway.ts',
    "        if (absoluteTimer !== undefined) clearTimeout(absoluteTimer);",
    "        clearTimeout(absoluteTimer);",
)
replace_once(
    'src/infrastructure/fetch/secure-http-gateway.ts',
    "        if (absoluteTimer !== undefined) clearTimeout(absoluteTimer);",
    "        clearTimeout(absoluteTimer);",
)
replace_once(
    'src/infrastructure/fetch/secure-http-gateway.ts',
    "      absoluteTimer = setTimeout(() => {",
    "      const absoluteTimer = setTimeout(() => {",
)

replace_once(
    'src/infrastructure/http/http-utils.ts',
    """  const reader = response.body?.getReader();
  if (reader === undefined) {
    try {
      return JSON.parse('');
    } catch (error) {
      throw providerUnavailable(service, `${service} returned invalid JSON`, error);
    }
  }

  const chunks: Uint8Array[] = [];
""",
    """  if (response.body === null) {
    throw providerUnavailable(service, `${service} returned an empty response body`, undefined);
  }
  const reader = response.body.getReader();

  const chunks: Uint8Array[] = [];
""",
)
replace_once(
    'src/infrastructure/http/http-utils.ts',
    """    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
""",
    """    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
""",
)

http_test = read('tests/infrastructure/http-utils.test.ts')
if "rejects an empty provider response body" not in http_test:
    needle = "\n  it('rejects provider JSON responses above the configured byte budget', async () => {"
    addition = """
  it('rejects an empty provider response body', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

    await expect(
      fetchJson('crawl4ai', new URL('https://example.com'), {}, 1_000, fetchMock as typeof fetch),
    ).rejects.toMatchObject({ code: 'CONTENT_PROVIDER_UNAVAILABLE' });
  });

"""
    if needle not in http_test:
        raise SystemExit('HTTP_UTILS_TEST_INSERTION_POINT_NOT_FOUND')
    write('tests/infrastructure/http-utils.test.ts', http_test.replace(needle, '\n' + addition + needle.lstrip('\n'), 1))

# Enforce the same npm lifecycle-script policy in OCI and Windows staging as in checkout builds.
dockerfile = read('Dockerfile')
if dockerfile.count('COPY .npmrc ./') == 0:
    dockerfile = dockerfile.replace(
        'COPY package.json package-lock.json ./\nRUN npm ci',
        'COPY package.json package-lock.json ./\nCOPY .npmrc ./\nRUN npm ci',
        1,
    )
    dockerfile = dockerfile.replace(
        'COPY package.json package-lock.json LICENSE ./\nRUN npm ci --omit=dev',
        'COPY package.json package-lock.json LICENSE ./\nCOPY .npmrc ./\nRUN npm ci --omit=dev',
        1,
    )
    write('Dockerfile', dockerfile)
if read('Dockerfile').count('COPY .npmrc ./') != 2:
    raise SystemExit('DOCKER_NPMRC_COPY_COUNT_INVALID')

replace_once(
    'scripts/release/build-windows-distribution.ps1',
    "Copy-Item -LiteralPath (Join-Path $RepoRoot 'package-lock.json') -Destination $AppDist -Force\n",
    "Copy-Item -LiteralPath (Join-Path $RepoRoot 'package-lock.json') -Destination $AppDist -Force\nCopy-Item -LiteralPath (Join-Path $RepoRoot '.npmrc') -Destination $AppDist -Force\n",
)

supply = read('scripts/check-supply-chain.mjs')
if "windowsDistributionBuilder" not in supply:
    supply = supply.replace(
        "const dockerfile = readText('Dockerfile');\n",
        "const dockerfile = readText('Dockerfile');\nconst windowsDistributionBuilder = readText('scripts/release/build-windows-distribution.ps1');\n",
        1,
    )
    marker = "assert(\n  npmrc\n    .split(/\\r?\\n/u)\n    .map((line) => line.trim())\n    .includes('strict-allow-scripts=true'),\n  'STRICT_ALLOW_SCRIPTS_NOT_ENABLED',\n);\n"
    addition = marker + """assert(
  dockerfile.split('COPY .npmrc ./').length - 1 === 2,
  'STRICT_ALLOW_SCRIPTS_NOT_PROPAGATED_TO_DOCKER',
);
assert(
  windowsDistributionBuilder.includes(
    "Copy-Item -LiteralPath (Join-Path $RepoRoot '.npmrc') -Destination $AppDist -Force",
  ),
  'STRICT_ALLOW_SCRIPTS_NOT_PROPAGATED_TO_WINDOWS_STAGING',
);
"""
    if marker not in supply:
        raise SystemExit('SUPPLY_CHAIN_NPMRC_ASSERTION_NOT_FOUND')
    supply = supply.replace(marker, addition, 1)
    write('scripts/check-supply-chain.mjs', supply)

# Neutralize srcdoc before prepared HTML is ever passed to Chromium/Crawl4AI.
crawl = read('src/infrastructure/fetch/crawl4ai-content-fetcher.ts')
if "  'srcdoc'," not in crawl:
    crawl = crawl.replace("  'srcset',\n", "  'srcset',\n  'srcdoc',\n", 1)
    write('src/infrastructure/fetch/crawl4ai-content-fetcher.ts', crawl)

crawl_test = read('tests/infrastructure/crawl4ai-content-fetcher.test.ts')
if 'srcdoc-neutralized' not in crawl_test:
    crawl_test = crawl_test.replace(
        '<div style="background:url(http://127.0.0.1/y)"></div>',
        '<div style="background:url(http://127.0.0.1/y)"></div><div data-marker="srcdoc-neutralized" srcdoc="&lt;img src=&#39;http://127.0.0.1/srcdoc&#39;&gt;">neutralized</div>',
        1,
    )
    crawl_test = crawl_test.replace(
        "      expect(payload.urls[0]).not.toContain('xlink:href');\n",
        "      expect(payload.urls[0]).not.toContain('xlink:href');\n      expect(payload.urls[0]).not.toContain(' srcdoc=');\n",
        1,
    )
    write('tests/infrastructure/crawl4ai-content-fetcher.test.ts', crawl_test)

# Strictly parse MCP resource ids and page offsets; parseInt must never accept suffix garbage.
resource_file = 'src/presentation/mcp/catalog-resources.ts'
resource = read(resource_file)
old_tail = """function parseNumericResourceId(
  uri: URL,
  collection: 'sources' | 'documents' | 'sections',
): number {
  const prefix = `mcp-search-net://${collection}/`;
  if (!uri.href.startsWith(prefix)) return Number.NaN;
  return Number.parseInt(uri.href.slice(prefix.length), 10);
}

function parsePageOffset(uri: URL, collection: 'sources' | 'documents' | 'versions' | 'sections') {
  const marker = collection === 'versions' ? '/versions/page/' : `//${collection}/page/`;
  const markerIndex = uri.href.lastIndexOf(marker);
  if (markerIndex === -1) return Number.NaN;
  return Number.parseInt(uri.href.slice(markerIndex + marker.length), 10);
}

function parseDocumentVersionResourceIds(uri: URL): {
  readonly documentId: number;
  readonly versionId: number;
} {
  const parts = uri.href.split('/');
  const documentId = parts.length >= 4 ? Number.parseInt(parts[3] ?? '', 10) : Number.NaN;
  const versionId = parts.length >= 6 ? Number.parseInt(parts[5] ?? '', 10) : Number.NaN;
  return { documentId, versionId };
}
"""
new_tail = """function parseNumericResourceId(
  uri: URL,
  collection: 'sources' | 'documents' | 'sections',
): number {
  const prefix = `mcp-search-net://${collection}/`;
  if (!uri.href.startsWith(prefix)) throw new Error(`Invalid ${collection} resource URI`);
  return parseStrictResourceInteger(uri.href.slice(prefix.length), `${collection} id`, false);
}

function parsePageOffset(uri: URL, collection: 'sources' | 'documents' | 'versions' | 'sections') {
  const marker = collection === 'versions' ? '/versions/page/' : `//${collection}/page/`;
  const markerIndex = uri.href.lastIndexOf(marker);
  if (markerIndex === -1) throw new Error(`Invalid ${collection} page resource URI`);
  return parseStrictResourceInteger(
    uri.href.slice(markerIndex + marker.length),
    `${collection} page offset`,
    true,
  );
}

function parseDocumentVersionResourceIds(uri: URL): {
  readonly documentId: number;
  readonly versionId: number;
} {
  const parts = uri.href.split('/');
  if (parts.length < 6) throw new Error('Invalid document version resource URI');
  return {
    documentId: parseStrictResourceInteger(parts[3] ?? '', 'document id', false),
    versionId: parseStrictResourceInteger(parts[5] ?? '', 'version id', false),
  };
}

function parseStrictResourceInteger(value: string, label: string, allowZero: boolean): number {
  if (!/^\\d+$/u.test(value)) throw new Error(`Invalid ${label}`);
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Invalid ${label}`);
  return parsed;
}
"""
if old_tail not in resource:
    raise SystemExit('CATALOG_RESOURCE_PARSERS_NOT_FOUND')
write(resource_file, resource.replace(old_tail, new_tail, 1))

resource_test = read('tests/e2e/mcp-resources.test.ts')
if "sources/1abc" not in resource_test:
    marker = """    for (const uri of [
      'mcp-search-net://sources/page/0',
      'mcp-search-net://documents/page/0',
      'mcp-search-net://sections/page/0',
    ]) {
      await expect(readJsonResource(client, uri)).resolves.toMatchObject({
        schemaVersion: '1.0',
        bounded: true,
        offset: 0,
        limit: 20,
      });
    }
"""
    addition = marker + """

    for (const uri of [
      'mcp-search-net://sources/1abc',
      'mcp-search-net://sources/page/0junk',
      'mcp-search-net://documents/1abc/versions',
      'mcp-search-net://documents/1/versions/2abc',
      'mcp-search-net://sections/0',
    ]) {
      await expect(client.readResource({ uri })).rejects.toThrow();
    }
"""
    if marker not in resource_test:
        raise SystemExit('MCP_RESOURCE_TEST_INSERTION_POINT_NOT_FOUND')
    write('tests/e2e/mcp-resources.test.ts', resource_test.replace(marker, addition, 1))

# Preserve user configuration/data by default in the legacy source uninstall path.
uninstall = read('scripts/uninstall-user.ps1')
if '[switch]$PurgeData' not in uninstall:
    uninstall = uninstall.replace(
        '    [switch]$KeepData,\n    [switch]$SkipServices\n',
        '    [switch]$KeepData,\n    [switch]$PurgeData,\n    [switch]$SkipServices\n',
        1,
    )
    uninstall = uninstall.replace(
        "$ExpectedRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'mcp-search-net'))\n",
        "$ExpectedRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'mcp-search-net'))\nif ($KeepData -and $PurgeData) { throw 'KeepData et PurgeData sont mutuellement exclusifs.' }\n$DeleteData = [bool]$PurgeData\n",
        1,
    )
    uninstall = uninstall.replace('        if (-not $KeepData) {', '        if ($DeleteData) {', 1)
    uninstall = uninstall.replace(
        "$ComposeAction = if ($KeepData) { 'Arrêter les services Compose' } else { 'Arrêter les services Compose et supprimer leurs volumes' }",
        "$ComposeAction = if (-not $DeleteData) { 'Arrêter les services Compose' } else { 'Arrêter les services Compose et supprimer leurs volumes' }",
        1,
    )
    uninstall = uninstall.replace('if ($KeepData) {', 'if (-not $DeleteData) {', 1)
    write('scripts/uninstall-user.ps1', uninstall)

install_test = read('scripts/test-installation.ps1')
install_test = install_test.replace(
    "& (Join-Path $SourceRoot 'scripts\\uninstall-user.ps1') -InstallRoot $InstallRoot -KeepData -SkipServices -Confirm:$false",
    "& (Join-Path $SourceRoot 'scripts\\uninstall-user.ps1') -InstallRoot $InstallRoot -SkipServices -Confirm:$false",
    1,
)
install_test = install_test.replace(
    "La désinstallation -KeepData n'a pas conservé configuration et données.",
    "La désinstallation par défaut n'a pas conservé configuration et données.",
    1,
)
install_test = install_test.replace(
    "La désinstallation -KeepData n'a pas supprimé le programme.",
    "La désinstallation par défaut n'a pas supprimé le programme.",
    1,
)
old_full = "& (Join-Path $SourceRoot 'scripts\\uninstall-user.ps1') -InstallRoot $InstallRoot -SkipServices -Confirm:$false\n    if (Test-Path -LiteralPath $InstallRoot) {\n        throw 'La désinstallation complète a laissé le dossier utilisateur.'\n    }"
new_full = "& (Join-Path $SourceRoot 'scripts\\uninstall-user.ps1') -InstallRoot $InstallRoot -PurgeData -SkipServices -Confirm:$false\n    if (Test-Path -LiteralPath $InstallRoot) {\n        throw 'La désinstallation -PurgeData a laissé le dossier utilisateur.'\n    }"
if old_full not in install_test:
    raise SystemExit('INSTALLATION_PURGE_TEST_BLOCK_NOT_FOUND')
write('scripts/test-installation.ps1', install_test.replace(old_full, new_full, 1))

# Documentation: correct Docker topology and legacy uninstall semantics.
windows_doc = read('docs/getting-started/installation-windows.md')
windows_doc = windows_doc.replace(
    'Le réseau `backend` est interne. SearXNG et Crawl4AI disposent aussi du réseau `egress` pour joindre\nles sources publiques nécessaires à leur fonctionnement.',
    'Le réseau `backend` est interne. SearXNG et le serveur MCP disposent du réseau `egress` lorsque\nnécessaire. Crawl4AI reste uniquement sur `backend` et ne dispose d’aucun egress public direct.',
    1,
)
windows_doc = windows_doc.replace(
    ".\\scripts\\uninstall-user.ps1\n.\\scripts\\uninstall-user.ps1 -KeepData",
    ".\\scripts\\uninstall-user.ps1\n.\\scripts\\uninstall-user.ps1 -PurgeData",
    1,
)
windows_doc = windows_doc.replace(
    "La première commande supprime l’installation et les volumes Compose canoniques après arrêt des\nservices. La seconde conserve explicitement configuration, données et volumes, tout en retirant le\nprogramme. `-SkipServices` signifie que l’opérateur prend lui-même en charge les conteneurs et\nvolumes.",
    "La première commande retire le programme mais conserve par défaut configuration, données et\nvolumes. La seconde exige explicitement la purge complète des données et volumes avec `-PurgeData`.\nLe switch historique `-KeepData` reste accepté comme alias explicite du comportement sûr par défaut.\n`-SkipServices` signifie que l’opérateur prend lui-même en charge les conteneurs et volumes.",
    1,
)
write('docs/getting-started/installation-windows.md', windows_doc)

append_once(
    'docs/operations/supply-chain.md',
    '## Invariant lifecycle scripts dans les artefacts',
    """## Invariant lifecycle scripts dans les artefacts

`.npmrc` et `strict-allow-scripts=true` font partie de la frontière de build. Le Dockerfile copie
explicitement `.npmrc` dans ses stages build/runtime avant `npm ci`, et le staging Windows copie le
même fichier avant l'installation des dépendances de production. `npm run check:supply-chain`
bloque toute régression de ces deux invariants.

### Provenance historique du tag `v1.1.1`

Le tag Git historique `v1.1.1` pointe vers un commit dont `package.json` déclare encore `1.1.0`.
Ce tag est conservé comme artefact historique et ne constitue pas une release SemVer qualifiée selon
la politique actuelle. Il ne doit pas être réécrit silencieusement ; une future publication doit
utiliser une nouvelle version cohérente entre tag, `package.json`, `package-lock.json` et manifestes.
""",
)

# Freeze removal of privileged temporary workflows in the regular audit invariant gate.
audit = read('scripts/check-audit-invariants.mjs')
marker = "  'CI: workflow embeddings one-shot terminé encore présent',\n);\n"
if 'one-shot-node-fix.yml' not in audit:
    addition = marker + """for (const obsoleteWorkflow of [
  '.github/workflows/one-shot-node-diagnostics.yml',
  '.github/workflows/one-shot-node-fix.yml',
  '.github/workflows/one-shot-remediation-cleanup.yml',
  '.github/workflows/one-shot-post-audit-doc-reconcile.yml',
]) {
  assert(!existsSync(resolve(root, obsoleteWorkflow)), `CI: workflow temporaire encore présent ${obsoleteWorkflow}`);
}
"""
    if marker not in audit:
        raise SystemExit('AUDIT_ONE_SHOT_INSERTION_POINT_NOT_FOUND')
    write('scripts/check-audit-invariants.mjs', audit.replace(marker, addition, 1))

print('POST_AUDIT_REMEDIATION_APPLIED')

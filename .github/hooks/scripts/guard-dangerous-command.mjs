import process from 'node:process';

const input = await readInput();
if (input === undefined) {
  deny('Le hook de commande a reçu un JSON invalide et a échoué en mode fermé.');
} else {
  const command = extractCommand(input.toolArgs ?? input.tool_input);
  const blocked = command === undefined ? undefined : findBlockedRule(command);
  if (blocked === undefined) {
    process.stdout.write('{}\n');
  } else {
    deny(blocked);
  }
}

async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += String(chunk);
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function extractCommand(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractCommand).filter(Boolean).join(' ');
  if (value === null || typeof value !== 'object') return undefined;
  for (const key of ['command', 'cmd', 'script', 'input']) {
    const candidate = extractCommand(value[key]);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function findBlockedRule(command) {
  const rules = [
    // ── Git destructif ──────────────────────────────────────────────────────────
    [
      /\bgit\s+reset\s+--hard\b/iu,
      'git reset --hard peut détruire du travail non committé. Autorisation utilisateur explicite requise.',
    ],
    [
      /\bgit\s+clean\s+-[^\s]*f/iu,
      'git clean --force peut supprimer des fichiers utilisateur non suivis. Autorisation explicite requise.',
    ],
    [
      /\bgit\s+push\b[^\r\n]*(?:--force|-f\b)/iu,
      'Le force-push requiert une autorisation utilisateur explicite.',
    ],
    [
      /\bgit\s+(?:checkout|restore)\s+--\s+/iu,
      'Discarding file changes requires explicit user authorization.',
    ],
    [
      /\bgit\s+branch\s+(?:-[^\s]*D\b|-D\b)/iu,
      'La suppression de branches requiert une autorisation utilisateur explicite.',
    ],

    // ── Suppression filesystem ──────────────────────────────────────────────────
    [
      /\b(?:rm|rmdir)\s+-(?:[^\s]*r[^\s]*f|[^\s]*f[^\s]*r)\b/iu,
      'La suppression récursive forcée est bloquée.',
    ],
    [
      /\bRemove-Item\b[^\r\n]*(?=.*-Recurse)(?=.*-Force)/iu,
      'Remove-Item -Recurse -Force est bloqué.',
    ],
    [/\brd\s+\/s\s+\/q\b/iu, 'rd /s /q (suppression récursive silencieuse) est bloqué.'],

    // ── Docker destructif ───────────────────────────────────────────────────────
    [
      /\bdocker\s+system\s+prune\b/iu,
      'docker system prune peut supprimer des données non liées à ce projet. Autorisation explicite requise.',
    ],
    [
      /\bdocker\s+volume\s+(?:rm|prune)\b/iu,
      'La suppression de volumes Docker peut détruire des données persistantes. Autorisation explicite requise.',
    ],
    [
      /\bdocker\s+(?:rm|rmi)\s+[^\r\n]*-f\b/iu,
      'La suppression forcée de containers/images Docker requiert une autorisation explicite.',
    ],

    // ── Infrastructure cloud ────────────────────────────────────────────────────
    [
      /\b(?:terraform|tofu)\s+destroy\b/iu,
      "La destruction d'infrastructure requiert une autorisation explicite.",
    ],
    [
      /\bkubectl\s+delete\b/iu,
      'La suppression de ressources Kubernetes requiert une autorisation explicite.',
    ],

    // ── Publication et accès distant ────────────────────────────────────────────
    [
      /\b(?:npm|pnpm|yarn)\s+publish\b/iu,
      'La publication de packages requiert une autorisation explicite.',
    ],
    [/\bgh\s+repo\s+delete\b/iu, 'La suppression de dépôt GitHub est bloquée.'],
    [
      /\bgh\s+(?:release|tag)\s+(?:create|delete)\b/iu,
      'La création ou suppression de releases/tags requiert une autorisation explicite.',
    ],

    // ── Sécurité — ne jamais exécuter depuis un agent ───────────────────────────
    [
      /\bcurl\b[^\r\n]*(?:--upload-file|-T\s|-d\s)[^\r\n]*(?:localhost|127\.|::1)/iu,
      'Upload vers localhost via curl depuis un agent est bloqué (risque SSRF).',
    ],
    [
      /\bssh\b[^\r\n]*-[^\s]*o[^\s]*StrictHostKeyChecking[^\s]*=?no/iu,
      'SSH avec StrictHostKeyChecking désactivé est bloqué.',
    ],
  ];
  return rules.find(([pattern]) => pattern.test(command))?.[1];
}

function deny(reason) {
  process.stdout.write(
    `${JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: reason })}\n`,
  );
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const REGISTRY_URL =
  'https://www.iana.org/assignments/ipv6-unicast-address-assignments/ipv6-unicast-address-assignments.csv';
const SNAPSHOT_PATH = resolve('src/infrastructure/security/iana-ipv6-allocations.json');
const RIR_DESIGNATIONS = new Set(['AFRINIC', 'APNIC', 'ARIN', 'LACNIC', 'RIPE NCC']);
const CIDR_PATTERN = /^([0-9a-f:]+)\/(\d{1,3})$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
assert(snapshot?.schemaVersion === '1.0', 'IANA_IPV6_SNAPSHOT_SCHEMA_INVALID');
assert(Array.isArray(snapshot?.rirAllocatedCidrs), 'IANA_IPV6_SNAPSHOT_CIDRS_MISSING');
assert(
  typeof snapshot?.registryLastUpdated === 'string' &&
    DATE_PATTERN.test(snapshot.registryLastUpdated),
  'IANA_IPV6_SNAPSHOT_LAST_UPDATED_MISSING',
);
const snapshotLastUpdated = snapshot.registryLastUpdated;
const snapshotCidrs = snapshot.rirAllocatedCidrs.map((entry) => {
  assert(Array.isArray(entry) && entry.length === 2, 'IANA_IPV6_SNAPSHOT_ENTRY_INVALID');
  const [network, bits] = entry;
  assert(typeof network === 'string', 'IANA_IPV6_SNAPSHOT_NETWORK_INVALID');
  assert(Number.isInteger(bits), 'IANA_IPV6_SNAPSHOT_PREFIX_LENGTH_INVALID');
  return validateCidr(`${network}/${bits}`, 'IANA_IPV6_SNAPSHOT_INVALID_CIDR');
});

assert(snapshotCidrs.length > 0, 'IANA_IPV6_SNAPSHOT_EMPTY');
assert(new Set(snapshotCidrs).size === snapshotCidrs.length, 'IANA_IPV6_SNAPSHOT_DUPLICATE');

if (process.argv.includes('--offline')) {
  writeResult('IANA_IPV6_SNAPSHOT_VALID', snapshotCidrs, snapshotLastUpdated);
  process.exit(0);
}

const controller = new globalThis.AbortController();
const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
timeout.unref();

try {
  const response = await globalThis.fetch(REGISTRY_URL, {
    headers: { accept: 'text/csv', 'user-agent': 'mcp-search-net-iana-registry-watch/1.0' },
    redirect: 'error',
    signal: controller.signal,
  });
  if (!response.ok) {
    throw new Error(`IANA_IPV6_REGISTRY_HTTP_${response.status}`);
  }

  const rows = parseCsv(await response.text());
  const header = rows.shift();
  assert(header !== undefined, 'IANA_IPV6_REGISTRY_HEADER_MISSING');
  const columns = columnMap(header);
  for (const required of ['prefix', 'designation', 'status']) {
    assert(columns.has(required), `IANA_IPV6_REGISTRY_COLUMN_MISSING:${required}`);
  }

  const registryCidrs = rows
    .filter((row) => value(row, columns, 'status').toUpperCase() === 'ALLOCATED')
    .filter((row) => RIR_DESIGNATIONS.has(value(row, columns, 'designation').toUpperCase()))
    .map((row) => value(row, columns, 'prefix').toLowerCase())
    .map((cidr) => validateCidr(cidr, 'IANA_IPV6_REGISTRY_INVALID_CIDR'))
    .sort(compareText);
  const expectedCidrs = [...snapshotCidrs].sort(compareText);

  const missingFromSnapshot = registryCidrs.filter((cidr) => !expectedCidrs.includes(cidr));
  const noLongerAllocated = expectedCidrs.filter((cidr) => !registryCidrs.includes(cidr));
  if (missingFromSnapshot.length > 0 || noLongerAllocated.length > 0) {
    throw new Error(
      [
        'IANA_IPV6_REGISTRY_DRIFT',
        `missingFromSnapshot=${JSON.stringify(missingFromSnapshot)}`,
        `noLongerAllocated=${JSON.stringify(noLongerAllocated)}`,
      ].join(' '),
    );
  }

  writeResult('IANA_IPV6_REGISTRY_CURRENT', expectedCidrs, snapshotLastUpdated);
} finally {
  globalThis.clearTimeout(timeout);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/u, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('IANA_IPV6_REGISTRY_CSV_UNTERMINATED_QUOTE');
  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/u, ''));
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((fieldValue) => fieldValue !== ''));
}

function columnMap(header) {
  return new Map(header.map((name, index) => [name.trim().toLowerCase(), index]));
}

function value(row, columns, name) {
  const index = columns.get(name);
  if (index === undefined) throw new Error(`IANA_IPV6_REGISTRY_COLUMN_MISSING:${name}`);
  return (row[index] ?? '').trim();
}

function validateCidr(cidr, errorCode) {
  const match = CIDR_PATTERN.exec(cidr);
  const bits = Number(match?.[2]);
  if (match === null || !Number.isInteger(bits) || bits < 0 || bits > 128) {
    throw new Error(`${errorCode}:${cidr}`);
  }
  return `${match[1]?.toLowerCase()}/${bits}`;
}

function writeResult(status, cidrs, lastUpdated) {
  process.stdout.write(
    `${JSON.stringify({ status, source: REGISTRY_URL, snapshotLastUpdated: lastUpdated, allocatedRirCidrs: cidrs.length })}\n`,
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

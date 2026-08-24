import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('Windows release signing policy', () => {
  const releaseWorkflow = readFileSync('.github/workflows/release-windows.yml', 'utf8');

  it('publishes without Authenticode by default', () => {
    const input = releaseWorkflow.indexOf('authenticode:');
    expect(input).toBeGreaterThan(0);
    const inputBlock = releaseWorkflow.slice(input, input + 350);
    expect(inputBlock).toContain('default: false');
    expect(inputBlock).toContain('laisser false sans certificat');
  });

  it('only touches certificate material when Authenticode is explicitly requested', () => {
    const signingStep = releaseWorkflow.indexOf('Signer le setup Windows avec Authenticode');
    expect(signingStep).toBeGreaterThan(0);
    const signingBlock = releaseWorkflow.slice(signingStep, signingStep + 1300);
    expect(signingBlock).toContain('!inputs.validate_only && inputs.authenticode');
    expect(signingBlock).toContain('WINDOWS_SIGNING_CERTIFICATE_BASE64');
    expect(signingBlock).toContain('WINDOWS_SIGNING_CERTIFICATE_PASSWORD');
    expect(signingBlock).toContain('WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT');
  });

  it('accepts the intentional unsigned path while still validating checksums', () => {
    expect(releaseWorkflow).toContain("if ($env:AUTHENTICODE_ENABLED -eq 'true')");
    expect(releaseWorkflow).toContain('Publication volontaire du setup Windows sans Authenticode.');
    expect(releaseWorkflow).toContain('Verify-Sha256 $setup $setupChecksum');
    expect(releaseWorkflow).toContain('Verify-Sha256 $zip $zipChecksum');
    expect(releaseWorkflow).toContain('Verify-Sha256 $notices $noticesChecksum');
  });

  it('always creates and verifies GitHub provenance attestations for publication', () => {
    expect(releaseWorkflow).toContain(
      'actions/attest-build-provenance@9d57eef8c06cd9d6b433effeeb7a6a77b3ff94ad',
    );
    expect(releaseWorkflow).toContain(
      'gh attestation verify $artifact --repo $env:GITHUB_REPOSITORY',
    );
  });
});

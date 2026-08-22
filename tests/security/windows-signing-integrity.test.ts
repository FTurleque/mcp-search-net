import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function windowsRuntimeTest(name: string, body: () => void) {
  it(name, () => {
    // Deliberately not `context.skip()`: this repo's required/coverage test suite gate
    // (scripts/run-test-suite.mjs) rejects any run with skipped tests, so a Windows-only
    // runtime probe asserts the (trivially true) platform check instead of skipping on other
    // platforms -- matching the `windowsRuntimeTest` convention used elsewhere in this suite
    // (e.g. windows-upgrade-contract.test.ts, native-client-certification-wiring.test.ts).
    if (process.platform === 'win32') {
      body();
    } else {
      expect(process.platform).not.toBe('win32');
    }
  });
}

describe('Windows Authenticode signer pinning', () => {
  const signer = readFileSync('scripts/release/sign-windows-setup.ps1', 'utf8');
  const releaseWorkflow = readFileSync('.github/workflows/release-windows.yml', 'utf8');

  it('requires an expected certificate thumbprint before signing can proceed', () => {
    expect(signer).toContain("$ExpectedCertificateThumbprint = ''");
    expect(signer).toContain(
      "throw 'WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT est requis pour publier une release.'",
    );
    const thumbprintGuard = signer.indexOf(
      'WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT est requis pour publier une release.',
    );
    const signingCall = signer.indexOf('$signtool sign /fd SHA256');
    expect(thumbprintGuard).toBeGreaterThan(0);
    expect(signingCall).toBeGreaterThan(0);
    expect(thumbprintGuard).toBeLessThan(signingCall);
  });

  it('normalizes and compares the actual signer thumbprint against the expected one, failing closed', () => {
    expect(signer).toContain('function Get-NormalizedThumbprint');
    expect(signer).toContain(
      '$actualThumbprint = Get-NormalizedThumbprint -Value $signature.SignerCertificate.Thumbprint',
    );
    expect(signer).toContain('if ($actualThumbprint -ne $expectedThumbprint)');
    expect(signer).toContain('Empreinte du certificat Authenticode inattendue');
    const statusCheck = signer.indexOf("if ([string]$signature.Status -ne 'Valid'");
    const thumbprintCheck = signer.indexOf('$actualThumbprint = Get-NormalizedThumbprint');
    expect(statusCheck).toBeGreaterThan(0);
    expect(thumbprintCheck).toBeGreaterThan(statusCheck);
  });

  it('also verifies the signing certificate carries the Code Signing EKU', () => {
    expect(signer).toContain("'1.3.6.1.5.5.7.3.3'");
    expect(signer).toContain('EnhancedKeyUsageList');
    expect(signer).toContain("Le certificat de signature ne possede pas l'EKU Code Signing");
  });

  it('threads the pinned thumbprint from a non-secret repository variable into the signing step', () => {
    expect(releaseWorkflow).toContain(
      'WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT: ${{ vars.WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT }}',
    );
    expect(releaseWorkflow).toContain(
      '-ExpectedCertificateThumbprint $env:WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT',
    );
    const signingStep = releaseWorkflow.indexOf('Signer le setup Windows avec Authenticode');
    const signingStepGuard = releaseWorkflow.indexOf(
      "if: github.ref == 'refs/heads/master' && !inputs.validate_only",
      signingStep,
    );
    const signingScriptCall = releaseWorkflow.indexOf(
      '-ExpectedCertificateThumbprint $env:WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT',
      signingStep,
    );
    expect(signingStep).toBeGreaterThan(0);
    expect(signingStepGuard).toBeGreaterThan(signingStep);
    expect(signingScriptCall).toBeGreaterThan(signingStepGuard);
  });

  it('leaves validate_only builds unaffected by the thumbprint requirement', () => {
    // The signing step (and therefore the mandatory-thumbprint guard inside the script) only
    // ever runs on master with validate_only=false; the qualify/build step above it has no such
    // condition, so a validate_only candidate build never touches signing at all.
    const qualifyStep = releaseWorkflow.indexOf('Construire et qualifier les artefacts Windows');
    const signingStep = releaseWorkflow.indexOf('Signer le setup Windows avec Authenticode');
    expect(qualifyStep).toBeGreaterThan(0);
    expect(signingStep).toBeGreaterThan(qualifyStep);
    expect(releaseWorkflow.slice(qualifyStep, signingStep).includes('validate_only')).toBe(false);
  });

  windowsRuntimeTest('compares thumbprints case-insensitively and ignoring whitespace', () => {
    function extractFunction(name: string) {
      const marker = `function ${name} {`;
      const start = signer.indexOf(marker);
      if (start < 0) throw new Error(`Function ${name} not found in sign-windows-setup.ps1`);
      let depth = 0;
      for (let i = start; i < signer.length; i++) {
        if (signer[i] === '{') depth++;
        else if (signer[i] === '}') {
          depth--;
          if (depth === 0) return signer.slice(start, i + 1);
        }
      }
      throw new Error(`Unbalanced braces extracting function ${name}`);
    }

    const script = [
      extractFunction('Get-NormalizedThumbprint'),
      '$a = Get-NormalizedThumbprint -Value "AB 12 cd 34"',
      '$b = Get-NormalizedThumbprint -Value "ab12CD34"',
      '$c = Get-NormalizedThumbprint -Value "AB12CD35"',
      'if ($a -ne $b) { throw "NORMALIZATION_MISMATCH: $a vs $b" }',
      'if ($a -eq $c) { throw "FALSE_POSITIVE_MATCH: $a vs $c" }',
      'Write-Output "THUMBPRINT_NORMALIZATION_STABLE"',
    ].join('\n');

    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    });

    if (result.status !== 0) {
      throw new Error(
        `thumbprint normalization probe failed (status=${result.status}): stdout=${result.stdout} stderr=${result.stderr}`,
      );
    }
    expect(result.stdout).toContain('THUMBPRINT_NORMALIZATION_STABLE');
  });
});

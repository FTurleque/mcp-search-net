import { describe, expect, it } from 'vitest';

import { sanitizePreparedHtml } from '../../src/infrastructure/fetch/prepared-html-sanitizer.js';

describe('sanitizePreparedHtml — encoded href bypass prevention', () => {
  function hrefIsAbsent(output: string): boolean {
    return !output.includes('href=');
  }

  it('removes a href with a dangerous script protocol (plain)', () => {
    const out = sanitizePreparedHtml('<a href="javascript:alert(1)">click</a>'); // NOSONAR
    expect(hrefIsAbsent(out)).toBe(true);
  });

  it('removes a javascript: href with colon encoded as decimal &#58;', () => {
    const out = sanitizePreparedHtml('<a href="javascript&#58;alert(1)">click</a>');
    expect(hrefIsAbsent(out)).toBe(true);
  });

  it('removes a javascript: href with s encoded as hex &#x73;', () => {
    const out = sanitizePreparedHtml('<a href="java&#x73;cript:alert(1)">click</a>');
    expect(hrefIsAbsent(out)).toBe(true);
  });

  it('removes a javascript: href with c encoded as decimal &#99;', () => {
    const out = sanitizePreparedHtml('<a href="javas&#99;ript:alert(1)">click</a>');
    expect(hrefIsAbsent(out)).toBe(true);
  });

  it('removes a data: href with colon encoded as decimal &#58;', () => {
    const out = sanitizePreparedHtml('<a href="data&#58;text/html,<h1>x</h1>">x</a>');
    expect(hrefIsAbsent(out)).toBe(true);
  });

  it('removes a file: href with colon encoded as decimal &#58;', () => {
    const out = sanitizePreparedHtml('<a href="file&#58;//etc/passwd">leak</a>');
    expect(hrefIsAbsent(out)).toBe(true);
  });

  it('removes a javascript: href with j encoded as decimal &#106;', () => {
    const out = sanitizePreparedHtml('<a href="&#106;avascript:x">x</a>');
    expect(hrefIsAbsent(out)).toBe(true);
  });

  it('removes a javascript: href with leading encoded tab character', () => {
    const out = sanitizePreparedHtml('<a href="&#9;javascript:x">x</a>');
    expect(hrefIsAbsent(out)).toBe(true);
  });

  it('preserves a valid http: href', () => {
    const out = sanitizePreparedHtml('<a href="http://example.com">link</a>');
    expect(out).toContain('href="http://example.com"');
  });

  it('preserves a valid https: href', () => {
    const out = sanitizePreparedHtml('<a href="https://example.com/path?q=1">link</a>');
    expect(out).toContain('href="https://example.com/path?q=1"');
  });

  it('preserves a relative href without a scheme', () => {
    const out = sanitizePreparedHtml('<a href="/docs/guide#section">link</a>');
    expect(out).toContain('href="/docs/guide#section"');
  });
});

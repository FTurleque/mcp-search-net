import { describe, expect, it } from 'vitest';

import { sanitizePreparedHtml } from '../../src/infrastructure/fetch/prepared-html-sanitizer.js';

describe('sanitizePreparedHtml — encoded href bypass prevention', () => {
  function hrefIsAbsent(output: string): boolean {
    return !output.includes('href=');
  }

  it.each([
    ['plain javascript: protocol', '<a href="javascript:alert(1)">click</a>'],
    [
      'javascript: with colon encoded as decimal &#58;',
      '<a href="javascript&#58;alert(1)">click</a>',
    ],
    ['javascript: with s encoded as hex &#x73;', '<a href="java&#x73;cript:alert(1)">click</a>'],
    ['javascript: with c encoded as decimal &#99;', '<a href="javas&#99;ript:alert(1)">click</a>'],
    ['data: with colon encoded as decimal &#58;', '<a href="data&#58;text/html,<h1>x</h1>">x</a>'],
    ['file: with colon encoded as decimal &#58;', '<a href="file&#58;//etc/passwd">leak</a>'],
    ['javascript: with j encoded as decimal &#106;', '<a href="&#106;avascript:x">x</a>'],
    ['javascript: with leading encoded tab &#9;', '<a href="&#9;javascript:x">x</a>'],
  ])('removes a dangerous-protocol href — %s', (_, html) => {
    const out = sanitizePreparedHtml(html);
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

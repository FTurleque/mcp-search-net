import { describe, expect, it } from 'vitest';

import {
  permanentRedirectPrefix,
  permanentRedirectTarget,
} from '../../src/domain/services/redirect-chain.js';

describe('permanent redirect chain semantics', () => {
  it('keeps the leading permanent chain only', () => {
    const chain = [
      { fromUrl: 'https://example.com/a', toUrl: 'https://example.com/b', permanent: true },
      { fromUrl: 'https://example.com/b', toUrl: 'https://example.com/c', permanent: true },
      { fromUrl: 'https://example.com/c', toUrl: 'https://example.com/d', permanent: false },
      { fromUrl: 'https://example.com/d', toUrl: 'https://example.com/e', permanent: true },
    ] as const;

    expect(permanentRedirectTarget(chain)).toBe('https://example.com/c');
    expect(permanentRedirectPrefix(chain)).toEqual(chain.slice(0, 2));
  });

  it('does not make the original URL permanent when the chain starts temporarily', () => {
    const chain = [
      { fromUrl: 'https://example.com/a', toUrl: 'https://example.com/b', permanent: false },
      { fromUrl: 'https://example.com/b', toUrl: 'https://example.com/c', permanent: true },
    ] as const;

    expect(permanentRedirectTarget(chain)).toBeUndefined();
    expect(permanentRedirectPrefix(chain)).toEqual([]);
  });
});

export interface RedirectHop {
  readonly fromUrl: string;
  readonly toUrl: string;
  readonly permanent: boolean;
}

/**
 * Returns the permanent destination of the original requested URL.
 *
 * Only the leading contiguous sequence of permanent redirects can permanently relocate the
 * original URL. A temporary redirect breaks that relationship; permanent redirects observed after
 * it apply to the temporary target, not to the original URL.
 */
export function permanentRedirectTarget(
  redirectChain: readonly RedirectHop[],
): string | undefined {
  let target: string | undefined;
  for (const redirect of redirectChain) {
    if (!redirect.permanent) break;
    target = redirect.toUrl;
  }
  return target;
}

export function permanentRedirectPrefix<T extends RedirectHop>(
  redirectChain: readonly T[],
): readonly T[] {
  const permanent: T[] = [];
  for (const redirect of redirectChain) {
    if (!redirect.permanent) break;
    permanent.push(redirect);
  }
  return permanent;
}

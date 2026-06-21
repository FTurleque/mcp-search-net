export interface FetchRequest {
  readonly url: string;
  readonly query?: string;
  readonly maxChars: number;
}

export interface FetchedContent {
  readonly requestedUrl: string;
  readonly resolvedUrl: string;
  readonly title?: string;
  readonly markdown: string;
  readonly contentType?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly links: readonly string[];
}

export interface SelectedContent {
  readonly markdown: string;
  readonly sectionHeadings: readonly string[];
  readonly truncated: boolean;
}

export interface FetchResponse {
  readonly url: string;
  readonly resolvedUrl: string;
  readonly title?: string;
  readonly markdown: string;
  readonly sectionHeadings: readonly string[];
  readonly metadata: {
    readonly contentType?: string;
    readonly fetchedAt: string;
    readonly cached: boolean;
    readonly truncated: boolean;
    readonly wordCount: number;
    readonly links: readonly string[];
    readonly source: Readonly<Record<string, unknown>>;
  };
}

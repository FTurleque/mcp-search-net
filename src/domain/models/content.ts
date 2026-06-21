import type { SourceStatus } from './search.js';

export type RenderMode = 'static' | 'auto';
export type ExtractionMode = 'static' | 'native-render';

export interface FetchRequest {
  readonly url: string;
  readonly query?: string;
  readonly maxCharacters: number;
  readonly maxSections: number;
  readonly renderMode: RenderMode;
}

export interface FetchedContent {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly canonicalUrl: string;
  readonly title?: string;
  readonly markdown: string;
  readonly contentType: string;
  readonly fetchedAt: string;
  readonly extractionMode: ExtractionMode;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly links: readonly string[];
}

export interface ContentSection {
  readonly heading: string;
  readonly markdown: string;
  readonly score: number;
  readonly truncated: boolean;
}

export interface SelectedContent {
  readonly sections: readonly ContentSection[];
  readonly markdown: string;
  readonly truncated: boolean;
  readonly sectionTruncated: boolean;
  readonly noRelevantSection: boolean;
}

export interface FetchResponse {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly canonicalUrl: string;
  readonly domain: string;
  readonly title?: string;
  readonly contentType: string;
  readonly sourceStatus: SourceStatus;
  readonly fetchedAt: string;
  readonly extractionMode: ExtractionMode;
  readonly truncated: boolean;
  readonly sectionCount: number;
  readonly sections: readonly ContentSection[];
  readonly markdown: string;
  readonly links: readonly string[];
}

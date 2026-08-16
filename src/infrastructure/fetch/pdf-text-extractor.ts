import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import {
  ExtractionError,
  OcrRequiredNotSupportedError,
  RequestTimeoutError,
} from '../../domain/errors/domain-errors.js';
import { PdfWorkerPool } from './pdf-worker-pool.js';

const MAX_PDF_PAGES = 200;
const MAX_PDF_TEXT_CHARACTERS = 1_000_000;
const MAX_PDF_TEXT_ITEMS = 200_000;
const PDF_EXTRACTION_TIMEOUT_MS = 10_000;
const PDF_WORKER_MAX_OLD_GENERATION_MB = 256;
const PDF_WORKER_MAX_YOUNG_GENERATION_MB = 32;
const PDF_ENVELOPE_SCAN_BYTES = 1_024;
const PDF_WORKER_POOL_SIZE = 2;

const require = createRequire(import.meta.url);
const PDFJS_MODULE_URL = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
const PDF_WORKER_SOURCE = createPdfWorkerSource();
const PDF_WORKER_URL = new URL(
  `data:text/javascript;base64,${Buffer.from(PDF_WORKER_SOURCE, 'utf8').toString('base64')}`,
);

type PdfTimeoutErrorFactory = () => Error;

interface PdfWorkerSuccess {
  readonly ok: true;
  readonly text: string;
}

interface PdfWorkerFailure {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

type PdfWorkerMessage = PdfWorkerSuccess | PdfWorkerFailure;

interface PdfWorkerReadyEnvelope {
  readonly type: 'ready';
}

interface PdfWorkerResultEnvelope {
  readonly type: 'result';
  readonly requestId: number;
  readonly result: PdfWorkerMessage;
}

type PdfWorkerEnvelope = PdfWorkerReadyEnvelope | PdfWorkerResultEnvelope;

interface ActivePdfRequest {
  readonly requestId: number;
  readonly resolve: (value: string) => void;
  readonly reject: (reason: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

class PdfWorkerClient {
  private readonly worker: Worker;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason: unknown) => void;
  private activeRequest: ActivePdfRequest | undefined;
  private nextRequestId = 1;
  private ready = false;
  private dead = false;
  private reserved = false;

  public constructor() {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker = new Worker(PDF_WORKER_URL, {
      workerData: {
        pdfModuleUrl: PDFJS_MODULE_URL,
        maxPages: MAX_PDF_PAGES,
        maxTextCharacters: MAX_PDF_TEXT_CHARACTERS,
        maxTextItems: MAX_PDF_TEXT_ITEMS,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: PDF_WORKER_MAX_OLD_GENERATION_MB,
        maxYoungGenerationSizeMb: PDF_WORKER_MAX_YOUNG_GENERATION_MB,
        stackSizeMb: 4,
      },
    });
    this.worker.on('message', (message: unknown) => this.handleMessage(message));
    this.worker.on('error', (error) => this.handleWorkerFailure(error));
    this.worker.on('exit', (code) => {
      if (!this.dead) {
        this.handleWorkerFailure(
          new ExtractionError(`The isolated PDF worker exited unexpectedly (code ${code})`),
        );
      }
    });
  }

  public get available(): boolean {
    return this.ready && !this.dead && !this.reserved && this.activeRequest === undefined;
  }

  public get failed(): boolean {
    return this.dead;
  }

  public reserve(): boolean {
    if (!this.available) return false;
    this.reserved = true;
    return true;
  }

  public async waitUntilReady(): Promise<void> {
    await this.readyPromise;
  }

  public async extract(
    body: Uint8Array,
    deadline: number,
    timeoutError: PdfTimeoutErrorFactory,
  ): Promise<string> {
    await this.readyPromise;
    if (!this.reserved || this.dead || this.activeRequest !== undefined) {
      throw new ExtractionError('The isolated PDF worker is unavailable');
    }
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) {
      this.reserved = false;
      throw timeoutError();
    }

    const workerBody = Uint8Array.from(body);
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    this.worker.ref();

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.activeRequest = undefined;
        this.reserved = false;
        this.dead = true;
        void this.worker.terminate();
        reject(timeoutError());
      }, remaining);
      timer.unref();
      this.activeRequest = { requestId, resolve, reject, timer };
      this.worker.postMessage({ type: 'extract', requestId, body: workerBody }, [
        workerBody.buffer,
      ]);
    });
  }

  public terminate(): void {
    if (this.dead) return;
    this.dead = true;
    this.reserved = false;
    if (this.activeRequest !== undefined) {
      clearTimeout(this.activeRequest.timer);
      this.activeRequest.reject(new ExtractionError('The isolated PDF worker was terminated'));
      this.activeRequest = undefined;
    }
    void this.worker.terminate();
  }

  private handleMessage(message: unknown): void {
    if (!isPdfWorkerEnvelope(message)) {
      this.handleWorkerFailure(new ExtractionError('The PDF worker returned an invalid response'));
      return;
    }
    if (message.type === 'ready') {
      if (!this.ready) {
        this.ready = true;
        this.worker.unref();
        this.resolveReady();
      }
      return;
    }

    const active = this.activeRequest;
    if (active?.requestId !== message.requestId) return;
    clearTimeout(active.timer);
    this.activeRequest = undefined;
    this.reserved = false;
    this.worker.unref();
    if (message.result.ok) active.resolve(message.result.text);
    else active.reject(pdfWorkerFailure(message.result));
  }

  private handleWorkerFailure(error: unknown): void {
    if (this.dead) return;
    this.dead = true;
    this.reserved = false;
    if (!this.ready) this.rejectReady(error);
    const active = this.activeRequest;
    if (active !== undefined) {
      clearTimeout(active.timer);
      this.activeRequest = undefined;
      active.reject(
        error instanceof ExtractionError
          ? error
          : new ExtractionError('The isolated PDF worker failed', { cause: error }),
      );
    }
  }
}

const pdfWorkerPool = await PdfWorkerPool.create(PDF_WORKER_POOL_SIZE, createReadyPdfWorkerClient);

export async function extractPdfText(
  body: Uint8Array,
  operationDeadline?: number,
): Promise<string> {
  const localDeadline = performance.now() + PDF_EXTRACTION_TIMEOUT_MS;
  let deadline = localDeadline;
  let timeoutError: PdfTimeoutErrorFactory = pdfExtractionTimeoutError;
  if (operationDeadline !== undefined && operationDeadline <= localDeadline) {
    deadline = operationDeadline;
    timeoutError = operationDeadlineExceededError;
  }
  if (deadline - performance.now() <= 0) throw timeoutError();
  if (!hasPdfEnvelope(body)) {
    throw new ExtractionError('The PDF could not be parsed or its text could not be extracted');
  }

  const client = await reservePdfWorker(deadline, timeoutError);
  try {
    return await client.extract(body, deadline, timeoutError);
  } finally {
    if (client.failed) void pdfWorkerPool.repair(client);
  }
}

async function reservePdfWorker(
  deadline: number,
  timeoutError: PdfTimeoutErrorFactory,
): Promise<PdfWorkerClient> {
  return pdfWorkerPool.reserve(deadline, timeoutError);
}

async function createReadyPdfWorkerClient(): Promise<PdfWorkerClient> {
  const client = new PdfWorkerClient();
  await client.waitUntilReady();
  return client;
}

function hasPdfEnvelope(body: Uint8Array): boolean {
  const headerEnd = Math.min(body.length, PDF_ENVELOPE_SCAN_BYTES);
  const trailerStart = Math.max(0, body.length - PDF_ENVELOPE_SCAN_BYTES);
  return (
    containsAscii(body, '%PDF-', 0, headerEnd) &&
    containsAscii(body, '%%EOF', trailerStart, body.length)
  );
}

function containsAscii(body: Uint8Array, needle: string, start: number, end: number): boolean {
  const bytes = Buffer.from(needle, 'ascii');
  if (bytes.length === 0 || end - start < bytes.length) return false;
  const lastStart = end - bytes.length;
  for (let offset = start; offset <= lastStart; offset += 1) {
    let matches = true;
    for (let index = 0; index < bytes.length; index += 1) {
      if (body[offset + index] !== bytes[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function isPdfWorkerEnvelope(value: unknown): value is PdfWorkerEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record['type'] === 'ready') return true;
  return (
    record['type'] === 'result' &&
    Number.isSafeInteger(record['requestId']) &&
    isPdfWorkerMessage(record['result'])
  );
}

function isPdfWorkerMessage(value: unknown): value is PdfWorkerMessage {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record['ok'] === true) return typeof record['text'] === 'string';
  return (
    record['ok'] === false &&
    typeof record['code'] === 'string' &&
    typeof record['message'] === 'string'
  );
}

function pdfWorkerFailure(failure: PdfWorkerFailure): Error {
  if (failure.code === 'OCR_REQUIRED') return new OcrRequiredNotSupportedError();
  if (failure.code === 'PAGE_LIMIT') {
    return new ExtractionError(`The PDF exceeds the ${MAX_PDF_PAGES}-page extraction limit`);
  }
  if (failure.code === 'TEXT_LIMIT') {
    return new ExtractionError(
      `The PDF exceeds the ${MAX_PDF_TEXT_CHARACTERS}-character extraction limit`,
    );
  }
  if (failure.code === 'ITEM_LIMIT') {
    return new ExtractionError(
      `The PDF exceeds the ${MAX_PDF_TEXT_ITEMS}-text-item extraction limit`,
    );
  }
  return new ExtractionError('The PDF could not be parsed or its text could not be extracted', {
    cause: new Error(failure.message),
  });
}

function operationDeadlineExceededError(): RequestTimeoutError {
  return new RequestTimeoutError('fetch_url operation deadline exceeded during PDF extraction');
}

function pdfExtractionTimeoutError(): ExtractionError {
  return new ExtractionError('The PDF extraction timed out');
}

function createPdfWorkerSource(): string {
  return String.raw`
import { parentPort, workerData } from 'node:worker_threads';

const { getDocument, VerbosityLevel } = await import(workerData.pdfModuleUrl);
const MAX_PAGES = workerData.maxPages;
const MAX_TEXT_CHARACTERS = workerData.maxTextCharacters;
const MAX_TEXT_ITEMS = workerData.maxTextItems;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function normalizePdfText(value) {
  return value
    .replace(/\0/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

async function extract(body) {
  let loadingTask;
  try {
    loadingTask = getDocument({
      data: new Uint8Array(body),
      disableAutoFetch: true,
      disableFontFace: true,
      disableRange: true,
      disableStream: true,
      stopAtErrors: true,
      useSystemFonts: false,
      useWasm: false,
      useWorkerFetch: false,
      verbosity: VerbosityLevel.ERRORS,
    });
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PAGES) fail('PAGE_LIMIT', 'PDF page limit exceeded');

    const pages = [];
    let extractedCharacters = 0;
    let extractedItems = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent({ disableNormalization: false });
      extractedItems += textContent.items.length;
      if (extractedItems > MAX_TEXT_ITEMS) fail('ITEM_LIMIT', 'PDF text item limit exceeded');

      const fragments = [];
      let pageCharacters = 0;
      for (const item of textContent.items) {
        if (!('str' in item) || item.str === '') continue;
        pageCharacters += item.str.length + 1;
        if (extractedCharacters + pageCharacters > MAX_TEXT_CHARACTERS) {
          fail('TEXT_LIMIT', 'PDF text character limit exceeded');
        }
        fragments.push(item.str, item.hasEOL ? '\n' : ' ');
      }

      const pageText = normalizePdfText(fragments.join(''));
      if (pageText !== '') {
        extractedCharacters += pageText.length + (pages.length === 0 ? 0 : 2);
        if (extractedCharacters > MAX_TEXT_CHARACTERS) {
          fail('TEXT_LIMIT', 'PDF text character limit exceeded');
        }
        pages.push(pageText);
      }
    }

    const text = pages.join('\n\n').trim();
    if (text === '') fail('OCR_REQUIRED', 'PDF contains no extractable text');
    return text;
  } finally {
    await loadingTask?.destroy().catch(() => undefined);
  }
}

parentPort?.on('message', async (message) => {
  if (message?.type !== 'extract' || !Number.isSafeInteger(message.requestId)) return;
  try {
    const text = await extract(message.body);
    parentPort?.postMessage({ type: 'result', requestId: message.requestId, result: { ok: true, text } });
  } catch (error) {
    parentPort?.postMessage({
      type: 'result',
      requestId: message.requestId,
      result: {
        ok: false,
        code:
          error !== null && typeof error === 'object' && typeof error.code === 'string'
            ? error.code
            : 'PARSE_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

parentPort?.postMessage({ type: 'ready' });
`;
}

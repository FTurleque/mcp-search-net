import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import {
  ExtractionError,
  OcrRequiredNotSupportedError,
  RequestTimeoutError,
} from '../../domain/errors/domain-errors.js';

const MAX_PDF_PAGES = 200;
const MAX_PDF_TEXT_CHARACTERS = 1_000_000;
const MAX_PDF_TEXT_ITEMS = 200_000;
const PDF_EXTRACTION_TIMEOUT_MS = 10_000;
const PDF_WORKER_MAX_OLD_GENERATION_MB = 256;
const PDF_WORKER_MAX_YOUNG_GENERATION_MB = 32;

const require = createRequire(import.meta.url);
const PDFJS_MODULE_URL = pathToFileURL(
  require.resolve('pdfjs-dist/legacy/build/pdf.mjs'),
).href;
const PDF_WORKER_SOURCE = createPdfWorkerSource();
const PDF_WORKER_URL = new URL(
  `data:text/javascript;base64,${Buffer.from(PDF_WORKER_SOURCE, 'utf8').toString('base64')}`,
);

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

export async function extractPdfText(
  body: Uint8Array,
  operationDeadline?: number,
): Promise<string> {
  const localDeadline = performance.now() + PDF_EXTRACTION_TIMEOUT_MS;
  const operationLimited = operationDeadline !== undefined && operationDeadline <= localDeadline;
  const deadline = operationLimited ? operationDeadline : localDeadline;
  const remaining = Math.ceil(deadline - performance.now());
  if (remaining <= 0) throw pdfTimeoutError(operationLimited);

  const workerBody = Uint8Array.from(body);
  const worker = new Worker(PDF_WORKER_URL, {
    workerData: {
      body: workerBody,
      pdfModuleUrl: PDFJS_MODULE_URL,
      maxPages: MAX_PDF_PAGES,
      maxTextCharacters: MAX_PDF_TEXT_CHARACTERS,
      maxTextItems: MAX_PDF_TEXT_ITEMS,
    },
    transferList: [workerBody.buffer],
    resourceLimits: {
      maxOldGenerationSizeMb: PDF_WORKER_MAX_OLD_GENERATION_MB,
      maxYoungGenerationSizeMb: PDF_WORKER_MAX_YOUNG_GENERATION_MB,
      stackSizeMb: 4,
    },
  });

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate();
      callback();
    };

    const timer = setTimeout(() => {
      finish(() => reject(pdfTimeoutError(operationLimited)));
    }, remaining);

    worker.once('message', (message: unknown) => {
      finish(() => {
        if (!isPdfWorkerMessage(message)) {
          reject(new ExtractionError('The PDF worker returned an invalid response'));
          return;
        }
        if (message.ok) {
          resolve(message.text);
          return;
        }
        reject(pdfWorkerFailure(message));
      });
    });
    worker.once('error', (error) => {
      finish(() =>
        reject(
          new ExtractionError('The isolated PDF worker failed', {
            cause: error,
          }),
        ),
      );
    });
    worker.once('exit', (code) => {
      if (settled) return;
      finish(() =>
        reject(
          new ExtractionError(
            `The isolated PDF worker exited before completing extraction (code ${code})`,
          ),
        ),
      );
    });
  });
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

function pdfTimeoutError(operationLimited: boolean): Error {
  return operationLimited
    ? new RequestTimeoutError('fetch_url operation deadline exceeded during PDF extraction')
    : new ExtractionError('The PDF extraction timed out');
}

function createPdfWorkerSource(): string {
  return `
import { parentPort, workerData } from 'node:worker_threads';

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
    .replace(/\\0/gu, '')
    .replace(/\\r\\n?/gu, '\\n')
    .replace(/[^\\S\\n]+/gu, ' ')
    .replace(/ *\\n */gu, '\\n')
    .replace(/\\n{3,}/gu, '\\n\\n')
    .trim();
}

async function extract() {
  const { getDocument, VerbosityLevel } = await import(workerData.pdfModuleUrl);
  let loadingTask;
  try {
    loadingTask = getDocument({
      data: new Uint8Array(workerData.body),
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
        fragments.push(item.str, item.hasEOL ? '\\n' : ' ');
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

    const text = pages.join('\\n\\n').trim();
    if (text === '') fail('OCR_REQUIRED', 'PDF contains no extractable text');
    return text;
  } finally {
    await loadingTask?.destroy().catch(() => undefined);
  }
}

extract().then(
  (text) => parentPort?.postMessage({ ok: true, text }),
  (error) =>
    parentPort?.postMessage({
      ok: false,
      code:
        error !== null && typeof error === 'object' && typeof error.code === 'string'
          ? error.code
          : 'PARSE_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }),
);
`;
}

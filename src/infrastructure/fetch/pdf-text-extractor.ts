import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  ExtractionError,
  OcrRequiredNotSupportedError,
} from '../../domain/errors/domain-errors.js';

const MAX_PDF_PAGES = 200;
const MAX_PDF_TEXT_CHARACTERS = 1_000_000;
const PDF_EXTRACTION_TIMEOUT_MS = 10_000;

export async function extractPdfText(body: Uint8Array): Promise<string> {
  let loadingTask: ReturnType<typeof getDocument> | undefined;
  const deadline = Date.now() + PDF_EXTRACTION_TIMEOUT_MS;

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
    const document = await withinPdfDeadline(loadingTask.promise, deadline);
    if (document.numPages > MAX_PDF_PAGES) {
      throw new ExtractionError(`The PDF exceeds the ${MAX_PDF_PAGES}-page extraction limit`);
    }
    const pages: string[] = [];
    let extractedCharacters = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await withinPdfDeadline(document.getPage(pageNumber), deadline);
      const textContent = await withinPdfDeadline(
        page.getTextContent({ disableNormalization: false }),
        deadline,
      );
      const pageText = normalizePdfText(
        textContent.items
          .flatMap((item) => {
            if (!('str' in item) || item.str === '') return [];
            return item.hasEOL ? [item.str, '\n'] : [item.str, ' '];
          })
          .join(''),
      );
      if (pageText !== '') {
        extractedCharacters += pageText.length + (pages.length === 0 ? 0 : 2);
        if (extractedCharacters > MAX_PDF_TEXT_CHARACTERS) {
          throw new ExtractionError(
            `The PDF exceeds the ${MAX_PDF_TEXT_CHARACTERS}-character extraction limit`,
          );
        }
        pages.push(pageText);
      }
    }

    const text = pages.join('\n\n').trim();
    if (text === '') throw new OcrRequiredNotSupportedError();
    return text;
  } catch (error) {
    if (error instanceof OcrRequiredNotSupportedError || error instanceof ExtractionError) {
      throw error;
    }
    throw new ExtractionError('The PDF could not be parsed or its text could not be extracted', {
      cause: error,
    });
  } finally {
    await loadingTask?.destroy().catch(() => undefined);
  }
}

async function withinPdfDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ExtractionError('The PDF extraction timed out');

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ExtractionError('The PDF extraction timed out')),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function normalizePdfText(value: string): string {
  return value
    .replace(/\0/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

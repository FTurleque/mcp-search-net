import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  ExtractionError,
  OcrRequiredNotSupportedError,
  RequestTimeoutError,
} from '../../src/domain/errors/domain-errors.js';
import { extractPdfText } from '../../src/infrastructure/fetch/pdf-text-extractor.js';

describe('extractPdfText', () => {
  it('extracts text from a compressed PDF stream', async () => {
    const pdf = makeTextPdf(['Compressed public documentation'], true);

    await expect(extractPdfText(pdf)).resolves.toContain('Compressed public documentation');
  });

  it('extracts every page in document order', async () => {
    const pdf = makeTextPdf(['First page documentation', 'Second page reference'], false);

    const text = await extractPdfText(pdf);

    expect(text).toContain('First page documentation');
    expect(text).toContain('Second page reference');
    expect(text.indexOf('First page')).toBeLessThan(text.indexOf('Second page'));
  });

  it('supports more concurrent PDF requests than the prewarmed worker pool', async () => {
    const results = await Promise.all([
      extractPdfText(makeTextPdf(['Concurrent document A'], false)),
      extractPdfText(makeTextPdf(['Concurrent document B'], false)),
      extractPdfText(makeTextPdf(['Concurrent document C'], false)),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Concurrent document A'),
        expect.stringContaining('Concurrent document B'),
        expect.stringContaining('Concurrent document C'),
      ]),
    );
  });

  it('rejects an already expired operation deadline before worker dispatch', async () => {
    const pdf = makeTextPdf(['Deadline documentation'], false);

    await expect(extractPdfText(pdf, performance.now() - 1)).rejects.toBeInstanceOf(
      RequestTimeoutError,
    );
  });

  it('terminates timed-out pooled workers and remains able to extract subsequent PDFs', async () => {
    const slowPdf = makeTextPdf(
      Array.from({ length: 200 }, (_value, index) => `Page ${index} ${'x'.repeat(3_000)}`),
      true,
    );
    const deadline = performance.now() + 25;

    const timedOut = await Promise.allSettled([
      extractPdfText(slowPdf, deadline),
      extractPdfText(slowPdf, deadline),
    ]);

    expect(timedOut).toHaveLength(2);
    for (const result of timedOut) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(RequestTimeoutError);
    }

    await expect(extractPdfText(makeTextPdf(['Recovered after timeout'], false))).resolves.toContain(
      'Recovered after timeout',
    );
  });

  it('rejects PDFs exceeding the fixed page extraction budget', async () => {
    const pdf = makeTextPdf(
      Array.from({ length: 201 }, (_value, index) => `Page ${index}`),
      false,
    );

    await expect(extractPdfText(pdf)).rejects.toThrow(/200-page extraction limit/u);
  });

  it('rejects extracted text exceeding the fixed character budget', async () => {
    const pdf = makeTextPdf(
      Array.from({ length: 200 }, () => 'x'.repeat(6_000)),
      true,
    );

    await expect(extractPdfText(pdf)).rejects.toThrow(/1000000-character extraction limit/u);
  });

  it('maps a valid image-only PDF to the dedicated OCR error', async () => {
    await expect(extractPdfText(makeImageOnlyPdf())).rejects.toBeInstanceOf(
      OcrRequiredNotSupportedError,
    );
  });

  it('rejects a malformed PDF envelope before worker extraction', async () => {
    await expect(
      extractPdfText(new TextEncoder().encode('%PDF-1.4\nnot a valid document')),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('maps a structurally invalid PDF with a complete envelope to an extraction error', async () => {
    await expect(
      extractPdfText(new TextEncoder().encode('%PDF-1.4\nnot a valid document\n%%EOF')),
    ).rejects.toBeInstanceOf(ExtractionError);
  });
});

function makeTextPdf(pageTexts: readonly string[], compressed: boolean): Uint8Array {
  const pageObjectIds = pageTexts.map((_text, index) => 3 + index * 2);
  const fontObjectId = 3 + pageTexts.length * 2;
  const objects: Buffer[] = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii(
      `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`,
    ),
  ];

  pageTexts.forEach((text, index) => {
    const pageObjectId = pageObjectIds[index];
    if (pageObjectId === undefined) throw new Error('Missing page object identifier');
    const streamObjectId = pageObjectId + 1;
    objects.push(
      ascii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${streamObjectId} 0 R >>`,
      ),
    );
    const source = makePageTextStream(text);
    const data = compressed ? deflateSync(source) : source;
    objects.push(pdfStream(data, compressed ? '/Filter /FlateDecode ' : ''));
  });
  objects.push(ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  return buildPdf(objects);
}

function makePageTextStream(text: string): Buffer {
  if (text.length <= 200) {
    return ascii(`BT /F1 18 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`);
  }

  const chunks = text.match(/.{1,50}/gu) ?? [];
  return ascii(
    `BT /F1 1 Tf 72 720 Td ${chunks
      .map((chunk, index) => `${index === 0 ? '' : '0 -5 Td '}(${escapePdfText(chunk)}) Tj`)
      .join(' ')} ET`,
  );
}

function makeImageOnlyPdf(): Uint8Array {
  const image = Buffer.from([0x7f]);
  return buildPdf([
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    ascii(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
    ),
    pdfStream(ascii('q 1 0 0 1 0 0 cm /Im1 Do Q')),
    pdfStream(
      image,
      '/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 ',
    ),
  ]);
}

function buildPdf(objects: readonly Buffer[]): Uint8Array {
  const parts: Buffer[] = [ascii('%PDF-1.4\n')];
  const offsets = [0];
  let length = parts[0]?.length ?? 0;

  objects.forEach((body, index) => {
    offsets.push(length);
    const object = Buffer.concat([ascii(`${index + 1} 0 obj\n`), body, ascii('\nendobj\n')]);
    parts.push(object);
    length += object.length;
  });

  const xrefOffset = length;
  const xrefEntries = offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  parts.push(
    ascii(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefEntries}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
    ),
  );
  return Buffer.concat(parts);
}

function pdfStream(data: Buffer, dictionary = ''): Buffer {
  return Buffer.concat([
    ascii(`<< ${dictionary}/Length ${data.length} >>\nstream\n`),
    data,
    ascii('\nendstream'),
  ]);
}

function ascii(value: string): Buffer {
  return Buffer.from(value, 'ascii');
}

function escapePdfText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

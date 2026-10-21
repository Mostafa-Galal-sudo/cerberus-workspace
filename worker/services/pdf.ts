import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface PdfColumn {
  header: string;
  weight?: number;
}

export interface PdfReport {
  title: string;
  subtitle: string;
  columns: PdfColumn[];
  rows: string[][];
  summary?: string[];
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const ROW_FONT_SIZE = 9;
const HEADER_FONT_SIZE = 9.5;
const CELL_PADDING = 4;
const LINE_HEIGHT = 11.5;

function normalizeText(value: string): string {
  return value
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\u00D7/g, 'x')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/[^\x20-\x7E\n\t]/g, '?')
    .replace(/\t/g, '    ');
}

function wrapText(text: string, font: PDFFont, size: number, width: number, maxLines = 4): string[] {
  const normalized = normalizeText(text).replace(/\r/g, '');
  const paragraphs = normalized.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    if (lines.length >= maxLines) break;
  }

  if (lines.length === 0) return [''];
  if (lines.length > maxLines) lines.length = maxLines;
  const lastIndex = lines.length - 1;
  if (font.widthOfTextAtSize(lines[lastIndex], size) > width) {
    let textLine = lines[lastIndex];
    while (textLine.length > 0 && font.widthOfTextAtSize(`${textLine}...`, size) > width) {
      textLine = textLine.slice(0, -1);
    }
    lines[lastIndex] = `${textLine}...`;
  }
  return lines;
}

function drawFooter(page: PDFPage, font: PDFFont, pageNumber: number, generatedAt: string) {
  const text = `CERBERUS workspace  |  Generated ${generatedAt}  |  Page ${pageNumber}`;
  page.drawText(normalizeText(text), {
    x: MARGIN,
    y: 24,
    size: 7.5,
    font,
    color: rgb(0.42, 0.47, 0.55),
  });
}

export async function renderReportPdf(report: PdfReport): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  document.setTitle(report.title);
  document.setAuthor('CERBERUS Workspace');
  document.setSubject(report.subtitle);
  document.setCreator('CERBERUS Workspace server-side PDF renderer');

  const weights = report.columns.map((column) => Math.max(0.5, column.weight ?? 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => (CONTENT_WIDTH * weight) / totalWeight);

  const rows = report.rows.slice(0, 800);
  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let pageNumber = 1;
  let cursorY = PAGE_HEIGHT - MARGIN;

  const startPage = () => {
    page.drawText(normalizeText(report.title), {
      x: MARGIN,
      y: cursorY - 18,
      size: 17,
      font: bold,
      color: rgb(0.08, 0.13, 0.2),
    });
    cursorY -= 30;
    page.drawText(normalizeText(report.subtitle), {
      x: MARGIN,
      y: cursorY - 10,
      size: 9,
      font: regular,
      color: rgb(0.35, 0.4, 0.48),
    });
    cursorY -= 22;

    if (report.summary?.length) {
      for (const line of report.summary) {
        for (const wrapped of wrapText(line, regular, 9, CONTENT_WIDTH, 2)) {
          page.drawText(wrapped, { x: MARGIN, y: cursorY - 8, size: 9, font: regular, color: rgb(0.18, 0.24, 0.32) });
          cursorY -= LINE_HEIGHT;
        }
      }
      cursorY -= 6;
    }

    const headerHeight = 20;
    page.drawRectangle({
      x: MARGIN,
      y: cursorY - headerHeight,
      width: CONTENT_WIDTH,
      height: headerHeight,
      color: rgb(0.09, 0.14, 0.22),
    });
    let x = MARGIN;
    report.columns.forEach((column, index) => {
      page.drawText(normalizeText(column.header), {
        x: x + CELL_PADDING,
        y: cursorY - 14,
        size: HEADER_FONT_SIZE,
        font: bold,
        color: rgb(0.88, 0.93, 0.98),
      });
      x += widths[index];
    });
    cursorY -= headerHeight + 4;
  };

  startPage();

  for (const row of rows) {
    const cellLines = row.map((cell, index) => wrapText(String(cell ?? ''), regular, ROW_FONT_SIZE, widths[index] - CELL_PADDING * 2));
    const rowHeight = Math.max(...cellLines.map((lines) => lines.length)) * LINE_HEIGHT + CELL_PADDING * 2;

    if (cursorY - rowHeight < 42) {
      drawFooter(page, regular, pageNumber, generatedAt);
      page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pageNumber += 1;
      cursorY = PAGE_HEIGHT - MARGIN;
      startPage();
    }

    const rowTop = cursorY;
    if (pageNumber % 2 === 0) {
      page.drawRectangle({
        x: MARGIN,
        y: rowTop - rowHeight,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: rgb(0.97, 0.98, 0.99),
      });
    }

    let cellX = MARGIN;
    cellLines.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: cellX + CELL_PADDING,
          y: rowTop - CELL_PADDING - ROW_FONT_SIZE - lineIndex * LINE_HEIGHT,
          size: ROW_FONT_SIZE,
          font: regular,
          color: rgb(0.14, 0.19, 0.26),
        });
      });
      cellX += widths[index];
    });

    cursorY -= rowHeight;
    page.drawLine({
      start: { x: MARGIN, y: cursorY },
      end: { x: PAGE_WIDTH - MARGIN, y: cursorY },
      thickness: 0.4,
      color: rgb(0.86, 0.89, 0.93),
    });
  }

  if (report.rows.length > rows.length) {
    page.drawText(normalizeText(`Showing the first ${rows.length} of ${report.rows.length} records.`), {
      x: MARGIN,
      y: cursorY - 16,
      size: 8,
      font: regular,
      color: rgb(0.45, 0.3, 0.15),
    });
  }

  drawFooter(page, regular, pageNumber, generatedAt);
  return document.save();
}

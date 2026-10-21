/**
 * RFC 4180-style CSV serialisation with spreadsheet formula-injection mitigation.
 * Fields are always quoted when they contain a comma, quote, CR, or LF. Values that
 * begin with a spreadsheet control character are prefixed with an apostrophe so a
 * task title such as "=HYPERLINK(...)" cannot execute when the file is opened.
 */
export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const encode = (value: unknown) => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };

  const lines = [headers, ...rows].map((row) => row.map(encode).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function csvHeaders(filename: string): Record<string, string> {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

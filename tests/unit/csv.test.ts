import { describe, expect, it } from 'vitest';
import { csvHeaders, toCsv } from '../../worker/services/csv';

describe('CSV serialization', () => {
  it('quotes separators, embedded quotes and line breaks', () => {
    const csv = toCsv(
      ['id', 'title', 'notes'],
      [
        ['task_1', 'Telemetry, "parser"', 'line one\nline two'],
        ['task_2', 'Plain title', null],
      ],
    );

    expect(csv).toBe(
      'id,title,notes\r\n' +
      'task_1,"Telemetry, ""parser""","line one\nline two"\r\n' +
      'task_2,Plain title,\r\n',
    );
  });

  it('neutralizes spreadsheet formula-leading values', () => {
    const csv = toCsv(['value'], [['=HYPERLINK("https://example.test")'], ['+1+1'], ['-2-2'], ['@SUM(A1:A2)']]);

    expect(csv).toContain(`"'=HYPERLINK(""https://example.test"")"`);
    expect(csv).toContain(`'+1+1`);
    expect(csv).toContain(`'-2-2`);
    expect(csv).toContain(`'@SUM(A1:A2)`);
  });

  it('returns non-cacheable attachment headers', () => {
    expect(csvHeaders('report.csv')).toMatchObject({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="report.csv"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
  });
});

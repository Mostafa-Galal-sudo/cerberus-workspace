import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '../../src/components/markdown';
import { safeMarkdownUrl } from '../../src/lib/markdown-url';

function render(markdown: string): string {
  return renderToStaticMarkup(<MarkdownRenderer content={markdown} />);
}

describe('safe markdown renderer', () => {
  it('renders headings, lists, fenced code and GFM tables', () => {
    const html = render([
      '# System overview',
      '',
      '- first item',
      '- second item',
      '',
      '```ts',
      'const value = 42;',
      '```',
      '',
      '| Metric | Target |',
      '| --- | --- |',
      '| Latency | 42 ms |',
    ].join('\n'));

    expect(html).toContain('<h1>System overview</h1>');
    expect(html).toContain('<li>first item</li>');
    expect(html).toContain('language-ts');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Metric</th>');
    expect(html).toContain('<td>42 ms</td>');
    expect(html).toContain('markdown-table-scroll');
  });

  it('renders blockquotes and GFM task lists', () => {
    const html = render('> Verification note\n\n- [x] evidence attached\n- [ ] review pending');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
  });

  it('opens external links safely and keeps relative links in place', () => {
    const external = render('[reference](https://example.test/report)');
    expect(external).toContain('target="_blank"');
    expect(external).toContain('rel="noreferrer noopener"');

    const internal = render('[tasks](/tasks)');
    expect(internal).toContain('href="/tasks"');
    expect(internal).not.toContain('target="_blank"');
  });

  it('neutralizes raw HTML and event handlers', () => {
    const html = render([
      '<script>alert("xss")</script>',
      '<iframe src="https://evil.test"></iframe>',
      '<object data="https://evil.test/payload"></object>',
      '<embed src="https://evil.test/payload">',
      '<img src="x" onerror="alert(1)">',
      '<div onclick="alert(1)">click</div>',
    ].join('\n\n'));

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<object');
    expect(html).not.toContain('<embed');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
  });

  it('rejects javascript, data and other unsafe URL schemes', () => {
    const html = render([
      '[javascript](javascript:alert(1))',
      '[data](data:text/html;base64,PHNjcmlwdD4=)',
      '[vbscript](vbscript:msgbox(1))',
    ].join('\n\n'));

    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
    expect(html).not.toContain('vbscript:');
  });

  it('only permits http(s), mail, relative and anchor URLs', () => {
    expect(safeMarkdownUrl('https://example.test')).toBe('https://example.test');
    expect(safeMarkdownUrl('mailto:team@example.test')).toBe('mailto:team@example.test');
    expect(safeMarkdownUrl('/tasks/task_1')).toBe('/tasks/task_1');
    expect(safeMarkdownUrl('#section')).toBe('#section');
    expect(safeMarkdownUrl('javascript:alert(1)')).toBe('');
    expect(safeMarkdownUrl(' data:text/html,<script>')).toBe('');
    expect(safeMarkdownUrl('file:///etc/passwd')).toBe('');
  });
});

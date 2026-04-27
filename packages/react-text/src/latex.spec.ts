import {
  hasLatexBlocks,
  parseLatexBlocks,
  renderLatexTextToHtml,
  renderLatexToString,
} from './latex';

jest.mock('@plait/common', () => ({
  DEFAULT_FONT_FAMILY: 'Arial',
  clearElementSizeCache: jest.fn(),
  measureElement: jest.fn(() => ({ width: 1, height: 1 })),
  updateElementSizeCache: jest.fn(),
}));

describe('latex blocks', () => {
  it('keeps plain text as a text segment', () => {
    expect(parseLatexBlocks('plain text')).toEqual([
      { type: 'text', text: 'plain text', start: 0, end: 10 },
    ]);
    expect(hasLatexBlocks('plain text')).toBe(false);
  });

  it('keeps explicit latex block markers as plain text', () => {
    expect(parseLatexBlocks('A \\latex x^2 \\endlatex B')).toEqual([
      { type: 'text', text: 'A \\latex x^2 \\endlatex B', start: 0, end: 24 },
    ]);
  });

  it('keeps multiline explicit latex blocks as plain text', () => {
    const input = '\\latex x \\endlatex\nand\n\\latex y \\\\ z \\endlatex';
    expect(parseLatexBlocks(input)).toEqual([
      { type: 'text', text: input, start: 0, end: 46 },
    ]);
  });

  it('keeps an unclosed latex block as text', () => {
    expect(parseLatexBlocks('A \\latex x^2')).toEqual([
      { type: 'text', text: 'A \\latex x^2', start: 0, end: 12 },
    ]);
  });

  it('parses common inline latex delimiters', () => {
    expect(parseLatexBlocks('A \\(x^2\\) B')).toEqual([
      { type: 'text', text: 'A ', start: 0, end: 2 },
      {
        type: 'latex',
        displayMode: false,
        formula: 'x^2',
        source: '\\(x^2\\)',
        start: 2,
        end: 9,
      },
      { type: 'text', text: ' B', start: 9, end: 11 },
    ]);
  });

  it('parses common display latex delimiters', () => {
    expect(parseLatexBlocks('A \\[x^2\\] B')).toEqual([
      { type: 'text', text: 'A ', start: 0, end: 2 },
      {
        type: 'latex',
        displayMode: true,
        formula: 'x^2',
        source: '\\[x^2\\]',
        start: 2,
        end: 9,
      },
      { type: 'text', text: ' B', start: 9, end: 11 },
    ]);
  });

  it('keeps dollar-delimited text unchanged for now', () => {
    expect(parseLatexBlocks('A $x$ and $$y$$')).toEqual([
      { type: 'text', text: 'A $x$ and $$y$$', start: 0, end: 15 },
    ]);
  });

  it('renders invalid latex without throwing', () => {
    expect(() => renderLatexToString('\\badcommand{')).not.toThrow();
    expect(renderLatexToString('\\badcommand{')).toContain('katex');
  });

  it('omits marker line breaks around rendered latex blocks', () => {
    const html = renderLatexTextToHtml({
      children: [
        {
          text: 'plain text\n\\[\nE = mc^2\n\\]\nafter text',
        },
      ],
    } as any);
    expect(html.startsWith('plain text<span class="plait-latex-block">')).toBe(
      true
    );
    expect(html.endsWith('</span>after text')).toBe(true);
    expect(html).not.toContain('plain text<br />');
    expect(html).not.toContain('<br />after text');
  });
});

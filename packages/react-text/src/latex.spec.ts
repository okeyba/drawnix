jest.mock('@plait/common', () => ({
  DEFAULT_FONT_FAMILY: 'Arial',
  clearElementSizeCache: jest.fn(),
  measureElement: jest.fn(() => ({ width: 1, height: 1 })),
  updateElementSizeCache: jest.fn(),
}));

import { hasLatexBlocks, parseLatexBlocks, renderLatexToString } from './latex';

describe('latex blocks', () => {
  it('keeps plain text as a text segment', () => {
    expect(parseLatexBlocks('plain text')).toEqual([
      { type: 'text', text: 'plain text', start: 0, end: 10 },
    ]);
    expect(hasLatexBlocks('plain text')).toBe(false);
  });

  it('parses a single latex block', () => {
    expect(parseLatexBlocks('A \\latex x^2 \\endlatex B')).toEqual([
      { type: 'text', text: 'A ', start: 0, end: 2 },
      {
        type: 'latex',
        formula: 'x^2',
        source: '\\latex x^2 \\endlatex',
        start: 2,
        end: 22,
      },
      { type: 'text', text: ' B', start: 22, end: 24 },
    ]);
  });

  it('parses multiple and multiline latex blocks', () => {
    const input = '\\latex x \\endlatex\nand\n\\latex y \\\\ z \\endlatex';
    expect(parseLatexBlocks(input)).toEqual([
      {
        type: 'latex',
        formula: 'x',
        source: '\\latex x \\endlatex',
        start: 0,
        end: 18,
      },
      { type: 'text', text: '\nand\n', start: 18, end: 23 },
      {
        type: 'latex',
        formula: 'y \\\\ z',
        source: '\\latex y \\\\ z \\endlatex',
        start: 23,
        end: 46,
      },
    ]);
  });

  it('keeps an unclosed latex block as text', () => {
    expect(parseLatexBlocks('A \\latex x^2')).toEqual([
      { type: 'text', text: 'A \\latex x^2', start: 0, end: 12 },
    ]);
  });

  it('renders invalid latex without throwing', () => {
    expect(() => renderLatexToString('\\badcommand{')).not.toThrow();
    expect(renderLatexToString('\\badcommand{')).toContain('katex');
  });
});

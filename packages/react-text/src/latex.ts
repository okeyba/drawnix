/// <reference path="./katex.d.ts" />

import {
  DEFAULT_FONT_FAMILY,
  clearElementSizeCache,
  measureElement,
  updateElementSizeCache,
  type ElementSize,
  type ParagraphElement,
} from '@plait/common';
import type { PlaitBoard } from '@plait/core';
import katex from 'katex';
import { Element as SlateElement, Node, Text } from 'slate';

export type LatexTextSegment =
  | {
      type: 'text';
      text: string;
      start: number;
      end: number;
    }
  | {
      type: 'latex';
      displayMode: boolean;
      formula: string;
      source: string;
      start: number;
      end: number;
    };

export type LatexMeasureOptions = {
  fontFamily?: string;
  fontSize?: number;
  maxWidth?: number;
  includeSourceSize?: boolean;
};

export type LatexTextRenderRange = {
  start: number;
  end: number;
};

const DEFAULT_FONT_SIZE = 14;
const DEFAULT_MAX_WIDTH = 10000;

export const parseLatexBlocks = (input: string): LatexTextSegment[] => {
  const segments: LatexTextSegment[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const nextSyntax = findNextLatexSyntax(input, cursor);
    if (!nextSyntax) {
      segments.push({
        type: 'text',
        text: input.slice(cursor),
        start: cursor,
        end: input.length,
      });
      break;
    }

    const { syntax, start } = nextSyntax;
    const contentStart = start + syntax.startToken.length;
    const end = findLatexSyntaxEnd(input, syntax, contentStart);
    if (end === -1) {
      segments.push({
        type: 'text',
        text: input.slice(cursor),
        start: cursor,
        end: input.length,
      });
      break;
    }

    const sourceEnd = end + syntax.endToken.length;
    const source = input.slice(start, sourceEnd);
    const formula = input.slice(contentStart, end).trim();

    if (start > cursor) {
      segments.push({
        type: 'text',
        text: input.slice(cursor, start),
        start: cursor,
        end: start,
      });
    }

    segments.push({
      type: 'latex',
      displayMode: syntax.displayMode,
      formula,
      source,
      start,
      end: sourceEnd,
    });
    cursor = sourceEnd;
  }

  if (!segments.length) {
    return [{ type: 'text', text: '', start: 0, end: 0 }];
  }

  return segments;
};

export const hasLatexBlocks = (input: string) => {
  return parseLatexBlocks(input).some((segment) => segment.type === 'latex');
};

export const hasLatexBlocksInTextElement = (element: Node) => {
  return hasLatexBlocks(Node.string(element));
};

export const renderLatexToString = (formula: string) => {
  return renderLatexFormulaToString(formula, true);
};

export const renderLatexFormulaToString = (
  formula: string,
  displayMode: boolean
) => {
  try {
    return katex.renderToString(formula, {
      displayMode,
      output: 'html',
      strict: false,
      throwOnError: false,
      trust: false,
    });
  } catch {
    return escapeHtml(formula);
  }
};

export const renderLatexTextToHtml = (element: Node) => {
  const segments = parseLatexBlocks(Node.string(element));
  return segments
    .map((segment, index) => {
      if (segment.type === 'latex') {
        const className = segment.displayMode
          ? 'plait-latex-block'
          : 'plait-latex-inline';
        return `<span class="${className}">${renderLatexFormulaToString(
          segment.formula,
          segment.displayMode
        )}</span>`;
      }
      const range = getLatexTextRenderRange(segments, index);
      return escapeHtml(
        segment.text.slice(
          range.start - segment.start,
          range.end - segment.start
        )
      ).replace(/\n/g, '<br />');
    })
    .join('');
};

export const getLatexTextRenderRange = (
  segments: LatexTextSegment[],
  index: number
): LatexTextRenderRange => {
  const segment = segments[index];
  if (!segment || segment.type !== 'text') {
    return {
      start: segment?.start || 0,
      end: segment?.end || 0,
    };
  }

  let start = segment.start;
  let end = segment.end;

  if (isDisplayLatexSegment(segments[index - 1])) {
    start = skipLeadingNewline(segment.text, start);
  }
  if (isDisplayLatexSegment(segments[index + 1])) {
    end = trimTrailingNewline(segment.text, segment.start, end);
  }

  return { start, end };
};

export const isParagraphTextElement = (
  value: unknown
): value is ParagraphElement => {
  if (!isObject(value) || !Array.isArray((value as any).children)) {
    return false;
  }
  return (value as any).children.some(isSlateTextChild);
};

export const findTextElements = (value: unknown): ParagraphElement[] => {
  const elements: ParagraphElement[] = [];
  const visited = new WeakSet<object>();

  const visit = (node: unknown) => {
    if (!isObject(node) || visited.has(node)) {
      return;
    }
    visited.add(node);

    if (isParagraphTextElement(node)) {
      elements.push(node);
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    Object.values(node).forEach(visit);
  };

  visit(value);
  return elements;
};

export const findLatexTextElements = (value: unknown): ParagraphElement[] => {
  return findTextElements(value).filter(hasLatexBlocksInTextElement);
};

export const measureLatexTextElement = (
  element: Node,
  options: LatexMeasureOptions = {}
): ElementSize | null => {
  if (
    typeof document === 'undefined' ||
    !hasLatexBlocksInTextElement(element)
  ) {
    return null;
  }

  const fontSize = options.fontSize || DEFAULT_FONT_SIZE;
  const maxWidth = options.maxWidth || DEFAULT_MAX_WIDTH;
  const container = document.createElement('div');
  container.className = 'plait-text-container plait-latex-text-container';
  container.style.position = 'absolute';
  container.style.left = '-10000px';
  container.style.top = '-10000px';
  container.style.visibility = 'hidden';
  container.style.pointerEvents = 'none';
  container.style.whiteSpace = 'pre-wrap';
  container.style.wordBreak = 'break-word';
  container.style.maxWidth = `${maxWidth}px`;
  container.style.fontFamily = options.fontFamily || DEFAULT_FONT_FAMILY;
  container.style.fontSize = `${fontSize}px`;
  container.style.lineHeight = fontSize === DEFAULT_FONT_SIZE ? '20px' : '1.5';
  container.innerHTML = renderLatexTextToHtml(element);

  document.body.appendChild(container);
  const rect = container.getBoundingClientRect();
  const size = {
    width: Math.ceil(
      Math.min(Math.max(rect.width, container.scrollWidth), maxWidth)
    ),
    height: Math.ceil(Math.max(rect.height, container.scrollHeight)),
  };
  container.remove();
  return size;
};

export const cacheLatexTextElementSize = (
  board: PlaitBoard | null,
  element: ParagraphElement,
  options: LatexMeasureOptions = {}
) => {
  clearElementSizeCache(board, element);
  if (!hasLatexBlocksInTextElement(element)) {
    return false;
  }

  const latexSize = measureLatexTextElement(element, options);
  if (!latexSize) {
    return false;
  }

  let size = latexSize;
  if (options.includeSourceSize) {
    const sourceSize = measureElement(
      board,
      element,
      {
        fontFamily: options.fontFamily || DEFAULT_FONT_FAMILY,
        fontSize: options.fontSize || DEFAULT_FONT_SIZE,
      },
      options.maxWidth || DEFAULT_MAX_WIDTH
    );
    size = {
      width: Math.max(latexSize.width, sourceSize.width),
      height: Math.max(latexSize.height, sourceSize.height),
    };
  }

  updateElementSizeCache(board, element, size);
  return true;
};

const escapeHtml = (input: string) => {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

type LatexSyntax = {
  displayMode: boolean;
  endToken: string;
  kind: 'display-bracket' | 'inline-paren';
  startToken: string;
};

const LATEX_SYNTAXES: LatexSyntax[] = [
  {
    displayMode: true,
    endToken: '\\]',
    kind: 'display-bracket',
    startToken: '\\[',
  },
  {
    displayMode: false,
    endToken: '\\)',
    kind: 'inline-paren',
    startToken: '\\(',
  },
];

const findNextLatexSyntax = (input: string, cursor: number) => {
  return LATEX_SYNTAXES.map((syntax) => ({
    start: findLatexSyntaxStart(input, syntax, cursor),
    syntax,
  }))
    .filter((value) => value.start !== -1)
    .sort((a, b) => a.start - b.start)[0];
};

const findLatexSyntaxStart = (
  input: string,
  syntax: LatexSyntax,
  cursor: number
) => {
  return findUnescapedToken(input, syntax.startToken, cursor);
};

const findLatexSyntaxEnd = (
  input: string,
  syntax: LatexSyntax,
  cursor: number
) => {
  return findUnescapedToken(input, syntax.endToken, cursor);
};

const findUnescapedToken = (input: string, token: string, cursor: number) => {
  let index = input.indexOf(token, cursor);
  while (index !== -1 && isEscaped(input, index)) {
    index = input.indexOf(token, index + token.length);
  }
  return index;
};

const isEscaped = (input: string, index: number) => {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && input[i] === '\\'; i--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
};

const isDisplayLatexSegment = (
  segment: LatexTextSegment | undefined
): segment is Extract<LatexTextSegment, { type: 'latex' }> => {
  return segment?.type === 'latex' && segment.displayMode;
};

const skipLeadingNewline = (text: string, start: number) => {
  if (text.startsWith('\r\n')) {
    return start + 2;
  }
  if (text.startsWith('\n') || text.startsWith('\r')) {
    return start + 1;
  }
  return start;
};

const trimTrailingNewline = (
  text: string,
  segmentStart: number,
  end: number
) => {
  if (text.endsWith('\r\n')) {
    return Math.max(segmentStart, end - 2);
  }
  if (text.endsWith('\n') || text.endsWith('\r')) {
    return Math.max(segmentStart, end - 1);
  }
  return end;
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isSlateTextChild = (value: unknown) => {
  if (Text.isText(value)) {
    return true;
  }
  return (
    SlateElement.isElement(value) &&
    (value as any).type === 'link' &&
    Array.isArray((value as any).children)
  );
};

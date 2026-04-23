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

export const LATEX_BLOCK_START = '\\latex';
export const LATEX_BLOCK_END = '\\endlatex';

export type LatexTextSegment =
  | {
      type: 'text';
      text: string;
      start: number;
      end: number;
    }
  | {
      type: 'latex';
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

const DEFAULT_FONT_SIZE = 14;
const DEFAULT_MAX_WIDTH = 10000;

export const parseLatexBlocks = (input: string): LatexTextSegment[] => {
  const segments: LatexTextSegment[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const start = input.indexOf(LATEX_BLOCK_START, cursor);
    if (start === -1) {
      segments.push({
        type: 'text',
        text: input.slice(cursor),
        start: cursor,
        end: input.length,
      });
      break;
    }

    const contentStart = start + LATEX_BLOCK_START.length;
    const end = input.indexOf(LATEX_BLOCK_END, contentStart);
    if (end === -1) {
      segments.push({
        type: 'text',
        text: input.slice(cursor),
        start: cursor,
        end: input.length,
      });
      break;
    }

    if (start > cursor) {
      segments.push({
        type: 'text',
        text: input.slice(cursor, start),
        start: cursor,
        end: start,
      });
    }

    const sourceEnd = end + LATEX_BLOCK_END.length;
    segments.push({
      type: 'latex',
      formula: input.slice(contentStart, end).trim(),
      source: input.slice(start, sourceEnd),
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
  try {
    return katex.renderToString(formula, {
      displayMode: true,
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
  return parseLatexBlocks(Node.string(element))
    .map((segment) => {
      if (segment.type === 'latex') {
        return `<span class="plait-latex-block">${renderLatexToString(
          segment.formula
        )}</span>`;
      }
      return escapeHtml(segment.text).replace(/\n/g, '<br />');
    })
    .join('');
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

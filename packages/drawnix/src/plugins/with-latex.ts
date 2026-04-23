import { DEFAULT_FONT_FAMILY, type ParagraphElement } from '@plait/common';
import { PlaitBoard, type PlaitElement, type PlaitPlugin } from '@plait/core';
import {
  MindElement,
  NodeSpace,
  getDefaultFontSizeForMindElement,
} from '@plait/mind';
import {
  cacheLatexTextElementSize,
  findTextElements,
} from '@plait-board/react-text';

export const cacheLatexElementSizes = (
  board: PlaitBoard,
  elements: PlaitElement[] = board.children
) => {
  const includeSourceSize = PlaitBoard.hasBeenTextEditing(board);
  elements.forEach((element) => {
    cacheLatexElementSize(board, element, includeSourceSize);
  });
};

export const withLatexBlockRendering: PlaitPlugin = (board) => {
  cacheLatexElementSizes(board);

  const { apply } = board;
  board.apply = (operation) => {
    apply(operation);
    cacheLatexElementSizes(board);
  };

  return board;
};

const cacheLatexElementSize = (
  board: PlaitBoard,
  element: PlaitElement,
  includeSourceSize: boolean
) => {
  if (MindElement.isMindElement(board, element)) {
    cacheMindElementLatexSize(board, element, includeSourceSize);
    element.children.forEach((child) =>
      cacheLatexElementSize(board, child, includeSourceSize)
    );
    return;
  }

  findTextElements(element).forEach((textElement) => {
    cacheDefaultLatexSize(board, textElement, includeSourceSize);
  });
};

const cacheMindElementLatexSize = (
  board: PlaitBoard,
  element: MindElement,
  includeSourceSize: boolean
) => {
  cacheLatexTextElementSize(board, element.data.topic, {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: getDefaultFontSizeForMindElement(element),
    includeSourceSize,
    maxWidth: NodeSpace.getTopicMaxDynamicWidth(board as any, element),
  });
};

const cacheDefaultLatexSize = (
  board: PlaitBoard,
  textElement: ParagraphElement,
  includeSourceSize: boolean
) => {
  cacheLatexTextElementSize(board, textElement, {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 14,
    includeSourceSize,
  });
};

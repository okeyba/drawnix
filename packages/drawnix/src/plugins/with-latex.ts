import {
  DEFAULT_FONT_FAMILY,
  getTextManages,
  type ParagraphElement,
  type TextManage,
} from '@plait/common';
import {
  PlaitBoard,
  type ClipboardData,
  type PlaitElement,
  type PlaitPlugin,
  type Point,
  type WritableClipboardOperationType,
} from '@plait/core';
import { DrawTransforms, PlaitDrawElement } from '@plait/draw';
import {
  MindElement,
  NodeSpace,
  getDefaultFontSizeForMindElement,
} from '@plait/mind';
import {
  cacheLatexTextElementSize,
  findTextElements,
  hasLatexBlocksInTextElement,
  measureLatexTextElement,
} from '@plait-board/react-text';

const PATCHED_TEXT_MANAGES = new WeakSet<TextManage>();

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
  scheduleTextManageBinding(board);

  const { apply, insertFragment } = board;
  board.apply = (operation) => {
    apply(operation);
    cacheLatexElementSizes(board);
    scheduleTextManageBinding(board);
  };

  board.insertFragment = (
    clipboardData: ClipboardData | null,
    targetPoint: Point,
    operationType?: WritableClipboardOperationType
  ) => {
    insertFragment(clipboardData, targetPoint, operationType);
    schedulePostInsertRefresh(board);
  };

  return board;
};

const cacheLatexElementSize = (
  board: PlaitBoard,
  element: PlaitElement,
  includeSourceSize: boolean
) => {
  bindLatexTextManageExit(board, element);

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

const scheduleTextManageBinding = (board: PlaitBoard) => {
  setTimeout(() => {
    board.children.forEach((element) => {
      bindLatexTextManageExit(board, element);
    });
  }, 0);
};

const schedulePostInsertRefresh = (board: PlaitBoard) => {
  setTimeout(() => {
    refreshRenderedLatexElements(board, board.children);
  }, 0);
};

const updateTextManageRectangles = (
  board: PlaitBoard,
  elements: PlaitElement[]
) => {
  elements.forEach((element) => {
    getTextManages(element).forEach((textManage) =>
      textManage.updateRectangle()
    );

    if (MindElement.isMindElement(board, element)) {
      updateTextManageRectangles(board, element.children);
    }
  });
};

const bindLatexTextManageExit = (board: PlaitBoard, element: PlaitElement) => {
  getTextManages(element).forEach((textManage) => {
    if (PATCHED_TEXT_MANAGES.has(textManage)) {
      return;
    }

    const edit = textManage.edit.bind(textManage);
    textManage.edit = (callback, exitEdit) => {
      prepareLatexTextManageEdit(board, element);
      return edit(() => {
        callback?.();
        schedulePostEditRefresh(board, element);
      }, exitEdit);
    };
    PATCHED_TEXT_MANAGES.add(textManage);
  });

  if (MindElement.isMindElement(board, element)) {
    element.children.forEach((child) => bindLatexTextManageExit(board, child));
  }
};

const prepareLatexTextManageEdit = (
  board: PlaitBoard,
  editedElement: PlaitElement
) => {
  const element = findCurrentElement(board, editedElement);
  if (!element) {
    return;
  }

  cacheLatexElementSize(board, element, true);
  updateTextManageRectangles(board, [element]);
};

const schedulePostEditRefresh = (
  board: PlaitBoard,
  editedElement: PlaitElement
) => {
  setTimeout(() => {
    const element = findCurrentElement(board, editedElement);
    if (!element) {
      return;
    }

    refreshRenderedLatexElements(board, [element]);
  }, 0);
};

const refreshRenderedLatexElements = (
  board: PlaitBoard,
  elements: PlaitElement[]
) => {
  cacheRenderedLatexElementSizes(board, elements);
  resizeAutoSizeTextElements(board, elements);
  updateTextManageRectangles(board, elements);
};

const cacheRenderedLatexElementSizes = (
  board: PlaitBoard,
  elements: PlaitElement[]
) => {
  elements.forEach((element) => {
    cacheLatexElementSize(board, element, false);
  });
};

const resizeAutoSizeTextElements = (
  board: PlaitBoard,
  elements: PlaitElement[]
) => {
  elements.forEach((element) => {
    resizeAutoSizeTextElement(board, element);

    if (MindElement.isMindElement(board, element)) {
      resizeAutoSizeTextElements(board, element.children);
    }
  });
};

const resizeAutoSizeTextElement = (
  board: PlaitBoard,
  element: PlaitElement
) => {
  if (
    !PlaitDrawElement.isText(element) ||
    !element.autoSize ||
    !element.text ||
    !hasLatexBlocksInTextElement(element.text)
  ) {
    return;
  }

  const text = element.text;
  const size = measureLatexTextElement(text, {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 14,
  });
  if (size) {
    DrawTransforms.setTextSize(board, element, size.width, size.height);
  }
};

const findCurrentElement = (
  board: PlaitBoard,
  target: PlaitElement
): PlaitElement | null => {
  const targetId = target.id;
  if (!targetId) {
    return target;
  }

  let matchedElement: PlaitElement | null = null;
  const visit = (elements: PlaitElement[]) => {
    for (const element of elements) {
      if (element.id === targetId) {
        matchedElement = element;
        return;
      }
      if (MindElement.isMindElement(board, element)) {
        visit(element.children);
        if (matchedElement) {
          return;
        }
      }
    }
  };

  visit(board.children);
  return matchedElement;
};

const cacheMindElementLatexSize = (
  board: PlaitBoard,
  element: MindElement,
  _includeSourceSize: boolean
) => {
  cacheMindTopicLatexSize(board, element, element.data.topic, false);
};

const cacheMindTopicLatexSize = (
  board: PlaitBoard,
  element: MindElement,
  topic: ParagraphElement,
  includeSourceSize: boolean
) => {
  cacheLatexTextElementSize(board, topic, {
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

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
const BOARDS_WITH_LATEX_CACHE = new WeakSet<PlaitBoard>();
const PENDING_LATEX_SIZE_CACHES = new WeakSet<PlaitBoard>();
const PENDING_TEXT_MANAGE_BINDINGS = new WeakSet<PlaitBoard>();

export const cacheLatexElementSizes = (
  board: PlaitBoard,
  elements: PlaitElement[] = board.children
) => {
  const includeSourceSize = PlaitBoard.hasBeenTextEditing(board);
  const shouldClearMissingLatex = BOARDS_WITH_LATEX_CACHE.has(board);
  let hasLatex = false;
  elements.forEach((element) => {
    hasLatex =
      cacheLatexElementSize(
        board,
        element,
        includeSourceSize,
        shouldClearMissingLatex
      ) || hasLatex;
  });
  if (elements === board.children) {
    if (hasLatex) {
      BOARDS_WITH_LATEX_CACHE.add(board);
    } else {
      BOARDS_WITH_LATEX_CACHE.delete(board);
    }
  }
  return hasLatex;
};

export const withLatexBlockRendering: PlaitPlugin = (board) => {
  cacheLatexElementSizes(board);
  scheduleTextManageBinding(board);

  const { apply, insertFragment } = board;
  board.apply = (operation) => {
    apply(operation);
    scheduleLatexElementSizeCaching(board);
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
  includeSourceSize: boolean,
  shouldClearMissingLatex: boolean
) => {
  bindLatexTextManageExit(board, element);

  if (MindElement.isMindElement(board, element)) {
    let hasLatex = cacheMindElementLatexSize(
      board,
      element,
      includeSourceSize,
      shouldClearMissingLatex
    );
    element.children.forEach((child) =>
      (hasLatex =
        cacheLatexElementSize(
          board,
          child,
          includeSourceSize,
          shouldClearMissingLatex
        ) || hasLatex)
    );
    return hasLatex;
  }

  let hasLatex = false;
  findTextElements(element).forEach((textElement) => {
    if (
      hasLatexBlocksInTextElement(textElement) ||
      shouldClearMissingLatex
    ) {
      hasLatex =
        cacheDefaultLatexSize(board, textElement, includeSourceSize) ||
        hasLatex;
    }
  });
  return hasLatex;
};

const scheduleLatexElementSizeCaching = (board: PlaitBoard) => {
  if (PENDING_LATEX_SIZE_CACHES.has(board)) {
    return;
  }

  PENDING_LATEX_SIZE_CACHES.add(board);
  setTimeout(() => {
    PENDING_LATEX_SIZE_CACHES.delete(board);
    cacheLatexElementSizes(board);
  }, 0);
};

const scheduleTextManageBinding = (board: PlaitBoard) => {
  if (PENDING_TEXT_MANAGE_BINDINGS.has(board)) {
    return;
  }

  PENDING_TEXT_MANAGE_BINDINGS.add(board);
  setTimeout(() => {
    PENDING_TEXT_MANAGE_BINDINGS.delete(board);
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

  cacheLatexElementSize(
    board,
    element,
    true,
    BOARDS_WITH_LATEX_CACHE.has(board)
  );
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
    cacheLatexElementSize(
      board,
      element,
      false,
      BOARDS_WITH_LATEX_CACHE.has(board)
    );
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
  _includeSourceSize: boolean,
  shouldClearMissingLatex: boolean
) => {
  if (
    hasLatexBlocksInTextElement(element.data.topic) ||
    shouldClearMissingLatex
  ) {
    return cacheMindTopicLatexSize(board, element, element.data.topic, false);
  }
  return false;
};

const cacheMindTopicLatexSize = (
  board: PlaitBoard,
  element: MindElement,
  topic: ParagraphElement,
  includeSourceSize: boolean
) => {
  return cacheLatexTextElementSize(board, topic, {
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
  return cacheLatexTextElementSize(board, textElement, {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 14,
    includeSourceSize,
  });
};

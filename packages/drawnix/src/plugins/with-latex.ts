import {
  DEFAULT_FONT_FAMILY,
  getTextManages,
  type ParagraphElement,
  type TextManage,
} from '@plait/common';
import {
  PlaitBoard,
  RectangleClient,
  type ClipboardData,
  type PlaitElement,
  type PlaitPlugin,
  type Point,
  type WritableClipboardOperationType,
} from '@plait/core';
import {
  DrawTransforms,
  MIN_TEXT_WIDTH,
  PlaitDrawElement,
  ShapeDefaultSpace,
} from '@plait/draw';
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
  parseLatexBlocks,
} from '@plait-board/react-text';
import { Node } from 'slate';

const PATCHED_TEXT_MANAGES = new WeakSet<TextManage>();
const BOARDS_WITH_LATEX_CACHE = new WeakSet<PlaitBoard>();
const PENDING_LATEX_SIZE_CACHES = new WeakSet<PlaitBoard>();
const PENDING_TEXT_MANAGE_BINDINGS = new WeakSet<PlaitBoard>();
const PENDING_TEXT_MANAGE_EXIT_REFRESHES = new WeakSet<TextManage>();
const BOARDS_UPDATING_LATEX_TEXT_SIZE = new WeakSet<PlaitBoard>();

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
    const shouldScheduleLatexRefresh =
      !BOARDS_UPDATING_LATEX_TEXT_SIZE.has(board);
    apply(operation);
    if (shouldScheduleLatexRefresh) {
      scheduleLatexElementSizeCaching(board);
    }
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
    element.children.forEach(
      (child) =>
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
    if (hasLatexBlocksInTextElement(textElement) || shouldClearMissingLatex) {
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
    refreshLatexElementsAfterApply(board);
  }, 0);
};

const refreshLatexElementsAfterApply = (board: PlaitBoard) => {
  const isTextEditing = PlaitBoard.hasBeenTextEditing(board);
  cacheLatexElementSizes(board);
  if (!isTextEditing) {
    resizeAutoSizeTextElements(board, board.children);
  }
  updateTextManageRectangles(board, board.children);
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
      const exit = edit(callback, (event) => {
        return (
          Boolean(exitEdit?.(event)) ||
          shouldExitStandaloneLatexTextEdit(textManage, event)
        );
      });
      scheduleActiveTextManageExitRefresh(board, element, textManage);
      return exit;
    };
    PATCHED_TEXT_MANAGES.add(textManage);
    scheduleActiveTextManageExitRefresh(board, element, textManage);
  });

  if (MindElement.isMindElement(board, element)) {
    element.children.forEach((child) => bindLatexTextManageExit(board, child));
  }
};

const scheduleActiveTextManageExitRefresh = (
  board: PlaitBoard,
  editedElement: PlaitElement,
  textManage: TextManage
) => {
  // TextManage invokes its callback before readonly rendering is restored, so
  // wait for the edit session to fully close before measuring rendered LaTeX.
  if (
    !textManage.isEditing ||
    PENDING_TEXT_MANAGE_EXIT_REFRESHES.has(textManage)
  ) {
    return;
  }

  PENDING_TEXT_MANAGE_EXIT_REFRESHES.add(textManage);
  const refreshWhenEditExits = () => {
    if (textManage.isEditing) {
      setTimeout(refreshWhenEditExits, 16);
      return;
    }

    PENDING_TEXT_MANAGE_EXIT_REFRESHES.delete(textManage);
    schedulePostEditRefresh(board, editedElement);
  };
  setTimeout(refreshWhenEditExits, 16);
};

const shouldExitStandaloneLatexTextEdit = (
  textManage: TextManage,
  event: Event
) => {
  if (
    typeof KeyboardEvent === 'undefined' ||
    !(event instanceof KeyboardEvent) ||
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return false;
  }

  const text = textManage.getText();
  if (!hasLatexBlocksInTextElement(text)) {
    return false;
  }

  return parseLatexBlocks(Node.string(text)).every(
    (segment) => segment.type === 'latex' || segment.text.trim() === ''
  );
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
  if (
    size &&
    !hasCurrentAutoSizeTextElementSize(element, size.width, size.height)
  ) {
    BOARDS_UPDATING_LATEX_TEXT_SIZE.add(board);
    try {
      DrawTransforms.setTextSize(board, element, size.width, size.height);
    } finally {
      BOARDS_UPDATING_LATEX_TEXT_SIZE.delete(board);
    }
  }
};

const hasCurrentAutoSizeTextElementSize = (
  element: PlaitElement,
  width: number,
  height: number
) => {
  if (!PlaitDrawElement.isText(element)) {
    return false;
  }

  const rectangle = RectangleClient.getRectangleByPoints(element.points);
  const targetWidth =
    Math.max(width, MIN_TEXT_WIDTH) + ShapeDefaultSpace.rectangleAndText * 2;
  return (
    Math.abs(rectangle.width - targetWidth) < 1 &&
    Math.abs(rectangle.height - height) < 1
  );
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

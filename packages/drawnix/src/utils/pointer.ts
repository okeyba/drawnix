import {
  BoardTransforms,
  PlaitPointerType,
  Transforms,
  type PlaitBoard,
} from '@plait/core';

export const updateDrawnixPointer = (board: PlaitBoard, pointer: string) => {
  if (board.pointer === pointer) {
    return;
  }

  if (pointer === PlaitPointerType.hand && board.selection !== null) {
    Transforms.setSelection(board, null);
  }

  BoardTransforms.updatePointerType(board, pointer);
};

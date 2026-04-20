const mockSetSelection = jest.fn();
const mockUpdatePointerType = jest.fn();

jest.mock('@plait/core', () => ({
  BoardTransforms: {
    updatePointerType: (...args: unknown[]) => mockUpdatePointerType(...args),
  },
  PlaitPointerType: {
    hand: 'hand',
    selection: 'selection',
  },
  Transforms: {
    setSelection: (...args: unknown[]) => mockSetSelection(...args),
  },
}));

import { updateDrawnixPointer } from './pointer';

describe('updateDrawnixPointer', () => {
  beforeEach(() => {
    mockSetSelection.mockClear();
    mockUpdatePointerType.mockClear();
  });

  it('clears selection before switching to the hand tool', () => {
    const board = {
      pointer: 'selection',
      selection: { anchor: [0, 0], focus: [1, 1] },
    } as any;

    updateDrawnixPointer(board, 'hand');

    expect(mockSetSelection).toHaveBeenCalledWith(board, null);
    expect(mockUpdatePointerType).toHaveBeenCalledWith(board, 'hand');
    expect(mockSetSelection.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdatePointerType.mock.invocationCallOrder[0]
    );
  });

  it('does not clear selection when switching to the selection tool', () => {
    const board = {
      pointer: 'hand',
      selection: { anchor: [0, 0], focus: [1, 1] },
    } as any;

    updateDrawnixPointer(board, 'selection');

    expect(mockSetSelection).not.toHaveBeenCalled();
    expect(mockUpdatePointerType).toHaveBeenCalledWith(board, 'selection');
  });

  it('returns early when the pointer is already active', () => {
    const board = {
      pointer: 'hand',
      selection: null,
    } as any;

    updateDrawnixPointer(board, 'hand');

    expect(mockSetSelection).not.toHaveBeenCalled();
    expect(mockUpdatePointerType).not.toHaveBeenCalled();
  });
});

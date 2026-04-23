jest.mock('@plait/common', () => ({
  DEFAULT_FONT_FAMILY: 'Arial',
  clearElementSizeCache: jest.fn(),
  measureElement: jest.fn(() => ({ width: 1, height: 1 })),
  updateElementSizeCache: jest.fn(),
}));

jest.mock('@plait/text-plugins', () => ({
  isUrl: jest.fn(() => false),
  LinkEditor: {
    isLinkActive: jest.fn(() => false),
    unwrapLink: jest.fn(),
    wrapLink: jest.fn(),
  },
}));

import { render } from '@testing-library/react';

import { Text } from './text';
import { Element } from 'slate';

describe('Text', () => {
  it('should render successfully', () => {
    // const ele: Element = { children: [{ text: '' }], type: 'paragraph' };
    // const { baseElement } = render(<Text text={ele} board={{} as any} />);
    // expect(baseElement).toBeTruthy();
  });

  it('renders latex blocks in readonly text', () => {
    const ele: Element = {
      children: [{ text: '\\latex x^2 \\endlatex' }],
      type: 'paragraph',
    };
    const { container } = render(<Text text={ele} board={{} as any} />);
    expect(container.querySelector('.katex')).toBeTruthy();
  });

  it('keeps latex source visible while editing', () => {
    const ele: Element = {
      children: [{ text: '\\latex x^2 \\endlatex' }],
      type: 'paragraph',
    };
    const { container } = render(
      <Text text={ele} board={{} as any} readonly={false} />
    );
    expect(container.querySelector('.katex')).toBeFalsy();
    expect(container.textContent).toContain('\\latex x^2 \\endlatex');
  });
});

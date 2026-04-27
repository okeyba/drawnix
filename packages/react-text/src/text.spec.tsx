import { render } from '@testing-library/react';
import { Element } from 'slate';

import { Text } from './text';

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

describe('Text', () => {
  it('should render successfully', () => {
    // const ele: Element = { children: [{ text: '' }], type: 'paragraph' };
    // const { baseElement } = render(<Text text={ele} board={{} as any} />);
    // expect(baseElement).toBeTruthy();
  });

  it('renders latex blocks in readonly text', () => {
    const ele: Element = {
      children: [{ text: '\\[x^2\\]' }],
      type: 'paragraph',
    };
    const { container } = render(<Text text={ele} board={{} as any} />);
    expect(container.querySelector('.katex')).toBeTruthy();
  });

  it('uses marks from the leaf containing a latex segment', () => {
    const ele: Element = {
      children: [
        { text: 'before ', 'font-size': 12 },
        { text: '\\(x^2\\)', 'font-size': 28 },
      ],
      type: 'paragraph',
    } as any;
    const { container } = render(<Text text={ele} board={{} as any} />);
    const latex = container.querySelector(
      '.plait-latex-inline'
    ) as HTMLElement;

    expect(latex.style.fontSize).toBe('28px');
  });

  it('preserves link markup while rendering latex text', () => {
    const ele: Element = {
      children: [
        {
          children: [{ text: 'link' }],
          type: 'link',
          url: 'https://example.com',
        },
        { text: ' \\(x\\)' },
      ],
      type: 'paragraph',
    } as any;
    const { container } = render(<Text text={ele} board={{} as any} />);
    const link = container.querySelector('a') as HTMLElement;

    expect(link.className).toBe('plait-board-link');
    expect(link.getAttribute('data-url')).toBe('https://example.com');
    expect(link.getAttribute('href')).toBe('https://example.com');
  });

  it('keeps latex source visible while editing', () => {
    const ele: Element = {
      children: [{ text: '\\[x^2\\]' }],
      type: 'paragraph',
    };
    const { container } = render(
      <Text text={ele} board={{} as any} readonly={false} />
    );
    expect(container.querySelector('.katex')).toBeFalsy();
    expect(container.textContent).toContain('\\[x^2\\]');
  });

  it('does not render explicit latex block markers', () => {
    const ele: Element = {
      children: [{ text: '\\latex x^2 \\endlatex' }],
      type: 'paragraph',
    };
    const { container } = render(<Text text={ele} board={{} as any} />);
    expect(container.querySelector('.katex')).toBeFalsy();
    expect(container.textContent).toContain('\\latex x^2 \\endlatex');
  });

  it('copies latex source instead of rendered katex text', () => {
    const ele: Element = {
      children: [
        {
          text: 'Before\n\\[\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n\\]\nAfter',
        },
      ],
      type: 'paragraph',
    };
    const { container } = render(<Text text={ele} board={{} as any} />);
    const latexContainer = container.querySelector(
      '.plait-latex-text-container'
    );
    const setData = jest.fn();
    const selection = {
      anchorNode: latexContainer?.firstChild,
      focusNode: latexContainer?.firstChild,
      isCollapsed: false,
      toString: () => 'Before rendered formula After',
    };
    jest.spyOn(window, 'getSelection').mockReturnValue(selection as any);

    const event = new Event('copy', {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { setData },
    });
    document.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith(
      'text/plain',
      (ele.children[0] as any).text
    );
    expect(setData).toHaveBeenCalledWith(
      'text/html',
      expect.stringContaining('\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}')
    );
  });
});

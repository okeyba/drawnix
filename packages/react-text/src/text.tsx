import {
  createEditor,
  type Descendant,
  Element as SlateElement,
  Node,
  Range,
  Text as SlateText,
  Transforms,
} from 'slate';
import { isKeyHotkey } from 'is-hotkey';
import {
  Editable,
  RenderElementProps,
  RenderLeafProps,
  Slate,
  withReact,
} from 'slate-react';
import {
  type CustomElement,
  type CustomText,
  type LinkElement,
  type ParagraphElement,
  type TextProps,
} from '@plait/common';
import React, {
  useMemo,
  useCallback,
  useEffect,
  CSSProperties,
  useRef,
} from 'react';
import { withHistory } from 'slate-history';
import { isUrl, LinkEditor } from '@plait/text-plugins';
import { withText } from './plugins/with-text';
import { CustomEditor, RenderElementPropsFor } from './custom-types';

import './styles/index.scss';
import { LinkComponent, withInlineLink } from './plugins/with-link';
import {
  getLatexTextRenderRange,
  hasLatexBlocksInTextElement,
  parseLatexBlocks,
  renderLatexFormulaToString,
} from './latex';
import 'katex/dist/katex.min.css';

export type TextComponentProps = TextProps;

export const Text: React.FC<TextComponentProps> = (
  props: TextComponentProps
) => {
  const { text, readonly, onChange, onComposition, afterInit } = props;

  const isReadonly = readonly === undefined ? true : readonly;
  const editableRef = useRef<HTMLDivElement | null>(null);
  const shouldRenderLatex = isReadonly && hasLatexBlocksInTextElement(text);

  const renderLeaf = useCallback(
    (props: RenderLeafProps) => <Leaf {...props} />,
    []
  );

  const initialValue: Descendant[] = [text];

  const editor = useMemo(() => {
    const editor = withInlineLink(
      withText(withHistory(withReact(createEditor())))
    );
    afterInit && afterInit(editor);
    return editor;
  }, []);

  useEffect(() => {
    if (text === editor.children[0]) {
      return;
    }
    editor.children = [text];
    editor.onChange();
  }, [text, editor]);

  useEffect(() => {
    if (!shouldRenderLatex) {
      return;
    }

    const handleCopy = (event: ClipboardEvent) => {
      if (!editableRef.current || !isDomSelectionInside(editableRef.current)) {
        return;
      }

      writePlainTextClipboard(event.clipboardData, Node.string(text));
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener('copy', handleCopy, true);
    document.addEventListener('cut', handleCopy, true);
    return () => {
      document.removeEventListener('copy', handleCopy, true);
      document.removeEventListener('cut', handleCopy, true);
    };
  }, [shouldRenderLatex, text]);

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    const { selection } = editor;

    // Default left/right behavior is unit:'character'.
    // This fails to distinguish between two cursor positions, such as
    // <inline>foo<cursor/></inline> vs <inline>foo</inline><cursor/>.
    // Here we modify the behavior to unit:'offset'.
    // This lets the user step into and out of the inline without stepping over characters.
    // You may wish to customize this further to only use unit:'offset' in specific cases.
    if (selection && Range.isCollapsed(selection)) {
      const { nativeEvent } = event;
      if (isKeyHotkey('left', nativeEvent)) {
        event.preventDefault();
        Transforms.move(editor, { unit: 'offset', reverse: true });
        return;
      }
      if (isKeyHotkey('right', nativeEvent)) {
        event.preventDefault();
        Transforms.move(editor, { unit: 'offset' });
        return;
      }
    }
  };

  return (
    <Slate
      editor={editor}
      initialValue={initialValue}
      onChange={(value: Descendant[]) => {
        onChange &&
          onChange({
            newText: editor.children[0] as ParagraphElement,
            operations: editor.operations,
          });
      }}
    >
      <Editable
        ref={editableRef}
        className="slate-editable-container plait-text-container"
        renderElement={(props) => (
          <Element {...props} renderLatex={isReadonly} />
        )}
        renderLeaf={renderLeaf}
        readOnly={isReadonly}
        onCompositionStart={(event) => {
          if (onComposition) {
            onComposition(event as unknown as CompositionEvent);
          }
        }}
        onCompositionUpdate={(event) => {
          if (onComposition) {
            onComposition(event as unknown as CompositionEvent);
          }
        }}
        onCompositionEnd={(event) => {
          if (onComposition) {
            onComposition(event as unknown as CompositionEvent);
          }
        }}
        onKeyDown={onKeyDown}
      />
    </Slate>
  );
};

const Element = (
  props: RenderElementProps & {
    renderLatex: boolean;
  }
) => {
  const { attributes, children, element } = props as RenderElementPropsFor<
    CustomElement & { type: string }
  > & {
    renderLatex: boolean;
  };
  switch (element.type) {
    case 'link':
      return (
        <LinkComponent {...(props as RenderElementPropsFor<LinkElement>)} />
      );
    default:
      return (
        <ParagraphComponent
          {...(props as RenderElementPropsFor<ParagraphElement>)}
          renderLatex={props.renderLatex}
        />
      );
  }
};

const ParagraphComponent = ({
  attributes,
  children,
  element,
  renderLatex,
}: RenderElementPropsFor<ParagraphElement> & { renderLatex: boolean }) => {
  const style = { textAlign: element.align } as CSSProperties;
  const shouldRenderLatex = renderLatex && hasLatexBlocksInTextElement(element);
  return (
    <div style={style} {...attributes}>
      {shouldRenderLatex ? (
        <>
          <LatexTextContent element={element} />
          <span hidden>{children}</span>
        </>
      ) : (
        children
      )}
    </div>
  );
};

const Leaf: React.FC<RenderLeafProps> = ({ children, leaf, attributes }) => {
  if ((leaf as CustomText).bold) {
    children = <strong>{children}</strong>;
  }

  if ((leaf as CustomText).code) {
    children = <code>{children}</code>;
  }

  if ((leaf as CustomText).italic) {
    children = <em>{children}</em>;
  }

  if ((leaf as CustomText).underlined) {
    children = <u>{children}</u>;
  }

  const fontSizeValue = (leaf as CustomText)['font-size'];
  const style: CSSProperties = {
    color: (leaf as CustomText).color,
  };

  return (
    <span
      style={style}
      {...attributes}
      {...({ 'plait-font-size': fontSizeValue } as any)}
    >
      {children}
    </span>
  );
};

type FlattenedTextLeaf = {
  end: number;
  marks: Omit<CustomText, 'text'>;
  start: number;
  text: string;
  url?: string;
};

const LatexTextContent = ({ element }: { element: ParagraphElement }) => {
  const leaves = flattenTextLeaves(element);
  const text = Node.string(element);
  const segments = parseLatexBlocks(text);
  return (
    <span className="plait-latex-text-container">
      {segments.map((segment, index) => {
        if (segment.type === 'latex') {
          const marks = getMarksAtOffset(leaves, segment.start);
          return (
            <LatexBlock
              displayMode={segment.displayMode}
              formula={segment.formula}
              key={`${segment.start}-${index}`}
              marks={marks}
            />
          );
        }
        const range = getLatexTextRenderRange(segments, index);
        return renderTextRange(leaves, range.start, range.end, index);
      })}
    </span>
  );
};

const LatexBlock = ({
  displayMode,
  formula,
  marks,
}: {
  displayMode: boolean;
  formula: string;
  marks?: Omit<CustomText, 'text'>;
}) => {
  return (
    <span
      className={displayMode ? 'plait-latex-block' : 'plait-latex-inline'}
      style={{ color: marks?.color }}
      dangerouslySetInnerHTML={{
        __html: renderLatexFormulaToString(formula, displayMode),
      }}
    />
  );
};

const flattenTextLeaves = (element: ParagraphElement) => {
  const leaves: FlattenedTextLeaf[] = [];
  let offset = 0;

  const visit = (node: Node, inheritedUrl?: string) => {
    if (SlateText.isText(node)) {
      const text = node.text;
      const start = offset;
      offset += text.length;
      leaves.push({
        end: offset,
        marks: node,
        start,
        text,
        url: inheritedUrl,
      });
      return;
    }

    if (SlateElement.isElement(node)) {
      const url =
        (node as LinkElement).type === 'link'
          ? (node as LinkElement).url
          : inheritedUrl;
      node.children.forEach((child) => visit(child, url));
    }
  };

  visit(element);
  return leaves;
};

const renderTextRange = (
  leaves: FlattenedTextLeaf[],
  start: number,
  end: number,
  segmentIndex: number
) => {
  return leaves
    .filter((leaf) => leaf.end > start && leaf.start < end)
    .map((leaf, index) => {
      const sliceStart = Math.max(start, leaf.start) - leaf.start;
      const sliceEnd = Math.min(end, leaf.end) - leaf.start;
      const text = leaf.text.slice(sliceStart, sliceEnd);
      const content = renderTextWithBreaks(text);
      const style = getLeafStyle(leaf.marks);
      const key = `${segmentIndex}-${leaf.start}-${index}`;

      if (leaf.url) {
        return (
          <a
            className="drawnix-link"
            href={leaf.url}
            key={key}
            rel="noreferrer"
            style={style}
            target="_blank"
          >
            {content}
          </a>
        );
      }

      return (
        <span key={key} style={style}>
          {content}
        </span>
      );
    });
};

const renderTextWithBreaks = (text: string) => {
  return text.split('\n').map((line, index, lines) => (
    <React.Fragment key={`${index}-${line}`}>
      {line}
      {index < lines.length - 1 && <br />}
    </React.Fragment>
  ));
};

const getMarksAtOffset = (
  leaves: FlattenedTextLeaf[],
  offset: number
): Omit<CustomText, 'text'> | undefined => {
  return leaves.find((leaf) => leaf.start <= offset && leaf.end >= offset)
    ?.marks;
};

const getLeafStyle = (leaf: Omit<CustomText, 'text'>): CSSProperties => {
  const fontSizeValue = leaf['font-size'];
  return {
    color: leaf.color,
    fontSize: fontSizeValue ? `${fontSizeValue}px` : undefined,
    fontStyle: leaf.italic ? 'italic' : undefined,
    fontWeight: leaf.bold ? 'bold' : undefined,
    lineHeight: fontSizeValue ? 1.5 : undefined,
    textDecoration:
      [leaf.underlined ? 'underline' : '', leaf.strike ? 'line-through' : '']
        .filter(Boolean)
        .join(' ') || undefined,
  };
};

const isDomSelectionInside = (container: HTMLElement) => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString()) {
    return false;
  }

  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  return (
    (!!anchorNode && container.contains(anchorNode)) ||
    (!!focusNode && container.contains(focusNode))
  );
};

const writePlainTextClipboard = (
  clipboardData: DataTransfer | null,
  text: string
) => {
  if (!clipboardData) {
    return;
  }

  clipboardData.setData('text/plain', text);
  clipboardData.setData(
    'text/html',
    `<pre style="white-space: pre-wrap;">${escapeHtml(text)}</pre>`
  );
};

const escapeHtml = (text: string) => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

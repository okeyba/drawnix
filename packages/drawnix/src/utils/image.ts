import { getSelectedElements, PlaitBoard, toSvgData } from '@plait/core';
import { base64ToBlob, download } from './common';
import { fileOpen } from '../data/filesystem';
import { IMAGE_MIME_TYPES } from '../constants';
import { insertImage } from '../data/image';
import { getBackgroundColor, isWhite } from './color';
import { TRANSPARENT } from '../constants/color';

type ClipboardImageFormat = 'svg' | 'png';
type ExportElements = ReturnType<typeof getSelectedElements>;

const EXPORT_PADDING = 20;
const EXPORT_RATIO = 4;

const CLIPBOARD_MIME_TYPES: Record<ClipboardImageFormat, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
};

const EXPORT_INLINE_STYLE_SELECTOR =
  '.extend,.emojis,.text,.plait-text-container,.plait-latex-text-container,.plait-latex-text-container *';

const EXPORT_INLINE_STYLE_NAMES = [
  'background',
  'background-color',
  'border',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-style',
  'border-bottom-width',
  'border-left',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-right',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-top',
  'border-top-color',
  'border-top-style',
  'border-top-width',
  'bottom',
  'box-sizing',
  'clip',
  'clip-path',
  'color',
  'direction',
  'display',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-size',
  'font-style',
  'font-weight',
  'height',
  'left',
  'line-height',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-width',
  'min-height',
  'opacity',
  'overflow',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'position',
  'right',
  'text-align',
  'text-decoration',
  'top',
  'transform',
  'transform-origin',
  'unicode-bidi',
  'vertical-align',
  'visibility',
  'white-space',
  'width',
  'word-break',
  'z-index',
];

let katexFontFaceCssPromise: Promise<string> | null = null;

const hasClipboardWriteSupport = () => {
  // Keep the ClipboardItem check local until the shared helper also covers it.
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard?.write &&
    typeof ClipboardItem !== 'undefined'
  );
};

const getClipboardItemSupports = () => {
  const clipboardItemWithSupports = ClipboardItem as typeof ClipboardItem & {
    supports?: (type: string) => boolean;
  };
  return clipboardItemWithSupports.supports;
};

export const canCopySelectionAs = (format: ClipboardImageFormat) => {
  if (!hasClipboardWriteSupport()) {
    return false;
  }
  const supports = getClipboardItemSupports();
  if (typeof supports === 'function') {
    return supports(CLIPBOARD_MIME_TYPES[format]);
  }
  return format === 'png';
};

const writeBlobToClipboard = async (
  format: ClipboardImageFormat,
  blob: Blob | null,
  fallbackPngBlob?: Blob | null
) => {
  if (!blob || !hasClipboardWriteSupport()) {
    return;
  }
  const item: Record<string, Blob> = { [CLIPBOARD_MIME_TYPES[format]]: blob };
  if (fallbackPngBlob) {
    item[CLIPBOARD_MIME_TYPES.png] = fallbackPngBlob;
  }
  await navigator.clipboard.write([new ClipboardItem(item)]);
};

const getSvgData = async (board: PlaitBoard, elements?: ExportElements) => {
  const backgroundColor = getBackgroundColor(board);
  const svgData = await toSvgData(board, {
    fillStyle: isWhite(backgroundColor) ? TRANSPARENT : backgroundColor,
    padding: EXPORT_PADDING,
    ratio: EXPORT_RATIO,
    elements,
    inlineStyleClassNames: EXPORT_INLINE_STYLE_SELECTOR,
    styleNames: EXPORT_INLINE_STYLE_NAMES,
  });
  return inlineKatexFontFaces(svgData);
};

const getSvgBlob = async (board: PlaitBoard, elements?: ExportElements) => {
  const svgData = await getSvgData(board, elements);
  return new Blob([svgData], { type: CLIPBOARD_MIME_TYPES.svg });
};

const getImageBlob = async (
  board: PlaitBoard,
  isTransparent: boolean,
  elements?: ExportElements
) => {
  const backgroundColor = getBackgroundColor(board) || 'white';
  const svgData = await getSvgData(board, elements);
  const imageDataUrl = await svgDataToImageDataUrl(
    svgData,
    isTransparent ? 'transparent' : backgroundColor,
    EXPORT_RATIO
  );
  return imageDataUrl ? base64ToBlob(imageDataUrl) : null;
};

const inlineKatexFontFaces = async (svgData: string) => {
  if (!svgData.includes('KaTeX')) {
    return svgData;
  }

  const css = await getKatexFontFaceCss();
  if (!css) {
    return svgData;
  }

  return svgData.replace(
    /(<svg\b[^>]*>)/,
    `$1<style type="text/css"><![CDATA[${css}]]></style>`
  );
};

const getKatexFontFaceCss = () => {
  if (!katexFontFaceCssPromise) {
    katexFontFaceCssPromise = collectKatexFontFaceCss();
  }
  return katexFontFaceCssPromise;
};

const collectKatexFontFaceCss = async () => {
  if (typeof document === 'undefined') {
    return '';
  }

  const rules = getKatexFontFaceRules();
  const css = await Promise.all(rules.map(buildEmbeddedFontFaceRule));
  return css.filter(Boolean).join('\n');
};

const getKatexFontFaceRules = () => {
  const rules: CSSFontFaceRule[] = [];
  if (typeof CSSFontFaceRule === 'undefined') {
    return rules;
  }

  Array.from(document.styleSheets).forEach((styleSheet) => {
    let cssRules: CSSRuleList;
    try {
      cssRules = styleSheet.cssRules;
    } catch {
      return;
    }

    Array.from(cssRules).forEach((rule) => {
      if (
        rule instanceof CSSFontFaceRule &&
        rule.style.getPropertyValue('font-family').includes('KaTeX')
      ) {
        rules.push(rule);
      }
    });
  });
  return rules;
};

const buildEmbeddedFontFaceRule = async (rule: CSSFontFaceRule) => {
  const src = rule.style.getPropertyValue('src');
  const fontUrl = getFirstFontUrl(src);
  if (!fontUrl) {
    return '';
  }

  const dataUrl = await fetchAsDataUrl(fontUrl);
  if (!dataUrl) {
    return '';
  }

  const fontFamily = rule.style.getPropertyValue('font-family');
  const fontStyle = rule.style.getPropertyValue('font-style') || 'normal';
  const fontWeight = rule.style.getPropertyValue('font-weight') || '400';

  return [
    '@font-face {',
    `font-family: ${fontFamily};`,
    `font-style: ${fontStyle};`,
    `font-weight: ${fontWeight};`,
    `src: url("${dataUrl}") format("woff2");`,
    '}',
  ].join('');
};

const getFirstFontUrl = (src: string) => {
  const match = src.match(/url\(["']?([^"')]+\.woff2[^"')]*)["']?\)/);
  if (!match) {
    return null;
  }
  return new URL(match[1], document.baseURI).toString();
};

const fetchAsDataUrl = async (url: string) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
};

const blobToDataUrl = (blob: Blob) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const svgDataToImageDataUrl = (
  svgData: string,
  fillStyle: string,
  ratio: number
) => {
  return new Promise<string | null>((resolve) => {
    const { width, height } = getSvgSize(svgData);
    if (!width || !height) {
      resolve(null);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve(null);
      return;
    }

    if (fillStyle !== 'transparent') {
      ctx.fillStyle = fillStyle;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const image = new Image();
    image.onload = () => {
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL(CLIPBOARD_MIME_TYPES.png));
    };
    image.onerror = () => resolve(null);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      svgData
    )}`;
  });
};

const getSvgSize = (svgData: string) => {
  const documentElement = new DOMParser().parseFromString(
    svgData,
    'image/svg+xml'
  ).documentElement;
  return {
    width: Number(documentElement.getAttribute('width')) || 0,
    height: Number(documentElement.getAttribute('height')) || 0,
  };
};

export const saveAsSvg = (board: PlaitBoard) => {
  const selectedElements = getSelectedElements(board);
  return getSvgBlob(
    board,
    selectedElements.length > 0 ? selectedElements : undefined
  ).then((blob) => {
    const imageName = `drawnix-${new Date().getTime()}.svg`;
    download(blob, imageName);
  });
};

export const saveAsImage = (board: PlaitBoard, isTransparent: boolean) => {
  const selectedElements = getSelectedElements(board);
  getImageBlob(
    board,
    isTransparent,
    selectedElements.length > 0 ? selectedElements : undefined
  ).then((imageBlob) => {
    if (imageBlob) {
      const ext = isTransparent ? 'png' : 'jpg';
      const imageName = `drawnix-${new Date().getTime()}.${ext}`;
      download(imageBlob, imageName);
    }
  });
};

export const copySelectionAsSvg = async (board: PlaitBoard) => {
  const selectedElements = getSelectedElements(board);
  if (selectedElements.length === 0) {
    return;
  }
  const [blob, pngBlob] = await Promise.all([
    getSvgBlob(board, selectedElements),
    getImageBlob(board, true, selectedElements),
  ]);
  await writeBlobToClipboard('svg', blob, pngBlob);
};

export const copySelectionAsPng = async (
  board: PlaitBoard,
  withBackground = false
) => {
  const selectedElements = getSelectedElements(board);
  if (selectedElements.length === 0) {
    return;
  }
  const imageBlob = await getImageBlob(
    board,
    !withBackground,
    selectedElements
  );
  if (!imageBlob) {
    return;
  }
  // The clipboard only gets image/png. The background choice is controlled by
  // how the image is rendered before writing to the clipboard.
  await writeBlobToClipboard('png', imageBlob);
};

export const addImage = async (board: PlaitBoard) => {
  const imageFile = await fileOpen({
    description: 'Image',
    extensions: Object.keys(
      IMAGE_MIME_TYPES
    ) as (keyof typeof IMAGE_MIME_TYPES)[],
  });
  insertImage(board, imageFile);
};

declare module 'katex' {
  export interface KatexOptions {
    displayMode?: boolean;
    output?: 'html' | 'mathml' | 'htmlAndMathml';
    strict?: boolean | string | ((errorCode: string) => string | boolean);
    throwOnError?: boolean;
    trust?: boolean | ((context: unknown) => boolean);
  }

  export function renderToString(
    expression: string,
    options?: KatexOptions
  ): string;

  const katex: {
    renderToString: typeof renderToString;
  };

  export default katex;
}

declare module 'katex/dist/katex.min.css';

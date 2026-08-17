// `editor.main` brings the whole editor — hovers, folding, bracket matching — the
// Monarch grammars for every language it knows, and Monaco's CSS/HTML/JSON/TS
// language services. The playground colors with the grammars and surfaces
// Treequel's own diagnostics as markers, so of those services it wants only JSON
// (to validate the captures object); the CSS/HTML/TS ones — including the ~7 MB TS
// worker — are stubbed out of the bundle in `vite.config.ts`. TS surfaces use a
// Monarch-only mode (`TS_LANGUAGE`) that never touches the TS service.
import * as monaco from "monaco-editor/editor/editor.main";
import {
  conf as tsLanguageConfig,
  language as tsMonarchLanguage,
} from "monaco-editor/languages/definitions/typescript/typescript.js";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

// JSON validation runs in its own worker; every other mode tokenizes on the main
// thread, so the base editor worker is the only other one we ever spawn.
window.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") return new JsonWorker();
    return new EditorWorker();
  },
};

/**
 * A Monarch-only TypeScript mode. It colors the lambda and the code viewers with
 * the same grammar Monaco ships, but registers no language service — so opening a
 * TS document never starts the TypeScript worker, which the playground has no use
 * for (Treequel supplies the diagnostics).
 */
export const TS_LANGUAGE = "treequel-ts";

/** The playground's dark palette, matched to the surrounding page. */
const THEME = "treequel-dark";

let configured = false;

/** Register the Monarch-only TypeScript mode and the theme once. */
export function configureMonaco(): void {
  if (configured) return;
  configured = true;

  monaco.languages.register({ id: TS_LANGUAGE });
  monaco.languages.setLanguageConfiguration(TS_LANGUAGE, tsLanguageConfig);
  monaco.languages.setMonarchTokensProvider(TS_LANGUAGE, tsMonarchLanguage);

  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "keyword", foreground: "6ea8fe" },
      { token: "number", foreground: "e5b567" },
      { token: "string", foreground: "8ec07c" },
      { token: "type", foreground: "7dcfff" },
      { token: "delimiter", foreground: "aeb6c6" },
      { token: "operator", foreground: "aeb6c6" },
    ],
    colors: {
      "editor.background": "#171a21",
      "editor.foreground": "#e6e9ef",
      "editorLineNumber.foreground": "#3b4252",
      "editorLineNumber.activeForeground": "#8b93a7",
      "editorCursor.foreground": "#6ea8fe",
      "editor.selectionBackground": "#2a3448",
      "editor.inactiveSelectionBackground": "#222a38",
      "editor.lineHighlightBackground": "#1c2029",
      "editor.lineHighlightBorder": "#00000000",
      "editorIndentGuide.background1": "#232833",
      "editorIndentGuide.activeBackground1": "#2f3644",
      "editorWidget.background": "#0f1115",
      "editorWidget.border": "#262b36",
      "editorHoverWidget.background": "#0f1115",
      "editorHoverWidget.border": "#262b36",
      "editorSuggestWidget.background": "#0f1115",
      "editorError.foreground": "#ff6b6b",
      "editorWarning.foreground": "#f0a020",
      "editorInfo.foreground": "#6ea8fe",
      "scrollbarSlider.background": "#2a303c80",
      "scrollbarSlider.hoverBackground": "#333b49aa",
      "scrollbarSlider.activeBackground": "#3a4152",
    },
  });
}

export interface MountOptions {
  readonly language: string;
  readonly value?: string;
  readonly readOnly?: boolean;
  readonly lineNumbers?: boolean;
  readonly minHeight?: number;
  readonly maxHeight?: number;
  readonly ariaLabel?: string;
}

export interface Mounted {
  readonly editor: monaco.editor.IStandaloneCodeEditor;
  readonly model: monaco.editor.ITextModel;
  /** Replace the content, optionally switching the language mode with it. */
  setValue(text: string, language?: string): void;
}

/**
 * Create an editor that grows with its content between `minHeight` and
 * `maxHeight`, then scrolls. Read-only mounts serve as the syntax-highlighted
 * viewers; editable ones as the lambda and captures inputs.
 */
export function mountEditor(host: HTMLElement, opts: MountOptions): Mounted {
  configureMonaco();

  const model = monaco.editor.createModel(opts.value ?? "", opts.language);
  const readOnly = opts.readOnly ?? false;

  const editor = monaco.editor.create(host, {
    model,
    theme: THEME,
    readOnly,
    domReadOnly: readOnly,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    lineNumbers: opts.lineNumbers ? "on" : "off",
    lineNumbersMinChars: 3,
    lineDecorationsWidth: opts.lineNumbers ? 8 : 6,
    glyphMargin: false,
    folding: readOnly,
    wordWrap: "on",
    wrappingStrategy: "advanced",
    renderLineHighlight: readOnly ? "none" : "line",
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    scrollbar: {
      alwaysConsumeMouseWheel: false,
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      verticalSliderSize: 6,
    },
    padding: { top: 10, bottom: 10 },
    fixedOverflowWidgets: true,
    contextmenu: false,
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    parameterHints: { enabled: false },
    wordBasedSuggestions: "off",
    occurrencesHighlight: "off",
    selectionHighlight: false,
    ariaLabel: opts.ariaLabel ?? opts.language,
  });

  const min = opts.minHeight ?? 44;
  const max = opts.maxHeight ?? 480;
  const applyHeight = (): void => {
    const height = Math.min(Math.max(editor.getContentHeight(), min), max);
    host.style.height = `${height}px`;
    editor.layout();
  };
  editor.onDidContentSizeChange(applyHeight);
  applyHeight();

  return {
    editor,
    model,
    setValue(text, language) {
      if (language && language !== model.getLanguageId()) {
        monaco.editor.setModelLanguage(model, language);
      }
      if (model.getValue() !== text) model.setValue(text);
    },
  };
}

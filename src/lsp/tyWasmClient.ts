import type { editor, languages } from 'monaco-editor'
import { Range as MonacoRange } from 'monaco-editor'

type TyModule = typeof import('ty_wasm') & {
  version?: () => string
  initLogging?: (level: unknown) => void
  LogLevel?: { Info: unknown }
}

export type TyState =
  | {
      status: 'loading'
      version: null
      message: string
    }
  | {
      status: 'ready'
      version: string
      message: string
    }
  | {
      status: 'error'
      version: null
      message: string
    }

export type TySession = {
  module: TyModule
  workspace: import('ty_wasm').Workspace
  file: import('ty_wasm').FileHandle
}

export type TySessionOptions = {
  filePath?: string
  pythonVersion?: string
}

let tyInitPromise: Promise<TyModule> | null = null

const ROOT = '/'

export async function createTySession(
  source: string,
  { filePath = '/main.py', pythonVersion = '3.13' }: TySessionOptions = {},
): Promise<TySession> {
  const ty = await initializeTy()

  const workspace = new ty.Workspace(ROOT, ty.PositionEncoding.Utf16, {
    environment: {
      'python-version': pythonVersion,
    },
    rules: {
      'undefined-reveal': 'ignore',
    },
  })
  const file = workspace.openFile(filePath, source)

  return { module: ty, workspace, file }
}

export function disposeTySession(session: TySession) {
  session.workspace.closeFile(session.file)
  session.workspace.free()
}

function initializeTy(): Promise<TyModule> {
  if (tyInitPromise == null) {
    tyInitPromise = import('ty_wasm').then(async (module) => {
      const ty = module as TyModule
      await ty.default()
      ty.initLogging?.(ty.LogLevel?.Info)
      return ty
    })
  }

  return tyInitPromise
}

export function updateTyFile(session: TySession, source: string) {
  session.workspace.updateFile(session.file, source)
}

export function checkTyFile(session: TySession) {
  return session.workspace.checkFile(session.file)
}

export function registerTyProviders(
  monaco: typeof import('monaco-editor'),
  sessionRef: React.MutableRefObject<TySession | null>,
  lineOffset: number,
) {
  const disposables = [
    monaco.languages.registerHoverProvider('python', {
      provideHover(model, position) {
        const session = sessionRef.current
        if (session == null) {
          return undefined
        }

        const hover = session.workspace.hover(
          session.file,
          new session.module.Position(
            position.lineNumber + lineOffset,
            position.column,
          ),
        )

        if (hover == null) {
          return undefined
        }

        const definition = hiddenDefinition(
          session,
          position.lineNumber + lineOffset,
          position.column,
          lineOffset,
        )

        return {
          range: tyRangeToMonacoRange(hover.range, lineOffset),
          contents: [
            { value: hover.markdown },
            ...(definition == null
              ? []
              : [
                  {
                    value:
                      '\n\n**Definition**\n\n```python\n' +
                      definition +
                      '\n```',
                  },
                ]),
          ],
        }
      },
    }),
    monaco.languages.registerCompletionItemProvider('python', {
      triggerCharacters: ['.', '(', '"', "'"],
      provideCompletionItems(model, position) {
        const session = sessionRef.current
        if (session == null) {
          return undefined
        }

        const word = model.getWordUntilPosition(position)
        const replacementRange = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        }

        const completions = session.workspace.completions(
          session.file,
          new session.module.Position(
            position.lineNumber + lineOffset,
            position.column,
          ),
        )

        return {
          incomplete: true,
          suggestions: completions.map((completion, index) => ({
            label: completion.name,
            sortText: String(index).padStart(5, '0'),
            kind: mapCompletionKind(monaco, completion.kind),
            insertText: completion.insert_text ?? completion.name,
            detail: completion.detail,
            documentation: completion.documentation,
            additionalTextEdits: completion.additional_text_edits
              ?.map((edit) => {
                if (edit.range.start.line <= lineOffset) {
                  return null
                }

                return {
                  range: tyRangeToMonacoRange(edit.range, lineOffset),
                  text: edit.new_text,
                }
              })
              .filter((edit) => edit != null),
            range: replacementRange,
          })),
        }
      },
    }),
    monaco.languages.registerInlayHintsProvider('python', {
      provideInlayHints(model, range) {
        const session = sessionRef.current
        if (session == null) {
          return undefined
        }

        const hints = session.workspace.inlayHints(
          session.file,
          new session.module.Range(
            new session.module.Position(
              range.startLineNumber + lineOffset,
              range.startColumn,
            ),
            new session.module.Position(
              range.endLineNumber + lineOffset,
              range.endColumn,
            ),
          ),
        )

        return {
          dispose() {},
          hints: hints
            .filter((hint) => hint.position.line > lineOffset)
            .map((hint) => ({
              label: hint.label.map((part) => part.label).join(''),
              position: {
                lineNumber: hint.position.line - lineOffset,
                column: hint.position.column,
              },
            })),
        }
      },
      resolveInlayHint() {
        return undefined
      },
    }),
  ]

  return () => {
    for (const disposable of disposables) {
      disposable.dispose()
    }
  }
}

export function setDiagnostics(
  monaco: typeof import('monaco-editor'),
  model: editor.ITextModel,
  session: TySession,
  lineOffset: number,
) {
  const markers = checkTyFile(session).flatMap((diagnostic) => {
    const range = diagnostic.toRange(session.workspace)

    if (range == null || range.start.line <= lineOffset) {
      return []
    }

    return {
      code: diagnostic.id().toString(),
      message: diagnostic.message().toString(),
      severity: severityToMarker(monaco, diagnostic.severity()),
      startLineNumber: range.start.line - lineOffset,
      startColumn: range.start.column,
      endLineNumber: range.end.line - lineOffset,
      endColumn: range.end.column,
    }
  })

  monaco.editor.setModelMarkers(model, 'ty', markers)
}

function hiddenDefinition(
  session: TySession,
  line: number,
  column: number,
  lineOffset: number,
) {
  try {
    const definition = session.workspace
      .gotoDefinition(
        session.file,
        new session.module.Position(line, column),
      )
      .find((location) => location.path === session.file.path())

    if (definition == null || definition.full_range.start.line > lineOffset) {
      return undefined
    }

    const sourceLines = session.workspace.sourceText(session.file).split('\n')
    const startLine = Math.max(definition.full_range.start.line - 1, 0)
    const endLine = Math.min(definition.full_range.end.line, sourceLines.length)

    return sourceLines.slice(startLine, endLine).join('\n').trimEnd()
  } catch {
    return undefined
  }
}

function tyRangeToMonacoRange(range: import('ty_wasm').Range, lineOffset: number) {
  return new MonacoRange(
    range.start.line - lineOffset,
    range.start.column,
    range.end.line - lineOffset,
    range.end.column,
  )
}

function severityToMarker(
  monaco: typeof import('monaco-editor'),
  severity: import('ty_wasm').Severity,
) {
  switch (severity) {
    case 0:
      return monaco.MarkerSeverity.Info
    case 1:
      return monaco.MarkerSeverity.Warning
    case 2:
    case 3:
    default:
      return monaco.MarkerSeverity.Error
  }
}

function mapCompletionKind(
  monaco: typeof import('monaco-editor'),
  kind: import('ty_wasm').CompletionKind | undefined,
) {
  switch (kind) {
    case 1:
      return monaco.languages.CompletionItemKind.Method
    case 2:
      return monaco.languages.CompletionItemKind.Function
    case 3:
      return monaco.languages.CompletionItemKind.Constructor
    case 4:
      return monaco.languages.CompletionItemKind.Field
    case 5:
      return monaco.languages.CompletionItemKind.Variable
    case 6:
      return monaco.languages.CompletionItemKind.Class
    case 8:
      return monaco.languages.CompletionItemKind.Module
    case 13:
      return monaco.languages.CompletionItemKind.Keyword
    default:
      return monaco.languages.CompletionItemKind.Text
  }
}

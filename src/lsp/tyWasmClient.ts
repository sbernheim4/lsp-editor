import type { editor } from 'monaco-editor'
import { checkTyFile } from './tyRuntime'
import type { TySession } from './tyRuntime'

export {
  checkTyFile,
  createTySession,
  disposeTySession,
  updateTyFile,
} from './tyRuntime'
export type {
  TySession,
  TySessionOptions,
  TyState,
} from './tyRuntime'

export type TyDiagnostic = {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
  startLineNumber: number
  startColumn: number
}

export function registerTyProviders(
  monaco: typeof import('monaco-editor'),
  sessionRef: React.MutableRefObject<TySession | null>,
  lineOffset: number,
  commandKeyRef: React.MutableRefObject<boolean>,
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

        const definition = commandKeyRef.current
          ? undefined
          : hiddenDefinition(
              session,
              position.lineNumber + lineOffset,
              position.column,
              lineOffset,
            )
        const hasDefinitionAlready =
          definition != null && hover.markdown.includes(definition)

        return {
          range: tyRangeToMonacoRange(hover.range, lineOffset),
          contents: [
            { value: hover.markdown },
            ...(definition == null || hasDefinitionAlready
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
    monaco.languages.registerSignatureHelpProvider('python', {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: [','],
      provideSignatureHelp(model, position) {
        const session = sessionRef.current
        if (session == null) {
          return undefined
        }

        const help = session.workspace.signatureHelp(
          session.file,
          new session.module.Position(
            position.lineNumber + lineOffset,
            position.column,
          ),
        )

        if (help == null || help.signatures.length === 0) {
          return undefined
        }

        return {
          value: {
            signatures: help.signatures.map((signature) => ({
              label: signature.label,
              documentation: signature.documentation,
              parameters: signature.parameters.map((parameter) => ({
                label: parameter.label,
                documentation: parameter.documentation,
              })),
              activeParameter: signature.active_parameter,
            })),
            activeSignature: help.active_signature ?? 0,
            activeParameter:
              help.signatures[help.active_signature ?? 0]?.active_parameter ?? 0,
          },
          dispose() {},
        }
      },
    }),
    monaco.languages.registerDocumentSymbolProvider('python', {
      provideDocumentSymbols(model) {
        const functionLines: number[] = []
        for (let line = 1; line <= model.getLineCount(); line += 1) {
          if (/^(?:async\s+)?def\s+[A-Za-z_]\w*/.test(model.getLineContent(line))) {
            functionLines.push(line)
          }
        }

        return functionLines.flatMap((line, index) => {
          const signature = model.getLineContent(line)
          const match = signature.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/)
          if (match == null) {
            return []
          }

          const nameStart = signature.indexOf(match[1]) + 1
          const endLine =
            functionLines[index + 1] == null
              ? model.getLineCount()
              : functionLines[index + 1] - 1

          return {
            name: match[1],
            detail: signature.trim(),
            kind: monaco.languages.SymbolKind.Function,
            range: {
              startLineNumber: line,
              startColumn: 1,
              endLineNumber: endLine,
              endColumn: model.getLineMaxColumn(endLine),
            },
            selectionRange: {
              startLineNumber: line,
              startColumn: nameStart,
              endLineNumber: line,
              endColumn: nameStart + match[1].length,
            },
            tags: [],
          }
        })
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
      severity: severityName(diagnostic.severity()),
      startLineNumber: range.start.line - lineOffset,
      startColumn: range.start.column,
      endLineNumber: range.end.line - lineOffset,
      endColumn: range.end.column,
    }
  })

  monaco.editor.setModelMarkers(
    model,
    'ty',
    markers.map((marker) => ({
      ...marker,
      severity: markerSeverity(monaco, marker.severity),
    })),
  )

  return markers.map(({ code, message, severity, startLineNumber, startColumn }) => ({
    code,
    message,
    severity,
    startLineNumber,
    startColumn,
  }))
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
    const definitionLine = Math.max(definition.full_range.start.line - 1, 0)
    const baseIndent = sourceLines[definitionLine].match(/^\s*/)?.[0].length ?? 0
    let startLine = definitionLine
    while (startLine > 0 && /^\s*@/.test(sourceLines[startLine - 1])) {
      startLine -= 1
    }

    let endLine = Math.min(
      Math.max(definition.full_range.end.line, definition.full_range.start.line + 1),
      sourceLines.length,
    )
    while (endLine < sourceLines.length) {
      const lineText = sourceLines[endLine]
      if (lineText.trim() !== '' && (lineText.match(/^\s*/)?.[0].length ?? 0) <= baseIndent) {
        break
      }
      endLine += 1
    }

    return sourceLines.slice(startLine, endLine).join('\n').trimEnd()
  } catch {
    return undefined
  }
}

function tyRangeToMonacoRange(range: import('ty_wasm').Range, lineOffset: number) {
  return {
    startLineNumber: range.start.line - lineOffset,
    startColumn: range.start.column,
    endLineNumber: range.end.line - lineOffset,
    endColumn: range.end.column,
  }
}

function severityName(
  severity: import('ty_wasm').Severity,
): TyDiagnostic['severity'] {
  switch (severity) {
    case 0:
      return 'info'
    case 1:
      return 'warning'
    default:
      return 'error'
  }
}

function markerSeverity(
  monaco: typeof import('monaco-editor'),
  severity: TyDiagnostic['severity'],
) {
  switch (severity) {
    case 'info':
      return monaco.MarkerSeverity.Info
    case 'warning':
      return monaco.MarkerSeverity.Warning
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

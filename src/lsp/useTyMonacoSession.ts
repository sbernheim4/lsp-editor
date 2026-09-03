import { useEffect, useRef, useState } from 'react'
import type { OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

import {
  createTySession,
  disposeTySession,
  registerTyProviders,
  setDiagnostics,
  type TySession,
  type TyDiagnostic,
  type TyState,
  updateTyFile,
} from './tyWasmClient'

export type EditablePythonDefinition = {
  signature: string
  initialBody: string
}

export type UseTyMonacoSessionOptions = {
  predefinedPython: string
  editableDefinitions: readonly EditablePythonDefinition[]
  filePath?: string
  pythonVersion?: string
}

export type TyMonacoSession = {
  source: string
  tyState: TyState
  hiddenLineCount: number
  editableLineCount: number
  handleMount: OnMount
  resetSource: () => void
  diagnostics: TyDiagnostic[]
}

export function useTyMonacoSession({
  predefinedPython,
  editableDefinitions,
  filePath,
  pythonVersion,
}: UseTyMonacoSessionOptions): TyMonacoSession {
  const initialSource = buildEditableSource(editableDefinitions)
  const [source, setSource] = useState(initialSource)
  const [tyState, setTyState] = useState<TyState>({
    status: 'loading',
    version: null,
    message: 'Loading ty WASM...',
  })
  const [diagnostics, setDiagnosticsState] = useState<TyDiagnostic[]>([])

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const sessionRef = useRef<TySession | null>(null)
  const lastGoodSourceRef = useRef(initialSource)
  const restoringRef = useRef(false)
  const diagnosticsTimerRef = useRef<number | null>(null)
  const contentListenerRef = useRef<{ dispose: () => void } | null>(null)
  const providersDisposeRef = useRef<(() => void) | null>(null)
  const languageDisposeRef = useRef<{ dispose: () => void } | null>(null)
  const signatureDecorationsRef = useRef<string[]>([])
  const mountTokenRef = useRef(0)
  const normalizedPrelude = predefinedPython.endsWith('\n')
    ? predefinedPython
    : `${predefinedPython}\n`
  const hiddenLineCount = normalizedPrelude.split('\n').length - 1

  useEffect(() => {
    return () => {
      if (diagnosticsTimerRef.current != null) {
        window.clearTimeout(diagnosticsTimerRef.current)
      }

      mountTokenRef.current += 1
      contentListenerRef.current?.dispose()
      providersDisposeRef.current?.()
      languageDisposeRef.current?.dispose()
      editorRef.current?.deltaDecorations(signatureDecorationsRef.current, [])
      contentListenerRef.current = null
      providersDisposeRef.current = null
      languageDisposeRef.current = null

      const session = sessionRef.current
      sessionRef.current = null
      if (session != null) {
        disposeTySession(session)
      }
    }
  }, [])

  const toVirtualSource = (userSource: string) => normalizedPrelude + userSource

  const runDiagnostics = () => {
    const monaco = monacoRef.current
    const model = editorRef.current?.getModel()
    const session = sessionRef.current

    if (monaco == null || model == null || session == null) {
      return
    }

    try {
      setDiagnosticsState(setDiagnostics(monaco, model, session, hiddenLineCount))
    } catch (error) {
      setTyState({
        status: 'error',
        version: null,
        message: formatError(error),
      })
      setDiagnosticsState([])
    }
  }

  const scheduleDiagnostics = () => {
    if (diagnosticsTimerRef.current != null) {
      window.clearTimeout(diagnosticsTimerRef.current)
    }

    diagnosticsTimerRef.current = window.setTimeout(runDiagnostics, 120)
  }

  const handleMount: OnMount = async (editorInstance, monaco) => {
    const mountToken = ++mountTokenRef.current
    editorRef.current = editorInstance
    monacoRef.current = monaco

    languageDisposeRef.current = monaco.languages.register({
      id: 'python',
      extensions: ['.py'],
    })

    const model = editorInstance.getModel()
    if (model == null) {
      return
    }

    model.updateOptions({ tabSize: 4, insertSpaces: true })
    const updateSignatureDecorations = () => {
      signatureDecorationsRef.current = editorInstance.deltaDecorations(
        signatureDecorationsRef.current,
        findSignatureLines(model, editableDefinitions).map((line) => ({
          range: {
            startLineNumber: line,
            startColumn: 1,
            endLineNumber: line,
            endColumn: model.getLineMaxColumn(line),
          },
          options: {
            isWholeLine: true,
            className: 'fixed-python-line',
            linesDecorationsClassName: 'fixed-python-decoration',
            glyphMarginClassName: 'fixed-python-glyph',
          },
        })),
      )
    }
    updateSignatureDecorations()
    const keydownListener = editorInstance.onKeyDown((event) => {
      const selection = editorInstance.getSelection()

      if (
        selection != null &&
        selectionTouchesSignature(selection, model, editableDefinitions) &&
        isMutatingKey(event.browserEvent)
      ) {
        event.browserEvent.preventDefault()
        event.browserEvent.stopPropagation()
      }
    })
    contentListenerRef.current = model.onDidChangeContent(() => {
      if (restoringRef.current) {
        return
      }

      if (!hasExpectedSignatures(model, editableDefinitions)) {
        restoringRef.current = true
        model.setValue(lastGoodSourceRef.current)
        editorInstance.setPosition({ lineNumber: 2, column: 5 })
        restoringRef.current = false
        updateSignatureDecorations()
        return
      }

      const nextSource = model.getValue()
      lastGoodSourceRef.current = nextSource
      setSource(nextSource)
      updateSignatureDecorations()

      if (sessionRef.current != null) {
        try {
          updateTyFile(sessionRef.current, toVirtualSource(nextSource))
          scheduleDiagnostics()
        } catch (error) {
          setTyState({
            status: 'error',
            version: null,
            message: formatError(error),
          })
          setDiagnosticsState([])
        }
      }
    })
    const previousContentListener = contentListenerRef.current
    contentListenerRef.current = {
      dispose() {
        keydownListener.dispose()
        previousContentListener?.dispose()
      },
    }

    try {
      const session = await createTySession(toVirtualSource(model.getValue()), {
        filePath,
        pythonVersion,
      })
      if (mountToken !== mountTokenRef.current) {
        disposeTySession(session)
        return
      }

      sessionRef.current = session
      const disposeProviders = registerTyProviders(
        monaco,
        sessionRef,
        hiddenLineCount,
      )
      providersDisposeRef.current = disposeProviders
      editorInstance.onDidDispose(() => {
        disposeProviders()
        providersDisposeRef.current = null
      })

      setTyState({
        status: 'ready',
        version: session.module.version?.() ?? 'unknown',
        message: 'ty WASM is analyzing this virtual Python file.',
      })
      runDiagnostics()
    } catch (error) {
      setTyState({
        status: 'error',
        version: null,
        message: formatError(error),
      })
    }
  }

  const resetSource = () => {
    const model = editorRef.current?.getModel()
    if (model == null) {
      return
    }

    restoringRef.current = true
    model.setValue(initialSource)
    restoringRef.current = false
    lastGoodSourceRef.current = initialSource
    setSource(initialSource)

    const session = sessionRef.current
    if (session != null) {
      updateTyFile(session, toVirtualSource(initialSource))
      scheduleDiagnostics()
    }
  }

  return {
    source,
    tyState,
    hiddenLineCount,
    editableLineCount: Math.max(source.split('\n').length, 1),
    handleMount,
    resetSource,
    diagnostics,
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function buildEditableSource(
  definitions: readonly EditablePythonDefinition[],
) {
  return definitions
    .map(({ signature, initialBody }) => `${signature}\n${initialBody}`)
    .join('\n\n')
}

function hasExpectedSignatures(
  model: editor.ITextModel,
  definitions: readonly EditablePythonDefinition[],
) {
  let nextSearchLine = 1

  for (const { signature } of definitions) {
    let matchingLine = 0

    for (let lineNumber = nextSearchLine; lineNumber <= model.getLineCount(); lineNumber += 1) {
      if (model.getLineContent(lineNumber) === signature) {
        if (matchingLine !== 0) {
          return false
        }
        matchingLine = lineNumber
      }
    }

    if (matchingLine === 0) {
      return false
    }

    nextSearchLine = matchingLine + 1
  }

  return true
}

function selectionTouchesSignature(
  selection: {
    startLineNumber: number
    endLineNumber: number
  },
  model: editor.ITextModel,
  definitions: readonly EditablePythonDefinition[],
) {
  const signatureLines = findSignatureLines(model, definitions)
  return signatureLines.some(
    (line) =>
      line >= selection.startLineNumber && line <= selection.endLineNumber,
  )
}

function findSignatureLines(
  model: editor.ITextModel,
  definitions: readonly EditablePythonDefinition[],
) {
  const lines: number[] = []
  let nextSearchLine = 1

  for (const { signature } of definitions) {
    const matchingLine = Array.from(
      { length: model.getLineCount() - nextSearchLine + 1 },
      (_, index) => nextSearchLine + index,
    ).find((line) => model.getLineContent(line) === signature)

    if (matchingLine == null) {
      return []
    }

    lines.push(matchingLine)
    nextSearchLine = matchingLine + 1
  }

  return lines
}

function isMutatingKey(event: KeyboardEvent) {
  const key = event.key
  const modified = event.ctrlKey || event.metaKey

  if (modified) {
    return ['v', 'x', 'z', 'y'].includes(key.toLowerCase())
  }

  return key.length === 1 || ['Backspace', 'Delete', 'Enter', 'Tab'].includes(key)
}

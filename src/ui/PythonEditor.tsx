import Editor from '@monaco-editor/react'
import '../monaco'
import {
  buildEditableSource,
  useTyMonacoSession,
} from '../lsp/useTyMonacoSession'

const HIDDEN_PYTHON_PRELUDE = `from dataclasses import dataclass

@dataclass
class Car:
    make: str
    model: str
`

const EDITABLE_DEFINITIONS = [
  {
    signature: 'def include_car(car: Car) -> bool:',
    initialBody: '    return car.make == "Toyota"',
  },
] as const

export function PythonEditor() {
  const initialSource = buildEditableSource(EDITABLE_DEFINITIONS)
  const {
    tyState,
    handleMount,
    resetSource,
    diagnostics,
    revealDiagnostic,
  } = useTyMonacoSession({
    predefinedPython: HIDDEN_PYTHON_PRELUDE,
    editableDefinitions: EDITABLE_DEFINITIONS,
  })

  return (
    <main className="editor-shell">
      <header className="topbar">
        <div>
          <h1>Python Car Editor</h1>
          <p>Monaco with ty WASM over a single in-memory Python file.</p>
        </div>
        <div className="topbar-actions">
          <button type="button" className="reset-button" onClick={resetSource}>
            Reset
          </button>
          <div className={`status-pill ${tyState.status}`}>
            <span>{tyState.status}</span>
            {tyState.version ? <strong>ty {tyState.version}</strong> : null}
          </div>
        </div>
      </header>

      <section className="workspace">
        <div className="editor-panel">
          <Editor
            height="100%"
            defaultLanguage="python"
            defaultPath="/main.py"
            defaultValue={initialSource}
            theme="vs-dark"
            onMount={handleMount}
            options={{
              automaticLayout: true,
              fontFamily:
                'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
              fontSize: 14,
              glyphMargin: true,
              lineNumbersMinChars: 3,
              minimap: { enabled: false },
              padding: { top: 12, bottom: 12 },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              tabSize: 4,
              wordWrap: 'on',
            }}
          />
        </div>
      </section>
      <section className="diagnostics-panel" aria-label="Diagnostics">
        <div className="diagnostics-header">
          <h2>Diagnostics</h2>
          <span>{diagnostics.length}</span>
        </div>
        {diagnostics.length === 0 ? (
          <p className="diagnostics-empty">No issues reported.</p>
        ) : (
          <ul className="diagnostics-list">
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.startLineNumber}-${index}`}>
                <button
                  type="button"
                  className="diagnostic-button"
                  onClick={() => revealDiagnostic(diagnostic)}
                >
                <span className={`diagnostic-severity ${diagnostic.severity}`}>
                  {diagnostic.severity}
                </span>
                <span className="diagnostic-location">
                  {diagnostic.startLineNumber}:{diagnostic.startColumn}
                </span>
                <span>{diagnostic.message}</span>
                <code>{diagnostic.code}</code>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

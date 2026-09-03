type TyModule = typeof import('ty_wasm') & {
  version?: () => string
  initLogging?: (level: unknown) => void
  LogLevel?: { Info: unknown }
}

export type TyState =
  | { status: 'loading'; version: null; message: string }
  | { status: 'ready'; version: string; message: string }
  | { status: 'error'; version: null; message: string }

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
    environment: { 'python-version': pythonVersion },
    rules: { 'undefined-reveal': 'ignore' },
  })
  const file = workspace.openFile(filePath, source)
  return { module: ty, workspace, file }
}

export function disposeTySession(session: TySession) {
  session.workspace.closeFile(session.file)
  session.workspace.free()
}

export function updateTyFile(session: TySession, source: string) {
  session.workspace.updateFile(session.file, source)
}

export function checkTyFile(session: TySession) {
  return session.workspace.checkFile(session.file)
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

/// <reference types="vite/client" />

declare module 'ty_wasm' {
  export default function init(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<unknown>

  export class Workspace {
    constructor(root: string, positionEncoding: PositionEncoding, options: unknown)
    openFile(path: string, contents: string): FileHandle
    closeFile(file: FileHandle): void
    free(): void
    updateFile(file: FileHandle, contents: string): void
    checkFile(file: FileHandle): Diagnostic[]
    gotoDefinition(file: FileHandle, position: Position): LocationLink[]
    sourceText(file: FileHandle): string
    hover(file: FileHandle, position: Position): Hover | undefined
    completions(file: FileHandle, position: Position): Completion[]
    signatureHelp(file: FileHandle, position: Position): SignatureHelp | undefined
    inlayHints(file: FileHandle, range: Range): InlayHint[]
  }

  export class FileHandle {
    path(): string
    toString(): string
  }

  export class Position {
    constructor(line: number, column: number)
    line: number
    column: number
  }

  export class Range {
    constructor(start: Position, end: Position)
    start: Position
    end: Position
  }

  export class LocationLink {
    path: string
    full_range: Range
  }

  export enum PositionEncoding {
    Utf8 = 0,
    Utf16 = 1,
    Utf32 = 2
  }

  export enum Severity {
    Info = 0,
    Warning = 1,
    Error = 2,
    Fatal = 3
  }

  export enum CompletionKind {
    Text = 0,
    Method = 1,
    Function = 2,
    Constructor = 3,
    Field = 4,
    Variable = 5,
    Class = 6,
    Interface = 7,
    Module = 8,
    Property = 9,
    Unit = 10,
    Value = 11,
    Enum = 12,
    Keyword = 13,
    Snippet = 14,
    Color = 15,
    File = 16,
    Reference = 17,
    Folder = 18,
    EnumMember = 19,
    Constant = 20,
    Struct = 21,
    Event = 22,
    Operator = 23,
    TypeParameter = 24
  }

  export class Diagnostic {
    message(): string
    id(): string
    severity(): Severity
    toRange(workspace: Workspace): Range | undefined
    display(workspace: Workspace): string
  }

  export type Hover = {
    range: Range
    markdown: string
  }

  export type Completion = {
    name: string
    kind?: CompletionKind
    detail?: string
    documentation?: string
    insert_text?: string
    additional_text_edits?: TextEdit[]
  }

  export type TextEdit = {
    range: Range
    new_text: string
  }

  export type InlayHint = {
    label: Array<{ label: string }>
    position: Position
  }

  export type SignatureHelp = {
    active_signature?: number
    signatures: SignatureInformation[]
  }

  export type SignatureInformation = {
    active_parameter?: number
    documentation?: string
    label: string
    parameters: ParameterInformation[]
  }

  export type ParameterInformation = {
    documentation?: string
    label: string
  }
}

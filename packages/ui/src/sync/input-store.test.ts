import { beforeEach, describe, expect, test } from "bun:test"
import { create } from "zustand"
import type { AttachedFile } from "@/stores/types/sessionTypes"
import type { InputState } from "./input-store"

class MockFileReader {
  result: string | ArrayBuffer | null = null
  onload: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null
  onerror: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null
  onabort: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null
  error: DOMException | null = null

  readAsDataURL() {
    pendingReaders.push(this)
  }
}

const pendingReaders: MockFileReader[] = []
const originalFileReader = globalThis.FileReader

const restoreFileReader = () => {
  pendingReaders.length = 0
  globalThis.FileReader = originalFileReader
}

const testWithMockFileReader = (name: string, fn: () => Promise<void>) => {
  test(name, async () => {
    try {
      await fn()
    } finally {
      restoreFileReader()
    }
  })
}

const resolveReader = (reader: MockFileReader, result: string) => {
  reader.result = result
  reader.onload?.call(reader as unknown as FileReader, {} as ProgressEvent<FileReader>)
}

const rejectReader = (reader: MockFileReader) => {
  reader.error = new DOMException("read failed", "NotReadableError")
  reader.onerror?.call(reader as unknown as FileReader, {} as ProgressEvent<FileReader>)
}

const createTestInputStore = () => {
  let attachmentReadGeneration = 0
  const pendingVSCodeSelectionKeys = new Set<string>()
  const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
    reader.onabort = () => reject(new Error("File read aborted"))
    reader.readAsDataURL(file)
  })
  return create<InputState>()((set) => ({
    pendingInputText: null,
    pendingInputMode: "replace",
    pendingSyntheticParts: null,
    attachedFiles: [],
    activeEditorFile: null,
    setPendingInputText: (text, mode = "replace") => set({ pendingInputText: text, pendingInputMode: mode }),
    consumePendingInputText: () => null,
    setPendingSyntheticParts: (parts) => set({ pendingSyntheticParts: parts }),
    consumePendingSyntheticParts: () => null,
    addAttachedFile: async (file) => {
      const generation = attachmentReadGeneration
      let dataUrl: string
      try {
        dataUrl = await readFileAsDataUrl(file)
      } catch {
        return
      }
      if (generation !== attachmentReadGeneration) return
      const attached: AttachedFile = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        dataUrl,
        mimeType: file.type,
        filename: file.name,
        size: file.size,
        source: "local",
      }
      set((s) => ({ attachedFiles: [...s.attachedFiles, attached] }))
    },
    removeAttachedFile: (id) => set((s) => ({ attachedFiles: s.attachedFiles.filter((file) => file.id !== id) })),
    setAttachedFiles: (files) => {
      attachmentReadGeneration += 1
      set({ attachedFiles: files })
    },
    clearAttachedFiles: () => {
      attachmentReadGeneration += 1
      set({ attachedFiles: [] })
    },
    addServerPathAttachment: () => undefined,
    addVSCodeFileAttachment: () => undefined,
    addVSCodeSelectionAttachment: async (path, file) => {
      const generation = attachmentReadGeneration
      const selectionKey = `${path}\u0000${file.name}`
      if (pendingVSCodeSelectionKeys.has(selectionKey)) return
      pendingVSCodeSelectionKeys.add(selectionKey)
      let dataUrl: string
      try {
        dataUrl = await readFileAsDataUrl(file)
      } catch {
        return
      } finally {
        pendingVSCodeSelectionKeys.delete(selectionKey)
      }
      if (generation !== attachmentReadGeneration) return
      set((s) => ({
        attachedFiles: [...s.attachedFiles, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          dataUrl,
          mimeType: file.type,
          filename: file.name,
          size: file.size,
          source: "vscode",
          vscodePath: path,
          vscodeSource: "selection",
        }],
      }))
    },
    setActiveEditorFile: (file) => set({ activeEditorFile: file }),
    addRestoredAttachment: () => undefined,
  }))
}

let useInputStore = createTestInputStore()

describe("input-store attachments", () => {
  beforeEach(() => {
    pendingReaders.length = 0
    globalThis.FileReader = MockFileReader as unknown as typeof FileReader
    useInputStore = createTestInputStore()
    useInputStore.setState({
      pendingInputText: null,
      pendingInputMode: "replace",
      pendingSyntheticParts: null,
      activeEditorFile: null,
    })
    useInputStore.getState().setAttachedFiles([])
  })

  testWithMockFileReader("does not attach a local file that finishes reading after attachments are cleared", async () => {
    const addPromise = useInputStore.getState().addAttachedFile(new File(["hello"], "hello.txt", { type: "text/plain" }))
    expect(pendingReaders).toHaveLength(1)

    useInputStore.getState().clearAttachedFiles()
    resolveReader(pendingReaders[0], "data:text/plain;base64,aGVsbG8=")
    await addPromise

    expect(useInputStore.getState().attachedFiles).toEqual([])
  })

  testWithMockFileReader("does not attach a local file after attached files are replaced", async () => {
    const addPromise = useInputStore.getState().addAttachedFile(new File(["hello"], "hello.txt", { type: "text/plain" }))
    expect(pendingReaders).toHaveLength(1)

    useInputStore.getState().setAttachedFiles([])
    resolveReader(pendingReaders[0], "data:text/plain;base64,aGVsbG8=")
    await addPromise

    expect(useInputStore.getState().attachedFiles).toEqual([])
  })

  testWithMockFileReader("does not attach a local file after attached files are restored", async () => {
    const addPromise = useInputStore.getState().addAttachedFile(new File(["hello"], "hello.txt", { type: "text/plain" }))
    expect(pendingReaders).toHaveLength(1)

    const restored = new File(["restored"], "restored.txt", { type: "text/plain" })
    useInputStore.getState().setAttachedFiles([{
      id: "restored",
      file: restored,
      dataUrl: "data:text/plain;base64,cmVzdG9yZWQ=",
      mimeType: "text/plain",
      filename: "restored.txt",
      size: restored.size,
      source: "local",
    }])
    resolveReader(pendingReaders[0], "data:text/plain;base64,aGVsbG8=")
    await addPromise

    expect(useInputStore.getState().attachedFiles.map((file) => file.filename)).toEqual(["restored.txt"])
  })

  testWithMockFileReader("does not attach a VS Code selection that finishes reading after attachments are cleared", async () => {
    const addPromise = useInputStore.getState().addVSCodeSelectionAttachment(
      "/workspace/hello.txt",
      new File(["hello"], "hello.txt", { type: "text/plain" })
    )
    expect(pendingReaders).toHaveLength(1)

    useInputStore.getState().clearAttachedFiles()
    resolveReader(pendingReaders[0], "data:text/plain;base64,aGVsbG8=")
    await addPromise

    expect(useInputStore.getState().attachedFiles).toEqual([])
  })

  test("does not leave local file reads pending after a reader error", async () => {
    const addPromise = useInputStore.getState().addAttachedFile(new File(["hello"], "hello.txt", { type: "text/plain" }))
    expect(pendingReaders).toHaveLength(1)

    rejectReader(pendingReaders[0])
    await addPromise

    expect(useInputStore.getState().attachedFiles).toEqual([])
  })

  test("cleans up pending VS Code selection keys after a reader error", async () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" })
    const firstAdd = useInputStore.getState().addVSCodeSelectionAttachment("/workspace/hello.txt", file)
    expect(pendingReaders).toHaveLength(1)

    rejectReader(pendingReaders[0])
    await firstAdd

    const secondAdd = useInputStore.getState().addVSCodeSelectionAttachment("/workspace/hello.txt", file)
    expect(pendingReaders).toHaveLength(2)
    resolveReader(pendingReaders[1], "data:text/plain;base64,aGVsbG8=")
    await secondAdd

    expect(useInputStore.getState().attachedFiles.map((attached) => attached.filename)).toEqual(["hello.txt"])
  })
})

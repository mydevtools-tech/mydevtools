/**
 * Web-branch behaviour of saveFile: every tool routes its downloads through
 * here, so the anchor must carry the right filename and the right bytes.
 * The desktop branch needs a live Tauri webview and is not covered.
 */
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }))

import { toast } from "sonner"
import { downloadFile, saveFile } from "@/lib/desktop/save-file"

type FakeAnchor = { href: string; download: string; click: jest.Mock }

function stubDom() {
  const anchors: FakeAnchor[] = []
  const blobs = new Map<string, Blob>()
  const origCreate = URL.createObjectURL
  const origRevoke = URL.revokeObjectURL

  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      const a: FakeAnchor = { href: "", download: "", click: jest.fn() }
      anchors.push(a)
      return a
    },
  }
  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:${blobs.size}`
    blobs.set(url, blob)
    return url
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL

  return {
    anchors,
    /** The blob the last anchor pointed at. */
    saved: () => blobs.get(anchors[anchors.length - 1].href)!,
    restore() {
      delete (globalThis as unknown as { document?: unknown }).document
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
    },
  }
}

describe("saveFile (web)", () => {
  let dom: ReturnType<typeof stubDom>
  beforeEach(() => {
    dom = stubDom()
    ;(toast.error as jest.Mock).mockClear()
  })
  afterEach(() => dom.restore())

  it("downloads a string under the given filename", async () => {
    expect(await saveFile("hello", "note.txt", "text/plain")).toBe(true)
    const a = dom.anchors[0]
    expect(a.download).toBe("note.txt")
    expect(a.click).toHaveBeenCalled()
    await expect(dom.saved().text()).resolves.toBe("hello")
    expect(dom.saved().type).toBe("text/plain")
  })

  it("preserves binary payloads byte for byte", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    await saveFile(bytes, "icon.png", "image/png")
    const out = new Uint8Array(await dom.saved().arrayBuffer())
    expect(Array.from(out)).toEqual(Array.from(bytes))
  })

  it("passes a Blob through without rewrapping its type", async () => {
    const blob = new Blob(["<svg />"], { type: "image/svg+xml" })
    await saveFile(blob, "out.svg")
    expect(dom.saved()).toBe(blob)
    expect(dom.anchors[0].download).toBe("out.svg")
  })

  it("reports a failed save as a toast instead of an unhandled rejection", async () => {
    ;(globalThis as unknown as { document: { createElement: () => never } }).document = {
      createElement: () => {
        throw new Error("no DOM")
      },
    }
    downloadFile("x", "x.txt")
    await new Promise((r) => setTimeout(r, 0))
    expect(toast.error).toHaveBeenCalledWith("no DOM")
  })
})

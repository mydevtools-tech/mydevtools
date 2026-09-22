/**
 * Outside the Tauri window there is no local store, so `/api/v1/*` and
 * `/api/backend/*` must fail with a readable 501 instead of falling through to
 * Next's 404 HTML page (which used to surface verbatim in error toasts).
 * Every other `/api/...` path stays a plain fetch — the api-client proxies
 * are real HTTP endpoints.
 */
import { apiFetch } from "@/lib/desktop/api-fetch"

describe("apiFetch outside the desktop app", () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it.each(["/api/v1/user-preferences", "/api/backend/notes"])(
    "fails %s with a readable 501 and never hits the network",
    async (path) => {
      global.fetch = jest.fn() as unknown as typeof fetch
      const res = await apiFetch(path)

      expect(global.fetch).not.toHaveBeenCalled()
      expect(res.status).toBe(501)
      const { detail } = await res.json()
      expect(detail).toContain(path)
      expect(detail).toContain("pnpm dev:desktop")
    },
  )

  it("passes other /api paths through to fetch", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response("{}")) as unknown as typeof fetch
    await apiFetch("/api/proxy-grpc", { method: "POST" })

    expect(global.fetch).toHaveBeenCalledWith("/api/proxy-grpc", { method: "POST" })
  })
})

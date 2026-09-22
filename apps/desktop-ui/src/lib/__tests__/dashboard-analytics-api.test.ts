import {
    EMPTY_ANALYTICS_SUMMARY,
    fetchDashboardAnalyticsSummary,
    normalizeAnalyticsSummary,
} from "../dashboard-analytics-api"
import { apiFetch } from "@/lib/desktop/api-fetch"

jest.mock("@/lib/desktop/api-fetch", () => ({ apiFetch: jest.fn() }))

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>

const jsonResponse = (body: unknown, ok = true) =>
    ({ ok, json: async () => body }) as unknown as Response

beforeEach(() => mockApiFetch.mockReset())

describe("fetchDashboardAnalyticsSummary", () => {
    it("reads live counts from the local router", async () => {
        mockApiFetch.mockResolvedValue(
            jsonResponse({
                notes: 4,
                bookmarks: 2,
                tasks: { total: 3, completed: 1, ongoing: 2, notStarted: 0 },
                codeSnippets: 7,
            }),
        )

        const s = await fetchDashboardAnalyticsSummary()

        expect(mockApiFetch).toHaveBeenCalledWith("/api/backend/dashboard/analytics")
        expect(s.notes).toBe(4)
        expect(s.bookmarks).toBe(2)
        expect(s.codeSnippets).toBe(7)
        expect(s.tasks).toEqual({ total: 3, completed: 1, ongoing: 2, notStarted: 0 })
        // Fields the router did not send fall back to 0 rather than undefined.
        expect(s.jsonFormatterDocuments).toBe(0)
    })

    it("returns zeros when there is no local router (web build)", async () => {
        mockApiFetch.mockResolvedValue(jsonResponse({ detail: "Not found" }, false))
        await expect(fetchDashboardAnalyticsSummary()).resolves.toEqual(EMPTY_ANALYTICS_SUMMARY)
    })
})

describe("normalizeAnalyticsSummary", () => {
    it("coerces junk payloads to zeros without throwing", () => {
        expect(normalizeAnalyticsSummary(null)).toEqual(EMPTY_ANALYTICS_SUMMARY)
        expect(normalizeAnalyticsSummary("nope")).toEqual(EMPTY_ANALYTICS_SUMMARY)
        expect(
            normalizeAnalyticsSummary({ notes: "12", bookmarks: NaN, tasks: { total: "x" } }),
        ).toEqual(EMPTY_ANALYTICS_SUMMARY)
    })
})

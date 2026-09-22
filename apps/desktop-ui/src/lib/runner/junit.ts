/**
 * JUnit XML emitter for collection-runner results.
 * Emits one `<testsuite>` per run, with one `<testcase>` per assertion across
 * every request iteration. Format mirrors Surefire/Jenkins-compatible output.
 */

import type { RequestRunResult } from "./types"
import { downloadFile } from "@/lib/desktop/save-file"

function escapeXml(s: string): string {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
}

export function buildJUnitXml(results: RequestRunResult[], suiteName: string): string {
    const allTests = results.flatMap((r) =>
        r.tests.map((t) => ({ run: r, test: t }))
    )
    const totalTests = allTests.length
    const failed = allTests.filter(({ test }) => !test.pass).length
    const errored = results.filter((r) => r.networkError || r.errors.length > 0).length
    const totalTime = results.reduce((s, r) => s + (r.time ?? 0), 0) / 1000

    const cases = allTests.map(({ run, test }) => {
        const classname = escapeXml(run.requestName)
        const name = escapeXml(test.name)
        const time = ((run.time ?? 0) / 1000).toFixed(3)
        if (test.pass) {
            return `    <testcase classname="${classname}" name="${name}" time="${time}" />`
        }
        const msg = escapeXml(test.error ?? "assertion failed")
        return `    <testcase classname="${classname}" name="${name}" time="${time}">
      <failure message="${msg}" type="AssertionError">${msg}</failure>
    </testcase>`
    })

    // Network / script errors land as <error> on a synthetic test case so CI tools surface them.
    const errorCases = results
        .filter((r) => r.networkError || r.errors.length > 0)
        .map((r) => {
            const msg = escapeXml(r.networkError ?? r.errors.join("; "))
            const classname = escapeXml(r.requestName)
            const time = ((r.time ?? 0) / 1000).toFixed(3)
            return `    <testcase classname="${classname}" name="request transport" time="${time}">
      <error message="${msg}" type="RuntimeError">${msg}</error>
    </testcase>`
        })

    const body = [...cases, ...errorCases].join("\n")

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="${escapeXml(suiteName)}" tests="${totalTests + errored}" failures="${failed}" errors="${errored}" time="${totalTime.toFixed(3)}">
${body}
  </testsuite>
</testsuites>`
}

export function downloadJUnitXml(results: RequestRunResult[], suiteName: string): void {
    if (typeof window === "undefined") return
    const xml = buildJUnitXml(results, suiteName)
    const blob = new Blob([xml], { type: "application/xml" })
    downloadFile(blob, `${suiteName.replace(/[^A-Za-z0-9_-]+/g, "_") || "run"}-junit.xml`)
}

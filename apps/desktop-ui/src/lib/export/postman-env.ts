/**
 * Postman Environment v2 export — mirror of `lib/import/postman-env.ts`.
 */

import type { Environment } from "@/components/api-client/use-environments"
import { downloadFile } from "@/lib/desktop/save-file"

export function exportPostmanEnvironment(env: Environment): string {
    return JSON.stringify(
        {
            id: env.id,
            name: env.name,
            values: env.variables
                .filter((v) => v.key)
                .map((v) => ({ key: v.key, value: v.value, enabled: v.enabled, type: "default" })),
            _postman_variable_scope: "environment",
            _postman_exported_at: new Date().toISOString(),
        },
        null,
        2,
    )
}

/** Trigger a browser download of the JSON. */
export function downloadEnvironmentAsPostman(env: Environment): void {
    if (typeof window === "undefined") return
    const blob = new Blob([exportPostmanEnvironment(env)], { type: "application/json" })
    downloadFile(blob, `${env.name.replace(/[^a-zA-Z0-9-_]+/g, "_") || "environment"}.postman_environment.json`)
}

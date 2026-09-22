import { downloadFile } from "@/lib/desktop/save-file"

export function downloadBackupCodesFile(codes: string[], userEmail?: string | null) {
    const date = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    })
    const lines = [
        "========================================",
        "  MYDEVTOOLS — MASTER PASSWORD BACKUP",
        "========================================",
        "",
        `Account : ${userEmail ?? "unknown"}`,
        `Created : ${date}`,
        "",
        "BACKUP CODES",
        "------------",
        "Each code can be used exactly once to recover access",
        "if you forget your master password.",
        "",
        ...codes.map((c, i) => `  ${String(i + 1).padStart(2, "0")}. ${c}`),
        "",
        "INSTRUCTIONS",
        "------------",
        '1. On the unlock screen, click "Use backup code instead".',
        "2. Enter one of the codes above (dashes optional).",
        "3. The code will be consumed — cross it off this list.",
        "4. Once all codes are used, generate new ones from Settings.",
        "",
        "Keep this file somewhere safe (password manager, printed copy).",
        "Anyone with these codes can access your encrypted data.",
        "",
        "========================================",
    ]
    const blob = new Blob([lines.join("\n")], { type: "text/plain" })
    downloadFile(blob, "mydevtools-backup-codes.txt")
}

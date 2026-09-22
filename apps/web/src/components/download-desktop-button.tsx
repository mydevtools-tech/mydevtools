import { Download, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";

/** GitHub's permanent "latest release" page — releases live in the source repo. */
export const RELEASES_URL =
  "https://github.com/mydevtools-tech/mydevtools/releases/latest";

/**
 * GitHub's permanent "latest release" redirect — always serves the newest DMG.
 * release-local.sh uploads a version-less MyDevTools.dmg to every release.
 */
export const DMG_URL = `${RELEASES_URL}/download/MyDevTools.dmg`;

/**
 * Linux artifacts. release-local.sh uploads arch-suffixed, version-less copies
 * to every release, so these URLs never need touching on a version bump.
 * Both architectures have shipped since 0.1.18; the arch naming is Tauri's —
 * Debian spelling for the .deb, GNU triple for the AppImage.
 */
export const DEB_URL = `${RELEASES_URL}/download/MyDevTools-amd64.deb`;
export const APPIMAGE_URL = `${RELEASES_URL}/download/MyDevTools-x86_64.AppImage`;
export const DEB_ARM64_URL = `${RELEASES_URL}/download/MyDevTools-arm64.deb`;
export const APPIMAGE_ARM64_URL = `${RELEASES_URL}/download/MyDevTools-aarch64.AppImage`;

/** Minimal Apple logo (lucide has no Apple icon in this version). */
export function AppleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 384 512" aria-hidden className={className} fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

export function DownloadDesktopButton({
  size = "lg",
  className,
}: {
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  return (
    <div className={className}>
      <Button asChild size={size} className="gap-2">
        <a href={DMG_URL} download>
          <AppleGlyph className="h-4 w-4" />
          Download for macOS
          <Download className="h-4 w-4 opacity-70" />
        </a>
      </Button>
      <p className="mt-2 text-sm text-muted-foreground">
        Universal (Apple Silicon &amp; Intel) · macOS 12+
      </p>
    </div>
  );
}

/**
 * Linux download. Two formats because they solve different problems: the .deb
 * integrates with apt on Debian/Ubuntu, the AppImage runs on anything without
 * installing. Neither self-updates yet, which /linux-builds says out loud.
 *
 * Intel/AMD keeps the buttons because it is what most desktop Linux runs;
 * ARM64 sits on a quieter second line rather than doubling the button count,
 * which would make the common case harder to pick out.
 */
export function DownloadLinuxButton({
  size = "lg",
  className,
}: {
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild size={size} variant="outline" className="gap-2">
          <a href={DEB_URL} download>
            <TerminalSquare className="h-4 w-4" />
            Download .deb
            <Download className="h-4 w-4 opacity-70" />
          </a>
        </Button>
        <Button asChild size={size} variant="outline" className="gap-2">
          <a href={APPIMAGE_URL} download>
            <TerminalSquare className="h-4 w-4" />
            Download AppImage
            <Download className="h-4 w-4 opacity-70" />
          </a>
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Intel/AMD (x86_64) · Ubuntu 22.04+ / Debian 12+ ·{" "}
        <a className="underline underline-offset-2" href="/linux-builds">
          install guide
        </a>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        On ARM64 (Apple Silicon VMs, ARM servers, Raspberry Pi)? Download the{" "}
        <a
          className="underline underline-offset-2 transition-colors hover:text-foreground"
          href={DEB_ARM64_URL}
          download
        >
          ARM64 .deb
        </a>{" "}
        or{" "}
        <a
          className="underline underline-offset-2 transition-colors hover:text-foreground"
          href={APPIMAGE_ARM64_URL}
          download
        >
          ARM64 AppImage
        </a>
        .
      </p>
    </div>
  );
}

import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { DownloadLinuxButton, RELEASES_URL } from "@/components/download-desktop-button";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://mydevtools.tech";

/**
 * Linux now ships in the same release as macOS, so this points at the current
 * release rather than the old v0.1.14-linux-preview pre-release. The download
 * buttons use the version-less filenames release-local.sh uploads every time.
 */
const LINUX_RELEASE_URL = RELEASES_URL;

export const metadata: Metadata = {
  title: "Download MyDevTools for Linux",
  description:
    "Download the MyDevTools desktop app for Linux — Intel/AMD (x86_64) and ARM64, as an AppImage or a .deb. Completely offline, no account required, free for everyone.",
  alternates: { canonical: `${baseUrl}/linux-builds` },
  openGraph: {
    title: "Download MyDevTools for Linux | MyDevTools",
    description:
      "Download the MyDevTools desktop app for Linux — Intel/AMD and ARM64, AppImage or .deb. Offline, no account, free for everyone.",
    url: `${baseUrl}/linux-builds`,
    siteName: "MyDevTools",
    type: "website",
    images: [{ url: `${baseUrl}/og-home.jpg`, width: 1200, height: 630, alt: "MyDevTools — The Offline Developer Workstation" }],
  },
};

export default function LinuxBuildsPage() {
  return (
    <div className="dark mdt-deck flex flex-col min-h-screen bg-background text-foreground font-sans">
      <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: -1, pointerEvents: "none" }}>
        <div className="mdt-grid" />
        <div className="mdt-noise" />
      </div>

      <Header />

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-6 pt-32 pb-24 text-center">
          <p className="mdt-kicker">Desktop app · Linux</p>
          <h1 className="mt-4 text-4xl sm:text-5xl font-semibold tracking-tight">
            Your entire dev toolkit,{" "}
            <span className="mdt-grad-text">on Linux.</span>
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            The same offline, local-first toolkit that runs on macOS — packaged as an
            AppImage and a <code>.deb</code>. No account, no sign-in, free for everyone.
          </p>

          {/* Preview status — set expectations honestly */}
          <div className="mt-8 mx-auto max-w-xl rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-5 py-4 text-left">
            <p className="text-sm font-semibold text-amber-200">Early Linux build</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Linux support is new and still being validated. Unlike the macOS build,
              these packages are not yet covered by automatic updates — grab a newer
              build from this page when one lands. Requires Ubuntu 22.04+ or Debian 12+
              (older releases don't ship <code>libwebkit2gtk-4.1-0</code>).
            </p>
          </div>

          <div className="mt-10 flex flex-col items-center">
            <DownloadLinuxButton />
            <p className="mt-3 text-xs text-muted-foreground">
              Or browse every file on the{" "}
              <a
                className="underline underline-offset-2"
                href={LINUX_RELEASE_URL}
                target="_blank"
                rel="noreferrer"
              >
                GitHub release page
              </a>
              .
            </p>
          </div>

          {/* Install instructions */}
          <div className="mt-16 mx-auto max-w-xl text-left mdt-surface rounded-xl p-6">
            <h2 className="text-sm font-semibold">Installing</h2>

            <p className="mt-3 text-sm text-muted-foreground">
              <strong className="text-foreground">Intel or AMD</strong> — both are the same
              architecture (<code>amd64</code>), so one package covers every normal PC:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 p-3 text-xs text-muted-foreground">
              <code>sudo apt install ./MyDevTools_*_amd64.deb</code>
            </pre>

            <p className="mt-4 text-xs text-muted-foreground">
              ARM64 machines (Raspberry Pi, ARM servers, Linux VMs on Apple Silicon) are
              supported too — grab the <code>arm64</code> .deb or the{" "}
              <code>aarch64</code> AppImage instead. Not sure which you have? Run{" "}
              <code>dpkg --print-architecture</code>.
            </p>

            <p className="mt-3 text-sm text-muted-foreground">
              <strong className="text-foreground">AppImage</strong> — runs anywhere, no
              install:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 p-3 text-xs text-muted-foreground">
              <code>{`chmod +x MyDevTools_*.AppImage
./MyDevTools_*.AppImage`}</code>
            </pre>

            <p className="mt-4 text-sm text-muted-foreground">
              <strong className="text-foreground">Debian / Ubuntu</strong>:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 p-3 text-xs text-muted-foreground">
              <code>sudo apt install ./MyDevTools_*.deb</code>
            </pre>

            <p className="mt-4 text-xs text-muted-foreground">
              MyDevTools stores its database encryption key in your desktop keyring
              (GNOME Keyring or KWallet), so a desktop session with a running keyring
              service is required.
            </p>
          </div>

          <p className="mt-10 text-sm text-muted-foreground">
            Looking for macOS?{" "}
            <a className="underline underline-offset-2" href="/download">
              Download for Mac
            </a>
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}

'use client'
import React, { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { NavBar } from '@/components/nav-bar';
import { MobileNav } from '@/components/mobile-nav';
import { TopBar } from '@/components/shell/top-bar';
import { useTabStore } from '@/store/tab-store';
import { isTabRoute } from '@/lib/route-config';
import { getTabComponent, isRegisteredTab } from '@/lib/tab-registry';
import { isDesktop } from '@/lib/desktop/is-desktop';
import { MobileDesktopHint } from '@/components/mobile-desktop-hint';
import { useWorkspaceStore } from '@/store/workspace-store';
import { initWorkspaceScopeReset } from '@/lib/workspace-scope-reset';
import { useToolUsage } from '@/hooks/use-tool-usage';
import { findItemByUrl } from '@/components/dashboard/types';

// Reset workspace-scoped stores whenever the active workspace changes
// (module-level, mirrors workspace-store's own subscribeOnce pattern).
initWorkspaceScopeReset();

// Renders all open tool tabs simultaneously. The active tab is visible;
// inactive tabs use display:none to stay mounted (preserving their state).
function TabContent() {
  const { tabs, activeTabPath } = useTabStore();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {tabs.map((tab) => {
        const Component = getTabComponent(tab.path);
        if (!Component) return null;
        const isActive = tab.path === activeTabPath;
        return (
          <div
            key={tab.path}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
            style={{ display: isActive ? 'flex' : 'none' }}
          >
            <Component />
          </div>
        );
      })}
    </div>
  );
}

// Syncs the current URL pathname to the tab store.
function TabSyncer() {
  const pathname = usePathname();
  const { openTab, setActiveTab } = useTabStore();

  useEffect(() => {
    if (isTabRoute(pathname) && isRegisteredTab(pathname)) {
      openTab(pathname);
      setActiveTab(pathname);
    }
  }, [pathname, openTab, setActiveTab]);

  return null;
}

// Records a "tool opened" event whenever the URL lands on a real tool route.
// This is the single choke point for usage history: the sidebar, ⌘K, dashboard
// cards and tab chips all navigate with router.push, so every open passes here.
// Events are keyed by route path, the only tool identity that survives a
// reordering of sidebar-data.
function ToolUsageTracker() {
  const pathname = usePathname();
  const { trackToolUsage } = useToolUsage();

  useEffect(() => {
    if (!pathname || !findItemByUrl(pathname)) return;
    trackToolUsage(pathname, pathname);
  }, [pathname, trackToolUsage]);

  return null;
}

function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tabs } = useTabStore();
  // Keying tool content by workspace remounts every mounted tab (and page) on
  // switch, so each tool refetches under the new scope instead of showing the
  // previous workspace's data.
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const inTabMode = isTabRoute(pathname) && tabs.length > 0;

  return (
    <div className="flex h-screen w-full flex-col relative overflow-hidden">
      <TabSyncer />
      <ToolUsageTracker />
      <TopBar />
      <div className="flex min-h-0 w-full flex-1">
        <main className="flex-1 font-mono flex flex-col pb-16 md:pb-0 min-w-0 overflow-hidden">
          <div className="shrink-0 z-20 bg-background">
            {!inTabMode && <NavBar />}
            <MobileDesktopHint />
          </div>

          {inTabMode ? (
            <TabContent key={activeWorkspaceId ?? 'none'} />
          ) : (
            <div
              key={activeWorkspaceId ?? 'none'}
              className="z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            >
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
                {children}
              </div>
            </div>
          )}

          <MobileNav />
        </main>
      </div>
      {/* Command palette is mounted once globally in ClientShell (root layout) —
          a second mount here caused stacked overlays needing two clicks to dismiss. */}
    </div>
  );
}

export function ClientLayout({ children }: { children: React.ReactNode }) {
  // Workspace hydration lives in <DesktopInit /> (mounted in app/layout.tsx).
  // Doing it here too fired a second GET + POST /workspaces/active on every
  // desktop launch, and 404'd in a plain browser dev server (no Next API routes).
  return <Layout>{children}</Layout>;
}

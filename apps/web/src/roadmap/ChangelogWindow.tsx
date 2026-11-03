import { useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { SidebarProvider } from "../components/ui/sidebar";

export function ChangelogWindowLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider className="h-dvh! min-h-0!" defaultOpen={false}>
      {children}
    </SidebarProvider>
  );
}

export function ChangelogWindowCoordinator() {
  const navigate = useNavigate();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Native IPC and browser pop-outs request navigation in the owning app window.
  useEffect(() => {
    const returned = (project: string | undefined) => {
      void navigate({ to: "/changelog", search: project ? { project } : {} });
    };
    const unsubscribe = window.desktopBridge?.onChangelogReturned?.(returned);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "t3.changelog.return")
        return;
      const project: unknown = event.data.project;
      if (project === undefined || (typeof project === "string" && project.length <= 512))
        returned(project);
    };
    window.addEventListener("message", onMessage);
    return () => {
      unsubscribe?.();
      window.removeEventListener("message", onMessage);
    };
  }, [navigate]);
  return null;
}

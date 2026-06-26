import { useEffect, useRef } from "react";
import { toaster } from "@/components/ui/toaster";
import { useClassroom } from "@/context/classroom-context";
import { useWebSocket } from "@/context/websocket-context";

interface InboxStatus {
  pending: boolean;
  package?: {
    filename?: string;
    created_at?: string;
    size?: number;
  } | null;
}

const CHECK_INTERVAL_MS = 5000;

/**
 * 教师下发作品包确认器（MVP T-5）。
 *
 * 教师端只把 ZIP 放入学生端 inbox；学生端前端轮询 inbox，弹窗确认后
 * 才真正调用 /workspace/inbox/apply 覆盖当前工作区。
 */
export default function WorkspaceInboxListener(): null {
  const { isAuthenticated } = useClassroom();
  const { baseUrl } = useWebSocket();
  const confirmingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }

    const root = baseUrl.replace(/\/+$/, "");

    const check = async () => {
      if (confirmingRef.current || document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`${root}/workspace/inbox`);
        if (!response.ok) return;
        const payload = (await response.json()) as InboxStatus;
        if (!payload.pending) return;

        confirmingRef.current = true;
        const filename = payload.package?.filename || "作品包.zip";
        const ok = window.confirm(`教师下发了作品包「${filename}」，是否载入？\n\n载入会覆盖当前工作区，请确认已保存当前作品。`);
        if (ok) {
          const apply = await fetch(`${root}/workspace/inbox/apply`, { method: "POST" });
          const result = await apply.json().catch(() => ({}));
          if (!apply.ok) {
            throw new Error(result.error || "应用作品包失败");
          }
          toaster.create({ title: "作品包已载入", type: "success", duration: 2000 });
          // 后端已应用 profile；刷新页面触发 /auth/me 重新应用前端 character_config/workspace_state
          window.location.reload();
        } else {
          await fetch(`${root}/workspace/inbox`, { method: "DELETE" });
          toaster.create({ title: "已忽略教师下发作品包", type: "info", duration: 1800 });
          confirmingRef.current = false;
        }
      } catch (error) {
        toaster.create({ title: `作品包处理失败：${(error as Error).message}`, type: "error", duration: 2400 });
        confirmingRef.current = false;
      }
    };

    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [baseUrl, isAuthenticated]);

  return null;
}

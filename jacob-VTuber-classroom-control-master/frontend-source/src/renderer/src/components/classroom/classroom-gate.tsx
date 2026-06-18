import Login from "./login";
import { useClassroom } from "@/context/classroom-context";

/**
 * 课堂登录守卫（PRD S-1）。
 * 未登录（authUsername 为空）时显示登录页；已登录则放行子组件。
 * 在 context 首次 /auth/me 检查完成前也显示登录页（避免闪烁主界面）。
 */
export default function ClassroomGate({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { isAuthenticated } = useClassroom();
  if (!isAuthenticated) {
    return <Login />;
  }
  return <>{children}</>;
}

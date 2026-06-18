import { useState } from "react";
import {
  Box,
  Button,
  Input,
  Stack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { FiLogIn, FiUserPlus } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import { toaster } from "@/components/ui/toaster";
import { useClassroom } from "@/context/classroom-context";

/**
 * 学生端登录页（PRD S-1 / S-2 / S-3）。
 * 元素：用户名输入框、登录按钮、创建用户名按钮。
 * 输入框不显示历史记录（autocomplete="off"）。
 */
export default function Login(): JSX.Element {
  const { t } = useTranslation();
  const { checkUsername, createUser, loginUser, loading } = useClassroom();
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState<"login" | "create">("login");
  const [busy, setBusy] = useState(false);

  const trimmed = username.trim();

  const handleLogin = async () => {
    if (!trimmed) {
      toaster.create({ title: t("classroom.login.needUsername"), type: "warning", duration: 2000 });
      return;
    }
    setBusy(true);
    try {
      const ok = await loginUser(trimmed);
      if (!ok) {
        toaster.create({ title: t("classroom.login.userNotFound"), type: "error", duration: 2400 });
      }
    } catch (err) {
      toaster.create({ title: t("classroom.login.failed", { msg: (err as Error).message }), type: "error", duration: 2400 });
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!trimmed) {
      toaster.create({ title: t("classroom.login.needUsername"), type: "warning", duration: 2000 });
      return;
    }
    setBusy(true);
    try {
      const check = await checkUsername(trimmed);
      if (!check.available) {
        toaster.create({ title: t("classroom.login.usernameExists"), type: "error", duration: 2400 });
        return;
      }
      const ok = await createUser(trimmed);
      if (!ok) {
        toaster.create({ title: t("classroom.login.createFailed"), type: "error", duration: 2400 });
      } else if (check.offline) {
        toaster.create({ title: t("classroom.login.offlineCreated"), type: "info", duration: 3000 });
      }
    } catch (err) {
      toaster.create({ title: t("classroom.login.createFailed", { msg: (err as Error).message }), type: "error", duration: 2400 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      position="fixed"
      inset={0}
      bg="linear-gradient(135deg, #1a202c 0%, #2d3748 100%)"
      display="flex"
      alignItems="center"
      justifyContent="center"
      zIndex={9999}
    >
      <VStack gap={6} w="360px" maxW="90vw">
        <Text fontSize="2xl" fontWeight="bold" color="white">
          {t("classroom.login.title")}
        </Text>
        <Stack w="100%" gap={3}>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("classroom.login.usernamePlaceholder")}
            autoComplete="off"
            size="lg"
            bg="whiteAlpha.100"
            color="white"
            borderColor="whiteAlpha.300"
            _placeholder={{ color: "whiteAlpha.500" }}
            maxLength={32}
          />
          <Button
            w="100%"
            size="lg"
            colorPalette="blue"
            variant={mode === "login" ? "solid" : "outline"}
            loading={busy || loading}
            onClick={handleLogin}
          >
            <Stack direction="row" gap={2} align="center">
              <FiLogIn />
              <Text>{t("classroom.login.login")}</Text>
            </Stack>
          </Button>
          <Button
            w="100%"
            size="lg"
            colorPalette="green"
            variant={mode === "create" ? "solid" : "outline"}
            loading={busy || loading}
            onClick={handleCreate}
          >
            <Stack direction="row" gap={2} align="center">
              <FiUserPlus />
              <Text>{t("classroom.login.create")}</Text>
            </Stack>
          </Button>
        </Stack>
        <Text fontSize="xs" color="whiteAlpha.600">
          {t("classroom.login.hint")}
        </Text>
      </VStack>
    </Box>
  );
}

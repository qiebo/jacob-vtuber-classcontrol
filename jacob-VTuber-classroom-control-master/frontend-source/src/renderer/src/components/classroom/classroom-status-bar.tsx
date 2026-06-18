import {
  Box,
  Button,
  HStack,
  IconButton,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FiRefreshCw, FiSave, FiSend, FiLock, FiUnlock } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import { toaster } from "@/components/ui/toaster";
import { useClassroom } from "@/context/classroom-context";

function formatSavedAt(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ClassroomStatusBar(): JSX.Element {
  const { t } = useTranslation();
  const {
    status,
    currentProfile,
    dirty,
    loading,
    error,
    refreshStatus,
    saveProfile,
    submitProfile,
  } = useClassroom();

  const className = status?.class_name || currentProfile?.class_name || "-";
  const username = status?.current_username || currentProfile?.username || "-";
  const hasProfile = Boolean(status?.current_username || currentProfile?.username);
  const isLocked = Boolean(status?.locked);
  const canWrite = hasProfile && !isLocked && !loading;

  const handleSave = async () => {
    try {
      await saveProfile();
      toaster.create({
        title: t("notification.classroomSaved"),
        type: "success",
        duration: 1600,
      });
    } catch (err) {
      toaster.create({
        title: `${t("error.classroomSaveFailed")}: ${(err as Error).message}`,
        type: "error",
        duration: 2200,
      });
    }
  };

  const handleSubmit = async () => {
    try {
      await submitProfile();
      toaster.create({
        title: t("notification.classroomSubmitted"),
        type: "success",
        duration: 1800,
      });
    } catch (err) {
      toaster.create({
        title: `${t("error.classroomSubmitFailed")}: ${(err as Error).message}`,
        type: "error",
        duration: 2200,
      });
    }
  };

  const handleRefresh = async () => {
    try {
      await refreshStatus();
    } catch (err) {
      toaster.create({
        title: `${t("error.classroomStatusFailed")}: ${(err as Error).message}`,
        type: "error",
        duration: 1800,
      });
    }
  };

  return (
    <Box
      bg="rgba(15, 23, 42, 0.74)"
      color="white"
      borderWidth="1px"
      borderColor="whiteAlpha.200"
      borderRadius="8px"
      boxShadow="0 10px 24px rgba(2, 6, 23, 0.24)"
      backdropFilter="blur(14px)"
      px={3}
      py={2}
      minW="320px"
      maxW="min(560px, calc(100vw - 40px))"
      pointerEvents="auto"
    >
      <HStack justify="space-between" align="center" gap={3}>
        <Stack gap={0} minW={0}>
          <Text fontSize="12px" color="whiteAlpha.700" lineHeight={1.2}>
            {t("classroom.statusBar.title")}
          </Text>
          <Text fontSize="sm" fontWeight="semibold" truncate>
            {t("classroom.statusBar.identity", { className, username })}
          </Text>
          <HStack gap={2} color="whiteAlpha.700" fontSize="12px">
            <Text>
              {dirty
                ? t("classroom.statusBar.unsaved")
                : t("classroom.statusBar.saved", {
                  time: formatSavedAt(status?.last_saved_at) || "-",
                })}
            </Text>
            <Text>/</Text>
            <Text>
              {status?.submitted
                ? t("classroom.statusBar.submitted")
                : t("classroom.statusBar.notSubmitted")}
            </Text>
            <Text>/</Text>
            <HStack gap={1}>
              {isLocked ? <FiLock /> : <FiUnlock />}
              <Text>
                {isLocked
                  ? t("classroom.statusBar.locked")
                  : t("classroom.statusBar.unlocked")}
              </Text>
            </HStack>
          </HStack>
          {error && (
            <Text fontSize="11px" color="red.200" truncate>
              {error}
            </Text>
          )}
        </Stack>
        <HStack gap={1} flexShrink={0}>
          <IconButton
            aria-label={t("classroom.actions.refresh")}
            size="sm"
            variant="ghost"
            color="whiteAlpha.900"
            loading={loading}
            onClick={handleRefresh}
          >
            <FiRefreshCw />
          </IconButton>
          <Button
            size="sm"
            colorPalette="blue"
            disabled={!canWrite}
            loading={loading}
            onClick={handleSave}
          >
            <HStack gap={1}>
              <FiSave />
              <Text>{t("classroom.actions.save")}</Text>
            </HStack>
          </Button>
          <Button
            size="sm"
            colorPalette="green"
            disabled={!canWrite}
            loading={loading}
            onClick={handleSubmit}
          >
            <HStack gap={1}>
              <FiSend />
              <Text>{t("classroom.actions.submit")}</Text>
            </HStack>
          </Button>
        </HStack>
      </HStack>
    </Box>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  HStack,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FiCheck, FiRefreshCw, FiSave, FiSend, FiUserPlus } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import { toaster } from "@/components/ui/toaster";
import { useClassroom } from "@/context/classroom-context";
import { settingStyles } from "./setting-styles";

function formatDate(value?: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export default function Classroom(): JSX.Element {
  const { t } = useTranslation();
  const {
    profiles,
    currentProfile,
    status,
    dirty,
    loading,
    error,
    loadProfiles,
    createProfile,
    loadProfile,
    saveProfile,
    submitProfile,
  } = useClassroom();
  const [username, setUsername] = useState("");
  const [className, setClassName] = useState("");

  const currentUsername = status?.current_username || currentProfile?.username || "";
  const canWrite = Boolean(currentUsername) && !status?.locked && !loading;
  const canCreate = username.trim() && !status?.locked && !loading;

  const sortedProfiles = useMemo(
    () => [...profiles].sort((a, b) =>
      `${a.class_name || ""}/${a.username}`.localeCompare(`${b.class_name || ""}/${b.username}`)),
    [profiles],
  );

  useEffect(() => {
    loadProfiles().catch(() => undefined);
  }, [loadProfiles]);

  const runAction = async (
    action: () => Promise<unknown>,
    successTitle: string,
    errorTitle: string,
  ) => {
    try {
      await action();
      toaster.create({
        title: successTitle,
        type: "success",
        duration: 1600,
      });
    } catch (err) {
      toaster.create({
        title: `${errorTitle}: ${(err as Error).message}`,
        type: "error",
        duration: 2400,
      });
    }
  };

  const handleCreate = async () => {
    await runAction(
      () => createProfile(username, className),
      t("notification.classroomProfileCreated"),
      t("error.classroomCreateFailed"),
    );
    setUsername("");
    setClassName("");
  };

  return (
    <Stack {...settingStyles.common.container}>
      <Box {...settingStyles.common.moduleCard}>
        <Stack gap={4}>
          <Text {...settingStyles.common.sectionTitle}>
            {t("settings.classroom.currentModule")}
          </Text>
          <Stack gap={2}>
            <Text fontSize="sm" color="whiteAlpha.900">
              {currentUsername
                ? t("settings.classroom.currentProfile", {
                  className: status?.class_name || currentProfile?.class_name || "-",
                  username: currentUsername,
                })
                : t("settings.classroom.noCurrentProfile")}
            </Text>
            <HStack gap={2} color="whiteAlpha.700" fontSize="xs" wrap="wrap">
              <Text>
                {dirty
                  ? t("classroom.statusBar.unsaved")
                  : t("classroom.statusBar.saved", {
                    time: formatDate(status?.last_saved_at),
                  })}
              </Text>
              <Text>/</Text>
              <Text>
                {status?.submitted
                  ? t("classroom.statusBar.submitted")
                  : t("classroom.statusBar.notSubmitted")}
              </Text>
              <Text>/</Text>
              <Text>
                {status?.locked
                  ? t("classroom.statusBar.locked")
                  : t("classroom.statusBar.unlocked")}
              </Text>
            </HStack>
            {error && (
              <Text fontSize="xs" color="red.200">
                {error}
              </Text>
            )}
          </Stack>
          <HStack gap={2} wrap="wrap">
            <Button
              size="sm"
              colorPalette="blue"
              disabled={!canWrite}
              loading={loading}
              onClick={() => runAction(
                saveProfile,
                t("notification.classroomSaved"),
                t("error.classroomSaveFailed"),
              )}
            >
              <HStack gap={2}>
                <FiSave />
                <Text>{t("classroom.actions.save")}</Text>
              </HStack>
            </Button>
            <Button
              size="sm"
              colorPalette="green"
              disabled={!canWrite}
              loading={loading}
              onClick={() => runAction(
                submitProfile,
                t("notification.classroomSubmitted"),
                t("error.classroomSubmitFailed"),
              )}
            >
              <HStack gap={2}>
                <FiSend />
                <Text>{t("classroom.actions.submit")}</Text>
              </HStack>
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={loading}
              onClick={() => runAction(
                loadProfiles,
                t("notification.classroomProfilesRefreshed"),
                t("error.classroomProfilesFailed"),
              )}
            >
              <HStack gap={2}>
                <FiRefreshCw />
                <Text>{t("classroom.actions.refresh")}</Text>
              </HStack>
            </Button>
          </HStack>
        </Stack>
      </Box>

      <Box {...settingStyles.common.moduleCard}>
        <Stack gap={4}>
          <Text {...settingStyles.common.sectionTitle}>
            {t("settings.classroom.createModule")}
          </Text>
          <Stack gap={2}>
            <Text {...settingStyles.common.fieldLabel}>
              {t("settings.classroom.username")}
            </Text>
            <Input
              {...settingStyles.common.input}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t("settings.classroom.usernamePlaceholder")}
            />
          </Stack>
          <Stack gap={2}>
            <Text {...settingStyles.common.fieldLabel}>
              {t("settings.classroom.className")}
            </Text>
            <Input
              {...settingStyles.common.input}
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              placeholder={t("settings.classroom.classNamePlaceholder")}
            />
          </Stack>
          <Button
            colorPalette="blue"
            disabled={!canCreate}
            loading={loading}
            onClick={handleCreate}
          >
            <HStack gap={2}>
              <FiUserPlus />
              <Text>{t("settings.classroom.createProfile")}</Text>
            </HStack>
          </Button>
        </Stack>
      </Box>

      <Box {...settingStyles.common.moduleCard}>
        <Stack gap={4}>
          <Text {...settingStyles.common.sectionTitle}>
            {t("settings.classroom.profileListModule")}
          </Text>
          {sortedProfiles.length === 0 ? (
            <Text fontSize="sm" color="whiteAlpha.700">
              {t("settings.classroom.emptyProfiles")}
            </Text>
          ) : (
            <Stack gap={3}>
              {sortedProfiles.map((profile) => {
                const isCurrent = profile.username === currentUsername;
                return (
                  <Box
                    key={profile.username}
                    p={3}
                    borderWidth="1px"
                    borderColor={isCurrent ? "blue.300" : "whiteAlpha.200"}
                    borderRadius="8px"
                    bg={isCurrent ? "rgba(30, 64, 175, 0.30)" : "whiteAlpha.50"}
                  >
                    <HStack justify="space-between" align="start" gap={3}>
                      <Stack gap={1} minW={0}>
                        <HStack gap={2}>
                          <Text fontSize="sm" color="whiteAlpha.950" fontWeight="semibold">
                            {profile.username}
                            {profile.class_name ? ` (${profile.class_name})` : ""}
                          </Text>
                          {isCurrent && <FiCheck />}
                        </HStack>
                        <Text fontSize="xs" color="whiteAlpha.600" truncate>
                          {profile.username}
                        </Text>
                        <Text fontSize="xs" color="whiteAlpha.600">
                          {t("settings.classroom.profileMeta", {
                            savedAt: formatDate(profile.last_saved_at),
                            status: profile.submitted
                              ? t("classroom.statusBar.submitted")
                              : profile.dirty
                                ? t("classroom.statusBar.unsaved")
                                : t("classroom.statusBar.saved", { time: "" }),
                          })}
                        </Text>
                      </Stack>
                      <Button
                        size="sm"
                        colorPalette={isCurrent ? "gray" : "blue"}
                        variant={isCurrent ? "outline" : "solid"}
                        disabled={isCurrent || loading}
                        loading={loading}
                        onClick={() => runAction(
                          () => loadProfile(profile.username),
                          t("notification.classroomProfileLoaded"),
                          t("error.classroomLoadFailed"),
                        )}
                      >
                        {t("settings.classroom.loadProfile")}
                      </Button>
                    </HStack>
                  </Box>
                );
              })}
            </Stack>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}

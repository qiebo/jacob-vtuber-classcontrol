/* eslint-disable import/no-extraneous-dependencies */
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, HStack, IconButton, Stack, Text } from "@chakra-ui/react";
import { FiTrash2, FiUpload } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import { toaster } from "@/components/ui/toaster";
import { settingStyles } from "./setting-styles";
import { SwitchField } from "./common";
import { useWebSocket } from "@/context/websocket-context";
import { useClassroom } from "@/context/classroom-context";
import { wsService, MessageEvent } from "@/services/websocket-service";
import { useLocalStorage } from "@/hooks/utils/use-local-storage";

interface KnowledgeFileItem {
  id: string;
  name: string;
  extension: string;
  size_bytes: number;
  uploaded_at: string;
  chunk_count: number;
}

interface KnowledgeLimits {
  max_files: number;
  max_total_size_bytes: number;
  max_single_file_bytes: number;
  supported_extensions: string[];
}

interface KnowledgeResponse {
  files?: KnowledgeFileItem[];
  file_count?: number;
  total_size_bytes?: number;
  limits?: KnowledgeLimits;
  error?: string;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const formatDate = (isoString: string): string => {
  if (!isoString) {
    return "-";
  }
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return isoString;
  }
  return parsed.toLocaleString();
};

function Knowledge(): JSX.Element {
  const { t } = useTranslation();
  const { baseUrl, wsState } = useWebSocket();
  const { markDirty } = useClassroom();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<KnowledgeFileItem[]>([]);
  const [limits, setLimits] = useState<KnowledgeLimits | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [totalSizeBytes, setTotalSizeBytes] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [knowledgeEnabled, setKnowledgeEnabled] = useLocalStorage<boolean>(
    "knowledgeEnabled",
    false,
  );
  const pendingKnowledgeEnabledRef = useRef<boolean | null>(null);

  const normalizedBaseUrl = useMemo(() => baseUrl.replace(/\/+$/, ""), [baseUrl]);

  const fetchKnowledgeFiles = useCallback(async () => {
    const endpoint = `${normalizedBaseUrl}/knowledge/files`;
    setIsLoading(true);
    try {
      const response = await fetch(endpoint);
      const payload = await response.json().catch(() => ({} as KnowledgeResponse));
      if (!response.ok) {
        throw new Error(payload.error || t("error.knowledgeListFailed"));
      }
      setFiles(Array.isArray(payload.files) ? payload.files : []);
      setFileCount(Number(payload.file_count || 0));
      setTotalSizeBytes(Number(payload.total_size_bytes || 0));
      setLimits(payload.limits || null);
    } catch (error) {
      toaster.create({
        title: `${t("error.knowledgeListFailed")}: ${(error as Error).message}`,
        type: "error",
        duration: 2200,
      });
    } finally {
      setIsLoading(false);
    }
  }, [normalizedBaseUrl, t]);

  useEffect(() => {
    fetchKnowledgeFiles();
  }, [fetchKnowledgeFiles]);

  useEffect(() => {
    const subscription = wsService.onMessage((message: MessageEvent) => {
      if (
        message.type === "knowledge-settings"
        && typeof message.knowledge_enabled === "boolean"
      ) {
        const nextEnabled = message.knowledge_enabled;
        setKnowledgeEnabled(nextEnabled);

        if (
          pendingKnowledgeEnabledRef.current !== null
          && pendingKnowledgeEnabledRef.current === nextEnabled
        ) {
          toaster.create({
            title: nextEnabled
              ? t("notification.knowledgeEnabled")
              : t("notification.knowledgeDisabled"),
            type: "success",
            duration: 1400,
          });
          pendingKnowledgeEnabledRef.current = null;
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setKnowledgeEnabled, t]);

  useEffect(() => {
    if (wsState !== "OPEN") {
      return;
    }

    wsService.sendMessage({
      type: "update-knowledge-settings",
      knowledge_enabled: knowledgeEnabled,
    });
  }, [knowledgeEnabled, wsState]);

  const handleOpenUploadDialog = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || isUploading) {
      return;
    }

    const endpoint = `${normalizedBaseUrl}/knowledge/upload`;
    const formData = new FormData();
    formData.append("file", file);

    setIsUploading(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({} as KnowledgeResponse));
      if (!response.ok) {
        throw new Error(payload.error || t("error.knowledgeUploadFailed"));
      }
      toaster.create({
        title: t("notification.knowledgeUploadSuccess"),
        type: "success",
        duration: 1800,
      });
      markDirty();
      await fetchKnowledgeFiles();
    } catch (error) {
      toaster.create({
        title: `${t("error.knowledgeUploadFailed")}: ${(error as Error).message}`,
        type: "error",
        duration: 2400,
      });
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const handleDelete = async (fileId: string) => {
    if (!fileId || deletingFileId) {
      return;
    }
    const endpoint = `${normalizedBaseUrl}/knowledge/files/${encodeURIComponent(fileId)}`;
    setDeletingFileId(fileId);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      const payload = await response.json().catch(() => ({} as KnowledgeResponse));
      if (!response.ok) {
        throw new Error(payload.error || t("error.knowledgeDeleteFailed"));
      }
      toaster.create({
        title: t("notification.knowledgeDeleted"),
        type: "success",
        duration: 1600,
      });
      markDirty();
      await fetchKnowledgeFiles();
    } catch (error) {
      toaster.create({
        title: `${t("error.knowledgeDeleteFailed")}: ${(error as Error).message}`,
        type: "error",
        duration: 2200,
      });
    } finally {
      setDeletingFileId(null);
    }
  };

  const handleKnowledgeToggle = (checked: boolean) => {
    setKnowledgeEnabled(checked);
    pendingKnowledgeEnabledRef.current = checked;
    markDirty();
  };

  return (
    <Stack {...settingStyles.common.container}>
      <Box {...settingStyles.common.moduleCard}>
        <Stack gap={4}>
          <Text {...settingStyles.common.sectionTitle}>{t("settings.knowledge.moduleTitle")}</Text>
          <Text fontSize="sm" color="whiteAlpha.800">
            {t("settings.knowledge.moduleDescription")}
          </Text>
          <SwitchField
            label={t("settings.knowledge.enableForCurrentConversation")}
            checked={knowledgeEnabled}
            onChange={handleKnowledgeToggle}
            help={t("settings.knowledge.enableForCurrentConversationHelp")}
          />
          <HStack justify="space-between" align="center">
            <Text fontSize="xs" color="whiteAlpha.700">
              {t("settings.knowledge.limitSummary", {
                fileCount,
                maxFiles: limits?.max_files ?? 5,
                totalSize: formatBytes(totalSizeBytes),
                maxTotalSize: formatBytes(limits?.max_total_size_bytes ?? 8 * 1024 * 1024),
              })}
            </Text>
          </HStack>
          <Button
            {...settingStyles.common.primaryActionButton}
            onClick={handleOpenUploadDialog}
            loading={isUploading}
          >
            <HStack gap={2}>
              <FiUpload />
              <Text>
                {isUploading
                  ? t("settings.knowledge.uploading")
                  : t("settings.knowledge.uploadButton")}
              </Text>
            </HStack>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.pdf,.docx"
            onChange={handleUpload}
            style={{ display: "none" }}
          />
          <Text fontSize="xs" color="whiteAlpha.700">
            {t("settings.knowledge.supportHint", {
              maxSingle: formatBytes(limits?.max_single_file_bytes ?? 2 * 1024 * 1024),
            })}
          </Text>
        </Stack>
      </Box>

      <Box {...settingStyles.common.moduleCard}>
        <Stack gap={3}>
          <Text {...settingStyles.common.sectionTitle}>{t("settings.knowledge.fileListTitle")}</Text>
          {isLoading ? (
            <Text fontSize="sm" color="whiteAlpha.700">
              {t("settings.knowledge.loading")}
            </Text>
          ) : files.length === 0 ? (
            <Text fontSize="sm" color="whiteAlpha.700">
              {t("settings.knowledge.empty")}
            </Text>
          ) : (
            files.map((file) => (
              <HStack
                key={file.id}
                p={3}
                borderWidth="1px"
                borderRadius="lg"
                borderColor="whiteAlpha.200"
                bg="whiteAlpha.50"
                justify="space-between"
                align="start"
              >
                <Stack gap={1}>
                  <Text fontSize="sm" color="whiteAlpha.900" fontWeight="medium">
                    {file.name}
                  </Text>
                  <Text fontSize="xs" color="whiteAlpha.700">
                    {formatBytes(file.size_bytes)} · {t("settings.knowledge.chunkCount", { count: file.chunk_count })}
                  </Text>
                  <Text fontSize="xs" color="whiteAlpha.600">
                    {formatDate(file.uploaded_at)}
                  </Text>
                </Stack>
                <IconButton
                  aria-label={t("settings.knowledge.deleteFile")}
                  size="xs"
                  variant="ghost"
                  colorPalette="red"
                  loading={deletingFileId === file.id}
                  onClick={() => handleDelete(file.id)}
                >
                  <FiTrash2 />
                </IconButton>
              </HStack>
            ))
          )}
        </Stack>
      </Box>
    </Stack>
  );
}

export default Knowledge;

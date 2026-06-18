import { Box, Stack, Text } from "@chakra-ui/react";
import { FiLock } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import { useClassroom } from "@/context/classroom-context";

export default function ClassroomLockOverlay(): JSX.Element | null {
  const { t } = useTranslation();
  const { status } = useClassroom();

  if (!status?.locked) {
    return null;
  }

  return (
    <Box
      position="fixed"
      inset={0}
      zIndex={10000}
      display="grid"
      placeItems="center"
      bg="rgba(15, 23, 42, 0.96)"
      color="white"
      pointerEvents="auto"
      userSelect="none"
    >
      <Stack align="center" gap={4} textAlign="center" px={6}>
        <Box fontSize="42px" aria-hidden>
          <FiLock />
        </Box>
        <Text fontSize="2xl" fontWeight="semibold">
          {t("classroom.lockOverlay.title")}
        </Text>
        <Text fontSize="md" color="whiteAlpha.700">
          {t("classroom.lockOverlay.description")}
        </Text>
      </Stack>
    </Box>
  );
}

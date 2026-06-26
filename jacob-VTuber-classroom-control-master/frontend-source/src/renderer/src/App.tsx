/* eslint-disable no-shadow */
// import { StrictMode } from 'react';
import { Box, Flex, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { useState, useEffect, useRef } from "react";
// import Canvas from './components/canvas/canvas'; // Likely unused now
import Sidebar from "./components/sidebar/sidebar";
import HistorySidebar from "./components/sidebar/history-sidebar";
import Footer from "./components/footer/footer";
import { AiStateProvider } from "./context/ai-state-context";
import { Live2DConfigProvider } from "./context/live2d-config-context";
import { SubtitleProvider } from "./context/subtitle-context";
import { BgUrlProvider } from "./context/bgurl-context";
import { layoutStyles } from "./layout";
import WebSocketHandler from "./services/websocket-handler";
import { CameraProvider } from "./context/camera-context";
import { ChatHistoryProvider } from "./context/chat-history-context";
import { CharacterConfigProvider } from "./context/character-config-context";
import { Toaster } from "./components/ui/toaster";
import { VADProvider } from "./context/vad-context";
import { Live2D } from "./components/canvas/live2d";
import TitleBar from "./components/electron/title-bar";
import { InputSubtitle } from "./components/electron/input-subtitle";
import { ProactiveSpeakProvider } from "./context/proactive-speak-context";
import { ScreenCaptureProvider } from "./context/screen-capture-context";
import { GroupProvider } from "./context/group-context";
import { BrowserProvider } from "./context/browser-context";
import { UiEntryVisibilityProvider } from "./context/ui-entry-visibility-context";
import { ClassroomProvider } from "./context/classroom-context";
// eslint-disable-next-line import/no-extraneous-dependencies, import/newline-after-import
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import Background from "./components/canvas/background";
import WebSocketStatus from "./components/canvas/ws-status";
import ClassroomStatusBar from "./components/classroom/classroom-status-bar";
import ClassroomLockOverlay from "./components/classroom/classroom-lock-overlay";
import ClassroomSnapshotUploader from "./components/classroom/classroom-snapshot-uploader";
import ClassroomGate from "./components/classroom/classroom-gate";
import WorkspaceInboxListener from "./components/classroom/workspace-inbox-listener";
import Subtitle from "./components/canvas/subtitle";
import { ModeProvider, useMode } from "./context/mode-context";
import { AvatarPack } from "./components/canvas/avatar-pack";
import {
  STAGE_DIALOG_WIDTH,
  STAGE_FOOTER_HEIGHT,
  STAGE_SAFE_AREA_HEIGHT,
  STAGE_SAFE_AREA_WIDTH,
  STAGE_SUBTITLE_COLLAPSED_BOTTOM,
  STAGE_SUBTITLE_EXPANDED_BOTTOM,
} from "./components/canvas/stage-safe-area";
import {
  AvatarAppearanceProvider,
  useAvatarAppearance,
} from "./context/avatar-appearance-context";

function AppContent(): JSX.Element {
  const [showSettingsSidebar, setShowSettingsSidebar] = useState(false);
  const [showHistorySidebar, setShowHistorySidebar] = useState(false);
  const [isFooterCollapsed, setIsFooterCollapsed] = useState(false);
  const { mode } = useMode();
  const { avatarMode } = useAvatarAppearance();
  const isElectron = window.api !== undefined;
  const live2dContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty("--vh", `${vh}px`);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

    
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.height = '100%';
  document.body.style.height = '100%';
  document.documentElement.style.position = 'fixed';
  document.body.style.position = 'fixed';
  document.documentElement.style.width = '100%';
  document.body.style.width = '100%';

  // Define base style properties shared across modes/breakpoints
  const live2dBaseStyle = {
    position: "absolute" as const,
    overflow: "hidden",
    transition: "all 0.3s ease-in-out", // Optional transition
    pointerEvents: "auto" as const,
  };

  // Define styles specifically for the "window" mode, using responsive syntax
  const getResponsiveLive2DWindowStyle = () => ({
    ...live2dBaseStyle,
    top: isElectron ? "30px" : "0px",
    height: `calc(100% - ${isElectron ? "30px" : "0px"})`,
    zIndex: 5, // Ensure it's layered correctly below UI but above background
    left: "0px",
    width: "100%",
  });

  const toggleSettingsSidebar = () => {
    setShowSettingsSidebar((prev) => {
      const next = !prev;
      if (next) {
        setShowHistorySidebar(false);
      }
      return next;
    });
  };

  const toggleHistorySidebar = () => {
    setShowHistorySidebar((prev) => {
      const next = !prev;
      if (next) {
        setShowSettingsSidebar(false);
      }
      return next;
    });
  };

  // Define styles specifically for the "pet" mode
  const live2dPetStyle = {
    ...live2dBaseStyle,
    top: 0, // Override position for pet mode
    left: 0,
    width: "100vw", // Full viewport
    height: "100vh",
    zIndex: 15, // Higher zIndex for pet mode overlay
  };

  return (
    <>
      <Box
        ref={live2dContainerRef}
        // Apply styles conditionally based on mode
        // Use the function to get dynamic responsive styles for window mode
        {...(mode === "window"
          ? getResponsiveLive2DWindowStyle()
          : live2dPetStyle)}
      >
        {avatarMode === "live2d" ? <Live2D /> : <AvatarPack />}
      </Box>

      {/* Conditional Rendering of Window UI */}
      {mode === "window" && (
        <>
          {isElectron && <TitleBar />}
          {/* Apply styles by spreading */}
          <Flex {...layoutStyles.appContainer}>
            <Box {...layoutStyles.sidebar('left')}>
              <Sidebar
                isCollapsed={!showSettingsSidebar}
                onToggle={toggleSettingsSidebar}
              />
            </Box>
            <Box {...layoutStyles.mainContent}>
              <Background />
              <Box position="absolute" top="20px" left="20px" zIndex={10}>
                <WebSocketStatus />
              </Box>
              <Box position="absolute" top="20px" right="20px" zIndex={10}>
                <ClassroomStatusBar />
              </Box>
              <Box
                position="absolute"
                left="50%"
                top="50%"
                transform="translate(-50%, -50%)"
                zIndex={10}
                width={STAGE_SAFE_AREA_WIDTH}
                height={STAGE_SAFE_AREA_HEIGHT}
                pointerEvents="none"
                overflow="visible"
              >
                <Box
                  position="absolute"
                  bottom={isFooterCollapsed
                    ? STAGE_SUBTITLE_COLLAPSED_BOTTOM
                    : STAGE_SUBTITLE_EXPANDED_BOTTOM}
                  left="50%"
                  transform="translateX(-50%)"
                  width={STAGE_DIALOG_WIDTH}
                  pointerEvents="auto"
                >
                  <Subtitle />
                </Box>
                <Box
                  position="absolute"
                  bottom="-20px"
                  left="50%"
                  transform="translateX(-50%)"
                  width={STAGE_DIALOG_WIDTH}
                  height={STAGE_FOOTER_HEIGHT}
                  pointerEvents="auto"
                >
                  <Footer
                    isCollapsed={isFooterCollapsed}
                    onToggle={() => setIsFooterCollapsed(!isFooterCollapsed)}
                  />
                </Box>
              </Box>
            </Box>
            <Box {...layoutStyles.sidebar('right')}>
              <HistorySidebar
                isCollapsed={!showHistorySidebar}
                onToggle={toggleHistorySidebar}
              />
            </Box>
          </Flex>
        </>
      )}

      {/* Conditional Rendering of Pet Mode UI */}
      {mode === "pet" && <InputSubtitle />}
    </>
  );
}

function App(): JSX.Element {
  return (
    <ChakraProvider value={defaultSystem}>
      {/* ModeProvider needs to wrap AppContent to provide mode to getGlobalStyles */}
      <ModeProvider>
        <AppWithGlobalStyles />
      </ModeProvider>
    </ChakraProvider>
  );
}

// New component to access mode for global styles
function AppWithGlobalStyles(): JSX.Element {
  return (
    <>
      <CameraProvider>
        <ScreenCaptureProvider>
          <CharacterConfigProvider>
            <ChatHistoryProvider>
              <AiStateProvider>
                <ProactiveSpeakProvider>
                  <Live2DConfigProvider>
                    <SubtitleProvider>
                      <VADProvider>
                        <BgUrlProvider>
                          <GroupProvider>
                            <BrowserProvider>
                              <UiEntryVisibilityProvider>
                                <AvatarAppearanceProvider>
                                  <WebSocketHandler>
                                    <ClassroomProvider>
                                      <Toaster />
                                      <ClassroomGate>
                                        <WorkspaceInboxListener />
                                        <AppContent />
                                        <ClassroomSnapshotUploader />
                                        <ClassroomLockOverlay />
                                      </ClassroomGate>
                                    </ClassroomProvider>
                                  </WebSocketHandler>
                                </AvatarAppearanceProvider>
                              </UiEntryVisibilityProvider>
                            </BrowserProvider>
                          </GroupProvider>
                        </BgUrlProvider>
                      </VADProvider>
                    </SubtitleProvider>
                  </Live2DConfigProvider>
                </ProactiveSpeakProvider>
              </AiStateProvider>
            </ChatHistoryProvider>
          </CharacterConfigProvider>
        </ScreenCaptureProvider>
      </CameraProvider>
    </>
  );
}

export default App;

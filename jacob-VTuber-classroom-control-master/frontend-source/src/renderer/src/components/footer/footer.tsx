/* eslint-disable react/require-default-props */
import {
  Box, Textarea, IconButton, HStack,
} from '@chakra-ui/react';
import { BsMicFill, BsMicMuteFill, BsPaperclip } from 'react-icons/bs';
import { IoHandRightSharp } from 'react-icons/io5';
import { FiChevronDown } from 'react-icons/fi';
import { RiShutDownLine } from 'react-icons/ri';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { InputGroup } from '@/components/ui/input-group';
import { footerStyles } from './footer-styles';
import { useFooter } from '@/hooks/footer/use-footer';

// Type definitions
interface FooterProps {
  isCollapsed?: boolean
  onToggle?: () => void
}

interface ToggleButtonProps {
  onToggle?: () => void
}

interface ActionButtonsProps {
  micOn: boolean
  onMicToggle: () => void
  onInterrupt: () => void
  onExitProject: () => void
}

interface MessageInputProps {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
}

// Reusable components
const FloatingToggleButton = memo(({ onToggle }: ToggleButtonProps) => (
  <Box
    {...footerStyles.footer.toggleButton(true)}
    onClick={onToggle}
  >
    <FiChevronDown
      size={22}
      style={{
        transform: 'rotate(180deg)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    />
  </Box>
));

FloatingToggleButton.displayName = 'FloatingToggleButton';

const InlineToggleButton = memo(({ onToggle }: ToggleButtonProps) => (
  <Box
    {...footerStyles.footer.inlineToggleButton}
    onClick={onToggle}
  >
    <FiChevronDown
      size={24}
      style={{
        transform: 'rotate(0deg)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    />
  </Box>
));

InlineToggleButton.displayName = 'InlineToggleButton';

const ActionButtons = memo(({
  micOn,
  onMicToggle,
  onInterrupt,
  onExitProject,
}: ActionButtonsProps) => {
  const { t } = useTranslation();

  return (
    <HStack gap={3} align="stretch" flexShrink={0}>
      <IconButton
        bg={micOn ? 'green.500' : 'red.500'}
        {...footerStyles.footer.actionButton}
        onClick={onMicToggle}
      >
        {micOn ? <BsMicFill size="40" /> : <BsMicMuteFill size="40" />}
      </IconButton>
      <IconButton
        aria-label="Raise hand"
        bg="yellow.500"
        {...footerStyles.footer.actionButton}
        onClick={onInterrupt}
      >
        <IoHandRightSharp size="42" />
      </IconButton>
      <IconButton
        aria-label={t('footer.exitProject')}
        bg="red.600"
        {...footerStyles.footer.actionButton}
        onClick={onExitProject}
      >
        <RiShutDownLine size="40" />
      </IconButton>
    </HStack>
  );
});

ActionButtons.displayName = 'ActionButtons';

const MessageInput = memo(({
  value,
  onChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
}: MessageInputProps) => {
  const { t } = useTranslation();

  return (
    <InputGroup flex={1}>
      <Box position="relative" width="100%">
        <IconButton
          aria-label="Attach file"
          variant="ghost"
          {...footerStyles.footer.attachButton}
        >
          <BsPaperclip size="24" />
        </IconButton>
        <Textarea
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder={t('footer.typeYourMessage')}
          {...footerStyles.footer.input}
        />
      </Box>
    </InputGroup>
  );
});

MessageInput.displayName = 'MessageInput';

// Main component
function Footer({ isCollapsed = false, onToggle }: FooterProps): JSX.Element {
  const {
    inputValue,
    handleInputChange,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
    handleInterrupt,
    handleExitProject,
    handleMicToggle,
    micOn,
  } = useFooter();

  return (
    <Box {...footerStyles.footer.wrapper}>
      {isCollapsed && <FloatingToggleButton onToggle={onToggle} />}

      {!isCollapsed && (
        <Box {...footerStyles.footer.container(isCollapsed)}>
          <HStack width="100%" gap={4} align="stretch">
            <ActionButtons
              micOn={micOn}
              onMicToggle={handleMicToggle}
              onInterrupt={handleInterrupt}
              onExitProject={handleExitProject}
            />

            <MessageInput
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyPress}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
            />
            <InlineToggleButton onToggle={onToggle} />
          </HStack>
        </Box>
      )}
    </Box>
  );
}

export default Footer;

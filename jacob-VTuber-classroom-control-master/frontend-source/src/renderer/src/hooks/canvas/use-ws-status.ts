import { useMemo, useCallback } from 'react';
import { useWebSocket } from '@/context/websocket-context';

interface WSStatusInfo {
  color: string
  isDisconnected: boolean
  handleClick: () => void
}

export const useWSStatus = () => {
  const { wsState, reconnect } = useWebSocket();

  const handleClick = useCallback(() => {
    if (wsState !== 'OPEN' && wsState !== 'CONNECTING') {
      reconnect();
    }
  }, [wsState, reconnect]);

  const statusInfo = useMemo((): WSStatusInfo => {
    return {
      color: wsState === 'OPEN' ? 'green.400' : 'red.400',
      isDisconnected: wsState !== 'OPEN',
      handleClick,
    };
  }, [wsState, handleClick]);

  return statusInfo;
};

import { createContext, useContext, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

interface ConnectionContextValue {
  connectionStatus: ConnectionStatus;
  presenceSocket: Socket | null;
}

const ConnectionContext = createContext<ConnectionContextValue | undefined>(undefined);

interface ConnectionProviderProps {
  value: ConnectionContextValue;
  children: ReactNode;
}

export function ConnectionProvider({ value, children }: ConnectionProviderProps) {
  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnectionContext(): ConnectionContextValue {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error('useConnectionContext must be used within a ConnectionProvider');
  }
  return context;
}

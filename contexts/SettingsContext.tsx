import React, { createContext, useContext, useState, useEffect } from 'react';

interface SettingsContextType {
  apiKey: string;
  setApiKey: (key: string) => void;
  isAiEnabled: boolean;
  setIsAiEnabled: (enabled: boolean) => void;
  isSettingsModalOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apiKey, setApiKey] = useState<string>('');
  const [isAiEnabled, setIsAiEnabled] = useState<boolean>(true);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  useEffect(() => {
    const storedKey = localStorage.getItem('gemini_api_key');
    const storedEnabled = localStorage.getItem('ai_enabled');
    
    if (storedKey) setApiKey(storedKey);
    if (storedEnabled !== null) setIsAiEnabled(storedEnabled === 'true');
  }, []);

  const updateApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

  const updateAiEnabled = (enabled: boolean) => {
    setIsAiEnabled(enabled);
    localStorage.setItem('ai_enabled', String(enabled));
  };

  const openSettings = () => setIsSettingsModalOpen(true);
  const closeSettings = () => setIsSettingsModalOpen(false);

  return (
    <SettingsContext.Provider value={{ 
      apiKey, 
      setApiKey: updateApiKey, 
      isAiEnabled, 
      setIsAiEnabled: updateAiEnabled,
      isSettingsModalOpen,
      openSettings,
      closeSettings
    }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used within a SettingsProvider');
  return context;
};

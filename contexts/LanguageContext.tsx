
import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, Language } from '../translations';
import { format as fnsFormat } from 'date-fns';
import { de } from 'date-fns/locale';

const LANGUAGE_STORAGE_KEY = 'ibs_qfc_language';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  formatDate: (date: Date, formatStr: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language | null;
      if (stored && stored in translations) return stored;
    } catch {
      // localStorage unavailable (e.g. private mode)
    }
    return 'de';
  });

  // Persist language changes
  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // ignore
    }
  }, [language]);

  const t = (key: string) => {
    const keys = key.split('.');
    let value: any = translations[language];
    for (const k of keys) {
      value = value?.[k];
    }
    if (typeof value !== 'string') {
      console.warn(`[i18n] Missing translation key: "${key}" (${language})`);
      return key;
    }
    return value;
  };

  const formatDate = (date: Date, formatStr: string) =>
    language === 'de' ? fnsFormat(date, formatStr, { locale: de }) : fnsFormat(date, formatStr);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, formatDate }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within a LanguageProvider');
  return context;
};

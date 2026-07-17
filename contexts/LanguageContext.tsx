
import React, { createContext, useContext, useState } from 'react';
import { translations, Language } from '../translations';
import { format as fnsFormat } from 'date-fns';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  formatDate: (date: Date, formatStr: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('de');

  const t = (key: string) => {
    const keys = key.split('.');
    let value: any = translations[language];
    for (const k of keys) {
      value = value?.[k];
    }
    return value || key;
  };

  const formatDate = (date: Date, formatStr: string) => {
    // Basic overrides for German locale since we might not have the full locale object loaded
    if (language === 'de') {
      let res = formatStr;

      // 1. Replace Month Names
      if (res.includes('MMMM')) {
        const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
        res = res.replace('MMMM', monthNames[date.getMonth()]);
      } else if (res.includes('MMM')) {
        const shortMonths = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
        res = res.replace('MMM', shortMonths[date.getMonth()]);
      }

      // 2. Replace Weekday Names
      if (res.includes('EEE')) {
        const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
        res = res.replace('EEE', days[date.getDay()]);
      } else if (res.includes('EEEE')) {
        const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
        res = res.replace('EEEE', days[date.getDay()]);
      }

      // 3. Replace numeric tokens
      const year = date.getFullYear().toString();
      const day = date.getDate().toString();
      const dayPadded = day.padStart(2, '0');
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');

      res = res.replace('yyyy', year);
      
      // Handle dd vs d
      if (res.includes('dd')) {
          res = res.replace('dd', dayPadded);
      } else if (res.includes('d')) {
          res = res.replace('d', day);
      }

      res = res.replace('HH', hours);
      res = res.replace('mm', minutes);
      
      return res;
    }
    
    // Fallback to date-fns default (English)
    return fnsFormat(date, formatStr);
  };

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

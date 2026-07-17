
import React, { useState, useEffect, useRef } from 'react';
import { Bot, Send, Minimize2, Settings, Terminal, Cpu, AlertTriangle, ChevronDown, Sparkles, ArrowRight, X } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useLanguage } from '../contexts/LanguageContext';
import { chatWithResourceData } from '../services/chatAi';
import { Assignment, Employee, Project, Absence } from '../types';
import { AsciiSpinner } from './ui/AsciiSpinner';

interface ResourcePlanChatProps {
  employees: Employee[];
  projects: Project[];
  assignments: Assignment[];
  absences: Absence[];
  currentDate: Date;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export const ResourcePlanChat: React.FC<ResourcePlanChatProps> = ({
  employees,
  projects,
  assignments,
  absences,
  currentDate
}) => {
  const { isAiEnabled, apiKey, openSettings } = useSettings();
  const { language, t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen && !isMinimized) {
      scrollToBottom();
      // Auto-focus only if not mobile
      if (window.innerWidth > 768) {
         inputRef.current?.focus();
      }
    }
  }, [messages, isOpen, isMinimized]);

  const handleSend = async (e?: React.FormEvent, manualInput?: string) => {
    if (e) e.preventDefault();
    const textToSend = manualInput || input;
    if (!textToSend.trim() || isLoading) return;

    if (!isAiEnabled || !apiKey) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: t('chat.accessDenied'),
        timestamp: Date.now()
      }]);
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: textToSend,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const history = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }));

      const responseText = await chatWithResourceData(
        userMessage.content,
        { employees, projects, assignments, absences, currentDate },
        apiKey,
        language,
        history
      );

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText,
        timestamp: Date.now()
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'system',
        content: t('chat.errorComputation'),
        timestamp: Date.now()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleChat = () => {
    setIsOpen(!isOpen);
    setIsMinimized(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    setMessages([]);
    setInput('');
  };

  const suggestions = [
      t('chat.suggestion1'),
      t('chat.suggestion2'),
      t('chat.suggestion3'),
      t('chat.suggestion4')
  ];

  const handleOpenSettings = () => {
    setIsOpen(false);
    openSettings();
  };

  return (
    <>
      {/* Trigger Button */}
      <div className={`fixed bottom-6 right-6 z-40 transition-all duration-300 ${isOpen ? 'opacity-0 pointer-events-none translate-y-4' : 'opacity-100 translate-y-0'}`}>
        <button
          onClick={toggleChat}
          className="group relative flex items-center justify-center w-10 h-10 bg-charcoal-900 border border-charcoal-700 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all overflow-hidden"
        >
          <div className="absolute inset-0 bg-blue-500/10 rounded-full animate-pulse-subtle"></div>
          <Bot className="w-5 h-5 text-blue-400 relative z-10 group-hover:text-blue-300 transition-colors" />
        </button>
      </div>

      {/* Chat Window */}
      <div 
        className={`fixed bottom-6 right-6 z-50 flex flex-col bg-charcoal-900/95 backdrop-blur-xl border border-charcoal-700 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 origin-bottom-right
        ${isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'}
        ${isMinimized ? 'w-64 h-14 rounded-full cursor-pointer border-charcoal-600' : 'w-[900px] h-[350px] max-w-[calc(100vw-40px)]'}
        `}
      >
        
        {/* Minimized View */}
        {isMinimized && (
          <div className="flex items-center justify-between px-4 h-full w-full hover:bg-charcoal-800 transition-colors" onClick={() => setIsMinimized(false)}>
             <div className="flex items-center gap-2 text-blue-400">
               <Bot className="w-5 h-5" />
               <span className="font-mono text-sm font-bold text-gray-200">{t('chat.assistantReady')}</span>
             </div>
             <ChevronDown className="w-4 h-4 text-charcoal-400" />
          </div>
        )}

        {/* Expanded View */}
        {!isMinimized && (
          <>
            {/* Header */}
            <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-charcoal-700 bg-charcoal-950/50 select-none">
              <div className="flex items-center gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                <span className="text-xs font-mono font-bold text-blue-400 tracking-widest uppercase">{t('chat.resourceAssistant')}</span>
              </div>
              <div className="flex items-center gap-1">
                 <button onClick={handleOpenSettings} className="p-1.5 text-charcoal-400 hover:text-blue-400 rounded-md transition-colors" title="Settings">
                    <Settings className="w-3.5 h-3.5" />
                 </button>
                 <button onClick={() => setIsMinimized(true)} className="p-1.5 text-charcoal-400 hover:text-blue-400 rounded-md transition-colors" title="Minimize">
                    <Minimize2 className="w-3.5 h-3.5" />
                 </button>
                 <button onClick={handleClose} className="p-1.5 text-charcoal-400 hover:text-red-400 rounded-md transition-colors" title="Close">
                    <X className="w-4 h-4" />
                 </button>
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0 relative">
               {/* Background Grid */}
               <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none"></div>

               {/* Messages Area */}
               <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar-dark relative z-10 scroll-smooth">
                   {messages.length === 0 ? (
                       <div className="h-full flex flex-col items-center justify-center text-center space-y-6 opacity-80">
                           <div className="w-16 h-16 bg-charcoal-800 rounded-2xl flex items-center justify-center border border-charcoal-700 shadow-sm">
                               <Bot className="w-8 h-8 text-blue-500" />
                           </div>
                           <div>
                               <h3 className="text-gray-200 font-semibold mb-1">{t('chat.howCanIHelp')}</h3>
                               <p className="text-charcoal-400 text-xs">{t('chat.askAbout')}</p>
                           </div>
                           <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
                               {suggestions.map((s, i) => (
                                   <button 
                                      key={i} 
                                      onClick={() => handleSend(undefined, s)}
                                      className="px-3 py-2 text-xs text-blue-300 bg-charcoal-800 border border-charcoal-700 rounded-lg hover:bg-charcoal-700 hover:border-charcoal-600 transition-all text-left truncate shadow-sm"
                                   >
                                       {s}
                                   </button>
                               ))}
                           </div>
                       </div>
                   ) : (
                       <div className="max-w-3xl mx-auto space-y-6 w-full pb-4">
                           {messages.map((msg) => (
                             <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-fade-in-up`}>
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-blue-600 text-white shadow-md' : 'bg-charcoal-800 border border-charcoal-700 text-blue-400 shadow-sm'}`}>
                                    {msg.role === 'user' ? <ArrowRight className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                                </div>
                                <div className={`flex-1 space-y-1 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                                    {msg.role !== 'system' && (
                                        <div className="text-[10px] text-charcoal-500 font-bold uppercase tracking-wider">
                                            {msg.role === 'user' ? t('chat.you') : t('chat.assistant')}
                                        </div>
                                    )}
                                    <div className={`text-sm leading-relaxed ${msg.role === 'user' ? 'text-white font-medium bg-blue-600/10 border border-blue-500/20' : 'text-gray-300 bg-charcoal-800 border border-charcoal-700'} font-mono whitespace-pre-wrap p-3 rounded-lg`}>
                                        {msg.content}
                                    </div>
                                </div>
                             </div>
                           ))}
                           
                           {isLoading && (
                             <div className="flex gap-4 animate-fade-in">
                                 <div className="w-8 h-8 rounded-lg bg-charcoal-800 border border-charcoal-700 flex items-center justify-center flex-shrink-0 shadow-sm">
                                     <Cpu className="w-4 h-4 text-blue-500 animate-pulse" />
                                 </div>
                                 <div className="flex items-center gap-2 pt-1.5">
                                     <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                     <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                     <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></span>
                                 </div>
                             </div>
                           )}
                           <div ref={messagesEndRef} />
                       </div>
                   )}
               </div>

               {/* Input Area */}
               <div className="flex-none p-4 bg-charcoal-900/95 border-t border-charcoal-700 backdrop-blur-md">
                   <div className="max-w-3xl mx-auto">
                        {!isAiEnabled || !apiKey ? (
                            <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-xs justify-center">
                                <AlertTriangle className="w-4 h-4" />
                                <span>{t('chat.aiConfigMissing')}</span>
                                <button type="button" onClick={handleOpenSettings} className="underline hover:text-red-300 font-semibold">{t('chat.enableInSettings')}</button>
                            </div>
                        ) : (
                            <form onSubmit={(e) => handleSend(e)} className="relative flex items-center gap-2 bg-charcoal-800 border border-charcoal-600 rounded-xl p-1 shadow-inner focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500/50 transition-all">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder={t('chat.inputPlaceholder')}
                                    className="flex-1 bg-transparent border-none outline-none text-white text-sm placeholder-charcoal-500 px-3 font-mono h-9"
                                    disabled={isLoading}
                                />
                                <button 
                                    type="submit" 
                                    disabled={!input.trim() || isLoading}
                                    className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                                >
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            </form>
                        )}
                   </div>
               </div>
            </div>
          </>
        )}
      </div>
    </>
  );
};

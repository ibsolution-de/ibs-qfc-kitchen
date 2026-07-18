
import React, { useState } from 'react';
import { Employee, IkigaiItem, IkigaiZone } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { Plus, X } from 'lucide-react';
import { uid } from '../../utils/uid';

interface IkigaiBuilderProps {
  items: IkigaiItem[];
  onUpdate: (items: IkigaiItem[]) => void;
}

export const IkigaiBuilder: React.FC<IkigaiBuilderProps> = ({ items, onUpdate }) => {
  const { t } = useLanguage();
  const [newItemText, setNewItemText] = useState('');

  const addItem = (e: React.FormEvent) => {
      e.preventDefault();
      if(!newItemText.trim()) return;
      
      const newItem: IkigaiItem = {
          id: uid(),
          text: newItemText,
          zone: 'good' // Default start zone
      };
      onUpdate([...items, newItem]);
      setNewItemText('');
  };

  const removeItem = (id: string) => {
      onUpdate(items.filter(i => i.id !== id));
  };

  const moveItem = (id: string, zone: IkigaiZone) => {
      onUpdate(items.map(i => i.id === id ? { ...i, zone } : i));
  };

  const zones: { id: IkigaiZone, label: string, color: string }[] = [
      { id: 'love', label: t('development.zones.love'), color: 'bg-pink-100 border-pink-300' },
      { id: 'good', label: t('development.zones.good'), color: 'bg-blue-100 border-blue-300' },
      { id: 'paid', label: t('development.zones.paid'), color: 'bg-green-100 border-green-300' },
      { id: 'needed', label: t('development.zones.needed'), color: 'bg-purple-100 border-purple-300' },
  ];
  
  // Special zones
  const burnoutItems = items.filter(i => i.zone === 'burnout');
  const boreoutItems = items.filter(i => i.zone === 'boreout');
  const ikigaiItems = items.filter(i => i.zone === 'ikigai');

  return (
    <div className="flex flex-col h-full">
        {/* Input Area */}
        <form onSubmit={addItem} className="flex gap-2 mb-6">
            <input 
                type="text" 
                value={newItemText} 
                onChange={(e) => setNewItemText(e.target.value)}
                placeholder={t('development.addActivity')}
                className="flex-1 px-3 py-2 border border-charcoal-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <button type="submit" className="px-3 py-2 bg-charcoal-800 text-white rounded-lg hover:bg-charcoal-700">
                <Plus className="w-4 h-4" />
            </button>
        </form>

        {/* Visual Venn Diagram (Simplified as Grid for interaction reliability) */}
        <div className="flex-1 grid grid-cols-2 gap-4 relative">
             {zones.map(z => (
                 <div key={z.id} className={`rounded-xl border-2 p-3 flex flex-col min-h-[140px] relative transition-colors ${z.color}`}>
                     <div className="text-xs font-bold uppercase tracking-wider mb-2 opacity-70 text-center">{z.label}</div>
                     <div className="flex-1 flex flex-wrap content-start gap-2">
                         {items.filter(i => i.zone === z.id).map(item => (
                             <div key={item.id} className="bg-white px-2 py-1 rounded text-xs shadow-sm border border-charcoal-100 flex items-center gap-1 group cursor-pointer hover:scale-105 transition-transform">
                                 {item.text}
                                 {/* Simple mover controls for demo */}
                                 <div className="hidden group-hover:flex gap-1 absolute -top-8 left-0 bg-charcoal-800 text-white p-1 rounded z-20">
                                     {zones.filter(oz => oz.id !== z.id).map(oz => (
                                         <div key={oz.id} onClick={() => moveItem(item.id, oz.id)} className={`w-3 h-3 rounded-full ${oz.color.split(' ')[0]}`} title={`Move to ${oz.label}`} />
                                     ))}
                                      <div onClick={() => moveItem(item.id, 'ikigai')} className="w-3 h-3 rounded-full bg-yellow-400" title="Move to Center (Ikigai)" />
                                      <div onClick={() => moveItem(item.id, 'burnout')} className="w-3 h-3 rounded-full bg-red-500" title="Burnout Risk" />
                                 </div>
                                 <X onClick={(e) => { e.stopPropagation(); removeItem(item.id); }} className="w-3 h-3 text-charcoal-300 hover:text-red-500" />
                             </div>
                         ))}
                     </div>
                 </div>
             ))}
             
             {/* Center Overlap: Ikigai */}
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-yellow-100/90 border-2 border-yellow-400 rounded-full flex flex-col items-center justify-center shadow-lg backdrop-blur-sm z-10">
                 <span className="text-[10px] font-bold text-yellow-800 mb-1">IKIGAI</span>
                 <div className="flex flex-wrap justify-center gap-1 px-2">
                     {ikigaiItems.map(item => (
                         <div key={item.id} className="text-[9px] bg-white px-1 rounded border border-yellow-200 cursor-pointer" onClick={() => moveItem(item.id, 'good')}>
                             {item.text}
                         </div>
                     ))}
                 </div>
             </div>
        </div>

        {/* Risk Zones */}
        <div className="mt-4 grid grid-cols-2 gap-4">
             <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                 <div className="text-[10px] font-bold text-red-600 uppercase mb-2">Burnout Risk (Good + Needed - Love)</div>
                 <div className="flex flex-wrap gap-2">
                     {burnoutItems.map(item => (
                         <div key={item.id} className="bg-white px-2 py-1 rounded text-xs border border-red-100 cursor-pointer hover:bg-red-100" onClick={() => moveItem(item.id, 'good')}>{item.text}</div>
                     ))}
                 </div>
             </div>
             <div className="bg-gray-100 border border-gray-200 rounded-lg p-3">
                 <div className="text-[10px] font-bold text-gray-600 uppercase mb-2">Boreout (Paid + Good - Love)</div>
                 <div className="flex flex-wrap gap-2">
                     {boreoutItems.map(item => (
                         <div key={item.id} className="bg-white px-2 py-1 rounded text-xs border border-gray-200 cursor-pointer hover:bg-gray-200" onClick={() => moveItem(item.id, 'good')}>{item.text}</div>
                     ))}
                 </div>
             </div>
        </div>
    </div>
  );
};

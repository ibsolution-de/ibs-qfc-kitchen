
import React, { useState } from 'react';
import { Employee } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { Search, Zap, CheckCircle } from 'lucide-react';

interface TeamSkillMatrixProps {
  employees: Employee[];
}

export const TeamSkillMatrix: React.FC<TeamSkillMatrixProps> = ({ employees }) => {
  const { t } = useLanguage();
  
  // Simulator State
  const [requiredSkill, setRequiredSkill] = useState('');
  const [requiredLevel, setRequiredLevel] = useState(3);
  const [simulationResult, setSimulationResult] = useState<{ id: string, match: boolean, gap: number }[] | null>(null);

  // Extract all unique skills
  const allSkills = Array.from(new Set(employees.flatMap(e => e.competencies?.map(c => c.skill) || []))).sort();

  const runSimulation = () => {
      const results = employees.map(emp => {
          const comp = emp.competencies?.find(c => c.skill.toLowerCase() === requiredSkill.toLowerCase());
          const rating = comp ? comp.managerRating : 0;
          return {
              id: emp.id,
              match: rating >= requiredLevel,
              gap: requiredLevel - rating
          };
      });
      setSimulationResult(results);
  };

  const getHeatmapColor = (rating: number) => {
      if (rating === 0) return 'bg-gray-50';
      if (rating === 1) return 'bg-blue-50';
      if (rating === 2) return 'bg-blue-100';
      if (rating === 3) return 'bg-blue-200';
      if (rating === 4) return 'bg-blue-300';
      if (rating === 5) return 'bg-blue-500 text-white';
      return 'bg-gray-50';
  };

  return (
    <div className="h-full flex flex-col">
        {/* Simulator Toolbar */}
        <div className="bg-charcoal-800 text-white p-4 rounded-xl mb-6 shadow-md">
            <div className="flex items-center gap-2 mb-3 text-sm font-bold uppercase tracking-wider text-blue-300">
                <Zap className="w-4 h-4" /> {t('development.projectSimulator')}
            </div>
            <div className="flex items-end gap-4">
                <div className="flex-1">
                    <label className="block text-xs text-charcoal-400 mb-1">{t('development.requiredSkill')}</label>
                    <div className="relative">
                        <input 
                            value={requiredSkill}
                            onChange={(e) => setRequiredSkill(e.target.value)}
                            className="w-full bg-charcoal-900 border border-charcoal-600 rounded px-3 py-2 text-sm text-white focus:border-blue-500 outline-none" 
                            placeholder="e.g. React"
                        />
                        <Search className="absolute right-3 top-2.5 w-4 h-4 text-charcoal-500" />
                    </div>
                </div>
                <div className="w-32">
                     <label className="block text-xs text-charcoal-400 mb-1">{t('development.requiredLevel')}</label>
                     <select 
                        value={requiredLevel} 
                        onChange={(e) => setRequiredLevel(Number(e.target.value))}
                        className="w-full bg-charcoal-900 border border-charcoal-600 rounded px-3 py-2 text-sm text-white outline-none"
                     >
                         {[1,2,3,4,5].map(i => <option key={i} value={i}>Level {i}</option>)}
                     </select>
                </div>
                <button 
                    onClick={runSimulation}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition-colors shadow-sm"
                >
                    {t('development.checkReadiness')}
                </button>
            </div>
        </div>

        {/* Heatmap Table */}
        <div className="flex-1 overflow-auto custom-scrollbar border border-charcoal-200 rounded-xl bg-white shadow-sm">
            <table className="w-full text-sm text-left">
                <thead className="bg-charcoal-50 sticky top-0 z-10">
                    <tr>
                        <th className="p-3 border-b border-r border-charcoal-200 min-w-[150px] bg-charcoal-50 z-20 sticky left-0 text-xs font-bold text-charcoal-500 uppercase">Skill / Employee</th>
                        {employees.map(emp => (
                            <th key={emp.id} className="p-3 border-b border-charcoal-200 text-center min-w-[100px]">
                                <div className="flex flex-col items-center gap-1">
                                    <img src={emp.avatar} className="w-8 h-8 rounded-full" />
                                    <span className="text-xs font-medium truncate w-20">{emp.name.split(' ')[0]}</span>
                                    {simulationResult && (
                                        <div className="mt-1">
                                            {simulationResult.find(r => r.id === emp.id)?.match ? (
                                                <CheckCircle className="w-4 h-4 text-green-500" />
                                            ) : (
                                                <span className="text-[10px] text-red-500 font-bold bg-red-50 px-1 rounded">
                                                    -{simulationResult.find(r => r.id === emp.id)?.gap || 0}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-charcoal-100">
                    {allSkills.map((skill: string) => {
                        const isSimulatedSkill = skill.toLowerCase() === requiredSkill.toLowerCase();
                        return (
                            <tr key={skill} className={`hover:bg-charcoal-50/50 transition-colors ${isSimulatedSkill ? 'bg-blue-50/30' : ''}`}>
                                <td className={`p-3 border-r border-charcoal-200 font-medium sticky left-0 bg-white group-hover:bg-charcoal-50/50 z-10 ${isSimulatedSkill ? 'text-blue-700 font-bold' : 'text-charcoal-700'}`}>
                                    {skill}
                                </td>
                                {employees.map(emp => {
                                    const comp = emp.competencies?.find(c => c.skill === skill);
                                    const rating = comp ? comp.managerRating : 0;
                                    return (
                                        <td key={`${emp.id}-${skill}`} className="p-1 border-r border-charcoal-100 last:border-0 text-center">
                                            <div className={`w-full h-8 flex items-center justify-center rounded ${getHeatmapColor(rating)}`}>
                                                {rating > 0 && <span className="text-xs font-bold opacity-60">{rating}</span>}
                                            </div>
                                        </td>
                                    )
                                })}
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    </div>
  );
};

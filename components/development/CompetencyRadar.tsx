
import React from 'react';
import { Competency } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';

interface CompetencyRadarProps {
  competencies: Competency[];
}

export const CompetencyRadar: React.FC<CompetencyRadarProps> = ({ competencies }) => {
  const { t } = useLanguage();
  if (!competencies || competencies.length === 0) {
      return <div className="text-center text-charcoal-400 py-10">No competency data available.</div>;
  }

  // Config
  const size = 300;
  const center = size / 2;
  const radius = (size / 2) - 40;
  const levels = 5;

  // Helper to get coordinates
  const getCoords = (value: number, index: number, total: number) => {
    const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
    const r = (value / levels) * radius;
    const x = center + Math.cos(angle) * r;
    const y = center + Math.sin(angle) * r;
    return { x, y };
  };

  // Generate paths
  const selfPoints = competencies.map((c, i) => {
    const { x, y } = getCoords(c.selfRating, i, competencies.length);
    return `${x},${y}`;
  }).join(' ');

  const managerPoints = competencies.map((c, i) => {
    const { x, y } = getCoords(c.managerRating, i, competencies.length);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="overflow-visible">
        {/* Background Grid */}
        {[...Array(levels)].map((_, i) => (
          <circle 
            key={i} 
            cx={center} 
            cy={center} 
            r={(i + 1) * (radius / levels)} 
            fill="none" 
            stroke="#e5e7eb" 
            strokeWidth="1" 
          />
        ))}

        {/* Axes */}
        {competencies.map((c, i) => {
          const { x, y } = getCoords(levels, i, competencies.length);
          return (
            <line 
              key={i} 
              x1={center} 
              y1={center} 
              x2={x} 
              y2={y} 
              stroke="#e5e7eb" 
              strokeWidth="1" 
            />
          );
        })}

        {/* Self Data */}
        <polygon points={selfPoints} fill="rgba(59, 130, 246, 0.2)" stroke="#3b82f6" strokeWidth="2" />
        {competencies.map((c, i) => {
          const { x, y } = getCoords(c.selfRating, i, competencies.length);
          return <circle key={`self-${i}`} cx={x} cy={y} r="3" fill="#3b82f6" />;
        })}

        {/* Manager Data */}
        <polygon points={managerPoints} fill="rgba(168, 85, 247, 0.1)" stroke="#a855f7" strokeWidth="2" strokeDasharray="4 2" />
        {competencies.map((c, i) => {
          const { x, y } = getCoords(c.managerRating, i, competencies.length);
          return <circle key={`mgr-${i}`} cx={x} cy={y} r="3" fill="#a855f7" />;
        })}

        {/* Labels */}
        {competencies.map((c, i) => {
          const { x, y } = getCoords(levels + 1.2, i, competencies.length); // Push label out a bit
          return (
            <text 
              key={`label-${i}`} 
              x={x} 
              y={y} 
              textAnchor="middle" 
              dominantBaseline="middle" 
              className="text-[10px] fill-charcoal-600 font-medium"
            >
              {c.skill}
            </text>
          );
        })}
      </svg>
      
      <div className="flex gap-4 mt-4 text-xs">
          <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-blue-500/20 border border-blue-500 rounded"></div>
              <span>{t('development.self')}</span>
          </div>
          <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-purple-500/10 border border-purple-500 border-dashed rounded"></div>
              <span>{t('development.manager')}</span>
          </div>
      </div>
    </div>
  );
};

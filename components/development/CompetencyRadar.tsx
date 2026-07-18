import React, { useMemo } from 'react';
import { Competency } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

interface CompetencyRadarProps {
  competencies: Competency[];
}

export const CompetencyRadar: React.FC<CompetencyRadarProps> = ({ competencies }) => {
  const { t } = useLanguage();
  if (!competencies || competencies.length === 0) {
      return <div className="text-center text-charcoal-400 py-10">No competency data available.</div>;
  }

  const radarData = useMemo(() => {
    return competencies.map(c => ({
      skill: c.skill,
      self: c.selfRating,
      manager: c.managerRating,
    }));
  }, [competencies]);

  return (
    <div className="flex flex-col items-center">
      <div
        role="img"
        aria-label={t('development.competencies')}
        className="h-[300px] w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid />
            <PolarAngleAxis dataKey="skill" tick={{ fontSize: 10, fill: '#4f5968' }} />
            <PolarRadiusAxis angle={30} domain={[0, 5]} tickCount={6} tick={{ fontSize: 10, fill: '#647081' }} />
            <Radar
              name={t('development.self')}
              dataKey="self"
              stroke="#3b82f6"
              fill="#3b82f6"
              fillOpacity={0.2}
            />
            <Radar
              name={t('development.manager')}
              dataKey="manager"
              stroke="#a855f7"
              fill="#a855f7"
              fillOpacity={0.1}
              strokeDasharray="4 2"
            />
            <Legend />
            <Tooltip formatter={(value: any) => [value, '']} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <table className="sr-only">
        <caption>{t('accessibility.chartData')}: {t('development.competencies')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('team.skills')}</th>
            <th scope="col">{t('development.self')}</th>
            <th scope="col">{t('development.manager')}</th>
          </tr>
        </thead>
        <tbody>
          {competencies.map(c => (
            <tr key={c.skill}>
              <td>{c.skill}</td>
              <td>{c.selfRating}</td>
              <td>{c.managerRating}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

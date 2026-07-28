import { useState, useEffect } from 'react';

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Returns a Date object pinned to the current calendar day.
 * It is frozen at app mount and updates itself at the next midnight,
 * so every consumer using the same hook instance sees the same "today".
 */
export function useToday(): Date {
  const [today, setToday] = useState<Date>(() => startOfDay(new Date()));

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const msUntilMidnight = nextMidnight.getTime() - now.getTime();

    const timeoutId = setTimeout(() => {
      setToday(startOfDay(new Date()));
    }, msUntilMidnight);

    return () => clearTimeout(timeoutId);
  }, [today]);

  return today;
}

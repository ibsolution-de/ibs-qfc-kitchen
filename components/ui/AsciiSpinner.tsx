import React, { useState, useEffect } from 'react';

interface AsciiSpinnerProps {
  className?: string;
  speed?: number;
}

export const AsciiSpinner: React.FC<AsciiSpinnerProps> = ({ className = '', speed = 120 }) => {
  const frames = ['/', '-', '\\', '|'];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, speed);
    return () => clearInterval(timer);
  }, [speed]);

  return (
    <span className={`inline-block font-mono ${className}`} aria-hidden="true">
      {frames[frame]}
    </span>
  );
};
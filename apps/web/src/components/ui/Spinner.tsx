'use client';

import { theme } from './theme';

interface SpinnerProps {
  size?: number;
  color?: string;
  label?: string;
  padding?: string;
}

export default function Spinner({ size = 24, color = theme.spinnerBlue, label, padding = '16px 0' }: SpinnerProps) {
  return (
    <div style={{ textAlign: 'center', padding }}>
      <div
        className="animate-spin"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          borderTopColor: 'transparent',
          margin: '0 auto',
        }}
      />
      {label && <p style={{ color: '#9ca3af', marginTop: '12px' }}>{label}</p>}
    </div>
  );
}

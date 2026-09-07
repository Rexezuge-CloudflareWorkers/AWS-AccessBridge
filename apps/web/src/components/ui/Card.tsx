'use client';

import { cardStyle } from './theme';

interface CardProps {
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export default function Card({ title, children, style }: CardProps) {
  return (
    <div style={{ ...cardStyle, ...style }}>
      {title && <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>{title}</h3>}
      {children}
    </div>
  );
}

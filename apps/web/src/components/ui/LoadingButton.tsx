'use client';

import { useState } from 'react';
import { buttonColors } from './theme';

interface LoadingButtonProps {
  onClick: () => Promise<void> | void;
  disabled?: boolean;
  variant?: 'blue' | 'green' | 'red';
  children: React.ReactNode;
  type?: 'button' | 'submit';
}

export default function LoadingButton({ onClick, disabled = false, variant = 'blue', children, type = 'button' }: LoadingButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = async () => {
    if (disabled || isLoading) return;
    setIsLoading(true);
    try {
      await onClick();
    } finally {
      setIsLoading(false);
    }
  };

  const colors = buttonColors[variant] || buttonColors.blue;
  const isDisabledOrLoading = disabled || isLoading;

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={isDisabledOrLoading}
      style={{
        borderRadius: '8px',
        padding: '10px 20px',
        fontWeight: 500,
        color: isDisabledOrLoading ? '#6b7280' : '#ffffff',
        background: isDisabledOrLoading ? '#374151' : isHovered ? colors.hover : colors.bg,
        cursor: isDisabledOrLoading ? 'not-allowed' : 'pointer',
        border: 'none',
        transition: 'background 0.15s',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            className="animate-spin"
            style={{ width: '16px', height: '16px', borderRadius: '9999px', border: '2px solid #ffffff', borderTopColor: 'transparent' }}
          />
        </div>
      ) : (
        children
      )}
    </button>
  );
}

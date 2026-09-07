'use client';

export const theme = {
  cardBg: '#1e2433',
  inputBg: '#252d3d',
  border: '#374151',
  focusBorder: '#3b82f6',
  blue: '#2563eb',
  blueHover: '#1d4ed8',
  green: '#16a34a',
  greenHover: '#15803d',
  red: '#dc2626',
  redHover: '#b91c1c',
  spinnerBlue: '#60a5fa',
} as const;

export const buttonColors: Record<string, { bg: string; hover: string }> = {
  blue: { bg: theme.blue, hover: theme.blueHover },
  green: { bg: theme.green, hover: theme.greenHover },
  red: { bg: theme.red, hover: theme.redHover },
};

export const cardStyle: React.CSSProperties = {
  background: theme.cardBg,
  borderRadius: '12px',
  padding: '24px',
};

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  background: theme.inputBg,
  borderRadius: '8px',
  border: `1px solid ${theme.border}`,
  color: '#ffffff',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
};

export const tableCardStyle: React.CSSProperties = {
  background: theme.cardBg,
  borderRadius: '12px',
  overflow: 'hidden',
};

export const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px',
  background: theme.inputBg,
  color: '#9ca3af',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontSize: '12px',
  fontWeight: 500,
};

export const tdStyle: React.CSSProperties = {
  padding: '12px',
  borderTop: '1px solid rgba(55,65,81,0.3)',
};

export const paginationBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: theme.inputBg,
  border: 'none',
  borderRadius: '8px',
  color: 'white',
  cursor: 'pointer',
  transition: 'background 0.15s',
};

const btnBase: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: '8px',
  color: 'white',
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  transition: 'background 0.15s',
};

export const btnBlueStyle: React.CSSProperties = { ...btnBase, background: theme.blue };
export const btnGreenStyle: React.CSSProperties = { ...btnBase, background: theme.green };
export const btnRedStyle: React.CSSProperties = { ...btnBase, background: theme.red };
export const btnSmallStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  color: 'white',
  fontWeight: 500,
  fontSize: '13px',
  border: 'none',
  cursor: 'pointer',
  transition: 'background 0.15s',
};

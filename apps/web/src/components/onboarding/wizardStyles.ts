'use client';

const wizardStyles = {
  card: {
    background: '#1e2433',
    border: '1px solid rgba(55,65,81,0.5)',
    padding: '24px',
    borderRadius: '12px',
  } as React.CSSProperties,
  cardInner: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '12px',
    background: '#252d3d',
    borderRadius: '8px',
    border: '1px solid #374151',
    color: 'white',
    outline: 'none',
    transition: 'border-color 0.15s',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  summaryItem: {
    background: '#252d3d',
    border: '1px solid rgba(55,65,81,0.3)',
    padding: '12px',
    borderRadius: '8px',
  } as React.CSSProperties,
  chainResult: {
    background: '#252d3d',
    border: '1px solid rgba(55,65,81,0.3)',
    padding: '12px',
    borderRadius: '8px',
  } as React.CSSProperties,
  btnPrimary: {
    background: '#2563eb',
    padding: '10px 20px',
    borderRadius: '8px',
    color: 'white',
    border: 'none',
    transition: 'background 0.15s',
    opacity: 1,
  } as React.CSSProperties,
  btnSuccess: {
    background: '#16a34a',
    padding: '10px 20px',
    borderRadius: '8px',
    color: 'white',
    border: 'none',
    transition: 'background 0.15s',
    opacity: 1,
  } as React.CSSProperties,
  btnSecondary: {
    background: '#374151',
    border: '1px solid #4b5563',
    padding: '10px 20px',
    borderRadius: '8px',
    color: '#d1d5db',
    transition: 'background 0.15s',
  } as React.CSSProperties,
  btnDisabled: {
    background: '#374151',
    color: '#6b7280',
    cursor: 'not-allowed',
    opacity: 1,
  } as React.CSSProperties,
  roleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    background: '#252d3d',
    borderRadius: '8px',
    transition: 'background 0.15s',
  } as React.CSSProperties,
};

function getInputStyle(focusedInput: string | null, styles: typeof wizardStyles, name: string): React.CSSProperties {
  return { ...styles.input, borderColor: focusedInput === name ? '#3b82f6' : '#374151' };
}

function getBtnPrimary(styles: typeof wizardStyles, disabled: boolean): React.CSSProperties {
  return { ...styles.btnPrimary, ...(disabled && styles.btnDisabled) };
}

function getBtnSuccess(styles: typeof wizardStyles, disabled: boolean): React.CSSProperties {
  return { ...styles.btnSuccess, ...(disabled && styles.btnDisabled) };
}

export { getBtnPrimary, getBtnSuccess, getInputStyle, wizardStyles };

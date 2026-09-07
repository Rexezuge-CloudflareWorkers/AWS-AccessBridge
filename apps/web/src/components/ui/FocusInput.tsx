'use client';

import { useState } from 'react';
import { inputStyle } from './theme';

export default function FocusInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  const { style: extraStyle, ...rest } = props;
  return (
    <input
      {...rest}
      style={{ ...inputStyle, borderColor: focused ? '#3b82f6' : '#374151', ...extraStyle }}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
    />
  );
}

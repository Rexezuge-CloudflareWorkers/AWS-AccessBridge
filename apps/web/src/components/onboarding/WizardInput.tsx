'use client';

import { useState } from 'react';
import { getInputStyle } from './wizardStyles';

/**
 * A wizard text input that highlights itself while focused.
 *
 * The focus flag lives here, in the one component that renders it. It used to be
 * `focusedInput` state in `useOnboardingWizard`, keyed by a string per field, so
 * a purely visual detail re-rendered the whole wizard and had to be threaded
 * through the hook's return value.
 */
export default function WizardInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      style={getInputStyle(focused)}
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

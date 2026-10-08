'use client';

import { useState } from 'react';
import type { DiscoveredRole } from '../../lib/onboardingWizard';
import { wizardStyles } from './wizardStyles';

interface RoleOptionProps {
  role: DiscoveredRole;
  selected: boolean;
  onToggle: (roleName: string) => void;
}

/**
 * One selectable role row. The hover highlight is local state here — it used to be
 * `hoveredRole` in `useOnboardingWizard`, so moving the pointer across the list
 * re-rendered the whole wizard for a purely visual effect.
 */
export default function RoleOption({ role, selected, onToggle }: RoleOptionProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <label
      className="cursor-pointer"
      style={{ ...wizardStyles.roleLabel, background: hovered ? '#313b50' : '#252d3d' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <input type="checkbox" checked={selected} onChange={() => onToggle(role.roleName)} />
      <span className="font-medium">{role.roleName}</span>
      {role.description && (
        <span className="text-sm" style={{ color: '#9ca3af' }}>
          — {role.description}
        </span>
      )}
    </label>
  );
}

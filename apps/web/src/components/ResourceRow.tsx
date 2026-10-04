'use client';

import { useTranslation } from 'react-i18next';
import { resourceStateColor } from '../lib/presentation';
import type { ResourceItem } from '../services/resourceService';

/**
 * One row of the inventory table.
 *
 * Split out of `ResourceInventory`, which was 354 lines mostly because this row —
 * with its per-row role picker and its Open button — was inline. The row owns its
 * own presentation and reports intent upward, so the parent keeps only fetching,
 * filtering, and pagination.
 */

const cellStyle: React.CSSProperties = { padding: '12px' };

interface ResourceRowProps {
  resource: ResourceItem;
  /**
   * Roles assumable in this resource's account; empty disables the picker.
   */
  accountRoles: string[];
  /**
   * The role currently chosen for this account, or undefined for the default.
   */
  selectedRole: string | undefined;
  /**
   * Suppresses the top border on the first row, so the table reads as one block.
   */
  isFirst: boolean;
  onSelectRole: (awsAccountId: string, role: string) => void;
  onOpen: (resource: ResourceItem) => void;
}

export default function ResourceRow({ resource, accountRoles, selectedRole, isFirst, onSelectRole, onOpen }: ResourceRowProps) {
  const { t } = useTranslation();
  const hasRoles = accountRoles.length > 0;
  // The console link needs a role; without one the button is disabled rather
  // than hidden, so the row's affordances do not shift as the picker changes.
  const canOpen = hasRoles;

  return (
    <tr
      style={{
        borderTop: isFirst ? 'none' : '1px solid #2d3748',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(event) => {
        (event.currentTarget as HTMLElement).style.background = '#252d3d';
      }}
      onMouseLeave={(event) => {
        (event.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      <td className="font-medium uppercase text-xs" style={{ ...cellStyle, color: '#d1d5db' }}>
        {resource.resourceType}
      </td>
      <td style={{ ...cellStyle, color: '#fff' }}>{resource.resourceName}</td>
      <td className="font-mono text-xs" style={{ ...cellStyle, color: '#9ca3af' }}>
        {resource.awsAccountId}
      </td>
      <td style={{ ...cellStyle, color: '#9ca3af' }}>{resource.region}</td>
      <td style={{ ...cellStyle, color: resourceStateColor(resource.state) }}>{resource.state}</td>
      <td style={cellStyle}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={selectedRole ?? ''}
            disabled={!hasRoles}
            onChange={(event) => onSelectRole(resource.awsAccountId, event.target.value)}
            className="text-xs"
            aria-label={t('resources.roleForResource', 'Role for {{name}}', { name: resource.resourceName || resource.resourceId })}
            style={{
              maxWidth: '150px',
              padding: '7px 8px',
              background: '#111827',
              borderRadius: '8px',
              border: '1px solid #374151',
              color: '#e5e7eb',
              outline: 'none',
              opacity: hasRoles ? 1 : 0.45,
            }}
          >
            {hasRoles ? (
              accountRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))
            ) : (
              <option value="">{t('resources.noRole', 'No role')}</option>
            )}
          </select>
          <button
            type="button"
            onClick={() => onOpen(resource)}
            disabled={!canOpen}
            className="text-xs font-medium"
            title={
              canOpen
                ? t('resources.openConsole', 'Open in AWS Console')
                : t('resources.selectRoleFirst', 'Select a role first')
            }
            style={{
              padding: '8px 12px',
              background: canOpen ? '#2563eb' : '#374151',
              borderRadius: '8px',
              border: 'none',
              color: '#fff',
              cursor: canOpen ? 'pointer' : 'default',
              opacity: canOpen ? 1 : 0.5,
              whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
          >
            Open
          </button>
        </div>
      </td>
    </tr>
  );
}
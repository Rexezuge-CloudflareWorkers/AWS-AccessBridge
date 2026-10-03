'use client';

import { useTranslation } from 'react-i18next';
import type { ResourceSummary } from '../services/resourceService';

/**
 * The inventory's type-count cards.
 *
 * Split out of `ResourceInventory`, where this block was ~55 of the component's
 * 354 lines. The `byType` iteration order is left as the service returned it: it
 * is a count summary, not a ranked list, so a card order that varies between
 * loads would be a display bug rather than something to sort away here.
 */

const TYPE_LABEL_KEYS: Record<string, string> = {
  ec2: 'resources.typeEc2',
  s3: 'resources.typeS3',
  lambda: 'resources.typeLambda',
  rds: 'resources.typeRds',
  dynamodb: 'resources.typeDynamoDb',
};

const cardStyle: React.CSSProperties = {
  background: '#1e2433',
  padding: '16px',
  borderRadius: '12px',
  textAlign: 'center',
};

interface ResourceSummaryCardsProps {
  summary: ResourceSummary;
}

export default function ResourceSummaryCards({ summary }: ResourceSummaryCardsProps) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${1 + Object.keys(summary.byType).length}, 1fr)`,
        gap: '12px',
      }}
    >
      <div style={cardStyle}>
        <p className="text-2xl font-bold" style={{ color: '#fff' }}>
          {summary.totalResources}
        </p>
        <p className="text-xs" style={{ color: '#9ca3af', marginTop: '4px' }}>
          {t('resources.total', 'Total')}
        </p>
      </div>
      {Object.entries(summary.byType).map(([type, count]) => (
        <div key={type} style={cardStyle}>
          <p className="text-2xl font-bold" style={{ color: '#fff' }}>
            {count}
          </p>
          <p className="text-xs" style={{ color: '#9ca3af', marginTop: '4px' }}>
            {/* An unmapped type falls back to the raw AWS type name rather than
                a blank card, so a newly supported service is visible immediately. */}
            {t(TYPE_LABEL_KEYS[type] ?? 'resources.typeLabel', type)}
          </p>
        </div>
      ))}
    </div>
  );
}
'use client';

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ResourceSummary } from '../services/resourceService';

/**
 * The inventory's type-count cards.
 *
 * Split out of `ResourceInventory`, where this block was ~55 of the component's
 * 354 lines. The `byType` iteration order is left as the service returned it: it
 * is a count summary, not a ranked list, so a card order that varies between
 * loads would be a display bug rather than something to sort away here.
 */

/**
 * Spelled as literal `t()` calls rather than a key map, so `validate:locales` can
 * see each key is referenced. An unmapped type falls back to the raw AWS type
 * name rather than a blank card, so a newly supported service is visible
 * immediately.
 */
function typeLabel(t: TFunction, type: string): string {
  switch (type) {
    case 'ec2': {
      return t('resources.typeEc2', 'EC2 Instances');
    }
    case 's3': {
      return t('resources.typeS3', 'S3 Buckets');
    }
    case 'lambda': {
      return t('resources.typeLambda', 'Lambda Functions');
    }
    case 'rds': {
      return t('resources.typeRds', 'RDS Databases');
    }
    case 'dynamodb': {
      return t('resources.typeDynamodb', 'DynamoDB Tables');
    }
    default: {
      return type;
    }
  }
}

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
            {typeLabel(t, type)}
          </p>
        </div>
      ))}
    </div>
  );
}

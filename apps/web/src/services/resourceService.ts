import { readJson, throwForResponse } from '../lib/api';

interface ResourceItem {
  awsAccountId: string;
  region: string;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  state: string;
  metadata: Record<string, string>;
}

interface ResourceSummary {
  totalResources: number;
  byType: Record<string, number>;
  byAccount: Record<string, Record<string, number>>;
}

interface ResourcesResult {
  items: ResourceItem[];
  total: number;
  rolesByAccount: Record<string, string[]>;
}

interface ListResourcesOptions {
  filterType: string;
  searchQuery: string;
  pageSize: number;
  page: number;
}

interface ConsoleDestination {
  path: string;
  region?: string;
}

function getConsoleDestination(resource: ResourceItem): ConsoleDestination | null {
  const region: string | undefined = resource.region && resource.region !== 'global' ? resource.region : undefined;
  switch (resource.resourceType) {
    case 'ec2': {
      return { path: `ec2/home#InstanceDetails:instanceId=${encodeURIComponent(resource.resourceId)}`, region };
    }
    case 's3': {
      return { path: `s3/buckets/${encodeURIComponent(resource.resourceName || resource.resourceId)}`, region };
    }
    case 'lambda': {
      return { path: `lambda/home#/functions/${encodeURIComponent(resource.resourceName || resource.resourceId)}`, region };
    }
    case 'rds': {
      return { path: `rds/home#database:id=${encodeURIComponent(resource.resourceId)};is-cluster=false`, region };
    }
    case 'dynamodb': {
      return {
        path: `dynamodbv2/home#table?name=${encodeURIComponent(resource.resourceName || resource.resourceId.split(':').pop() || resource.resourceId)}`,
        region,
      };
    }
    default: {
      return null;
    }
  }
}

async function loadSummary(): Promise<ResourceSummary | null> {
  const res = await fetch('/user/resources/summary');
  if (!res.ok) return null;
  return readJson<ResourceSummary>(res);
}

async function listResources(options: ListResourcesOptions): Promise<ResourcesResult> {
  const { filterType, searchQuery, pageSize, page } = options;
  const params = new URLSearchParams();
  if (filterType) params.set('type', filterType);
  if (searchQuery.trim()) params.set('search', searchQuery.trim());
  params.set('limit', pageSize.toString());
  params.set('offset', (page * pageSize).toString());

  const res = await fetch(`/user/resources?${params.toString()}`);
  if (!res.ok) {
    await throwForResponse(res, 'Failed to load resources');
  }
  return readJson<ResourcesResult>(res);
}

export type { ResourceItem, ResourceSummary, ResourcesResult, ListResourcesOptions, ConsoleDestination };
export { loadSummary, listResources, getConsoleDestination };

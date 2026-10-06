/**
 * Regions the resource inventory sweeps when `INVENTORY_REGIONS` is unset.
 *
 * An explicit list rather than a discovery call, for two reasons. `ec2:
 * DescribeRegions` would be a **breaking IAM change**: every existing
 * assumed-role policy grants only what the collectors read today
 * (`DescribeInstances`, `ListAllMyBuckets`, `ListFunctions`,
 * `DescribeDBInstances`, `ListTables`), so requiring one more action would
 * break collection for every deployed role until an operator updated it. And a
 * role that denies it would need the "denied is not empty" handling threaded
 * through the region step — which is exactly the kind of failure that presents
 * as an empty inventory.
 *
 * So the set is configuration, and an operator who wants a different one sets
 * `INVENTORY_REGIONS`. The tradeoff is honest in one direction: a region absent
 * from this list is invisible to the inventory, and adding a new AWS region means
 * editing it here. S3 is global and ignores the list entirely.
 */
const DEFAULT_INVENTORY_REGIONS: readonly string[] = [
  'af-south-1',
  'ap-east-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-south-1',
  'ap-south-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-4',
  'ca-central-1',
  'ca-west-1',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-south-1',
  'eu-south-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'il-central-1',
  'me-central-1',
  'me-south-1',
  'sa-east-1',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
];

export { DEFAULT_INVENTORY_REGIONS };
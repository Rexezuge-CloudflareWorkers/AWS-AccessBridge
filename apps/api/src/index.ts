import { AccessBridgeWorker } from '@/workers';
export { CronTasksWorker, CollectionWorkflow } from '@aws-access-bridge/background';

export default new AccessBridgeWorker();

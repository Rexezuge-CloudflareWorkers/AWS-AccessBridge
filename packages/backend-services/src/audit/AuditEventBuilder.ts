import { TimestampUtil, UUIDUtil } from '@aws-access-bridge/shared/utils';

interface AuditEventInput {
  userEmail: string;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  resource?: string;
  detail?: string;
  ipAddress?: string;
  userAgent?: string;
}

interface AuditEvent extends AuditEventInput {
  logId: string;
  timestamp: number;
}

class AuditEventBuilder {
  private input: Partial<AuditEventInput> = {};

  public static create(): AuditEventBuilder {
    return new AuditEventBuilder();
  }

  public userEmail(userEmail: string): this {
    this.input.userEmail = userEmail;
    return this;
  }

  public action(action: string): this {
    this.input.action = action;
    return this;
  }

  public request(method: string, path: string): this {
    this.input.method = method;
    this.input.path = path;
    return this;
  }

  public status(statusCode: number): this {
    this.input.statusCode = statusCode;
    return this;
  }

  public resource(resource: string): this {
    this.input.resource = resource;
    return this;
  }

  public detail(detail: string): this {
    this.input.detail = detail;
    return this;
  }

  public network(ipAddress?: string, userAgent?: string): this {
    this.input.ipAddress = ipAddress;
    this.input.userAgent = userAgent;
    return this;
  }

  public build(): AuditEvent {
    if (!this.input.userEmail || !this.input.action || !this.input.method || !this.input.path || this.input.statusCode === undefined) {
      throw new Error('AuditEvent requires userEmail, action, method, path, and statusCode.');
    }
    return {
      userEmail: this.input.userEmail,
      action: this.input.action,
      method: this.input.method,
      path: this.input.path,
      statusCode: this.input.statusCode,
      resource: this.input.resource,
      detail: this.input.detail,
      ipAddress: this.input.ipAddress,
      userAgent: this.input.userAgent,
      logId: UUIDUtil.getRandomUUID(),
      timestamp: TimestampUtil.getCurrentUnixTimestampInSeconds(),
    };
  }
}

export { AuditEventBuilder };
export type { AuditEvent, AuditEventInput };

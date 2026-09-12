import { describe, it, expect } from 'vitest';
import { ConsoleService } from '@aws-access-bridge/backend-services/aws/console';

describe('ConsoleService', () => {
  describe('getLoginUrl', () => {
    it('generates a valid AWS federation login URL', () => {
      const url = new ConsoleService().getLoginUrl('token123', 'https://my-app.example.com');
      expect(url).toContain('https://signin.aws.amazon.com/federation?');
      expect(url).toContain('Action=login');
      expect(url).toContain('Issuer=https%3A%2F%2Fmy-app.example.com');
      expect(url).toContain('SigninToken=token123');
      expect(url).toContain('Destination=https%3A%2F%2Fconsole.aws.amazon.com%2F');
    });

    it('uses default destination when not specified', () => {
      const url = new ConsoleService().getLoginUrl('token123', 'https://issuer.com');
      expect(url).toContain('Destination=https%3A%2F%2Fconsole.aws.amazon.com%2F');
    });

    it('uses custom destination when specified', () => {
      const url = new ConsoleService().getLoginUrl('token123', 'https://issuer.com', 'https://console.aws.amazon.com/s3');
      expect(url).toContain('Destination=https%3A%2F%2Fconsole.aws.amazon.com%2Fs3');
    });

    it('properly encodes special characters in parameters', () => {
      const url = new ConsoleService().getLoginUrl('token+with=special&chars', 'https://my app.com');
      expect(url).toContain('SigninToken=token%2Bwith%3Dspecial%26chars');
    });
  });

  describe('buildDestination', () => {
    it('builds console destinations with optional region', () => {
      const service = new ConsoleService();
      expect(service.buildDestination(undefined, undefined)).toBe('https://console.aws.amazon.com/');
      expect(service.buildDestination('ec2/home', 'eu-west-1')).toContain('region=eu-west-1');
    });
  });

  describe('buildIssuerUrl', () => {
    it('appends federate parameters when account and role are known', () => {
      const service = new ConsoleService();
      expect(service.buildIssuerUrl('https://example.com', '123456789012', 'Dev')).toContain('/user/aws/federate?awsAccountId=123456789012&role=Dev');
      expect(service.buildIssuerUrl('https://example.com')).toBe('https://example.com');
    });
  });
});

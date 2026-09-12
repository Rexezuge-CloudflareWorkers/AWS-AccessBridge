import { describe, it, expect } from 'vitest';
import { AwsConsoleUtil } from '@aws-access-bridge/backend-services/aws/AwsConsoleUtil';

describe('AwsConsoleUtil', () => {
  describe('getLoginUrl', () => {
    it('generates a valid AWS federation login URL', () => {
      const url = AwsConsoleUtil.getLoginUrl('token123', 'https://my-app.example.com');
      expect(url).toContain('https://signin.aws.amazon.com/federation?');
      expect(url).toContain('Action=login');
      expect(url).toContain('Issuer=https%3A%2F%2Fmy-app.example.com');
      expect(url).toContain('SigninToken=token123');
      expect(url).toContain('Destination=https%3A%2F%2Fconsole.aws.amazon.com%2F');
    });

    it('uses default destination when not specified', () => {
      const url = AwsConsoleUtil.getLoginUrl('token123', 'https://issuer.com');
      expect(url).toContain('Destination=https%3A%2F%2Fconsole.aws.amazon.com%2F');
    });

    it('uses custom destination when specified', () => {
      const url = AwsConsoleUtil.getLoginUrl('token123', 'https://issuer.com', 'https://console.aws.amazon.com/s3');
      expect(url).toContain('Destination=https%3A%2F%2Fconsole.aws.amazon.com%2Fs3');
    });

    it('properly encodes special characters in parameters', () => {
      const url = AwsConsoleUtil.getLoginUrl('token+with=special&chars', 'https://my app.com');
      expect(url).toContain('SigninToken=token%2Bwith%3Dspecial%26chars');
    });
  });
});

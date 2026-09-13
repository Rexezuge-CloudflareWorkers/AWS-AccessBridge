import type { AccessKeys, AccessKeysWithExpiration, CredentialChain } from '@aws-access-bridge/shared/model';
import type { StsService } from '../aws/sts';

/**
 * Template Method for walking a credential chain from base credentials
 * down to the leaf (target) role.
 *
 * Previously the reverse-walk `for (i = len-2; i >= 0; i--)` loop was
 * duplicated in `CredentialService.resolveLeafCredentials` and
 * `CredentialService.testChain`. Subclasses implement per-hop behavior;
 * the base owns iteration order ([target, ..., base] walked base→target).
 */
abstract class CredentialChainWalker<T> {
  constructor(protected readonly sts: StsService) {}

  public async walk(chain: CredentialChain, sessionName: string): Promise<T> {
    let credentials: AccessKeys = {
      accessKeyId: chain.accessKeyId,
      secretAccessKey: chain.secretAccessKey,
      sessionToken: chain.sessionToken,
    };
    await this.onBaseCredentials(chain, credentials);
    for (let i = chain.principalArns.length - 2; i >= 0; i--) {
      const roleArn: string = chain.principalArns[i];
      credentials = await this.assumeHop(roleArn, credentials, sessionName, i, chain);
    }
    return this.toResult(chain, credentials);
  }

  protected onBaseCredentials(_chain: CredentialChain, _credentials: AccessKeys): Promise<void> {
    return Promise.resolve();
  }

  protected abstract assumeHop(
    roleArn: string,
    credentials: AccessKeys,
    sessionName: string,
    index: number,
    chain: CredentialChain,
  ): Promise<AccessKeys>;

  protected abstract toResult(chain: CredentialChain, credentials: AccessKeys): T;
}

class LeafCredentialsWalker extends CredentialChainWalker<{ chain: CredentialChain; credentials: AccessKeys }> {
  protected assumeHop(roleArn: string, credentials: AccessKeys, sessionName: string): Promise<AccessKeys> {
    return this.sts.assumeRole(roleArn, credentials, sessionName);
  }

  protected toResult(chain: CredentialChain, credentials: AccessKeys): { chain: CredentialChain; credentials: AccessKeys } {
    return { chain, credentials };
  }
}

interface ChainTestStep {
  arn: string;
  status: string;
}

class ChainTestWalker extends CredentialChainWalker<{ success: boolean; chain: ChainTestStep[] }> {
  private readonly steps: ChainTestStep[] = [];
  private failed = false;

  protected override onBaseCredentials(chain: CredentialChain): Promise<void> {
    const baseArn: string | undefined = chain.principalArns.at(-1);
    if (baseArn) {
      this.steps.push({ arn: baseArn, status: 'ok (base credentials)' });
    }
    return Promise.resolve();
  }

  protected override async assumeHop(roleArn: string, credentials: AccessKeys, sessionName: string): Promise<AccessKeys> {
    if (this.failed) {
      return credentials;
    }
    try {
      const assumed: AccessKeysWithExpiration = await this.sts.assumeRole(roleArn, credentials, sessionName);
      this.steps.push({ arn: roleArn, status: 'ok' });
      return assumed;
    } catch (error: unknown) {
      this.failed = true;
      this.steps.push({ arn: roleArn, status: `failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
      return credentials;
    }
  }

  protected override toResult(): { success: boolean; chain: ChainTestStep[] } {
    return { success: !this.failed, chain: this.steps };
  }
}

export { ChainTestWalker, CredentialChainWalker, LeafCredentialsWalker };
export type { ChainTestStep };

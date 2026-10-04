'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  discoverAccountRoles,
  setAccountNickname,
  storeCredentialRelationship,
  storeCredentials,
  testCredentialChain,
  validateCredentials,
} from '../services/adminService';
import { AWS_ACCOUNT_ID_ERROR_MESSAGE, isAwsAccountId } from '@aws-access-bridge/shared';
import { grantSelectedRoles, saveRoleRelationships } from './onboardingBatches';

interface DiscoveredRole {
  roleName: string;
  arn: string;
  description: string;
}

/**
 * Wizard state + handlers (vertical slice). Previously `OnboardingWizard.tsx`
 * (858 lines) held 6 steps + inline styles + all `apiCall`s + validation in
 * one closure. Steps render from this hook; each step is its own component
 * under `components/onboarding/`.
 */
/**
 * The wizard actions that can show their own spinner.
 */
type WizardBusyAction = 'validate' | 'store' | 'setChain' | 'testChain';

function useOnboardingWizard(showMessage: (type: 'success' | 'error', text: string) => void) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);

  // Step 1: Account
  const [awsAccountId, setAwsAccountId] = useState('');
  const [nickname, setNickname] = useState('');
  const [accountSaved, setAccountSaved] = useState(false);

  // Step 2: Credentials
  const [principalArn, setPrincipalArn] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [credentialValidated, setCredentialValidated] = useState(false);
  const [credentialStored, setCredentialStored] = useState(false);
  const [validationResult, setValidationResult] = useState<{ arn: string; accountId: string } | null>(null);

  // Step 3: Chain
  const [intermediateRoleArn, setIntermediateRoleArn] = useState('');
  const [chainConfigured, setChainConfigured] = useState(false);
  const [chainTestResult, setChainTestResult] = useState<Array<{ arn: string; status: string }> | null>(null);
  const [roleForDiscovery, setRoleForDiscovery] = useState('');

  // Step 4: Roles
  const [discoveredRoles, setDiscoveredRoles] = useState<DiscoveredRole[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [manualRoleName, setManualRoleName] = useState('');

  // Step 5: Users
  const [userEmails, setUserEmails] = useState<string[]>(['']);
  const [accessGranted, setAccessGranted] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  // One flag per in-flight action, so a button can show its own spinner. They
  // were five separate `useState` booleans; a keyed record says the same thing in
  // one line and makes "which actions can be busy" a single question.
  const [busyAction, setBusyAction] = useState<WizardBusyAction | null>(null);
  const isValidating: boolean = busyAction === 'validate';
  const isStoring: boolean = busyAction === 'store';
  const isSettingChain: boolean = busyAction === 'setChain';
  const isTestingChain: boolean = busyAction === 'testChain';

  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [hoveredRole, setHoveredRole] = useState<string | null>(null);

  const handleSaveAccount = async () => {
    if (!isAwsAccountId(awsAccountId)) {
      showMessage('error', AWS_ACCOUNT_ID_ERROR_MESSAGE);
      return;
    }
    setBusyAction('validate');
    try {
      if (nickname.trim()) {
        await setAccountNickname(awsAccountId, nickname.trim());
      }
      setAccountSaved(true);
      showMessage('success', t('onboarding.accountConfigured', 'Account configured.'));
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : 'Failed to save account');
    } finally {
      setBusyAction(null);
    }
  };

  const handleValidateCredentials = async () => {
    setBusyAction('validate');
    try {
      const result = await validateCredentials(accessKeyId, secretAccessKey, sessionToken || undefined);
      setValidationResult(result);
      setCredentialValidated(true);
      showMessage('success', t('onboarding.credentialsValid', 'Credentials valid. Identity: {{identity}}', { identity: result.arn }));
    } catch (err) {
      setValidationResult(null);
      setCredentialValidated(false);
      showMessage('error', err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleStoreCredentials = async () => {
    if (!principalArn.trim()) {
      showMessage('error', t('onboarding.principalRequired', 'Principal ARN is required.'));
      return;
    }
    setBusyAction('store');
    try {
      await storeCredentials(principalArn, accessKeyId, secretAccessKey, sessionToken || undefined);
      setCredentialStored(true);
      showMessage('success', t('onboarding.credentialsStored', 'Credentials stored securely.'));
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : 'Failed to store credentials');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSetChain = async () => {
    if (!intermediateRoleArn.trim()) {
      showMessage('error', t('onboarding.intermediateRequired', 'Intermediate Role ARN is required.'));
      return;
    }
    setBusyAction('setChain');
    try {
      await storeCredentialRelationship(intermediateRoleArn, principalArn);
      setChainConfigured(true);
      setRoleForDiscovery(intermediateRoleArn);
      showMessage('success', t('onboarding.chainConfigured', 'Credential chain configured.'));
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : 'Failed to configure chain');
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestChain = async () => {
    setBusyAction('testChain');
    try {
      const result = await testCredentialChain(roleForDiscovery || principalArn);
      setChainTestResult(result.chain);
      if (result.success) showMessage('success', t('onboarding.chainPassed', 'Chain test passed!'));
      else showMessage('error', t('onboarding.chainFailed', 'Chain test failed. Check results below.'));
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : 'Chain test failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDiscoverRoles = async () => {
    setIsLoading(true);
    try {
      const result = await discoverAccountRoles(roleForDiscovery || principalArn);
      setDiscoveredRoles(result.roles);
      showMessage('success', t('onboarding.rolesFound', 'Found {{count}} roles.', { count: result.roles.length }));
    } catch (err) {
      showMessage(
        'error',
        `${err instanceof Error ? err.message : 'Discovery failed'} ${t('onboarding.manualHint', 'You can manually add role names below.')}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRole = (roleName: string) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(roleName)) next.delete(roleName);
      else next.add(roleName);
      return next;
    });
  };

  const handleAddManualRole = () => {
    if (!manualRoleName.trim()) return;
    setDiscoveredRoles((prev) => [...prev, { roleName: manualRoleName.trim(), arn: '', description: '(manually added)' }]);
    setSelectedRoles((prev) => new Set(prev).add(manualRoleName.trim()));
    setManualRoleName('');
  };

  const handleSaveRoleRelationships = async (): Promise<boolean> => {
    const assumedByArn = roleForDiscovery || principalArn;
    // Nothing to do is success: an empty selection or an unknown ARN is a state
    // the wizard must be able to advance past, not an error.
    if (!assumedByArn || selectedRoles.size === 0) return true;
    setIsLoading(true);
    const { ok, failures } = await saveRoleRelationships(selectedRoles, discoveredRoles, assumedByArn);
    setIsLoading(false);
    if (!ok) {
      showMessage('error', t('onboarding.rolesSaveFailed', '{{count}} role relationship(s) failed to save.', { count: failures }));
      return false;
    }
    return true;
  };

  const handleStep4Next = async () => {
    const saved = await handleSaveRoleRelationships();
    if (saved) {
      setStep(4);
    }
  };

  const handleGrantAccess = async () => {
    const validEmails = userEmails.filter((e) => e.trim());
    if (validEmails.length === 0 || selectedRoles.size === 0) {
      showMessage('error', t('onboarding.assignRequired', 'Add at least one user email and select at least one role.'));
      return;
    }
    setIsLoading(true);
    const { failures } = await grantSelectedRoles(validEmails, selectedRoles, awsAccountId);
    if (failures === 0) {
      setAccessGranted(true);
      showMessage(
        'success',
        t('onboarding.accessGrantedTo', 'Access granted to {{users}} user(s) for {{roles}} role(s).', {
          users: validEmails.length,
          roles: selectedRoles.size,
        }),
      );
    } else {
      showMessage(
        'error',
        t('onboarding.accessGrantFailed', '{{count}} access grant(s) failed. Check logs for details.', { count: failures }),
      );
    }
    setIsLoading(false);
  };

  /**
   * Editing any credential field invalidates the validation result, so a stale
   * "validated" badge cannot sit above credentials that no longer match what was
   * checked. One factory rather than three identical copies — a fourth field
   * added later would otherwise be the one that forgot to reset.
   */
  const withValidationReset =
    (setter: (value: string) => void) =>
    (value: string): void => {
      setter(value);
      setCredentialValidated(false);
      setValidationResult(null);
    };

  return {
    step,
    setStep,
    awsAccountId,
    setAwsAccountId,
    nickname,
    setNickname,
    accountSaved,
    principalArn,
    setPrincipalArn,
    accessKeyId,
    setAccessKeyId: withValidationReset(setAccessKeyId),
    secretAccessKey,
    setSecretAccessKey: withValidationReset(setSecretAccessKey),
    sessionToken,
    setSessionToken: withValidationReset(setSessionToken),
    credentialValidated,
    credentialStored,
    validationResult,
    intermediateRoleArn,
    setIntermediateRoleArn: (value: string) => {
      setIntermediateRoleArn(value);
      setChainConfigured(false);
      setChainTestResult(null);
    },
    chainConfigured,
    chainTestResult,
    roleForDiscovery,
    discoveredRoles,
    selectedRoles,
    manualRoleName,
    setManualRoleName,
    userEmails,
    setUserEmails,
    accessGranted,
    isLoading,
    isValidating,
    isStoring,
    isSettingChain,
    isTestingChain,
    focusedInput,
    setFocusedInput,
    hoveredRole,
    setHoveredRole,
    handleSaveAccount,
    handleValidateCredentials,
    handleStoreCredentials,
    handleSetChain,
    handleTestChain,
    handleDiscoverRoles,
    toggleRole,
    handleAddManualRole,
    handleStep4Next,
    handleGrantAccess,
  };
}

type OnboardingWizard = ReturnType<typeof useOnboardingWizard>;

export { useOnboardingWizard };
export type { DiscoveredRole, OnboardingWizard };

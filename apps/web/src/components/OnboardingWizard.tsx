'use client';

import { useEffect, useState } from 'react';
import { apiCall } from '../lib/api';

interface OnboardingWizardProps {
  showMessage: (type: 'success' | 'error', text: string) => void;
}

const STEPS = ['Account', 'Credentials', 'Chain', 'Roles', 'Users', 'Summary'] as const;

const wizardStyles = {
  card: {
    background: '#1e2433',
    border: '1px solid rgba(55,65,81,0.5)',
    padding: '24px',
    borderRadius: '12px',
  } as React.CSSProperties,
  cardInner: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '12px',
    background: '#252d3d',
    borderRadius: '8px',
    border: '1px solid #374151',
    color: 'white',
    outline: 'none',
    transition: 'border-color 0.15s',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  summaryItem: {
    background: '#252d3d',
    border: '1px solid rgba(55,65,81,0.3)',
    padding: '12px',
    borderRadius: '8px',
  } as React.CSSProperties,
  chainResult: {
    background: '#252d3d',
    border: '1px solid rgba(55,65,81,0.3)',
    padding: '12px',
    borderRadius: '8px',
  } as React.CSSProperties,
  btnPrimary: {
    background: '#2563eb',
    padding: '10px 20px',
    borderRadius: '8px',
    color: 'white',
    border: 'none',
    transition: 'background 0.15s',
    opacity: 1,
  } as React.CSSProperties,
  btnSuccess: {
    background: '#16a34a',
    padding: '10px 20px',
    borderRadius: '8px',
    color: 'white',
    border: 'none',
    transition: 'background 0.15s',
    opacity: 1,
  } as React.CSSProperties,
  btnSecondary: {
    background: '#374151',
    border: '1px solid #4b5563',
    padding: '10px 20px',
    borderRadius: '8px',
    color: '#d1d5db',
    transition: 'background 0.15s',
  } as React.CSSProperties,
  btnDisabled: {
    background: '#374151',
    color: '#6b7280',
    cursor: 'not-allowed',
    opacity: 1,
  } as React.CSSProperties,
  roleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    background: '#252d3d',
    borderRadius: '8px',
    transition: 'background 0.15s',
  } as React.CSSProperties,
};

export default function OnboardingWizard({ showMessage }: OnboardingWizardProps) {
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
  const [_credentialValidated, setCredentialValidated] = useState(false);
  const [credentialStored, setCredentialStored] = useState(false);
  const [validationResult, setValidationResult] = useState<{ arn: string; accountId: string } | null>(null);

  // Step 3: Chain
  const [intermediateRoleArn, setIntermediateRoleArn] = useState('');
  const [chainConfigured, setChainConfigured] = useState(false);
  const [chainTestResult, setChainTestResult] = useState<Array<{ arn: string; status: string }> | null>(null);
  const [roleForDiscovery, setRoleForDiscovery] = useState('');

  // Step 4: Roles
  const [discoveredRoles, setDiscoveredRoles] = useState<Array<{ roleName: string; arn: string; description: string }>>([]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [manualRoleName, setManualRoleName] = useState('');

  // Step 5: Users
  const [userEmails, setUserEmails] = useState<string[]>(['']);
  const [accessGranted, setAccessGranted] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isStoring, setIsStoring] = useState(false);
  const [isSettingChain, setIsSettingChain] = useState(false);
  const [isTestingChain, setIsTestingChain] = useState(false);

  // Focus tracking for inputs
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  // Hover tracking for role labels
  const [hoveredRole, setHoveredRole] = useState<string | null>(null);

  useEffect(() => {
    if (_credentialValidated) {
      setCredentialValidated(false);
      setValidationResult(null);
    }
  }, [accessKeyId, secretAccessKey, sessionToken]);

  useEffect(() => {
    if (chainConfigured) {
      setChainConfigured(false);
      setChainTestResult(null);
    }
  }, [intermediateRoleArn]);

  // Step 1 handlers
  const handleSaveAccount = async () => {
    if (!/^[0-9]{12}$/.test(awsAccountId)) {
      showMessage('error', 'AWS Account ID must be exactly 12 digits.');
      return;
    }
    setIsValidating(true);
    if (nickname.trim()) {
      const result = await apiCall('/api/admin/account/nickname', 'PUT', { awsAccountId, nickname: nickname.trim() });
      if (!result.ok) {
        showMessage('error', result.error!);
        setIsValidating(false);
        return;
      }
    }
    setAccountSaved(true);
    showMessage('success', 'Account configured.');
    setIsValidating(false);
  };

  // Step 2 handlers
  const handleValidateCredentials = async () => {
    setIsValidating(true);
    const result = await apiCall('/api/admin/credentials/validate', 'POST', {
      accessKeyId,
      secretAccessKey,
      sessionToken: sessionToken || undefined,
    });
    if (result.ok) {
      const d = result.data as { arn: string; accountId: string };
      setValidationResult(d);
      setCredentialValidated(true);
      showMessage('success', `Credentials valid. Identity: ${d.arn}`);
    } else {
      setValidationResult(null);
      setCredentialValidated(false);
      showMessage('error', result.error!);
    }
    setIsValidating(false);
  };

  const handleStoreCredentials = async () => {
    if (!principalArn.trim()) {
      showMessage('error', 'Principal ARN is required.');
      return;
    }
    setIsStoring(true);
    const result = await apiCall('/api/admin/credentials', 'POST', {
      principalArn,
      accessKeyId,
      secretAccessKey,
      ...(sessionToken && { sessionToken }),
    });
    if (result.ok) {
      setCredentialStored(true);
      showMessage('success', 'Credentials stored securely.');
    } else {
      showMessage('error', result.error!);
    }
    setIsStoring(false);
  };

  // Step 3 handlers
  const handleSetChain = async () => {
    if (!intermediateRoleArn.trim()) {
      showMessage('error', 'Intermediate Role ARN is required.');
      return;
    }
    setIsSettingChain(true);
    const result = await apiCall('/api/admin/credentials/relationship', 'POST', {
      principalArn: intermediateRoleArn,
      assumedBy: principalArn,
    });
    if (result.ok) {
      setChainConfigured(true);
      setRoleForDiscovery(intermediateRoleArn);
      showMessage('success', 'Credential chain configured.');
    } else {
      showMessage('error', result.error!);
    }
    setIsSettingChain(false);
  };

  const handleTestChain = async () => {
    setIsTestingChain(true);
    const roleArnToTest = roleForDiscovery || principalArn;
    const result = await apiCall('/api/admin/credentials/test-chain', 'POST', { principalArn: roleArnToTest });
    if (result.ok) {
      const d = result.data as { success: boolean; chain: Array<{ arn: string; status: string }> };
      setChainTestResult(d.chain);
      if (d.success) showMessage('success', 'Chain test passed!');
      else showMessage('error', 'Chain test failed. Check results below.');
    } else {
      showMessage('error', result.error!);
    }
    setIsTestingChain(false);
  };

  // Step 4 handlers
  const handleDiscoverRoles = async () => {
    setIsLoading(true);
    const roleArnToUse = roleForDiscovery || principalArn;
    const result = await apiCall('/api/admin/account/roles', 'POST', { principalArn: roleArnToUse });
    if (result.ok) {
      const d = result.data as { roles: Array<{ roleName: string; arn: string; description: string }> };
      setDiscoveredRoles(d.roles);
      showMessage('success', `Found ${d.roles.length} roles.`);
    } else {
      showMessage('error', result.error! + ' You can manually add role names below.');
    }
    setIsLoading(false);
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
    if (selectedRoles.size === 0) return true;

    const assumedByArn = roleForDiscovery || principalArn;
    if (!assumedByArn) return true;

    setIsLoading(true);
    let failures = 0;
    for (const roleName of selectedRoles) {
      const role = discoveredRoles.find((r) => r.roleName === roleName);
      if (!role || !role.arn) continue;

      const result = await apiCall('/api/admin/credentials/relationship', 'POST', {
        principalArn: role.arn,
        assumedBy: assumedByArn,
      });
      if (!result.ok) failures++;
    }
    setIsLoading(false);

    if (failures > 0) {
      showMessage('error', `${failures} role relationship(s) failed to save.`);
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

  // Step 5 handlers
  const handleGrantAccess = async () => {
    const validEmails = userEmails.filter((e) => e.trim());
    if (validEmails.length === 0 || selectedRoles.size === 0) {
      showMessage('error', 'Add at least one user email and select at least one role.');
      return;
    }
    setIsLoading(true);
    let failures = 0;
    for (const email of validEmails) {
      for (const role of selectedRoles) {
        const result = await apiCall('/api/admin/access', 'POST', { userEmail: email.trim(), awsAccountId, roleName: role });
        if (!result.ok) failures++;
      }
    }
    if (failures === 0) {
      setAccessGranted(true);
      showMessage('success', `Access granted to ${validEmails.length} user(s) for ${selectedRoles.size} role(s).`);
    } else {
      showMessage('error', `${failures} access grant(s) failed. Check logs for details.`);
    }
    setIsLoading(false);
  };

  const getInputStyle = (name: string): React.CSSProperties => ({
    ...wizardStyles.input,
    borderColor: focusedInput === name ? '#3b82f6' : '#374151',
  });

  const getBtnPrimary = (disabled: boolean): React.CSSProperties => ({
    ...wizardStyles.btnPrimary,
    ...(disabled ? wizardStyles.btnDisabled : {}),
  });

  const getBtnSuccess = (disabled: boolean): React.CSSProperties => ({
    ...wizardStyles.btnSuccess,
    ...(disabled ? wizardStyles.btnDisabled : {}),
  });

  return (
    <div style={{ maxWidth: '56rem', margin: '0 auto' }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2.5rem' }}>
        {STEPS.map((label, i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? '1' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                className="text-sm font-bold"
                style={{
                  width: '36px',
                  height: '36px',
                  minWidth: '36px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: i < step ? '#16a34a' : i === step ? '#2563eb' : '#374151',
                  color: i <= step ? 'white' : '#9ca3af',
                  boxShadow: i === step ? '0 0 0 4px rgba(37, 99, 235, 0.2)' : 'none',
                }}
              >
                {i < step ? '\u2713' : i + 1}
              </div>
              <span
                className="text-sm font-medium"
                style={{
                  whiteSpace: 'nowrap',
                  color: i === step ? 'white' : i < step ? '#4ade80' : '#6b7280',
                }}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: '1px',
                  margin: '0 16px',
                  background: i < step ? '#16a34a' : '#374151',
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Account */}
      {step === 0 && (
        <div style={wizardStyles.card}>
          <div style={wizardStyles.cardInner}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>Add AWS Account</h3>
            <p className="text-sm" style={{ color: '#9ca3af' }}>
              Enter the 12-digit AWS Account ID and an optional nickname.
            </p>
            <input
              type="text"
              placeholder="AWS Account ID (12 digits)"
              value={awsAccountId}
              onChange={(e) => setAwsAccountId(e.target.value)}
              style={getInputStyle('accountId')}
              onFocus={() => setFocusedInput('accountId')}
              onBlur={() => setFocusedInput(null)}
              pattern="[0-9]{12}"
            />
            <input
              type="text"
              placeholder="Nickname (optional)"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              style={getInputStyle('nickname')}
              onFocus={() => setFocusedInput('nickname')}
              onBlur={() => setFocusedInput(null)}
            />
            {accountSaved && (
              <p className="text-sm" style={{ color: '#4ade80' }}>
                Account configured.
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button
                onClick={handleSaveAccount}
                disabled={isLoading || !/^[0-9]{12}$/.test(awsAccountId)}
                className="font-medium"
                style={getBtnPrimary(isLoading || !/^[0-9]{12}$/.test(awsAccountId))}
              >
                {isLoading ? 'Saving...' : 'Save Account'}
              </button>
              <button onClick={() => setStep(1)} disabled={!accountSaved} className="font-medium" style={getBtnSuccess(!accountSaved)}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Credentials */}
      {step === 1 && (
        <div style={wizardStyles.card}>
          <div style={wizardStyles.cardInner}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>Store Credentials</h3>
            <p className="text-sm" style={{ color: '#9ca3af' }}>
              Enter IAM credentials. Validate first to confirm they work, then store them securely.
            </p>
            <input
              type="text"
              placeholder="Principal ARN (e.g., arn:aws:iam::123456789012:user/username)"
              value={principalArn}
              onChange={(e) => setPrincipalArn(e.target.value)}
              style={getInputStyle('principalArn')}
              onFocus={() => setFocusedInput('principalArn')}
              onBlur={() => setFocusedInput(null)}
            />
            <input
              type="text"
              placeholder="Access Key ID"
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              style={getInputStyle('accessKeyId')}
              onFocus={() => setFocusedInput('accessKeyId')}
              onBlur={() => setFocusedInput(null)}
            />
            <input
              type="password"
              placeholder="Secret Access Key"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
              style={getInputStyle('secretAccessKey')}
              onFocus={() => setFocusedInput('secretAccessKey')}
              onBlur={() => setFocusedInput(null)}
            />
            <input
              type="password"
              placeholder="Session Token (optional)"
              value={sessionToken}
              onChange={(e) => setSessionToken(e.target.value)}
              style={getInputStyle('sessionToken')}
              onFocus={() => setFocusedInput('sessionToken')}
              onBlur={() => setFocusedInput(null)}
            />
            {validationResult && (
              <p className="text-sm" style={{ color: '#4ade80' }}>
                Identity: {validationResult.arn} (Account: {validationResult.accountId})
              </p>
            )}
            {credentialStored && (
              <p className="text-sm" style={{ color: '#4ade80' }}>
                Credentials stored securely.
              </p>
            )}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={handleValidateCredentials}
                disabled={isValidating || !accessKeyId || !secretAccessKey}
                className="font-medium"
                style={getBtnPrimary(isValidating || !accessKeyId || !secretAccessKey)}
              >
                {isValidating ? 'Validating...' : 'Validate'}
              </button>
              <button
                onClick={handleStoreCredentials}
                disabled={isStoring || !_credentialValidated || !principalArn || !accessKeyId || !secretAccessKey}
                className="font-medium"
                style={getBtnSuccess(isStoring || !_credentialValidated || !principalArn || !accessKeyId || !secretAccessKey)}
              >
                {isStoring ? 'Storing...' : 'Store Credentials'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '16px' }}>
              <button
                onClick={() => setStep(0)}
                className="font-medium"
                style={wizardStyles.btnSecondary}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
              >
                Back
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={!credentialStored}
                className="font-medium"
                style={getBtnSuccess(!credentialStored)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Credential Chain */}
      {step === 2 && (
        <div style={wizardStyles.card}>
          <div style={wizardStyles.cardInner}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>Credential Chain (Optional)</h3>
            <p className="text-sm" style={{ color: '#9ca3af' }}>
              Enter the intermediate role ARN that the credentials from Step 2 will assume. Leave empty if no chain is needed.
            </p>
            <input
              type="text"
              placeholder="Intermediate Role ARN (role that credentials from Step 2 will assume)"
              value={intermediateRoleArn}
              onChange={(e) => setIntermediateRoleArn(e.target.value)}
              style={getInputStyle('intermediateRoleArn')}
              onFocus={() => setFocusedInput('intermediateRoleArn')}
              onBlur={() => setFocusedInput(null)}
            />
            {chainConfigured && (
              <p className="text-sm" style={{ color: '#4ade80' }}>
                Chain configured. Using {roleForDiscovery} for role discovery.
              </p>
            )}
            {chainTestResult && (
              <div className="text-sm" style={wizardStyles.chainResult}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {chainTestResult.map((r, i) => (
                    <div key={i} style={{ color: r.status.startsWith('ok') ? '#4ade80' : '#f87171' }}>
                      {r.arn}: {r.status}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={handleSetChain}
                disabled={isSettingChain || !intermediateRoleArn.trim()}
                className="font-medium"
                style={getBtnPrimary(isSettingChain || !intermediateRoleArn.trim())}
              >
                {isSettingChain ? 'Setting...' : 'Set Chain'}
              </button>
              <button
                onClick={handleTestChain}
                disabled={isTestingChain || !chainConfigured}
                className="font-medium"
                style={getBtnPrimary(isTestingChain || !chainConfigured)}
              >
                {isTestingChain ? 'Testing...' : 'Test Chain'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '16px' }}>
              <button
                onClick={() => setStep(1)}
                className="font-medium"
                style={wizardStyles.btnSecondary}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
              >
                Back
              </button>
              <button onClick={() => setStep(3)} className="font-medium" style={wizardStyles.btnSuccess}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Roles */}
      {step === 3 && (
        <div style={wizardStyles.card}>
          <div style={wizardStyles.cardInner}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>Discover & Select Roles</h3>
            <p className="text-sm" style={{ color: '#9ca3af' }}>
              Discover IAM roles in the account or add them manually.
            </p>
            <button onClick={handleDiscoverRoles} disabled={isLoading} className="font-medium" style={getBtnPrimary(isLoading)}>
              {isLoading ? 'Discovering...' : 'Discover Roles'}
            </button>
            {discoveredRoles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '256px', overflowY: 'auto' }}>
                {discoveredRoles.map((role) => (
                  <label
                    key={role.roleName}
                    className="cursor-pointer"
                    style={{
                      ...wizardStyles.roleLabel,
                      background: hoveredRole === role.roleName ? '#313b50' : '#252d3d',
                    }}
                    onMouseEnter={() => setHoveredRole(role.roleName)}
                    onMouseLeave={() => setHoveredRole(null)}
                  >
                    <input type="checkbox" checked={selectedRoles.has(role.roleName)} onChange={() => toggleRole(role.roleName)} />
                    <span className="font-medium">{role.roleName}</span>
                    {role.description && (
                      <span className="text-sm" style={{ color: '#9ca3af' }}>
                        — {role.description}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Manually add role name"
                value={manualRoleName}
                onChange={(e) => setManualRoleName(e.target.value)}
                style={getInputStyle('manualRole')}
                onFocus={() => setFocusedInput('manualRole')}
                onBlur={() => setFocusedInput(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddManualRole();
                }}
              />
              <button
                onClick={handleAddManualRole}
                disabled={!manualRoleName.trim()}
                className="font-medium"
                style={getBtnPrimary(!manualRoleName.trim())}
              >
                Add
              </button>
            </div>
            <p className="text-sm" style={{ color: '#9ca3af' }}>
              {selectedRoles.size} role(s) selected
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '16px' }}>
              <button
                onClick={() => setStep(2)}
                className="font-medium"
                style={wizardStyles.btnSecondary}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
              >
                Back
              </button>
              <button
                onClick={handleStep4Next}
                disabled={selectedRoles.size === 0 || isLoading}
                className="font-medium"
                style={getBtnSuccess(selectedRoles.size === 0 || isLoading)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Users */}
      {step === 4 && (
        <div style={wizardStyles.card}>
          <div style={wizardStyles.cardInner}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>Assign Users</h3>
            <p className="text-sm" style={{ color: '#9ca3af' }}>
              Enter email addresses of users to grant access to the selected roles.
            </p>
            {userEmails.map((email, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => {
                    const next = [...userEmails];
                    next[i] = e.target.value;
                    setUserEmails(next);
                  }}
                  style={getInputStyle(`email-${i}`)}
                  onFocus={() => setFocusedInput(`email-${i}`)}
                  onBlur={() => setFocusedInput(null)}
                />
                {userEmails.length > 1 && (
                  <button
                    onClick={() => setUserEmails(userEmails.filter((_, j) => j !== i))}
                    style={{ color: '#f87171', padding: '0 8px', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#fca5a5')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#f87171')}
                  >
                    X
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setUserEmails([...userEmails, ''])}
              className="text-sm"
              style={{ color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#93bbfd')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#60a5fa')}
            >
              + Add another user
            </button>
            <p className="text-sm" style={{ color: '#9ca3af' }}>
              Granting access to: {Array.from(selectedRoles).join(', ')} in account {awsAccountId}
            </p>
            {accessGranted && (
              <p className="text-sm" style={{ color: '#4ade80' }}>
                Access granted successfully.
              </p>
            )}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleGrantAccess}
                disabled={isLoading || userEmails.every((e) => !e.trim()) || selectedRoles.size === 0}
                className="font-medium"
                style={getBtnSuccess(isLoading || userEmails.every((e) => !e.trim()) || selectedRoles.size === 0)}
              >
                {isLoading ? 'Granting...' : 'Grant Access'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '16px' }}>
              <button
                onClick={() => setStep(3)}
                className="font-medium"
                style={wizardStyles.btnSecondary}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
              >
                Back
              </button>
              <button onClick={() => setStep(5)} className="font-medium" style={wizardStyles.btnSuccess}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 6: Summary */}
      {step === 5 && (
        <div style={wizardStyles.card}>
          <div style={wizardStyles.cardInner}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>Setup Complete</h3>
            <div className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={wizardStyles.summaryItem}>
                <span style={{ color: '#9ca3af' }}>Account:</span> {nickname ? `${nickname} (${awsAccountId})` : awsAccountId}
              </div>
              <div style={wizardStyles.summaryItem}>
                <span style={{ color: '#9ca3af' }}>Principal:</span> {principalArn}
              </div>
              {intermediateRoleArn && (
                <div style={wizardStyles.summaryItem}>
                  <span style={{ color: '#9ca3af' }}>Chain:</span> {principalArn} → {intermediateRoleArn}
                </div>
              )}
              <div style={wizardStyles.summaryItem}>
                <span style={{ color: '#9ca3af' }}>Roles:</span> {Array.from(selectedRoles).join(', ')}
              </div>
              <div style={wizardStyles.summaryItem}>
                <span style={{ color: '#9ca3af' }}>Users:</span> {userEmails.filter((e) => e.trim()).join(', ') || '(none assigned)'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', paddingTop: '16px' }}>
              <button onClick={handleTestChain} disabled={isLoading} className="font-medium" style={getBtnPrimary(isLoading)}>
                {isLoading ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                onClick={() => setStep(0)}
                className="font-medium"
                style={wizardStyles.btnSecondary}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#4b5563')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#374151')}
              >
                Back to Start
              </button>
            </div>
            {chainTestResult && (
              <div className="text-sm" style={wizardStyles.chainResult}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {chainTestResult.map((r, i) => (
                    <div key={i} style={{ color: r.status.startsWith('ok') ? '#4ade80' : '#f87171' }}>
                      {r.arn}: {r.status}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

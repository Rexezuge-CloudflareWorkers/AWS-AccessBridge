/**
 * The onboarding wizard's pure rules: step names, step gating, and the small
 * reducers behind its forms. `hooks/onboarding/*` own the state; everything that
 * can be decided without React lives here.
 */
import type { ChainTestEntry, DiscoveredRole, ValidatedIdentity } from '../services/adminService';

/**
 * The wizard's steps, in order. Named because the bare indices (`setStep(4)`)
 * were scattered across the hook and six components, so reordering a step meant
 * finding every literal.
 */
const WIZARD_STEP = {
  ACCOUNT: 0,
  CREDENTIALS: 1,
  CHAIN: 2,
  ROLES: 3,
  USERS: 4,
  SUMMARY: 5,
} as const;

type WizardStep = (typeof WIZARD_STEP)[keyof typeof WIZARD_STEP];

const FIRST_WIZARD_STEP: WizardStep = WIZARD_STEP.ACCOUNT;
const LAST_WIZARD_STEP: WizardStep = WIZARD_STEP.SUMMARY;

/**
 * The step after `step`, or `step` itself on the last one.
 */
function nextStep(step: WizardStep): WizardStep {
  return Math.min(LAST_WIZARD_STEP, step + 1) as WizardStep;
}

/**
 * The step before `step`, or `step` itself on the first one.
 */
function previousStep(step: WizardStep): WizardStep {
  return Math.max(FIRST_WIZARD_STEP, step - 1) as WizardStep;
}

/**
 * The `useAsyncAction` busy keys, one per action that shows its own spinner. Each
 * action has its own key: the account save used to borrow `'validate'`, so the
 * Validate button on the *next* step would have spun for it, and the Save button
 * never did.
 */
const WIZARD_BUSY = {
  SAVE_ACCOUNT: 'saveAccount',
  VALIDATE: 'validate',
  STORE: 'store',
  SET_CHAIN: 'setChain',
  TEST_CHAIN: 'testChain',
  DISCOVER: 'discover',
  SAVE_ROLES: 'saveRoles',
  GRANT: 'grant',
} as const;

interface StepGateFlags {
  accountSaved: boolean;
  credentialStored: boolean;
  selectedRoleCount: number;
}

/**
 * Whether the wizard may leave `step` going forward.
 *
 * Account and credentials must be persisted first; roles need at least one
 * selection. The chain step is optional ("leave empty if no chain is needed") and
 * the users step may be skipped, so both always advance. The summary has no next.
 */
function canAdvanceFromStep(step: WizardStep, flags: StepGateFlags): boolean {
  switch (step) {
    case WIZARD_STEP.ACCOUNT: {
      return flags.accountSaved;
    }
    case WIZARD_STEP.CREDENTIALS: {
      return flags.credentialStored;
    }
    case WIZARD_STEP.ROLES: {
      return flags.selectedRoleCount > 0;
    }
    case WIZARD_STEP.CHAIN:
    case WIZARD_STEP.USERS: {
      return true;
    }
    default: {
      return false;
    }
  }
}

interface CredentialsState {
  principalArn: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  credentialValidated: boolean;
  credentialStored: boolean;
  validationResult: ValidatedIdentity | null;
}

/**
 * The fields whose edit invalidates a validation. `principalArn` is not one: it
 * names where the credentials are stored, not what was checked.
 */
type ValidatedCredentialField = 'accessKeyId' | 'secretAccessKey' | 'sessionToken';

const EMPTY_CREDENTIALS: CredentialsState = {
  principalArn: '',
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: '',
  credentialValidated: false,
  credentialStored: false,
  validationResult: null,
};

/**
 * Editing a credential field invalidates the validation result, so a stale
 * "validated" badge cannot sit above credentials that no longer match what was
 * checked. One rule for all three fields — a fourth added later cannot be the one
 * that forgot to reset it.
 *
 * `credentialStored` is deliberately left alone: what was already written to the
 * server stays written, and the store button is separately gated on a fresh
 * validation.
 */
function editCredentialField(state: CredentialsState, field: ValidatedCredentialField, value: string): CredentialsState {
  return { ...state, [field]: value, credentialValidated: false, validationResult: null };
}

interface ChainState {
  intermediateRoleArn: string;
  chainConfigured: boolean;
  chainTestResult: ChainTestEntry[] | null;
  roleForDiscovery: string;
}

const EMPTY_CHAIN: ChainState = {
  intermediateRoleArn: '',
  chainConfigured: false,
  chainTestResult: null,
  roleForDiscovery: '',
};

/**
 * Editing the intermediate ARN un-configures the chain and drops its test
 * result, since both describe the ARN that was just changed. `roleForDiscovery`
 * stays: it is what was last *saved*, and discovery keeps using it until the new
 * ARN is.
 */
function editIntermediateRoleArn(state: ChainState, value: string): ChainState {
  return { ...state, intermediateRoleArn: value, chainConfigured: false, chainTestResult: null };
}

/**
 * The ARN discovery and relationship writes assume from: the saved chain's
 * intermediate role when there is one, else the stored principal.
 */
function resolveAssumedByArn(chain: Pick<ChainState, 'roleForDiscovery'>, principalArn: string): string {
  return chain.roleForDiscovery || principalArn;
}

/**
 * Adds a hand-typed role, selected.
 *
 * The name is trimmed. A blank name is a no-op (`null`). A name already in the
 * list is not added a second time — two rows with one key is a React warning and
 * would double the relationship write — but it is selected, since the user's
 * intent is clearly "use this role".
 *
 * `description` is passed in, already translated, because a role added by hand
 * has no discovered description of its own.
 */
function addManualRole(
  discovered: DiscoveredRole[],
  selected: ReadonlySet<string>,
  rawName: string,
  description: string,
): { discoveredRoles: DiscoveredRole[]; selectedRoles: Set<string> } | null {
  const roleName = rawName.trim();
  if (!roleName) {
    return null;
  }
  const exists = discovered.some((role) => role.roleName === roleName);
  return {
    discoveredRoles: exists ? discovered : [...discovered, { roleName, arn: '', description }],
    selectedRoles: new Set(selected).add(roleName),
  };
}

/**
 * A new set with `roleName` flipped in or out; the input is never mutated, so
 * React sees a new identity.
 */
function toggleSelection(selected: ReadonlySet<string>, roleName: string): Set<string> {
  const next = new Set(selected);
  if (next.has(roleName)) {
    next.delete(roleName);
  } else {
    next.add(roleName);
  }
  return next;
}

/**
 * The addresses worth granting to: trimmed, blanks dropped. An untouched empty
 * input row is the wizard's starting state, so it must not count as an address.
 */
function validEmails(emails: readonly string[]): string[] {
  return emails.map((email) => email.trim()).filter((email) => email !== '');
}

export type { ChainState, CredentialsState, StepGateFlags, ValidatedCredentialField, WizardStep };
export {
  EMPTY_CHAIN,
  EMPTY_CREDENTIALS,
  FIRST_WIZARD_STEP,
  LAST_WIZARD_STEP,
  WIZARD_BUSY,
  WIZARD_STEP,
  addManualRole,
  canAdvanceFromStep,
  editCredentialField,
  editIntermediateRoleArn,
  nextStep,
  previousStep,
  resolveAssumedByArn,
  toggleSelection,
  validEmails,
};

export { type ChainTestEntry, type DiscoveredRole, type ValidatedIdentity } from '../services/adminService';

/**
 * Represents an AWS IAM trust chain for role assumption operations.
 *
 * This interface models the complete credential chain required to assume AWS roles
 * through a series of intermediate principals. The chain represents the trust relationship
 * path from the initial IAM user to the final target role, enabling secure cross-account
 * and cross-role access patterns.
 *
 * The principal chain is ordered from highest index (initial user) to lowest index (target role),
 * where each principal in the chain has permission to assume the next principal in the sequence.
 *
 * @example
 * // Example of a 4-level trust chain:
 * // Chain[3]: Initial IAM User (arn:aws:iam::000000000000:user/InitialUser)
 * // Chain[2]: First Intermediate Role (arn:aws:iam::000000000000:role/IntermediateRole-1)
 * // Chain[1]: Second Intermediate Role (arn:aws:iam::000000000000:role/IntermediateRole-2)
 * // Chain[0]: Final Target Role (arn:aws:iam::000000000000:role/TargetRole)
 *
 * const credentialChain: CredentialChain = {
 *   principalArns: [
 *     "arn:aws:iam::000000000000:role/TargetRole",            // Index 0 - Final target
 *     "arn:aws:iam::000000000000:role/IntermediateRole-2",    // Index 1 - Second intermediate
 *     "arn:aws:iam::000000000000:role/IntermediateRole-1",    // Index 2 - First intermediate
 *     "arn:aws:iam::000000000000:user/InitialUser"            // Index 3 - Initial user
 *   ],
 *   accessKeyId: "AKIA<example-key-id>",
 *   secretAccessKey: "<example-secret-key>",
 *   sessionToken: "AQoDYXdzEJr...<remainder-of-session-token>"
 * };
 *
 * @example
 * // Simple 2-level chain (user -> role):
 * const simpleChain: CredentialChain = {
 *   principalArns: [
 *     "arn:aws:iam::000000000000:role/TargetRole",
 *     "arn:aws:iam::000000000000:user/InitialUser"
 *   ],
 *   accessKeyId: "AKIA<example-key-id>",
 *   secretAccessKey: "<example-secret-key>"
 * };
 */
interface CredentialChain {
  /**
   * Ordered array of AWS principal ARNs representing the trust chain.
   *
   * The array is ordered from target (index 0) to source (highest index):
   * - Index 0: The final target role that will be assumed
   * - Index 1 to n-1: Intermediate roles in the assumption chain
   * - Index n: The initial IAM user or role with base credentials
   *
   * Each principal must have permission to assume the previous principal in the array.
   */
  principalArns: Array<string>;

  /**
   * AWS access key ID for the base credentials.
   *
   * This corresponds to the access key of the initial principal (highest index)
   * in the principalArns array, typically an IAM user's long-term credentials.
   */
  accessKeyId: string;

  /**
   * AWS secret access key for the base credentials.
   *
   * This is the secret key paired with the accessKeyId, belonging to the
   * initial principal in the trust chain.
   */
  secretAccessKey: string;

  /**
   * Optional AWS session token for temporary credentials.
   *
   * When present, indicates that the base credentials are temporary (STS-issued)
   * rather than long-term IAM user credentials. This is used when the initial
   * principal in the chain is itself an assumed role.
   */
  sessionToken?: string;
}

export type { CredentialChain };

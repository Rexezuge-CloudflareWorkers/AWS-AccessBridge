/**
 * The all-zero team id, which marks the implicit team every account belongs to.
 *
 * It is a sentinel rather than a real team: accounts with no explicit team
 * membership are attributed here, so it backs rows that would otherwise be
 * orphaned and must never be deletable. It was defined three times — in
 * `TeamService`, in the web app's `lib/constants`, and inline in an OpenAPI
 * example — so a change to it would have had to be found in three places, and
 * the two real definitions could drift into disagreeing about which id is
 * protected.
 */
export const DEFAULT_TEAM_ID: string = '00000000-0000-0000-0000-000000000000';
export type BrokerErrorCode =
  | "invalid_request"
  | "invalid_proof"
  | "invalid_invite"
  | "invalid_account"
  | "not_admin"
  | "not_paid"
  | "already_subscribed"
  | "blocked"
  | "rate_limited"
  | "full"
  | "upstream";

export const ERROR_STATUS: Record<BrokerErrorCode, number> = {
  invalid_request: 400,
  invalid_proof: 401,
  invalid_invite: 403,
  invalid_account: 401,
  not_admin: 403,
  not_paid: 402,
  already_subscribed: 409,
  blocked: 403,
  rate_limited: 429,
  full: 503,
  upstream: 502,
};

export class BrokerError extends Error {
  readonly code: BrokerErrorCode;

  constructor(code: BrokerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

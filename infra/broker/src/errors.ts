export type BrokerErrorCode =
  | "invalid_request"
  | "invalid_proof"
  | "blocked"
  | "rate_limited"
  | "full"
  | "upstream";

export const ERROR_STATUS: Record<BrokerErrorCode, number> = {
  invalid_request: 400,
  invalid_proof: 401,
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

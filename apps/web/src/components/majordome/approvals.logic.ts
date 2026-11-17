import {
  MAJORDOME_APPROVAL_FAILURE_MESSAGES,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";

type SecretRequestItem = Extract<OrchestrationV2TurnItem, { readonly type: "secret_request" }>;

/** The card an assistant shows before it changes something that is hard to take back. */
export function isApprovalRequest(
  item: OrchestrationV2TurnItem,
): item is SecretRequestItem & { readonly delivery: "approval" } {
  return item.type === "secret_request" && item.delivery === "approval";
}

/** How an answered question reads in the conversation afterwards. */
export function approvalOutcomeLabel(
  status: Exclude<SecretRequestItem["secretStatus"], "pending">,
): string {
  switch (status) {
    case "saved":
      return "You allowed it";
    case "declined":
      return "You said no";
    case "cancelled":
      return "Closed without an answer";
  }
}

/** A failed answer, as the server words it. */
export function approvalFailureMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "reason" in error) {
    const { reason } = error;
    if (typeof reason === "string" && reason in MAJORDOME_APPROVAL_FAILURE_MESSAGES) {
      return MAJORDOME_APPROVAL_FAILURE_MESSAGES[
        reason as keyof typeof MAJORDOME_APPROVAL_FAILURE_MESSAGES
      ];
    }
  }
  return "Something went wrong. Try again.";
}

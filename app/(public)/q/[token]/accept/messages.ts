/**
 * Shared between the server actions and the client flow, so the flow can
 * recognise this exact refusal and route the customer back to the code step.
 * Lives outside actions.ts because a "use server" module may only export
 * async functions.
 */
export const VERIFY_FIRST_ERROR =
  "Your verification has expired. Ask for a new code and try again.";

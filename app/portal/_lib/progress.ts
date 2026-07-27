/**
 * Provisioning checklists are written for operators ("Record MSISDN and
 * external ref"). A customer waiting for their line wants the same
 * information in their own words, so map the known steps and fall back to the
 * operator label, which is plain enough, rather than inventing one.
 */

const CUSTOMER_STEPS: Array<[RegExp, string]> = [
  [/rica/i, "RICA check"],
  [/allocate sim|sim from stock/i, "SIM allocated"],
  [/msisdn/i, "Your number assigned"],
  [/data allocation/i, "Data allocation live"],
  [/router/i, "Router delivered"],
  [/feasibility|installation/i, "Feasibility and installation"],
  [/order line/i, "Line ordered with the network"],
  [/circuit/i, "Circuit assigned"],
  [/line active/i, "Line active and speed checked"],
  [/extensions/i, "Extensions set up"],
  [/port or assign/i, "Your number assigned"],
  [/test inbound/i, "Call test"],
  [/activate on/i, "Activated with the network"],
];

export function customerStepLabel(label: string): string {
  for (const [pattern, copy] of CUSTOMER_STEPS) {
    if (pattern.test(label)) return copy;
  }
  return label;
}

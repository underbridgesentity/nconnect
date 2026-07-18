export const PLAN_CATEGORIES = [
  { value: "lte_home", label: "Home Internet (LTE/5G)" },
  { value: "telkom_lte", label: "Telkom LTE" },
  { value: "fibre", label: "Fibre" },
  { value: "voip", label: "Business VoIP" },
  { value: "sim_data", label: "SIM Data" },
] as const;

export const HW_CATEGORIES = [
  { value: "router_lte", label: "LTE router" },
  { value: "router_5g", label: "5G router" },
  { value: "router_fibre", label: "Fibre router" },
  { value: "mesh", label: "Mesh" },
  { value: "extender", label: "Extender" },
  { value: "voip_phone", label: "VoIP phone" },
  { value: "power", label: "Power" },
  { value: "accessory", label: "Accessory" },
] as const;

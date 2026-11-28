import type { Wording } from "./index";

// Upstream's addresses for getting the app and reporting a problem lead to T3 Code. Each entry is
// the whole address as source spells it.
export const LINKS_WORDING: Wording = [
  ["https://t3.codes/download", "https://github.com/Wozacosta/majordome/releases/latest"],
  // Where a phone opens Majordome: it signs in and picks the computer.
  ["https://t3.codes/mobile", "https://majord.me/open"],
  ["https://t3.codes/privacy-policy", "https://majord.me/privacy"],
  [
    "https://github.com/pingdotgg/t3code/issues/new",
    "https://github.com/Wozacosta/majordome/issues/new",
  ],
  [
    "https://github.com/pingdotgg/t3code/blob/main/docs/user/faq.md#can-i-add-a-bunch-of-accounts-for-one-provider",
    "https://github.com/Wozacosta/majordome/blob/main/docs/user/faq.md#can-i-add-a-bunch-of-accounts-for-one-provider",
  ],
];

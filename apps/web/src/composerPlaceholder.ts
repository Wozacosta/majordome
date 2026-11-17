import { isMajordome } from "./env";

export const DEFAULT_COMPOSER_PLACEHOLDER = isMajordome
  ? "Ask anything, or tell me what to remember"
  : "Ask anything. @ files, $ skills, / commands";

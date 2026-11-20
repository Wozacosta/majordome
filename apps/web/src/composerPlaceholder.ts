import { msg } from "gt-react";

import { isMajordome } from "./env";

export const DEFAULT_COMPOSER_PLACEHOLDER = isMajordome
  ? msg("Ask anything, or tell me what to remember")
  : msg("Ask anything. @ files, $ skills, / commands");

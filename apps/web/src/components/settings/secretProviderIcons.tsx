import {
  FileLockIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  SquareTerminalIcon,
  VariableIcon,
} from "lucide-react";
import { createElement, type ComponentType } from "react";

import { OnePasswordIcon } from "../Icons";

const ICONS: Readonly<
  Record<string, ComponentType<{ readonly className?: string; readonly "aria-hidden"?: boolean }>>
> = {
  keychain: LockKeyholeIcon,
  encrypted_file: FileLockIcon,
  one_password: OnePasswordIcon,
  exec: SquareTerminalIcon,
  env: VariableIcon,
};

/** A kind this build does not know, or a source that is gone, gets the plain key. */
export function SecretProviderIcon(props: {
  readonly kind: string | undefined;
  readonly className?: string;
}) {
  return createElement((props.kind === undefined ? undefined : ICONS[props.kind]) ?? KeyRoundIcon, {
    className: props.className ?? "size-3.5 shrink-0",
    "aria-hidden": true,
  });
}

import { makeSecretProviderDefinitionRegistry } from "@t3tools/secret-provider-core/shared/definition";
import * as Bitwarden from "@t3tools/secret-provider-bitwarden/shared/definition";
import * as EncryptedFile from "@t3tools/secret-provider-encrypted-file/shared/definition";
import * as Env from "@t3tools/secret-provider-env/shared/definition";
import * as Exec from "@t3tools/secret-provider-exec/shared/definition";
import * as Keychain from "@t3tools/secret-provider-keychain/shared/definition";
import * as OnePassword from "@t3tools/secret-provider-onepassword/shared/definition";

/** In the order the Add provider dialog offers them. */
export const builtInSecretProviderDefinitions = makeSecretProviderDefinitionRegistry([
  Keychain.definition,
  EncryptedFile.definition,
  OnePassword.definition,
  Bitwarden.definition,
  Exec.definition,
  Env.definition,
]);

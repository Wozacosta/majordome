import { EnvironmentId } from "@t3tools/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

const updateSettings = vi.hoisted(() => vi.fn());

vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useUpdateEnvironmentSettings: (() => updateSettings) as never,
}));

import { SecretProviderDialog } from "./SecretProviderDialog";

describe("SecretProviderDialog", () => {
  it("offers every kind, warns about one the server cannot read, and saves the picked kind's fields", async () => {
    updateSettings.mockClear();
    const onClose = vi.fn();
    await using _screen = await render(
      <SecretProviderDialog
        onClose={onClose}
        environmentId={EnvironmentId.make("vps")}
        environmentLabel="My server"
        environmentOs="linux"
        existingIds={new Set()}
      />,
    );

    // A Linux server opens on the first kind it can read, not on the Keychain.
    const kind = page.getByRole("combobox", { name: "Where the secrets are" });
    await expect.element(kind).toHaveTextContent("Encrypted file");
    await userEvent.click(kind);
    for (const label of ["Mac Keychain", "Encrypted file", "1Password", "Command"]) {
      await expect.element(page.getByRole("option", { name: label })).toBeVisible();
    }
    await userEvent.click(page.getByRole("option", { name: "Mac Keychain" }));
    await expect.element(page.getByText(/cannot be read on My server/)).toBeVisible();

    await userEvent.click(kind);
    await userEvent.click(page.getByRole("option", { name: "Command" }));
    await userEvent.type(page.getByLabelText("Name"), "Infisical{Enter}");
    await expect.element(page.getByText("Enter the program to run.")).toBeVisible();
    expect(updateSettings).not.toHaveBeenCalled();

    await userEvent.type(page.getByLabelText("Arguments"), "secrets{Enter}get{Enter}--plain");
    await userEvent.type(page.getByLabelText("Program"), "/usr/local/bin/infisical{Enter}");

    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      secretProviders: {
        infisical: {
          kind: "exec",
          label: "Infisical",
          config: { command: "/usr/local/bin/infisical", args: ["secrets", "get", "--plain"] },
        },
      },
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

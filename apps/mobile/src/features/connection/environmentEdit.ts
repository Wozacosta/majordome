interface EnvironmentEdit {
  readonly label: string;
  readonly displayUrl: string;
}

/** Whether what was typed on an environment's row differs from what is saved and can be saved. */
export function canSaveEnvironmentEdit(saved: EnvironmentEdit, typed: EnvironmentEdit): boolean {
  const label = typed.label.trim();
  const displayUrl = typed.displayUrl.trim();
  if (label === "" || displayUrl === "") return false;
  return label !== saved.label.trim() || displayUrl !== saved.displayUrl.trim();
}

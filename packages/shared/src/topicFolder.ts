/** Where a new topic's folder goes: `<projects folder>/<title as a folder name>`. */
export function defaultTopicFolder(projectsFolder: string, title: string): string {
  const name = title
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 60);
  const base = projectsFolder.replace(/\/+$/, "");
  if (name === "") return base;
  return base === "" ? name : `${base}/${name}`;
}

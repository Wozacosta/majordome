import type { MenuAction } from "@react-native-menu/menu";
import { msg } from "gt-react-native";

export type AttachmentMenuActionId = "camera" | "photos" | "files";

const CAMERA = { id: "camera", title: msg("Take a photo"), image: "camera" } as const;
const PHOTOS = { id: "photos", title: msg("Photo Library"), image: "photo" } as const;
const FILES = { id: "files", title: msg("Choose Files"), image: "folder" } as const;

/** The "+" menu, top to bottom: the camera first, files only where the computer takes them. */
export function attachmentMenuActions(input: {
  readonly supportsFiles: boolean;
}): ReadonlyArray<MenuAction & { readonly id: AttachmentMenuActionId }> {
  return input.supportsFiles ? [CAMERA, PHOTOS, FILES] : [CAMERA, PHOTOS];
}

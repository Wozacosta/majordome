import { expect, it } from "vite-plus/test";

import { attachmentMenuActions } from "./ComposerAttachmentButton.logic";

it("lists the camera first, and files only where the computer takes them", () => {
  expect(attachmentMenuActions({ supportsFiles: true }).map((action) => action.id)).toEqual([
    "camera",
    "photos",
    "files",
  ]);
  expect(attachmentMenuActions({ supportsFiles: false }).map((action) => action.id)).toEqual([
    "camera",
    "photos",
  ]);
});

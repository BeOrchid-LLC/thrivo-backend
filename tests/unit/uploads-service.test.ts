import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../../src/lib/errors";
import type { User } from "../../src/repositories/user.repository";

const { createUpload, getByIdForUser, markVerified, markFailed } = vi.hoisted(() => ({
  createUpload: vi.fn(),
  getByIdForUser: vi.fn(),
  markVerified: vi.fn(),
  markFailed: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({
  uploadsRepo: { createUpload, getByIdForUser, markVerified, markFailed },
}));

const { generatePresignedUrl, verifyObject, deleteObject } = vi.hoisted(() => ({
  generatePresignedUrl: vi.fn(),
  verifyObject: vi.fn(),
  deleteObject: vi.fn(),
}));
vi.mock("../../src/services/r2.service", () => ({
  generatePresignedUrl,
  verifyObject,
  deleteObject,
  getContentTypeFromExtension: (ext: string) =>
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream",
  IMAGE_CONTENT_TYPES: new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]),
}));

import { confirmUpload, requestUpload } from "../../src/services/uploads.service";

const user = { id: "u1" } as unknown as User;

describe("uploads.service", () => {
  afterEach(() => vi.clearAllMocks());

  describe("requestUpload", () => {
    it("mints a presigned URL and records a pending row for an avatar", async () => {
      generatePresignedUrl.mockResolvedValue({
        filename: "abc.jpg",
        key: "test-files/user/u1/avatar/abc.jpg",
        url: "https://signed.example/put",
        publicUrl: "https://cdn.thrivo.fit/test-files/user/u1/avatar/abc.jpg",
      });
      createUpload.mockResolvedValue({
        id: "up1",
        publicUrl: "https://cdn.thrivo.fit/test-files/user/u1/avatar/abc.jpg",
      });

      const result = await requestUpload(user, { intent: "avatar", fileExtension: "jpg" });

      expect(generatePresignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "user", entityId: "u1", intent: "avatar" })
      );
      expect(createUpload).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", intent: "avatar", status: "pending" })
      );
      expect(result.uploadId).toBe("up1");
      expect(result.uploadUrl).toBe("https://signed.example/put");
      expect(result.contentType).toBe("image/jpeg");
      // Avatars are capped at 1 MB and the cap is reported to the client.
      expect(result.maxBytes).toBe(1024 * 1024);
    });

    it("rejects an intent that is not enabled yet (before touching storage)", async () => {
      await expect(
        requestUpload(user, { intent: "progress_photo", fileExtension: "jpg" })
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(generatePresignedUrl).not.toHaveBeenCalled();
    });
  });

  describe("confirmUpload", () => {
    it("throws NotFound for an upload that isn't the caller's", async () => {
      getByIdForUser.mockResolvedValue(null);
      await expect(confirmUpload(user, "missing")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("deletes the object and fails the row when the file exceeds the intent's cap", async () => {
      getByIdForUser.mockResolvedValue({
        id: "up1",
        userId: "u1",
        intent: "avatar",
        key: "test-files/user/u1/avatar/abc.jpg",
        publicUrl: "https://cdn.thrivo.fit/test-files/user/u1/avatar/abc.jpg",
        status: "pending",
        size: null,
      });
      // 2 MB is under the 5 MB default but over the avatar-specific 1 MB cap.
      verifyObject.mockResolvedValue({ size: 2 * 1024 * 1024, contentType: "image/jpeg" });
      deleteObject.mockResolvedValue(undefined);
      markFailed.mockResolvedValue({ id: "up1" });

      await expect(confirmUpload(user, "up1")).rejects.toBeInstanceOf(ValidationError);
      expect(deleteObject).toHaveBeenCalledWith("test-files/user/u1/avatar/abc.jpg");
      expect(markFailed).toHaveBeenCalled();
      expect(markVerified).not.toHaveBeenCalled();
    });

    it("marks the row verified when the object exists and is within the size limit", async () => {
      getByIdForUser.mockResolvedValue({
        id: "up1",
        userId: "u1",
        intent: "avatar",
        key: "test-files/user/u1/avatar/abc.jpg",
        publicUrl: "https://cdn.thrivo.fit/test-files/user/u1/avatar/abc.jpg",
        status: "pending",
        size: null,
      });
      verifyObject.mockResolvedValue({ size: 120_000, contentType: "image/jpeg" });
      markVerified.mockResolvedValue({
        id: "up1",
        publicUrl: "https://cdn.thrivo.fit/test-files/user/u1/avatar/abc.jpg",
        size: 120_000,
      });

      const result = await confirmUpload(user, "up1");

      expect(result.status).toBe("verified");
      expect(result.size).toBe(120_000);
      expect(deleteObject).not.toHaveBeenCalled();
    });
  });
});

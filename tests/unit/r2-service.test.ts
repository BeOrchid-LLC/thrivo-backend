import { describe, expect, it, vi } from "vitest";

// Provide a fully-configured R2 env so the service's lazy client builds. Includes
// LOG_LEVEL/NODE_ENV because the logger (imported transitively) reads them too.
vi.mock("../../src/env", () => ({
  env: {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    R2_ACCOUNT_ID: "acct123",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET_NAME: "thrivo-media",
    R2_FOLDER_PREFIX: "test-files",
    R2_CDN_URL: "https://cdn.thrivo.fit",
    R2_PUBLIC_URL: "https://thrivo-media.r2.dev",
  },
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://signed.example/put?sig=abc"),
}));

import {
  extractKeyFromUrl,
  generatePresignedUrl,
  getContentTypeFromExtension,
  IMAGE_CONTENT_TYPES,
  isR2Configured,
} from "../../src/services/r2.service";

describe("r2.service", () => {
  it("reports configured when all four core credentials are present", () => {
    expect(isR2Configured()).toBe(true);
  });

  it("builds a namespaced key and prefers the CDN URL for the public URL", async () => {
    const result = await generatePresignedUrl({
      entityType: "user",
      entityId: "u1",
      intent: "avatar",
      fileExtension: "jpg",
      contentType: "image/jpeg",
    });

    expect(result.key).toMatch(/^test-files\/user\/u1\/avatar\/[^/]+\.jpg$/);
    expect(result.url).toBe("https://signed.example/put?sig=abc");
    expect(result.publicUrl).toBe(`https://cdn.thrivo.fit/${result.key}`);
  });

  it("round-trips a stored public URL back to its key, and ignores foreign URLs", async () => {
    const { key, publicUrl } = await generatePresignedUrl({
      entityType: "user",
      entityId: "u1",
      intent: "avatar",
      fileExtension: "png",
    });

    expect(extractKeyFromUrl(publicUrl)).toBe(key);
    // External OAuth avatar URLs are not ours — caller must not try to delete them.
    expect(extractKeyFromUrl("https://lh3.googleusercontent.com/a/photo")).toBeNull();
  });

  it("maps image extensions to content-types in the image allowlist", () => {
    expect(getContentTypeFromExtension("jpg")).toBe("image/jpeg");
    expect(getContentTypeFromExtension(".PNG")).toBe("image/png");
    expect(getContentTypeFromExtension("xyz")).toBe("application/octet-stream");
    expect(IMAGE_CONTENT_TYPES.has("image/jpeg")).toBe(true);
    expect(IMAGE_CONTENT_TYPES.has("application/pdf")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { normalizeAssetSearch } from "../src/lib/search";

describe("asset search normalization", () => {
  it("ignores spaces, case and full-width ASCII", () => {
    expect(normalizeAssetSearch("万  科Ａ")).toBe("万科a");
    expect(normalizeAssetSearch(" 600519.SH ")).toBe("600519.sh");
  });
});

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(resolve(root, "public/manifest.webmanifest"), "utf8"),
) as {
  name: string;
  short_name: string;
  display: string;
  start_url: string;
  scope: string;
  theme_color: string;
  icons: { src: string; sizes: string; purpose: string }[];
};

describe("PWA manifest", () => {
  it("opens from the home screen as its own app, not inside the browser", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.short_name).toBe("Rota Moto");
    expect(manifest.name).toContain("Rota Moto");
  });

  it("ships the icon sizes phones install from, and the files exist", () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    const purposes = manifest.icons.map((icon) => icon.purpose);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(purposes).toContain("maskable");

    for (const icon of manifest.icons) {
      expect(existsSync(resolve(root, "public", icon.src.replace(/^\//, "")))).toBe(true);
    }
  });
});

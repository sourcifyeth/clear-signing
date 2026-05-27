import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  platform: "neutral",
  esbuildOptions(options) {
    options.supported = {
      ...options.supported,
      "import-attributes": true,
    };
  },
});

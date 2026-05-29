import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Source maps on in build too, so Vibecheck's allocation attribution (Task #5) can
// map hotspots back to component files. The "no source maps" verification case flips
// `build.sourcemap` to false.
export default defineConfig({
  plugins: [react()],
  build: { sourcemap: true },
});

import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    lib: {
      // Entry point that just imports the fonts
      entry: path.resolve(__dirname, "esign/public/js/fonts.js"),
      name: "ESignFonts",
      fileName: "esign-fonts",
      formats: ["es"],
    },
    outDir: "esign/public/dist",
    emptyOutDir: false,
    minify: true,
    target: "es2022",
    rollupOptions: {
      output: {
        // Ensure CSS is extracted to a separate file
        assetFileNames: "esign-fonts.[ext]",
      },
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV || "production",
    ),
  },
});

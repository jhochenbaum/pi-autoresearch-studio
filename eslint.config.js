import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow explicit any at boundaries (pi extension callbacks, etc.)
      "@typescript-eslint/no-explicit-any": "warn",
      // Unused vars: allow underscore-prefixed
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Allow empty catch blocks (common in git fallback patterns)
      "no-empty": ["error", { allowEmptyCatch: true }],
      // No floating promises
      // Requires typed linting (parserOptions.project) — enable when typed linting is configured
      "@typescript-eslint/no-floating-promises": "off",
      // Allow require() in specific cases
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    ignores: ["node_modules/", "backup-v1/", "src/html/dashboard.js", "src/html/styles.css"],
  }
);

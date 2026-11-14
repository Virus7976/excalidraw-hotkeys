import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";

export default tseslint.config(
	{ ignores: ["main.js", "node_modules/**", "esbuild.config.mjs", "eslint.config.mjs", "docs/**"] },
	...obsidianmd.configs.recommended,
	comments.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: { parser: tseslint.parser, parserOptions: { project: "./tsconfig.json" } },
		rules: {
			"@eslint-community/eslint-comments/require-description": "error",
			"@eslint-community/eslint-comments/no-restricted-disable": ["error", "@typescript-eslint/no-explicit-any"],
		},
	},
);

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// pnpm monorepo: Metro must watch the workspace root so it can follow the
// symlink pnpm creates for @momentum/shared into packages/shared, and it
// must be told where the hoisted/root node_modules live since pnpm keeps
// most packages under <root>/node_modules/.pnpm rather than nested inside
// apps/mobile/node_modules.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// pnpm's strict, symlinked node_modules relies on Node's package-exports
// resolution; Metro's own exports support (stable since SDK 52) needs to be
// on for that to work consistently across workspace packages.
config.resolver.unstable_enablePackageExports = true;
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

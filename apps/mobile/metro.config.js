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

// @momentum/shared uses NodeNext-style relative imports ("./types.js" for a
// types.ts file). Metro's resolver takes that literally, so remap a missing
// ".js" specifier to its ".ts"/".tsx" source before giving up.
const { resolveRequest: defaultResolveRequest } = config.resolver;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    try {
      return (defaultResolveRequest ?? context.resolveRequest)(
        context,
        moduleName.slice(0, -3) + ".ts",
        platform
      );
    } catch {
      try {
        return (defaultResolveRequest ?? context.resolveRequest)(
          context,
          moduleName.slice(0, -3) + ".tsx",
          platform
        );
      } catch {
        // fall through to default resolution of the original specifier
      }
    }
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;

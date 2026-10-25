const { getDefaultConfig } = require("expo/metro-config");
// Expo configures workspace discovery and native module resolution together.
const config = getDefaultConfig(__dirname);

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

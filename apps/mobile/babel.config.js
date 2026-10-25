module.exports = function (api) {
  api.cache(true);
  return {
    // Resolve Expo's own preset under pnpm's isolated dependency layout.
    presets: [
      require.resolve("babel-preset-expo", {
        paths: [require.resolve("expo/package.json")],
      }),
    ],
  };
};

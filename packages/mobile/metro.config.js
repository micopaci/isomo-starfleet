const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const mobileRoot = __dirname;
const monorepoRoot = path.resolve(mobileRoot, '../..');

const config = {
  watchFolders: [
    monorepoRoot,
    path.resolve(mobileRoot, '../shared'),
  ],
  resolver: {
    // Explicitly force React and React-Native to the mobile node_modules
    extraNodeModules: new Proxy({}, {
      get: (target, name) => {
        if (name === 'react' || name === 'react-native') {
          return path.resolve(mobileRoot, 'node_modules', name);
        }
        return path.resolve(mobileRoot, 'node_modules', name);
      },
    }),
    nodeModulesPaths: [
      path.resolve(mobileRoot, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(mobileRoot), config);
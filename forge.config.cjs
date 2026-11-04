module.exports = {
  packagerConfig: {
    name: 'Claude Account Reset', executableName: 'Claude Account Reset', appBundleId: 'org.forcemind.claude-account-reset',
    appCategoryType: 'public.app-category.utilities', asar: true,
    ignore: file => file !== '' && !/^\/(desktop(?:\/(?:dist|main\.mjs|worker\.mjs|service\.mjs|demo\.mjs|preload\.cjs)(?:\/|$))?|lib(?:\/|$)|node_modules(?:\/|$)|package\.json$|LICENSE$)/.test(file)
  },
  rebuildConfig: {},
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin'] }],
  plugins: [{ name: '@electron-forge/plugin-auto-unpack-natives', config: {} }]
};

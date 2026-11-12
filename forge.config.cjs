const { version } = require('./package.json');

module.exports = {
  packagerConfig: {
    name: 'Claude Account Reset', executableName: 'Claude Account Reset', appBundleId: 'org.forcemind.claude-account-reset',
    appCategoryType: 'public.app-category.utilities', asar: true,
    ignore: file => file !== '' && !/^\/(desktop(?:\/(?:dist|main\.mjs|worker\.mjs|service\.mjs|demo\.mjs|preload\.cjs|library\.mjs|readonly\.mjs|environment\.mjs)(?:\/|$))?|lib(?:\/|$)|node_modules(?:\/|$)|package\.json$|LICENSE$)/.test(file)
  },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'win32'] },
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: {
      name: 'ClaudeAccountReset', authors: 'ForceMind', description: 'Local Claude account and session maintenance',
      setupExe: `Claude-Account-Reset-${version}-win-x64.exe`
    } }
  ],
  plugins: [{ name: '@electron-forge/plugin-auto-unpack-natives', config: {} }]
};

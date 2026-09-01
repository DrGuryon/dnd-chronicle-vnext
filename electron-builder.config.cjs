const repository = process.env.GITHUB_REPOSITORY;
const [owner, repo] = repository ? repository.split('/') : [];
const publish = owner && repo
  ? [{ provider: 'github', owner, repo, releaseType: 'release' }]
  : undefined;
const isSignedBuild = Boolean(process.env.CSC_LINK || process.env.WIN_CSC_LINK);
const electronCache = process.env.ELECTRON_CACHE || process.env.electron_config_cache;

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'cz.dndchronicle.vnext',
  productName: 'D&D Chronicle vNext',
  artifactName: 'D&D-Chronicle-vNext-Setup-${version}.${ext}',
  directories: {
    output: 'release',
    buildResources: 'build-resources',
  },
  files: [
    'dist/**/*',
    'package.json',
  ],
  extraResources: [
    { from: 'rules-packs', to: 'rules-packs', filter: ['**/*.json'] },
  ],
  asar: true,
  electronDownload: electronCache ? { cache: electronCache } : undefined,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    verifyUpdateCodeSignature: isSignedBuild,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'D&D Chronicle vNext',
    deleteAppDataOnUninstall: false,
  },
  publish,
};

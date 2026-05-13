"use strict";

const { resolve, join, sep, dirname } = require("node:path");
const { cp, rm, mkdir, lstat, readlink } = require("node:fs/promises");
const asar = require("@electron/asar");

const PNPM_HOIST_SEGMENT = `${sep}.pnpm${sep}node_modules`;

async function symlinkEscapes(src, root) {
    let st;
    try {
        st = await lstat(src);
    } catch {
        return false;
    }
    if (!st.isSymbolicLink()) return false;
    const target = await readlink(src);
    const absolute = resolve(dirname(src), target);
    return absolute !== root && !absolute.startsWith(root + sep);
}

function makeFilter(root) {
    const resolvedRoot = resolve(root);
    return async (src) => {
        if (src.includes(`${PNPM_HOIST_SEGMENT}${sep}`) || src.endsWith(PNPM_HOIST_SEGMENT)) {
            return false;
        }
        if (await symlinkEscapes(src, resolvedRoot)) {
            console.warn(`[afterPack] skip symlink outside root: ${src}`);
            return false;
        }
        return true;
    };
}

const UNPACK_GLOB =
    "{LICENSE.md,bundledPlugins/**,assets/*.exe,assets/css/**,duckdb-extensions/**," +
    "**/*.node," +
    "node_modules/**/7z-bin/**," +
    "node_modules/**/bootstrap-sass/assets/stylesheets/**," +
    "node_modules/**/json-socket/**," +
    "node_modules/**/react-select/scss/**," +
    "node_modules/**/@nexusmods/fomod-installer-native/dist/*.dll," +
    "node_modules/**/@nexusmods/fomod-installer-ipc/dist/*.exe}";

module.exports = async ({ appOutDir }) => {
    const distDir = __dirname;
    const buildDir = resolve(distDir, "build");
    const deployNodeModules = resolve(distDir, "node_modules");
    const resourcesDir = join(appOutDir, "resources");
    const asarPath = join(resourcesDir, "app.asar");
    const unpackedDir = join(resourcesDir, "app.asar.unpacked");
    const tmpDir = join(resourcesDir, "app.asar.tmp");

    const start = Date.now();
    console.log(`[afterPack] composing ${tmpDir}`);

    await Promise.all([
        rm(tmpDir, { recursive: true, force: true }),
        rm(asarPath, { force: true }),
        rm(unpackedDir, { recursive: true, force: true }),
    ]);
    await mkdir(tmpDir, { recursive: true });

    await Promise.all([
        cp(buildDir, tmpDir, {
            recursive: true,
            verbatimSymlinks: true,
            filter: makeFilter(buildDir),
        }),
        cp(deployNodeModules, join(tmpDir, "node_modules"), {
            recursive: true,
            verbatimSymlinks: true,
            filter: makeFilter(deployNodeModules),
        }),
    ]);

    console.log(`[afterPack] composed in ${Date.now() - start}ms, packing asar`);
    const packStart = Date.now();

    await asar.createPackageWithOptions(tmpDir, asarPath, { unpack: UNPACK_GLOB });

    await rm(tmpDir, { recursive: true });

    console.log(`[afterPack] packed in ${Date.now() - packStart}ms`);
};

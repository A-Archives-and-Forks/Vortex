import {showDialog} from '../../../actions/notifications';
import {IExtensionApi} from '../../../types/IExtensionContext';
import { IGame } from '../../../types/IGame';
import {IState} from '../../../types/IState';
import {ProcessCanceled, UserCanceled} from '../../../util/CustomErrors';
import * as fs from '../../../util/fs';
import { writeFileAtomic } from '../../../util/fsAtomic';
import { log } from '../../../util/log';
import { activeGameId, currentGameDiscovery, installPathForGame } from '../../../util/selectors';
import { getSafe } from '../../../util/storeHelper';
import { deBOM, makeQueue, truthy } from '../../../util/util';

import { getGame } from '../../gamemode_management/util/getGame';

import {IDeploymentManifest, ManifestFormat} from '../types/IDeploymentManifest';
import {IDeployedFile, IDeploymentMethod} from '../types/IDeploymentMethod';

import { getActivator, getCurrentActivator } from './deploymentMethods';
import format_1 from './manifest_formats/format_1';

import * as msgpack from '@msgpack/msgpack';
import Promise from 'bluebird';
import I18next from 'i18next';
import * as path from 'path';
import { sync as writeAtomicSync } from 'write-file-atomic';

const CURRENT_VERSION = 1;

const formats: { [version: number]: ManifestFormat } = {
  1: format_1,
};

function emptyManifest(instance: string): IDeploymentManifest {
  return {
    version: CURRENT_VERSION,
    instance,
    files: [],
  };
}

/**
 * since the manifest is read from disc, it could have been modified by the user.
 * Check it for correctness
 */
function repairManifest(input: IDeploymentManifest): IDeploymentManifest {
  if (!truthy(input.version)) {
    input.version = CURRENT_VERSION;
  }

  if (!truthy(input.instance)) {
    input.instance = '';
  }

  input.files = input.files.reduce((prev: IDeployedFile[], file: IDeployedFile) => {
    if ((file !== null)
      && (file.relPath !== undefined) && (file.relPath !== null)
      && (file.source !== undefined) && (file.source !== null)
      && (file.time !== undefined) && (file.time !== null)) {
        prev.push(file);
    }
    return prev;
  }, [] as IDeployedFile[]);

  return input;
}

function readManifest(data: string | Buffer): IDeploymentManifest {
  if (data === '') {
    return undefined;
  }

  let parsed = typeof data === 'string'
    ? JSON.parse(deBOM(data))
    : msgpack.decode(data);

  let lastVersion = 0;
  while (lastVersion < CURRENT_VERSION) {
    parsed = formats[parsed.version || 1](parsed);
    if ((parsed.version === lastVersion) && (parsed.version < CURRENT_VERSION)) {
      // this should not happen!
      throw new Error(`unsupported format upgrade ${parsed.version} -> ${CURRENT_VERSION}`);
    }
    lastVersion = parsed.version;
  }
  if (parsed.files === undefined) {
    parsed.files = [];
  }
  return repairManifest(parsed);
}

function doFallbackPurge(basePath: string,
                         files: IDeployedFile[]): Promise<void> {
  return Promise.map(files, file => {
    const fullPath = path.join(basePath, file.relPath);
    return fs.statAsync(fullPath).then(
      stats => {
        // the timestamp from stat has ms precision but the one from the manifest doesn't
        return ((stats.mtime.getTime() - file.time) < 1000)
          ? fs.unlinkAsync(fullPath)
          : Promise.resolve();
      })
    .catch(err => {
      if (err.code !== 'ENOENT') {
        return Promise.reject(err);
      } // otherwise ignore
    });
  })
  .then(() => undefined);
}

function queryPurgeTextSafe(t: I18next.TFunction) {
  return t('IMPORTANT: This game was modded by another instance of Vortex.\n\n' +
      'If you switch between different instances (or between shared and ' +
      'single-user mode) it\'s better if you purge mods before switching.\n\n' +
      'Vortex can try to clean up now but this is less reliable (*) than doing it ' +
      'from the instance that deployed the files in the first place.\n\n' +
      'If you modified any files in the game directory you should back them up ' +
      'before continuing.\n\n' +
      '(*) This purge relies on a manifest of deployed files, created by that other ' +
      'instance. Files that have been changed since that manifest was created ' +
      'won\'t be removed to prevent data loss. If the manifest is damaged or ' +
      'outdated the purge may be incomplete. When purging from the "right" instance ' +
      'the manifest isn\'t required, it can reliably deduce which files need to ' +
      'be removed.');
}

function queryPurgeTextUnsafe(t: I18next.TFunction) {
  return t('IMPORTANT: This game was modded by another instance of Vortex.\n\n' +
      'Vortex can only proceed by purging the mods from that other instance.\n\n' +
      'This will irreversably **destroy** the mod installations from that other ' +
      'instance!\n\n' +
      'You should instead cancel now, open that other vortex instance and purge ' +
      'from there. This can also be caused by switching between shared and ' +
      'single-user mode.');
}

function queryPurge(api: IExtensionApi,
                    basePath: string,
                    files: IDeployedFile[],
                    safe: boolean): Promise<void> {
  const t = api.translate;
  const text = safe ? queryPurgeTextSafe(t) : queryPurgeTextUnsafe(t);
  return api.store.dispatch(showDialog('info', t('Purge files from different instance?'), {
    text,
  }, [ { label: 'Cancel' }, { label: 'Purge' } ]))
    .then(result => {
      if (result.action === 'Purge') {
        return doFallbackPurge(basePath, files)
          .catch(err => {
            api.showErrorNotification('Purging failed', err, {
              allowReport: false,
            });
            return Promise.reject(new UserCanceled());
          });
      } else {
        return Promise.reject(new UserCanceled());
      }
    });
}

function readManifestFile(filePath: string): Promise<any> {
  return fs.readFileAsync(filePath, 'utf8')
    .then(data => readManifest(data));
}

function readManifestFileBinary(filePath: string): Promise<any> {
  return fs.readFileAsync(filePath)
    .then(data => readManifest(data));
}

function getManifestImpl(api: IExtensionApi,
                         instanceId: string,
                         filePath: string,
                         backupPath: string,
                         backup2Path: string)
                         : Promise<IDeploymentManifest> {
  return readManifestFile(filePath)
    .catch(err => {
      if (err instanceof UserCanceled) {
        return Promise.reject(err);
      }
      if (err.code === 'ENOENT') {
        return emptyManifest(instanceId);
      }

      if (err.message.startsWith('Unexpected token')
          || err.message.startsWith('Unexpected end of JSON input')) {
        err.message = `The manifest file "${filePath}" is corrupted.\n`
                    + 'You should delete it, then immediately click the "Purge" button '
                    + 'on the "Mods" page, then deploy again.';
      }

      return readManifestFileBinary(backup2Path)
        .catch({ code: 'ENOENT' }, () => readManifestFile(backupPath))
        .then(data =>
          api.showDialog('question', 'Manifest damaged', {
            text: 'The deployment manifest has been corrupted.\n'
                + 'Fortunately we have a backup that seems to be intact.',
            parameters: {
              filePath,
            },
          }, [
            { label: 'Cancel' },
            { label: 'Restore from backup' },
          ])
          .then(result => {
            if (result.action === 'Cancel') {
              err.allowReport = false;
              return Promise.reject(err);
            } else {
              return Promise.resolve(data);
            }
          }))
        .catch(backupErr => {
          err.message += '\nBackup couldn\'t be read: ' + backupErr.message;
          return Promise.reject(err);
        });
    })
    .then(manifest => (manifest !== undefined)
      ? manifest
      : emptyManifest(instanceId));
}

function fallbackPurgeType(api: IExtensionApi, activator: IDeploymentMethod,
                           modType: string, deployPath: string,
                           stagingPath: string): Promise<void> {
  const state: IState = api.store.getState();
  const typeTag = (modType !== undefined) && (modType.length > 0) ? modType + '.' : '';
  const tagFileName = `vortex.deployment.${typeTag}json`;
  const tagFilePath = path.join(deployPath, tagFileName);
  const tagBackupPath = path.join(stagingPath, tagFileName);
  const tagBackup2Path = path.join(stagingPath, `vortex.deployment.backup.${typeTag}msgpack`);
  const instanceId = state.app.instanceId;

  return getManifestImpl(api, instanceId, tagFilePath, tagBackupPath, tagBackup2Path)
      .then(tagObject => {
        let result: Promise<void>;
        if (tagObject.files.length > 0) {
          let safe = true;
          if (tagObject.deploymentMethod !== undefined) {
            const previousActivator = getActivator(tagObject.deploymentMethod);
            if ((previousActivator !== undefined) && !previousActivator.isFallbackPurgeSafe) {
              safe = false;
            }
          }
          result = doFallbackPurge(deployPath, tagObject.files)
              .then(() => saveActivation(modType, state.app.instanceId,
                                         deployPath, stagingPath,
                                         [], activator !== undefined ? activator.id : undefined))
              .then(() => Promise.resolve());
        } else {
          result = Promise.resolve();
        }
        return result;
      })
      .catch(err => Promise.reject(err));
}

/**
 * purge files using information from the manifest
 */
export function fallbackPurge(api: IExtensionApi): Promise<void> {
  const state: IState = api.store.getState();
  const gameId = activeGameId(state);
  const gameDiscovery = currentGameDiscovery(state);
  const game: IGame = getGame(gameId);
  if ((game === undefined)
      || (gameDiscovery === undefined)
      || (gameDiscovery.path === undefined)) {
    return Promise.reject(new ProcessCanceled('game got disabled'));
  }
  const modPaths = game.getModPaths(gameDiscovery.path);
  const stagingPath = installPathForGame(state, gameId);
  const activator = getCurrentActivator(state, gameId, false);

  return Promise.each(Object.keys(modPaths), typeId =>
    fallbackPurgeType(api, activator, typeId, modPaths[typeId], stagingPath))
    .then(() => undefined);
}

const activationQueue = makeQueue();

export function withActivationLock(func: () => Promise<any>, tryOnly: boolean = false) {
  return activationQueue(func, tryOnly);
}

/**
 * return a manifest (detailing which files are currently deployed by Vortex)
 * Please note that the manifest is intended only as kind of a fallback, core functionality
 * of Vortex is designed to work cleanly even if the manifest is deleted by the user and
 * the same should be true for any extension using this function: Work on the assumption
 * that the manifest may be missing or outdated.
 * @param api api
 * @param modType the mod type for which to retrieve the manifest, default mod type if undefined
 * @param gameId the game for which to retrieve the manifest, defaults to the current game.
 */
export function getManifest(api: IExtensionApi,
                            modType?: string,
                            gameId?: string)
                            : Promise<IDeploymentManifest> {
  const state: IState = api.store.getState();
  const instanceId = state.app.instanceId;

  if (gameId === undefined) {
    gameId = activeGameId(state);
  }

  if (modType === undefined) {
    modType = '';
  }

  const game = getGame(gameId);
  const discovery = getSafe(state, ['settings', 'gameMode', 'discovered', gameId], undefined);
  if (discovery === undefined) {
    return Promise.resolve(undefined);
  }

  const stagingPath: string = installPathForGame(state, gameId);
  const deployPath: string = game.getModPaths(discovery.path)[modType];
  if ((stagingPath === undefined) || (deployPath === undefined)) {
    return Promise.resolve(undefined);
  }

  const typeTag = (modType !== undefined) && (modType.length > 0) ? modType + '.' : '';
  const tagFileName = `vortex.deployment.${typeTag}json`;
  const tagFilePath = path.join(deployPath, tagFileName);
  const tagBackupPath = path.join(stagingPath, tagFileName);
  const tagBackup2Path = path.join(stagingPath, `vortex.deployment.${typeTag}msgpack`);

  return getManifestImpl(api, instanceId, tagFilePath, tagBackupPath, tagBackup2Path);
}

export function loadActivation(api: IExtensionApi, modType: string,
                               deployPath: string, stagingPath: string,
                               activator: IDeploymentMethod): Promise<IDeployedFile[]> {
  if (deployPath === undefined) {
    return Promise.resolve([]);
  }
  const typeTag = (modType !== undefined) && (modType.length > 0) ? modType + '.' : '';
  const tagFileName = `vortex.deployment.${typeTag}json`;
  const tagFilePath = path.join(deployPath, tagFileName);
  const tagBackupPath = path.join(stagingPath, tagFileName);
  const tagBackup2Path = path.join(stagingPath, `vortex.deployment.${typeTag}msgpack`);
  const state: IState = api.store.getState();
  const instanceId = state.app.instanceId;
  return getManifestImpl(api, instanceId, tagFilePath, tagBackupPath, tagBackup2Path)
      .then(tagObject => {
        let result: Promise<IDeployedFile[]>;
        if ((tagObject.instance !== instanceId) && (tagObject.files.length > 0)) {
          let safe = true;
          if (tagObject.deploymentMethod !== undefined) {
            const previousActivator = getActivator(tagObject.deploymentMethod);
            if ((previousActivator !== undefined) && !previousActivator.isFallbackPurgeSafe) {
              safe = false;
            }
          }
          result = queryPurge(api, deployPath, tagObject.files, safe)
              .then(() => saveActivation(modType, state.app.instanceId, deployPath,
                                         stagingPath, [], activator.id))
              .then(() => Promise.resolve([]));
        } else {
          result = Promise.resolve(tagObject.files);
        }
        return result;
      });
}

export function saveActivation(modType: string, instance: string,
                               gamePath: string, stagingPath: string,
                               activation: IDeployedFile[], activatorId?: string) {
  const typeTag = (modType !== undefined) && (modType.length > 0) ? modType + '.' : '';
  const dataRaw = {
    instance,
    version: CURRENT_VERSION,
    deploymentMethod: activatorId,
    files: activation,
  };
  const dataJSON = JSON.stringify(dataRaw, undefined, 2);
  try {
    JSON.parse(dataJSON);
  } catch (err) {
    return Promise.reject(
      new Error(`failed to serialize deployment information: "${err.message}"`));
  }
  const tagFileName = `vortex.deployment.${typeTag}json`;
  const tagFilePath = path.join(gamePath, tagFileName);
  const tagBackupPath = path.join(stagingPath, `vortex.deployment.${typeTag}msgpack`);

  if (activation.length > 0) {
    // write backup synchronously
    try {
      writeAtomicSync(tagBackupPath, Buffer.from(msgpack.encode(dataRaw)));
    } catch (err) {
      log('error', 'Failed to write manifest backup', err.message);
    }
  }

  return (activation.length === 0)
    ? fs.removeAsync(tagFilePath).catch(() => undefined)
    : writeFileAtomic(tagFilePath, dataJSON)
        // remove backup from previous Vortex versions
        .then(() => fs.removeAsync(path.join(stagingPath, tagFileName))
          .catch({ code: 'ENOENT' }, () => null));
}

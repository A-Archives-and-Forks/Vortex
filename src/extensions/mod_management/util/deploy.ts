import { IDeployedFile, IDeploymentMethod, IExtensionApi } from '../../../types/IExtensionContext';
import { IGame } from '../../../types/IGame';
import { INotification } from '../../../types/INotification';
import { ProcessCanceled } from '../../../util/CustomErrors';
import { log } from '../../../util/log';
import { activeGameId, activeProfile, currentGameDiscovery } from '../../../util/selectors';
import { getSafe } from '../../../util/storeHelper';
import { truthy } from '../../../util/util';
import { getGame } from '../../gamemode_management/util/getGame';
import { installPath, installPathForGame } from '../selectors';
import { IMod } from '../types/IMod';
import { loadActivation, saveActivation, withActivationLock } from './activationStore';
import { getCurrentActivator } from './deploymentMethods';
import { NoDeployment } from './exceptions';
import { dealWithExternalChanges } from './externalChanges';

import * as Promise from 'bluebird';

export function genSubDirFunc(game: IGame): (mod: IMod) => string {
  if (typeof(game.mergeMods) === 'boolean') {
    return game.mergeMods
      ? () => ''
      : (mod: IMod) => mod.id;
  } else {
    return game.mergeMods;
  }
}

function filterManifest(activator: IDeploymentMethod,
                        deployPath: string,
                        stagingPath: string,
                        deployment: IDeployedFile[]): Promise<IDeployedFile[]> {
  return Promise.filter(deployment, file =>
    activator.isDeployed(stagingPath, deployPath, file));
}

export function purgeMods(api: IExtensionApi): Promise<void> {
  const state = api.store.getState();
  const stagingPath = installPath(state);
  const profile = activeProfile(state);
  const gameId = profile.gameId;
  const gameDiscovery = currentGameDiscovery(state);
  const t = api.translate;
  const activator = getCurrentActivator(state, gameId, false);

  if (activator === undefined) {
    return Promise.reject(new NoDeployment());
  }

  if (Object.keys(getSafe(state, ['session', 'base', 'toolsRunning'], {})).length > 0) {
    api.sendNotification({
      type: 'info',
      id: 'purge-not-possible',
      message: 'Can\'t purge while the game or a tool is running',
      displayMS: 5000,
    });
    return Promise.resolve();
  }

  const notification: INotification = {
    type: 'activity',
    message: t('Waiting for other operations to complete'),
    title: t('Purging'),
  };

  notification.id = api.sendNotification(notification);

  const game: IGame = getGame(gameId);
  const modPaths = game.getModPaths(gameDiscovery.path);

  const modTypes = Object.keys(modPaths).filter(typeId => truthy(modPaths[typeId]));

  return withActivationLock(() => {
    log('debug', 'purging mods', { activatorId: activator.id, stagingPath });
    notification.message = t('Purging mods');
    api.sendNotification(notification);

    let lastDeployment: { [typeId: string]: IDeployedFile[] };

    // TODO: we really should be using the deployment specified in the manifest,
    //   not the current one! This only works because we force a purge when switching
    //   deployment method.
    return activator.prePurge(stagingPath)
      // load previous deployments
      .then(() => Promise.reduce(modTypes, (prev, typeId) =>
        loadActivation(api, typeId, modPaths[typeId], stagingPath, activator)
          .then(deployment => {
            prev[typeId] = deployment;
            return prev;
          }), {})
        .then(deployments => { lastDeployment = deployments; }))
      // deal with all external changes
      .then(() => dealWithExternalChanges(api, activator, profile.id, stagingPath,
                                          modPaths, lastDeployment))
      // purge all mod types
      .then(() => Promise.mapSeries(modTypes, typeId =>
          activator.purge(stagingPath, modPaths[typeId])))
      // save (empty) activation
      .then(() => Promise.map(modTypes, typeId =>
          saveActivation(typeId, state.app.instanceId, modPaths[typeId], stagingPath,
                         [], activator.id)))
      // the deployment may be changed so on an exception we still need to update it
      .tapCatch(() => {
        if (lastDeployment === undefined) {
          // exception happened before the deployment is even loaded so there is nothing
          // to clean up
          return;
        }
        return Promise.map(modTypes, typeId =>
          filterManifest(activator, modPaths[typeId], stagingPath, lastDeployment[typeId])
            .then(files =>
              saveActivation(typeId, state.app.instanceId, modPaths[typeId], stagingPath,
                files, activator.id)));
      })
      .catch(ProcessCanceled, () => null)
      .then(() => Promise.resolve())
      .finally(() => activator.postPurge());
  }, true)
    .then(() => null)
    .finally(() => {
      api.dismissNotification(notification.id);
    });
}

export function purgeModsInPath(api: IExtensionApi, gameId: string, typeId: string,
                                modPath: string): Promise<void> {
  const state = api.store.getState();
  if (gameId === undefined) {
    gameId = activeGameId(state);
  }
  const stagingPath = installPathForGame(state, gameId);

  const t = api.translate;
  const activator = getCurrentActivator(state, gameId, false);

  if (activator === undefined) {
    return Promise.reject(new NoDeployment());
  }

  if (Object.keys(getSafe(state, ['session', 'base', 'toolsRunning'], {})).length > 0) {
    api.sendNotification({
      type: 'info',
      id: 'purge-not-possible',
      message: 'Can\'t purge while the game or a tool is running',
      displayMS: 5000,
    });
    return Promise.resolve();
  }

  const notification: INotification = {
    type: 'activity',
    message: t('Waiting for other operations to complete'),
    title: t('Purging'),
  };

  notification.id = api.sendNotification(notification);

  return withActivationLock(() => {
    log('debug', 'purging mods', { activatorId: activator.id, stagingPath });
    notification.message = t('Purging mods');
    api.sendNotification(notification);

    // TODO: we really should be using the deployment specified in the manifest,
    //   not the current one! This only works because we force a purge when switching
    //   deployment method.
    return activator.prePurge(stagingPath)
      // purge the specified mod type
      .then(() => activator.purge(stagingPath, modPath))
      // save (empty) activation
      .then(() => saveActivation(typeId, state.app.instanceId, modPath, stagingPath,
                         [], activator.id))
      .catch(ProcessCanceled, () => null)
      .then(() => Promise.resolve())
      .finally(() => activator.postPurge());
  }, true)
    .then(() => null)
    .finally(() => {
      api.dismissNotification(notification.id);
    });
}

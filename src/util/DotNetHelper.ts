/* eslint-disable */
import { IState } from '../types/IState';
import { IExtensionApi, IRegisterDotNetLibCall } from '../types/api';
import { activeGameId } from './selectors';
import * as fs from './fs';
import path from 'path';

import { log } from './log';


import dotnet from 'node-api-dotnet';

const byPriority = (lhs: IRegisterDotNetLibCall, rhs: IRegisterDotNetLibCall) => {
  return lhs.priority - rhs.priority;
}

const defaultAssemblyPathResolver = async () => {
  dotnet.addListener('resolving', (name, version, resolve) => {
    // Lets try to keep this event listener as light, static and synchronous
    //  as possible for the sake of our future selves.
    const recursiveRead = (directory) => {
      const files = fs.readdirSync(directory)
        .map(file => path.join(directory, file))
        .filter(file => fs.statSync(file).isFile() && path.extname(file) === '.dll');

      return files.concat(
        ...files.map(file => recursiveRead(file))
          .flatMap(files => files)
      );
    }
    const assemblies = recursiveRead(__dirname);
    const potentialMatch = assemblies.find(file => path.basename(file).toLowerCase() === name.toLowerCase());
    if (potentialMatch) {
      resolve(potentialMatch)
    }
  });
};

const _assemblyMap: Map<string, string> = new Map();

const silentLoad = (assemblyFilePath: string) => {
  try {
    dotnet.load(assemblyFilePath);
  } catch (err) {
    log('debug', 'failed to load assembly', { assemblyFilePath });
    return;
  }
}

class DotNetHelper {
  private mAssemblyRegistrationCalls: IRegisterDotNetLibCall[] = [];

  constructor() { };

  public init = async (api: IExtensionApi) => {
    const state = api.getState();
    defaultAssemblyPathResolver();
    this.addListeners(state);
    this.runRegistrationCalls(state);
  };

  public runRegistrationCalls = async (state: IState): Promise<void> => {
    const gameId = activeGameId(state);
    for (const call of this.mAssemblyRegistrationCalls) {
      await this.runRegistrationCall(state, gameId, call);
    }
  }

  public loadAssembly = (assemblyFilePath: string) => {
    if (path.isAbsolute(assemblyFilePath)) {
      silentLoad(assemblyFilePath);
    } else {
      if (_assemblyMap.has(path.basename(assemblyFilePath))) {
        silentLoad(_assemblyMap[assemblyFilePath]);
      }
      else {
        // This will fail but we will get the
        //  error back from dotnet rather than us
        //  generating one.
        silentLoad(assemblyFilePath);
      }
    }
  }

  public getAllDotNetLibCalls(): IRegisterDotNetLibCall[] {
    return this.mAssemblyRegistrationCalls;
  }

  public getSupportedDotNetCalls = (state: IState, assemblyPaths: string[]): IRegisterDotNetLibCall[] => {
    const gameId = activeGameId(state);
    const discovery = state.settings.gameMode.discovered[gameId];
    if ((discovery === undefined) || (discovery.path === undefined)) {
      return [];
    }
    const supportFunc = (assemblyPaths, gameId, call) =>
      call?.testSupported?.(assemblyPaths, gameId)
      ?? (() => Promise.resolve({ supported: true, requiredFiles: [] }));
    return this.mAssemblyRegistrationCalls.filter(call => supportFunc(assemblyPaths, gameId, call));
  }

  public RegisterDotNetLib = (call: IRegisterDotNetLibCall) => {
    call.assemblyFilePaths
      .filter(path.isAbsolute)

    this.mAssemblyRegistrationCalls.push(call);
    this.mAssemblyRegistrationCalls.sort(byPriority);
  }

  public getSelectedDotNetCall = (state: IState, selectedId: string): IRegisterDotNetLibCall => {
    return (selectedId !== undefined)
      ? this.mAssemblyRegistrationCalls.find((act: IRegisterDotNetLibCall) => act.id === selectedId)
      : undefined;
  }

  public addListeners = (state): void => {
    this.mAssemblyRegistrationCalls.forEach(call => {
      call.getListener !== undefined
        && dotnet.addListener('resolving', call.getListener());
    })
  }

  public runRegistrationCall = async (state: IState, gameId: string, call: IRegisterDotNetLibCall): Promise<void> => {
    const { assemblyFilePaths, testSupported } = call;
    const supportFunc = testSupported ?? (() => Promise.resolve({ supported: true, requiredFiles: [] }));
    const result = await supportFunc(assemblyFilePaths, gameId);
    if (!result.supported) {
      return;
    }

    call.assemblyFilePaths.forEach(assemblyFilePath => {
      if (!_assemblyMap.has(path.basename(assemblyFilePath))) {
        _assemblyMap.set(path.basename(assemblyFilePath), assemblyFilePath);
        silentLoad(assemblyFilePath);
      }
    });
  }
}

const instance: DotNetHelper = new Proxy({}, {
  get(target, name) {
    const branch = (name as string).split('.');
    if (target['inst'] === undefined) {
      target['inst'] = new DotNetHelper();
    }
    if (target['inst'][name] !== undefined) {
      return target['inst'][name];
    }
    try {
      const result = branch.reduce((current, key) => {
        if (current) {
          return current[key];
        } else {
          throw new Error(`Encountered null or undefined while resolving '${key}'`);
        }
      }, dotnet);
      return result;
    } catch (err) {
      log('error', 'Error accessing dotnet properties dynamically', err);
      return undefined;
    }
  },

  set(target, name, value) {
    if (target['inst'] === undefined) {
      target['inst'] = new DotNetHelper();
    }
    target['inst'][name] = value;
    return true;
  },

  has(target, name) {
    return Reflect.has(target, name) || target['inst'][name] !== undefined;
  },

  ownKeys(target) {
    // Return the keys of the `DotNetHelper` instance
    return Reflect.ownKeys(target['inst']);
  },
}) as any;

export default instance;


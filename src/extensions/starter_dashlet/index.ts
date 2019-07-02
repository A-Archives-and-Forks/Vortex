import * as Promise from 'bluebird';

import { IExtensionApi, IExtensionContext, ITestResult } from '../../types/api';
import { activeGameId } from '../../util/selectors';
import { getSafe } from '../../util/storeHelper';
import { truthy } from '../../util/util';

import { setPrimaryTool } from './actions';
import settingsReducer from './reducers';
import Starter from './Starter';

function testPrimaryTool(api: IExtensionApi): Promise<ITestResult> {
  const state = api.store.getState();

  const gameMode = activeGameId(state);
  if (gameMode === undefined) {
    return Promise.resolve(undefined);
  }
  const primaryToolId = getSafe(state,
    ['settings', 'interface', 'primaryTool', gameMode], undefined);

  if (primaryToolId !== undefined) {
    // We have a primary tool defined - ensure it's still valid.
    const primaryTool = getSafe(state,
      [ 'settings', 'gameMode', 'discovered', gameMode, 'tools', primaryToolId ], undefined);
    if ((primaryTool === undefined) || (!truthy(primaryTool.path))) {
      api.sendNotification({
        id: 'invalid-primary-tool',
        type: 'warning',
        message: 'Invalid primary tool',
        actions: [
          { title: 'More', action: (dismiss) =>
            api.showDialog('info', 'Invalid primary tool', {
              text: api.translate('The primary tool for {{game}}, {{tool}}, is no longer available.'
                                + ' Quick launch has reverted to the game\'s executable.',
                                    { replace: { tool: primaryToolId, game: gameMode } }),
            }, [ { label: 'Close', action: () => dismiss() } ]),
          },
        ],
      });
      api.store.dispatch(setPrimaryTool(gameMode, undefined));
    }
  }

  return Promise.resolve(undefined);
}

function init(context: IExtensionContext): boolean {
  context.registerDashlet('Starter', 2, 2, 100, Starter,
                          undefined, undefined, undefined);

  context.registerReducer(['settings', 'interface'], settingsReducer);

  context.registerTest('primary-tool', 'gamemode-activated',
    () => testPrimaryTool(context.api));

  return true;
}

export default init;

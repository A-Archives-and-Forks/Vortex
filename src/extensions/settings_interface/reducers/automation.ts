import { IReducerSpec } from '../../../types/IExtensionContext';

import * as actions from '../actions/automation';

import update from 'immutability-helper';

/**
 * reducer for changes to automation settings
 */
const automationReducer: IReducerSpec = {
  reducers: {
    [actions.setAutoDeployment as any]: (state, payload) =>
      update(state, { deploy: { $set: payload } }),
    [actions.setAutoEnable as any]: (state, payload) =>
      update(state, { enable: { $set: payload } }),
  },
  defaults: {
    deploy: true,
    enable: false,
  },
};

export default automationReducer;

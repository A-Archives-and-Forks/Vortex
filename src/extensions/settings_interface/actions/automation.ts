import safeCreateAction from '../../../actions/safeCreateAction';

import * as reduxAct from 'redux-act';

export const setAutoDeployment = safeCreateAction('SET_AUTO_DEPLOYMENT', deploy => deploy);
export const setAutoEnable = safeCreateAction('SET_AUTO_ENABLE', enabled => enabled);

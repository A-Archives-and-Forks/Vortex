import * as actions from '../src/extensions/installer_fomod/actions/installerUI';


describe('startDialog', () => {
  it('creates the correct action', () => {
     let installerInfo = {
      moduleName: 'test',
      image: 'test',
    };
    let instanceId = 'testInstance';
    expect(actions.startDialog(installerInfo, instanceId)).toEqual({
      error: false,
      type: 'START_FOMOD_DIALOG',
      payload: { info: installerInfo, instanceId: instanceId },
    });
  });
});

describe('endDialog', () => {
  it('creates the correct action', () => {
    let instanceId = 'testInstance';
    expect(actions.endDialog(instanceId)).toEqual({
      error: false,
      payload: { instanceId: instanceId },
      type: 'END_FOMOD_DIALOG',
    });
  });
});

describe('setDialogState', () => {
  it('creates the correct action', () => {
    let state = {
      installSteps: [],
      currentStep: 1,
    };
    let instanceId = 'testInstance';
    expect(actions.setDialogState(state, instanceId)).toEqual({
      error: false,
      type: 'SET_FOMOD_DIALOG_STATE',
      payload: { dialogState: state, instanceId: instanceId },
    });
  });
});

describe('setInstallerDataPath', () => {
  it('creates the correct action', () => {
    let instanceId = 'testInstance';
    expect(actions.setInstallerDataPath('path', instanceId)).toEqual({
      error: false,
      type: 'SET_INSTALLER_DATA_PATH',
      payload: { path: 'path', instanceId: instanceId },
    });
  });
});

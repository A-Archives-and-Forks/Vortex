import { ButtonType } from '../../../controls/IconBar';
import ToolbarIcon from '../../../controls/ToolbarIcon';
import { ComponentEx, connect, translate } from '../../../util/ComponentEx';
import { activeGameId } from '../../../util/selectors';

import { dialog as dialogIn, remote } from 'electron';
import * as React from 'react';

const dialog = remote !== undefined ? remote.dialog : dialogIn;

export interface IBaseProps {
  buttonType: ButtonType;
}

interface IConnectedProps {
  gameMode: string;
}

type IProps = IBaseProps & IConnectedProps;

class InstallButton extends ComponentEx<IProps, {}> {
  public render(): JSX.Element {
    const { t, buttonType } = this.props;

    return (
      <ToolbarIcon
        id='install-from-archive'
        icon='select-install'
        text={t('Install From File')}
        onClick={this.startInstallFile}
      />
    );
  }

  private startInstallFile = () => {
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
    };

    dialog.showOpenDialog(remote.getCurrentWindow(), options, (fileNames: string[]) => {
      if ((fileNames !== undefined) && (fileNames.length > 0)) {
        this.context.api.events.emit('start-install', fileNames[0]);
      }
    });
  }
}

function mapStateToProps(state: any): IConnectedProps {
  const gameMode = activeGameId(state);
  return {
    gameMode,
  };
}

export default
  translate(['common'], { wait: false })(
    connect(mapStateToProps)(
      InstallButton)) as React.ComponentClass<IBaseProps>;

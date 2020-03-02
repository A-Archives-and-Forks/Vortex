import { setDialogVisible } from '../../../actions/session';
import Icon from '../../../controls/Icon';
import * as tooltip from '../../../controls/TooltipControls';
import { IState } from '../../../types/IState';
import { ComponentEx, connect, translate } from '../../../util/ComponentEx';
import opn from '../../../util/opn';

import { setUserAPIKey } from '../actions/account';
import { IValidateKeyData } from '../types/IValidateKeyData';

import NexusT from '@nexusmods/nexus-api';
import * as React from 'react';
import { Image } from 'react-bootstrap';
import { WithTranslation } from 'react-i18next';
import * as Redux from 'redux';
import { ThunkDispatch } from 'redux-thunk';

export interface IBaseProps extends WithTranslation {
  nexus: NexusT;
}

interface IConnectedProps {
  APIKey: string;
  userInfo: IValidateKeyData;
  networkConnected: boolean;
}

interface IActionProps {
  onSetAPIKey: (APIKey: string) => void;
  onShowDialog: () => void;
}

type IProps = IBaseProps & IConnectedProps & IActionProps;

class LoginIcon extends ComponentEx<IProps, {}> {
  public render(): JSX.Element {
    const { t, networkConnected } = this.props;
    if (!networkConnected) {
      return (
        <span id='login-control'>
          <tooltip.Icon name='disconnected' tooltip={t('Network is offline')} />
        </span>
      );
    }
    return (
      <span id='login-control'>
        {this.renderLoginName()}
        {this.renderAvatar()}
      </span >
    );
  }

  private logOut = () => {
    const { onSetAPIKey } = this.props;
    onSetAPIKey(undefined);
  }

  private renderLoginName() {
    const { t, APIKey, userInfo } = this.props;

    if ((APIKey !== undefined) && (userInfo !== undefined) && (userInfo !== null)) {
      return (
        <div>
          <div className='username'>
            {userInfo.name}
          </div>
          <div className='logout-button'>
            <a onClick={this.logOut}>{t('Log out')}</a>
          </div>
        </div>
      );
    } else {
      return null;
    }
  }

  private renderAvatar() {
    const { t, APIKey, userInfo } = this.props;

    const loggedIn = (APIKey !== undefined) && (userInfo !== undefined) && (userInfo !== null);

    return (
      <tooltip.Button
        id='btn-login'
        tooltip={loggedIn ? t('Show Details') : t('Log in')}
        onClick={this.showLoginLayer}
      >
        {loggedIn ? (
          <Image
            src={userInfo.profileUrl  || 'assets/images/noavatar.png'}
            circle
            style={{ height: 32, width: 32 }}
          />
        ) : (
            <Icon name='user' className='logout-avatar' />
          )
        }
      </tooltip.Button>
    );
  }

  private showLoginLayer = () => {
    const { userInfo } = this.props;
    if ((userInfo === undefined) || (userInfo === null)) {
      this.setDialogVisible(true);
    } else {
      opn(`https://www.nexusmods.com/users/${userInfo.userId}`).catch(err => undefined);
    }
  }

  private hideLoginLayer = () => {
    this.setDialogVisible(false);
  }

  private setDialogVisible(visible: boolean): void {
    this.props.onShowDialog();
  }
}

function mapStateToProps(state: IState): IConnectedProps {
  return {
    APIKey: (state.confidential.account as any).nexus.APIKey,
    userInfo: (state.persistent as any).nexus.userInfo,
    networkConnected: state.session.base.networkConnected,
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<any, null, Redux.Action>): IActionProps {
  return {
    onSetAPIKey: (APIKey: string) => dispatch(setUserAPIKey(APIKey)),
    onShowDialog: () => dispatch(setDialogVisible('login-dialog')),
  };
}

export default
  translate(['common'])(
    connect(mapStateToProps, mapDispatchToProps)(
      LoginIcon)) as React.ComponentClass<IBaseProps>;

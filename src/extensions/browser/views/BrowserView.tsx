import { addNotification } from '../../../actions';
import Spinner from '../../../controls/Spinner';
import { IconButton } from '../../../controls/TooltipControls';
import Webview from '../../../controls/Webview';
import { INotification } from '../../../types/INotification';
import { IState } from '../../../types/IState';
import { ComponentEx, connect, translate } from '../../../util/ComponentEx';
import Debouncer from '../../../util/Debouncer';

import { closeBrowser } from '../actions';

import * as Promise from 'bluebird';
import {  WebviewTag } from 'electron';
import * as React from 'react';
import { Breadcrumb, Button, Modal } from 'react-bootstrap';
import * as ReactDOM from 'react-dom';
import * as Redux from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import * as nodeUrl from 'url';

export type SubscriptionResult = 'close' | 'continue' | 'ignore';

export interface IBaseProps {
  onHide: () => void;
  onNavigate: (url: string) => void;
  onEvent: (subscriber: string, eventId: string, value: any) => SubscriptionResult;
}

interface IConnectedProps {
  url: string;
  subscriber: string;
  instructions: string;
}

interface IActionProps {
  onClose: () => void;
  onNotification: (notification: INotification) => void;
}

interface IComponentState {
  confirmed: boolean;
  loading: boolean;
  url: string;
  history: string[];
  historyIdx: number;
}

type IProps = IBaseProps & IConnectedProps & IActionProps;

class BrowserView extends ComponentEx<IProps, IComponentState> {
  private mRef: Webview = null;
  private mWebView: WebviewTag;
  private mCallbacks: { [event: string]: (...args: any[]) => void };
  private mSessionCallbacks: { [event: string]: (...args: any[]) => void };
  private mLoadingDebouncer: Debouncer;

  constructor(props: IProps) {
    super(props);
    this.initState({
      confirmed: false,
      loading: false,
      url: props.url,
      history: [props.url],
      historyIdx: 0,
    });

    this.mLoadingDebouncer = new Debouncer((loading: boolean) => {
      if (loading !== this.state.loading) {
        this.nextState.loading = loading;
      }
      return Promise.resolve();
    }, 100, false);

    this.mCallbacks = {
      'did-navigate': (evt) => {
        this.navigate(evt.url);
      },
      'did-navigate-in-page': (evt) => {
        this.navigate(evt.url);
      },
    };
  }

  public componentWillReceiveProps(newProps: IProps) {
    if (newProps.url !== this.props.url) {
      if ((newProps.url === undefined) || (this.props.url === undefined)
        || (new URL(newProps.url).hostname !== new URL(this.props.url).hostname)) {
        this.nextState.confirmed = false;
        if (newProps.url !== undefined) {
          this.nextState.history = [newProps.url];
          this.nextState.historyIdx = 0;
        }
      }
      this.nextState.url = newProps.url;
    }
  }

  public shouldComponentUpdate(newProps: IProps, newState: IComponentState) {
    const res = (this.props.url !== newProps.url)
        || (this.props.instructions !== newProps.instructions)
        || (this.state.url !== newState.url)
        || (this.state.loading !== newState.loading)
        || (this.state.confirmed !== newState.confirmed)
        || (this.state.history !== newState.history);
    return res;
  }

  public render(): JSX.Element {
    const { instructions } = this.props;
    const { confirmed, history, historyIdx, loading, url } = this.state;
    const referrer = (history.length > 0)
      ? history[historyIdx - 1]
      : undefined;
    return (
      <Modal id='browser-dialog' show={url !== undefined} onHide={this.close}>
        <Modal.Header>
          {this.renderNav()}{this.renderUrl(url)}
          {loading ? <Spinner /> : null}
        </Modal.Header>
        <Modal.Body>
          {(instructions !== undefined) ? <p>{instructions}</p> : null}
          {confirmed
            ? (
              <Webview
                id='browser-webview'
                src={url}
                ref={this.setRef}
                httpreferrer={referrer}
                onLoading={this.loading}
                onNewWindow={this.newWindow}
              />
            )
            : this.renderConfirm()}
        </Modal.Body>
      </Modal>
    );
  }

  private renderLoadingOverlay(): JSX.Element {
    return <div className='browser-loading'><Spinner /></div>;
  }

  private renderNav(): JSX.Element {
    const { t } = this.props;
    const { history, historyIdx } = this.state;
    return (
      <div>
        <IconButton
          icon='nav-back'
          onClick={this.navBack}
          disabled={historyIdx === 0}
          tooltip={t('Back')}
        />
        <IconButton
          icon='nav-forward'
          onClick={this.navForward}
          disabled={historyIdx === history.length - 1}
          tooltip={t('Forward')}
        />
      </div>
    );
  }

  private renderUrl(input: string): JSX.Element {
    if (input === undefined) {
      return null;
    }
    const parsed = nodeUrl.parse(input);
    const segments = parsed.pathname.split('/').filter(seg => seg.length > 0);
    const Item: any = Breadcrumb.Item;
    return (
      <Breadcrumb>
        <Item data-idx={-1} onClick={this.navCrumb}>{parsed.protocol}//{parsed.hostname}</Item>
        {segments.map((seg, idx) =>
          <Item data-idx={idx} key={seg} onClick={this.navCrumb}>{seg}</Item>)}
        <Item active={false}>{parsed.search}</Item>
      </Breadcrumb>
    );
  }

  private renderConfirm() {
    const { t, url } = this.props;
    return (
      <div>
        <h3>{t('Attention')}</h3>
        <p>{t('Vortex is about to open an external web page:')}</p>
        <a href='#'>{url}</a>
        <p>{t('Please be aware that Vortex is based on electron which in turn is based on '
           + 'Chrome, but it will not always be the newest version. Also, we can\'t rule out '
           + 'that electron might contain it\'s own security issues pertaining to website '
           + 'access.')}</p>
        <p>{t('If you have security concerns or don\'t fully trust this page, please don\'t '
              + 'continue. Don\'t navigate away from pages you don\'t trust.')}</p>
        <Button onClick={this.confirm}>{t('Continue')}</Button>
      </div>
    );
  }

  private loading = (loading: boolean) => {
    if (loading) {
      this.mLoadingDebouncer.schedule(undefined, true);
    } else {
      this.mLoadingDebouncer.runNow(undefined, false);
    }
  }

  private newWindow = (url: string, disposition: string) => {
    const { onEvent, subscriber } = this.props;

    // currently we try to download any url that isn't opened in the same window
    if (onEvent(subscriber, 'download-url', url) === 'close') {
      this.props.onClose();
    }
  }

  private setRef = (ref: any) => {
    this.mRef = ref;
    if (ref !== null) {
      this.mWebView = ReactDOM.findDOMNode(this.mRef) as any;
      Object.keys(this.mCallbacks).forEach(event => {
        this.mWebView.addEventListener(event, this.mCallbacks[event]);
      });
    } else {
      Object.keys(this.mCallbacks).forEach(event => {
        this.mWebView.removeEventListener(event, this.mCallbacks[event]);
      });
    }
  }

  private navBack = () => {
    const { history, historyIdx } = this.state;
    const newPos = Math.max(0, historyIdx - 1);
    this.nextState.historyIdx = newPos;
    this.nextState.url = history[newPos];
  }

  private navForward = () => {
    const { history, historyIdx } = this.state;
    const newPos = Math.max(history.length - 1, historyIdx + 1);
    this.nextState.historyIdx = newPos;
    this.nextState.url = history[newPos];
  }

  private navCrumb = (evt) => {
    const idx = parseInt(evt.currentTarget.getAttribute('data-idx'), 10);
    const parsed = nodeUrl.parse(this.state.url);
    parsed.pathname = parsed.pathname.split('/').slice(0, idx + 2).join('/');
    parsed.path = undefined;
    parsed.href = undefined;
    this.nextState.url = nodeUrl.format(parsed);
  }

  private confirm = () => {
    this.nextState.confirmed = true;
  }

  private navigate(url: string) {
    this.props.onNavigate(url);
    this.nextState.url = url;
    if (url !== this.nextState.history[this.nextState.historyIdx]) {
      this.nextState.history.splice(this.nextState.historyIdx + 1, 9999, url);
      ++this.nextState.historyIdx;
    }
  }

  private close = () => {
    const { onClose, onEvent, subscriber } = this.props;
    if (onEvent(subscriber, 'close', null) !== 'ignore') {
      onClose();
    }
  }
}

function mapStateToProps(state: IState): IConnectedProps {
  return {
    subscriber: state.session.browser.subscriber,
    instructions: state.session.browser.instructions,
    url: state.session.browser.url,
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<IState, null, Redux.Action>): IActionProps {
  return {
    onClose: () => dispatch(closeBrowser()),
    onNotification: (notification: INotification) => dispatch(addNotification(notification)),
  };
}

export default
  translate(['common'])(
    connect(mapStateToProps, mapDispatchToProps)(
      BrowserView)) as React.ComponentClass<IBaseProps>;

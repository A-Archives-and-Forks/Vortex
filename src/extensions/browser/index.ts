import { IExtensionContext } from '../../types/IExtensionContext';
import { UserCanceled } from '../../util/CustomErrors';
import { getSafe } from '../../util/storeHelper';
import { setdefault } from '../../util/util';

import BrowserView, { SubscriptionResult } from './views/BrowserView';

import { closeBrowser, showURL } from './actions';
import { sessionReducer } from './reducers';

import * as Promise from 'bluebird';
import { ipcRenderer } from 'electron';
import { generate as shortid } from 'shortid';
import { IState } from '../../types/IState';

type SubscriptionFunction = (eventId: string, value: any) => SubscriptionResult;

const subscriptions: {
  [subscriber: string]: {
    [eventId: string]: SubscriptionFunction[],
  };
} = {};

function subscribe(subscriber: string, eventId: string,
                   callback: (value: any) => SubscriptionResult) {
  setdefault(setdefault(subscriptions, subscriber, {}), eventId, []).push(callback);
}

function unsubscribeAll(subscriber: string) {
  delete subscriptions[subscriber];
}

function triggerEvent(subscriber: string, eventId: string, value: any): SubscriptionResult {
  let res: SubscriptionResult = 'continue';

  getSafe(subscriptions, [subscriber, eventId], []).forEach(sub => {
    if (res === 'continue') {
      res = sub(value);
    }
  });

  return res;
}

function init(context: IExtensionContext): boolean {
  context.registerDialog('browser', BrowserView, () => ({
    onEvent: triggerEvent,
  }));
  context.registerReducer(['session', 'browser'], sessionReducer);

  context.once(() => {
    // open a browser to an url, displaying instructions if provided.
    // the browser closes as soon as a downloadable link was clicked and returns that
    // url
    context.api.onAsync('browse-for-download', (url: string, instructions: string) => {
      const subscriptionId = shortid();

      return new Promise<string>((resolve, reject) => {
        subscribe(subscriptionId, 'close', () => {
          reject(new UserCanceled());
          return 'continue';
        });
        subscribe(subscriptionId, 'download-url', (download: string) => {
          resolve(download);
          return 'close';
        });

        context.api.store.dispatch(showURL(url, instructions, subscriptionId));
      })
      .catch(UserCanceled, () => null)
      .catch(err => {
        context.api.showErrorNotification('Failed to download via browser', err);
      })
      .finally(() => {
        unsubscribeAll(subscriptionId);
      });
    });

    ipcRenderer.on('received-url', (evt: string, dlUrl: string, fileName: string) => {
      const state: IState = context.api.store.getState();
      const { subscriber } = state.session.browser;
      if (subscriber !== undefined) {
        const res = triggerEvent(subscriber, 'download-url', dlUrl);
        if (res === 'close') {
          context.api.store.dispatch(closeBrowser());
        }
      } else {
        context.api.events.emit('start-download-url', dlUrl);
      }
    });
  });

  return true;
}

export default init;

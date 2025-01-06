/* eslint-disable */
import Bluebird from 'bluebird';
import * as contentDisposition from 'content-disposition';
import * as http from 'http';
import * as https from 'https';
import * as stream from 'stream';
import * as url from 'url';
import * as zlib from 'zlib';
import {
  HTTPError, ProcessCanceled, StalledError, UserCanceled
} from '../../util/CustomErrors';
import makeRemoteCall from '../../util/electronRemote';
import { log } from '../../util/log';

import { IDownloadJob } from './types/IDownloadJob';
import { IDownloadWorker } from './types/IDownloadWorker';
import { FinishCallback } from './types/FinishCallback';
import { DownloadIsHTML } from './types/Errors';

const getCookies = makeRemoteCall('get-cookies',
  (electron, webContents, filter: Electron.CookiesGetFilter) => {
    return webContents.session.cookies.get(filter);
  });

interface IHTTP {
  request: (options: https.RequestOptions | string | URL,
    callback?: (res: http.IncomingMessage) => void) => http.ClientRequest;
  Agent: typeof http.Agent;
}

// don't follow redirects arbitrarily long
const MAX_REDIRECT_FOLLOW = 5;
// if we receive no data for this amount of time, reset the connection
const MAX_STALL_RESETS = 2;

const STALL_TIMEOUT = MAX_STALL_RESETS * 1500;

function isHTMLHeader(headers: http.IncomingHttpHeaders) {
  return (headers['content-type'] !== undefined)
    && (headers['content-type'].toString().startsWith('text/html'));
}

const dummyJob: IDownloadJob = {
  confirmedOffset: 0,
  confirmedReceived: 0,
  confirmedSize: 0,
  offset: 0,
  options: {},
  received: 0,
  size: 0,
  state: 'init',
  extraCookies: [],
  url: () => Bluebird.reject(new ProcessCanceled('dummy job')),
};

/**
 * a download worker. A worker is started to download one chunk of a file,
 * they are currently not reused.
 *
 * @class DownloadWorker
 */
export class DownloadWorker implements IDownloadWorker {
  public static dummy(onAbort: () => void): DownloadWorker {
    const res = new DownloadWorker(dummyJob,  () => null, () => null, () => null, '', () => null);
    res.mOnAbort = onAbort;
    res.mEnded = true;
    return res;
  }
  private static BUFFER_SIZE = 256 * 1024;
  private static BUFFER_SIZE_CAP = 4 * 1024 * 1024;
  private mJob: IDownloadJob;
  private mUrl: string;
  private mRequest: http.ClientRequest;
  private mProgressCB: (bytes: number) => void;
  private mFinishCB: FinishCallback;
  private mHeadersCB: (headers: any) => void;
  private mUserAgent: string;
  private mBuffers: Buffer[] = [];
  private mDataHistory: Array<{ time: number, size: number }> = [];
  private mEnded: boolean = false;
  private mResponse: http.IncomingMessage;
  private mWriting: boolean = false;
  private mRestart: boolean = false;
  private mRedirected: boolean = false;
  private mStallTimer: NodeJS.Timeout;
  private mStallResets: number = MAX_STALL_RESETS;
  private mRedirectsFollowed: number = 0;
  private mThrottle: () => stream.Transform;
  private mURLResolve: Bluebird<void>;
  private mOnAbort: () => void;

  constructor(job: IDownloadJob,
              progressCB: (bytes: number) => void,
              finishCB: FinishCallback,
              headersCB: (headers: any) => void,
              userAgent: string,
              throttle: () => stream.Transform) {
    this.mProgressCB = progressCB;
    this.mFinishCB = finishCB;
    this.mHeadersCB = headersCB;
    this.mJob = job;
    this.mUserAgent = userAgent;
    this.mThrottle = throttle;
    this.mURLResolve = Bluebird.resolve(job.url())
      .then(jobUrl => {
        this.mUrl = jobUrl;
        if (jobUrl.startsWith('blob:')) {
          // in the case of blob downloads (meaning: javascript already placed the entire file
          // in local storage) the main process has already downloaded this file, we just have
          // to use it now
          job.received = job.size;
          job.size = 0;
          const [ignore, fileName] = jobUrl.split('<')[0].split('|');
          finishCB(false, fileName);
        } else {
          this.assignJob(job, jobUrl);
        }
      })
      .catch(err => {
        this.handleError(err);
      })
      .finally(() => {
        this.mURLResolve = Bluebird.resolve(undefined);
      });
  }

  public assignJob(job: IDownloadJob, jobUrl: string) {
    this.mDataHistory = [];
    log('debug', 'requesting range', { id: job.workerId, offset: job.offset, size: job.size });
    if (job.size <= 0) {
      // early out if the job status didn't match the range
      this.handleComplete();
      return;
    }

    if (jobUrl === undefined) {
      this.handleError(new ProcessCanceled('No URL found for this download'));
      return;
    }

    try {
      getCookies({ url: jobUrl })
        .then(cookies => {
          this.startDownload(job, jobUrl, cookies);
        })
        .catch(err => {
          log('error', 'failed to retrieve cookies', err.message);
        });
    } catch (err) {
      log('error', 'failed to retrieve cookies', err.message);
      this.startDownload(job, jobUrl, []);
    }
  }

  public ended() {
    return this.mEnded;
  }

  public cancel() {
    this.abort(false);
  }

  public pause() {
    if (this.abort(true)) {
      if (this.mResponse !== undefined) {
        this.mResponse.pause();
      }
    }
  }

  public restart() {
    this.mResponse.removeAllListeners('error');
    this.mRequest.destroy();
    this.mRestart = true;
  }

  private startDownload(job: IDownloadJob, jobUrl: string, electronCookies: Electron.Cookie[]) {
    if (this.mEnded) {
      // worker was canceled while the url was still being resolved
      return;
    }
    let parsed: url.UrlWithStringQuery;
    let referer: string;
    try {
      const [urlIn, refererIn] = jobUrl.split('<');
      // at some point in the past we'd encode the uri here which apparently led to double-encoded
      // uris. Then we'd decode it which led to the request failing if there were characters in
      // the url that required encoding.
      // Since all that was tested at some point I'm getting the feeling it's inconsistent in
      // the callers whether the url is encoded or not
      parsed = url.parse(urlIn);
      referer = refererIn;
      jobUrl = urlIn;
    } catch (err) {
      this.handleError(new Error('No valid URL for this download'));
      return;
    }

    if (referer === undefined) {
      referer = job.options.referer;
    }

    const lib: IHTTP = parsed.protocol === 'https:' ? https : http;

    const allCookies = (electronCookies || [])
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .concat(this.mJob.extraCookies);

    try {
      const headers = {
          Range: `bytes=${job.offset}-${job.offset + job.size}`,
          'User-Agent': this.mUserAgent,
          'Accept-Encoding': 'gzip, deflate',
          Cookie: allCookies,
        };
      if (referer !== undefined) {
        headers['Referer'] = referer;
      }
      this.mRequest = lib.request({
        method: 'GET',
        protocol: parsed.protocol,
        port: parsed.port,
        hostname: parsed.hostname,
        path: parsed.path,
        headers,
        agent: false,
      }, (res) => {
        log('debug', 'downloading from',
          { address: `${res.connection.remoteAddress}:${res.connection.remotePort}` });
        this.mStallTimer = setTimeout(this.stalled, STALL_TIMEOUT);
        this.mResponse = res;
        let recodedURI: string;
        try {
          recodedURI = encodeURI(decodeURI(jobUrl));
        } catch (err) {
          this.handleError(err);
          return;
        }
        this.handleResponse(res, recodedURI);
        let str: stream.Readable = res;

        str = str.pipe(this.mThrottle());

        switch (res.headers['content-encoding']) {
          case 'gzip':
            str = str.pipe(zlib.createGunzip());
            break;
          case 'deflate':
            str = str.pipe(zlib.createInflate());
            break;
        }

        str
          .on('data', (data: Buffer) => {
            clearTimeout(this.mStallTimer);
            this.mStallTimer = setTimeout(this.stalled, STALL_TIMEOUT);
            this.mStallResets = MAX_STALL_RESETS;
            this.handleData(data, str);
          })
          .on('error', err => this.handleError(err))
          .on('end', () => {
            if (!this.mRedirected) {
              this.handleComplete(str);
            }
            this.mRequest.destroy();
          });
      });

      this.mRequest
        .on('error', (err) => {
          this.handleError(err);
        })
        .end();
    } catch (err) {
      this.handleError(err);
    }
  }

  private stalled = () => {
    if (this.mEnded) {
      return;
    }

    if (this.mRequest !== undefined) {
      if (this.mStallResets <= 0) {
        log('warn', 'giving up on download after repeated stalling with no progress', this.mUrl);
        const err = new StalledError();
        err['allowReport'] = false;
        return this.handleError(err);
      }

      log('info', 'download stalled, resetting connection', { url: this.mUrl, id: this.mJob.workerId });
      --this.mStallResets;

      this.mBuffers = [];

      this.mRedirected = true;
      this.mRequest.abort();
      setTimeout(() => {
        this.mRedirected = false;
        this.mEnded = false;
        this.assignJob(this.mJob, this.mUrl);
      }, 500);
    } // the else case doesn't really make sense
  }

  private handleError(err) {
    if (this.mEnded) {
      // don't report errors again
      return;
    }
    clearTimeout(this.mStallTimer);
    log('warn', 'chunk error', { id: this.mJob.workerId, err: err.message, ended: this.mEnded, url: this.mUrl });
    if (this.mJob.errorCB !== undefined) {
      this.mJob.errorCB(err);
    }
    if (this.mRequest !== undefined) {
      this.mRequest.abort();
    }
    if ((['ESOCKETTIMEDOUT', 'ECONNRESET'].includes(err.code))
      && !this.mEnded
      && (this.mDataHistory.length > 0)) {
      // as long as we made progress on this chunk, retry
      this.mJob.url().then(jobUrl => {
        this.assignJob(this.mJob, jobUrl);
      })
        .catch(innerErr => {
          this.handleError(innerErr);
        });
    } else {
      this.mEnded = true;
      this.mFinishCB(false);
    }
  }

  private abort(paused: boolean): boolean {
    if (this.mURLResolve !== undefined) {
      this.mURLResolve.cancel();
      this.mURLResolve = Bluebird.resolve(undefined);
    }
    this.mOnAbort?.();
    if (this.mEnded) {
      return false;
    }
    if (this.mRequest !== undefined) {
      this.mRequest.abort();
    }
    this.mEnded = true;
    this.mFinishCB(paused);
    return true;
  }

  private handleHTML(inputUrl: string) {
    this.abort(false);
    if (this.mJob.errorCB !== undefined) {
      this.mJob.errorCB(new DownloadIsHTML(inputUrl));
    }
  }

  private handleComplete(str?: stream.Readable) {
    if (this.mEnded) {
      log('debug', 'chunk completed but can\'t write it anymore', JSON.stringify(this.mJob));
      return;
    }
    clearTimeout(this.mStallTimer);
    log('info', 'chunk completed', {
      id: this.mJob.workerId,
      numBuffers: this.mBuffers.length,
    });
    this.writeBuffer(str)
      .then(() => {
        if (this.mRestart && (this.mJob.size > 0)) {
          this.mRestart = false;
          this.mJob.url().then(jobUrl => {
            this.assignJob(this.mJob, jobUrl);
          })
            .catch(err => {
              this.handleError(err);
            });
        } else {
          if (this.mJob.completionCB !== undefined) {
            this.mJob.completionCB();
          }
          this.abort(false);
        }
      })
      .catch(UserCanceled, () => null)
      .catch(ProcessCanceled, () => null)
      .catch(err => this.handleError(err));
  }

  private handleResponse(response: http.IncomingMessage, jobUrl: string) {
    // we're not handling redirections here. For one thing it may be undesired by the user
    // plus there might be a javascript redirect which we can't handle here anyway.
    // Instead we display the website as a download with a button where the user can open the
    // it. If it contains any redirect, the browser window will follow it and initiate a
    // download.
    if (response.statusCode < 400) {
      if (response.headers['set-cookie'] !== undefined) {
        this.mJob.extraCookies = this.mJob.extraCookies
          .concat(response.headers['set-cookie']);
      }
    }
    if (response.statusCode >= 300) {
      if (([301, 302, 303, 307, 308].includes(response.statusCode))
        && (this.mRedirectsFollowed < MAX_REDIRECT_FOLLOW)) {
        const newUrl = url.resolve(jobUrl, response.headers['location'] as string);
        log('info', 'redirected', { newUrl, loc: response.headers['location'] });
        this.mJob.url = () => Bluebird.resolve(newUrl);
        this.mRedirected = true;

        // delay the new request a bit to ensure the old request is completely settled
        // TODO: this is ugly and shouldn't be necessary if we made sure no state was neccessary to
        //   shut down the old connection
        setTimeout(() => {
          ++this.mRedirectsFollowed;
          this.mRedirected = false;
          // any data we may have gotten with the old reply is useless
          this.mJob.size += this.mJob.received;
          this.mJob.confirmedSize = this.mJob.size;
          this.mJob.offset -= this.mJob.received;
          this.mJob.confirmedOffset -= this.mJob.confirmedReceived;

          this.mJob.received = this.mJob.confirmedReceived = 0;
          this.mJob.state = 'running';
          this.mEnded = false;
          this.assignJob(this.mJob, newUrl);
        }, 100);
      } else {
        const err = new HTTPError(response.statusCode, response.statusMessage, jobUrl);
        err['attachLogOnReport'] = true;
        if (response.statusCode === 429) {
          err['allowReport'] = false;
        }
        this.handleError(err);
      }
      return;
    }

    this.mHeadersCB(response.headers);

    if (isHTMLHeader(response.headers)) {
      this.handleHTML(jobUrl);
      return;
    }

    const chunkable = 'content-range' in response.headers;

    log('debug', 'retrieving range',
      { id: this.mJob.workerId, range: response.headers['content-range'] || 'full' });
    if (this.mJob.responseCB !== undefined) {
      const chunkSize: number = (response.headers['content-length'] !== undefined)
        ? parseInt(response.headers['content-length'] as string, 10)
        : -1;

      let fileSize = chunkSize;
      if (chunkable) {
        const rangeExp: RegExp = /bytes (\d)*-(\d*)\/(\d*)/i;
        const sizeMatch: string[] = (response.headers['content-range'] as string).match(rangeExp);
        if ((sizeMatch?.length ?? 0) > 1) {
          fileSize = parseInt(sizeMatch[3], 10);
        }
      } else {
        log('debug', 'download doesn\'t support partial requests');
        // download can't be resumed so the returned data will start at 0
        this.mJob.offset = 0;
      }
      if (chunkSize !== this.mJob.size) {
        // on the first request it's possible we requested more than the file size if
        // the file is smaller than the minimum size for chunking or - if the file isn't chunkable -
        // the request may be larger than what we requested initially.
        // offset should always be 0 here
        this.mJob.confirmedSize = this.mJob.size = chunkSize;
      }

      let fileName;
      if ('content-disposition' in response.headers) {
        let cd: string = response.headers['content-disposition'] as string;
        // the content-disposition library can't deal with trailing semi-colon so
        // we have to remove it before parsing
        // see https://github.com/jshttp/content-disposition/issues/19
        if (cd[cd.length - 1] === ';') {
          cd = cd.substring(0, cd.length - 1);
        }
        if (cd.startsWith('filename')) {
          cd = 'attachment;' + cd;
        }
        try {
          const disposition = contentDisposition.parse(cd);
          if (!!(disposition.parameters['filename'])) {
            fileName = disposition.parameters['filename'];
          }
          log('debug', 'got file name', fileName);
        } catch (err) {
          log('warn', 'failed to parse content disposition', {
            'content-disposition': cd, message: err.message
          });
        }
      }
      this.mJob.responseCB(fileSize, fileName, chunkable);
    }
  }

  private mergeBuffers(): Buffer {
    const res = Buffer.concat(this.mBuffers);
    this.mBuffers = [];
    return res;
  }

  private get bufferLength(): number {
    return this.mBuffers.reduce((prev, iter) => prev + iter.length, 0);
  }

  private doWriteBuffer(buf: Buffer): Bluebird<void> {
    const len = buf.length;
    const res = this.mJob.dataCB(this.mJob.offset, buf)
      .then(() => {
        this.mJob.confirmedReceived += len;
        this.mJob.confirmedOffset += len;
        this.mJob.confirmedSize -= len;
      });

    // need to update immediately, otherwise chunks might overwrite each other
    this.mJob.received += len;
    this.mJob.offset += len;
    this.mJob.size -= len;
    return res;
  }

  private writeBuffer(str?: stream.Readable): Bluebird<void> {
    if (this.mBuffers.length === 0) {
      return Bluebird.resolve();
    }

    let merged: Buffer;

    try {
      merged = this.mergeBuffers();
    } catch (err) {
      // we failed to merge the smaller buffers, probably a memory issue.
      log('warn', 'failed to merge buffers', { sizes: this.mBuffers.map(buf => buf.length) });
      // let's try to write the buffers individually
      const bufs = this.mBuffers;
      this.mBuffers = [];
      str?.pause?.();
      return Bluebird.mapSeries(bufs, buf => this.doWriteBuffer(buf))
        .then(() => {
          str?.resume?.();
        });
    }

    return this.doWriteBuffer(merged);
  }

  private handleData(data: Buffer, str: stream.Readable) {
    if (this.mEnded || ['paused', 'finished'].includes(this.mJob.state)) {
      log('debug', 'got data after ended',
        { workerId: this.mJob.workerId, ended: this.mEnded, aborted: this.mRequest.aborted });
      this.mRequest?.abort?.();
      return;
    }

    if (this.mRedirected) {
      // ignore message body when we were redirected
      return;
    }

    this.mDataHistory.push({ time: Date.now(), size: data.byteLength });
    this.mBuffers.push(data);

    const bufferLength = this.bufferLength;
    if (bufferLength >= DownloadWorker.BUFFER_SIZE) {
      if (!this.mWriting) {
        this.mWriting = true;
        this.writeBuffer(str)
          .catch(UserCanceled, () => null)
          .catch(ProcessCanceled, () => null)
          .catch(err => {
            this.handleError(err);
          })
          .then(() => {
            this.mWriting = false;
            if (this.mResponse.isPaused()) {
              this.mResponse.resume();
            }
          });
        this.mProgressCB(bufferLength);
      } else if (bufferLength >= DownloadWorker.BUFFER_SIZE_CAP) {
        // throttle the download because we can't process input fast enough and we
        // risk the memory usage to escalate
        this.mResponse.pause();
      }
    }
  }
}
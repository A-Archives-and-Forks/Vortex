/* eslint-disable */
import * as path from 'path';

import { IExtensionApi } from '../../types/api';
import { IDownloadJob } from './types/IDownloadJob';
import { IDownloadWorker } from './types/IDownloadWorker';
import { ProgressCallback } from './types/ProgressCallback';
import { FinishCallback } from './types/FinishCallback';

import * as dlib from '@nexusmods/dlib';
import { IRunningDownload } from './types/IRunningDownload';
import { IDownloadOptions } from './types/IDownload';
import { IDownloadResult } from './types/IDownloadResult';
import SpeedCalculator from './SpeedCalculator';

export class DownloadWorkerExperimental implements IDownloadWorker {
  private mApi: IExtensionApi;
  private mRunningDownload: IRunningDownload;
  private mJob: IDownloadJob;
  private mUrl: string;
  private mDownloadsPath: string;
  private mFinishCB: FinishCallback;
  private mProgressCB: (bytes: number) => void;
  private mURLResolve: Promise<void>;
  private mOnAbort: () => void;
  private mEnded: boolean = false;
  private mMetaInfo: any;
  private mPrevBytes: number = 0;
  constructor(api: IExtensionApi, download: IRunningDownload, job: IDownloadJob, downloadsPath: string, progressCB: (bytes: number) => void, finishCB: FinishCallback) {
    this.mApi = api;
    this.mJob = job;
    this.mRunningDownload = download;
    this.mMetaInfo = download.resolvedUrls().then(resolved => resolved.meta);
    this.mDownloadsPath = downloadsPath;
    this.mFinishCB = finishCB;
    this.mProgressCB = progressCB;
    this.mURLResolve = Promise.resolve(job.url())
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
        this.mURLResolve = Promise.resolve(undefined);
      });
  }
  public assignJob = async (job: IDownloadJob, jobUrl: string) => {
    const id = this.mRunningDownload.id;
    this.mJob = job;
    this.mUrl = jobUrl;
    const destPath = this.mDownloadsPath;
    this.runExperimentalDownload(jobUrl, this.mRunningDownload.origName, this.mRunningDownload.tempName, this.mRunningDownload.id, destPath, job.options)
      .then((result: IDownloadResult) => {
        job.received = job.size;
        job.size = 0;
        this.mJob?.completionCB?.();
        this.mEnded = true;
      });
  };

  public cancel = () => {
    this.abort(false);
  };
  public pause = () => {
    this.abort(true);
  };

  public ended = () => {
    return this.mEnded;
  };

  public restart = async () => {
    try {
      await dlib.resumeDownload(this.mRunningDownload.id);
    } catch (err) {
      this.abort(false);
      this.mURLResolve = Promise.resolve(this.mJob.url())
      .then(jobUrl => {
        this.mUrl = jobUrl;
        if (jobUrl.startsWith('blob:')) {
          // in the case of blob downloads (meaning: javascript already placed the entire file
          // in local storage) the main process has already downloaded this file, we just have
          // to use it now
          this.mJob.received = this.mJob.size;
          this.mJob.size = 0;
          const [ignore, fileName] = jobUrl.split('<')[0].split('|');
          this.mFinishCB(false, fileName);
        } else {
          this.assignJob(this.mJob, jobUrl);
        }
      })
    }
  };

  private abort(paused: boolean): boolean {
    if (this.mURLResolve !== undefined) {
      this.mURLResolve.then(() => {
        this.mURLResolve = Promise.resolve(undefined);
      });
    }
    const functor = paused ? dlib.pauseDownload : dlib.cancelDownload;
    functor(this.mRunningDownload.id).then(() => {
      
    });
    this.mOnAbort?.();
    this.mFinishCB(paused);
    return true;
  }

  private handleError = (err: Error) => {
    this.mApi.showErrorNotification('Download error', err);
  };

  private runExperimentalDownload = (url: string, filePath: string, fileName: string, id: string, destPath: string, options?: IDownloadOptions) => {
      return new Promise(async (resolve, reject) => {
        const tempName = filePath;
        let totalBytesToReceive = 0;
        let finalName = (fileName !== undefined) ? path.join(destPath, path.basename(filePath)) : tempName;
        dlib.enqueueDownload({
          id,
          url,
          destinationPath: destPath,
          fileName: path.basename(finalName),
          nexusApiKey: options.apiKey,
          nexusToken: options.token,
          onCompleted: (id: string) => {
            const downloadRes: IDownloadResult = {
              filePath: finalName,
              headers: {},
              unfinishedChunks: [],
              hadErrors: false,
              size: totalBytesToReceive,
              metaInfo: this.mMetaInfo,
            };
            this.mJob.completionCB?.();
            this.mFinishCB(false, path.basename(finalName));
            this.mRunningDownload.finishCB(downloadRes);
            return resolve(downloadRes);
          },
          onError: (id: string, err) => {
            return reject(err);
          },
          onStart: (id: string, args: { totalBytesToReceive: number, finalFileName: string }) => {
            finalName = args.finalFileName ?? finalName;
            totalBytesToReceive = args.totalBytesToReceive;
            this.mJob?.responseCB?.(totalBytesToReceive, path.basename(finalName), false);
          },
          onProgress: (id: string, progress: { progressPercentage, totalBytesToReceive }) => {
            const { progressPercentage, totalBytesToReceive } = progress;
            const received = (progressPercentage * 0.01) * totalBytesToReceive;
            const bytes = received - this.mPrevBytes;
            this.mProgressCB(bytes);
            this.mPrevBytes = received;
            this.mJob.confirmedReceived = this.mJob.received = received;
            this.mJob.confirmedOffset = this.mJob.offset = received;
            this.mJob.confirmedSize = this.mJob.size = totalBytesToReceive - received;
            this.mJob?.dataCB(received, null);
          },
        });
      });
    }
}
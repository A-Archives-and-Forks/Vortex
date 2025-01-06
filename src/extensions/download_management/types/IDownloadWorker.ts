import { IDownloadJob } from './IDownloadJob';

export interface IDownloadWorker {
  assignJob: (job: IDownloadJob, jobUrl: string) => void;
  cancel: () => void;
  pause: () => void;
  restart: () => void;
  ended: () => boolean;
}
export class DownloadIsHTML extends Error {
  private mUrl: string;
  constructor(inputUrl: string) {
    super('');
    this.name = this.constructor.name;
    this.mUrl = inputUrl;
  }

  public get url() {
    return this.mUrl;
  }
}

export class AlreadyDownloaded extends Error {
  private mFileName: string;
  private mId: string;
  constructor(fileName: string, id?: string) {
    super('File already downloaded');
    Error.captureStackTrace(this, this.constructor);

    this.name = this.constructor.name;
    this.mFileName = fileName;
    this.mId = id;
  }

  public get fileName(): string {
    return this.mFileName;
  }

  public get downloadId() {
    return this.mId;
  }

  public set downloadId(id: string) {
    this.mId = id;
  }
}
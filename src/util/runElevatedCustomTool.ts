// dummy declarations
let toolPath: string;
// tslint:disable-next-line:prefer-const
let toolCWD: string;
// tslint:disable-next-line:prefer-const
let parameters: string[];
// tslint:disable-next-line:prefer-const
let environment: any;

function runElevatedCustomTool(ipcClient, req: NodeRequireFunction): Promise<void> {
  return new Promise((resolve, reject) => {
    const exec = req('child_process').execFile;
    try {
      let params: string[] = [];
      if (parameters !== undefined) {
        params = parameters;
      }

      const execOptions = {
          cwd: toolCWD,
          env: { ...process.env, ...environment },
        };

      toolPath = toolPath.replace(/\\/g, '\\\\');
      ipcClient.emit('log', {
        level: 'info',
        message: 'start tool elevated',
        meta: { toolPath, params },
      });
      exec(toolPath, params, execOptions, (err, output) => {
        // exec will report an error even if it's simply a not-0 exit code
        // which is not something we should react to (when you start from
        // windows explorer or similar you don't get notified of status
        // code != 0 either so it shouldn't be a situation to worry about
        ipcClient.emit('log', {
          level: err ? 'error' : 'info',
          message: 'tool finished',
          meta: err ? { err } : {},
        });
        ipcClient.emit('finished', {});
        resolve();
      });
    } catch (err) {
      ipcClient.emit('log', {
        level: 'error',
        message: 'Elevation Error',
        meta: { err: err.message },
      });
      reject(err);
    }
  });
}

export default runElevatedCustomTool;

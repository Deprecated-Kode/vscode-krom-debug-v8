/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {ChromeDebugAdapter as CoreDebugAdapter, logger, utils as coreUtils, ISourceMapPathOverrides} from 'vscode-chrome-debug-core';
import {spawn, ChildProcess} from 'child_process';

import {ILaunchRequestArgs, IAttachRequestArgs} from './chromeDebugInterfaces';
import * as utils from './utils';

import * as path from 'path';

const DefaultWebsourceMapPathOverrides: ISourceMapPathOverrides = {
    'webpack:///*': '${webRoot}/*',
    'meteor://💻app/*': '${webRoot}/*',
};

function osDir(): string {
    return 'win32';
}

function osExt(): string {
    return '.exe';
}

export class ChromeDebugAdapter extends CoreDebugAdapter {
    private _chromeProc: ChildProcess;

    public launch(args: ILaunchRequestArgs): Promise<void> {
        args.sourceMapPathOverrides = args.sourceMapPathOverrides || DefaultWebsourceMapPathOverrides;
        return super.launch(args).then(() => {
            logger.log('Using Kha from ' + args.kha + '\n');
            // Check exists?
            const kromPath = path.join(args.krom, osDir(), 'Krom' + osExt());
            if (!kromPath) {
                return coreUtils.errP(`Can't find Krom.`);
            }

            // Start with remote debugging enabled
            const port = args.port || 9222;
            const kromArgs: string[] = [path.join(args.cwd, 'build', 'krom'), path.join(args.cwd, 'build', 'krom-resources')];

            logger.log(`spawn('${kromPath}', ${JSON.stringify(kromArgs) })`);
            this._chromeProc = spawn(kromPath, kromArgs, {
                detached: true,
                stdio: ['ignore'],
                cwd: path.join(args.krom, osDir())
            });
            this._chromeProc.unref();
            this._chromeProc.on('error', (err) => {
                const errMsg = 'Krom error: ' + err;
                logger.error(errMsg);
                this.terminateSession(errMsg);
            });

            return this.doAttach(port, 'launchUrl', args.address);
        });
    }

    public attach(args: IAttachRequestArgs): Promise<void> {
        args.sourceMapPathOverrides = args.sourceMapPathOverrides || DefaultWebsourceMapPathOverrides;
        return super.attach(args);
    }

    public disconnect(): void {
        if (this._chromeProc) {
            this._chromeProc.kill('SIGINT');
            this._chromeProc = null;
        }

        return super.disconnect();
    }
}
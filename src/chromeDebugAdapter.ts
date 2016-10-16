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

            let options = {
                from: args.cwd,
                to: path.join(args.cwd, 'build'),
                projectfile: 'khafile.js',
                target: 'krom',
                vr: 'none',
                pch: false,
                intermediate: '',
                graphics: 'direct3d9',
                visualstudio: 'vs2015',
                kha: '',
                haxe: '',
                ogg: '',
                aac: '',
                mp3: '',
                h264: '',
                webm: '',
                wmv: '',
                theora: '',
                kfx: '',
                krafix: '',
                ffmpeg: args.ffmpeg,
                nokrafix: false,
                embedflashassets: false,
                compile: false,
                run: false,
                init: false,
                name: 'Project',
                server: false,
                port: 8080,
                debug: false,
                silent: false,
                watch: false
            };

            require(path.join(args.kha, 'Tools/khamake/out/main.js')).run(options, {
                info: message => {
                    //**this.fireEvent(new OutputEvent(message + '\n', 'stdout'));
                }, error: message => {
                    //**this.fireEvent(new OutputEvent(message + '\n', 'stderr'));
                }
            }).then((value: string) => {
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

                return new Promise<void>((resolve, rejevt) => {
                    resolve();
                });
                //return this.doAttach(port, 'launchUrl', args.address);
            }, (reason) => {
                return coreUtils.errP(`Launch canceled.`);
                /*this.fireEvent(new OutputEvent('Launch canceled.\n', 'stderr'));
                resolve();
                this.fireEvent(new TerminatedEvent());
                this.clearEverything();*/
            });
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
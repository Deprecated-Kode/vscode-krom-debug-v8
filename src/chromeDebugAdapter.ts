/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {ChromeDebugAdapter as CoreDebugAdapter, logger, utils as coreUtils, ISourceMapPathOverrides} from 'vscode-chrome-debug-core';
import {spawn, ChildProcess} from 'child_process';
import Crdp from 'chrome-remote-debug-protocol';
import {DebugProtocol} from 'vscode-debugprotocol';

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
    private static PAGE_PAUSE_MESSAGE = 'Paused in Visual Studio Code';

    private _chromeProc: ChildProcess;
    private _overlayHelper: utils.DebounceHelper;

    public initialize(args: DebugProtocol.InitializeRequestArguments): DebugProtocol.Capabilities {
        this._overlayHelper = new utils.DebounceHelper(/*timeoutMs=*/200);
        return super.initialize(args);
    }

    public launch(args: ILaunchRequestArgs): Promise<void> {
        args.sourceMapPathOverrides = args.sourceMapPathOverrides || DefaultWebsourceMapPathOverrides;
        return super.launch(args).then(() => {
            logger.log('Using Kha from ' + args.kha + '\n', true);

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
                    logger.log(message, true);
                }, error: message => {
                    logger.error(message, true);
                }
            }).then((value: string) => {
                // Check exists?
                const kromPath = path.join(args.krom, osDir(), 'Krom' + osExt());
                if (!kromPath) {
                    return coreUtils.errP(`Can't find Krom.`);
                }

                // Start with remote debugging enabled
                const port = args.port || 9224;
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

                /*return new Promise<void>((resolve, reject) => {
                    resolve();
                });*/
                return this.doAttach(port, 'http://krom', args.address);
            }, (reason) => {
                logger.error('Launch canceled.', true);
                return new Promise<void>((resolve) => {

                });
            });
        });
    }

    public attach(args: IAttachRequestArgs): Promise<void> {
        args.sourceMapPathOverrides = args.sourceMapPathOverrides || DefaultWebsourceMapPathOverrides;
        return super.attach(args);
    }

    protected doAttach(port: number, targetUrl?: string, address?: string, timeout?: number): Promise<void> {
        return super.doAttach(port, targetUrl, address, timeout).then(() => {
            // this.runScript();
        });
    }

    protected onPaused(notification: Crdp.Debugger.PausedEvent): void {
        this._overlayHelper.doAndCancel(() => this.chrome.Page.configureOverlay({ message: ChromeDebugAdapter.PAGE_PAUSE_MESSAGE }).catch(() => { }));
        super.onPaused(notification);
    }

    protected onResumed(): void {
        this._overlayHelper.wait(() => this.chrome.Page.configureOverlay({ }).catch(() => { }));
        super.onResumed();
    }

    public disconnect(): void {
        if (this._chromeProc) {
            this._chromeProc.kill('SIGINT');
            this._chromeProc = null;
        }

        return super.disconnect();
    }

    public runScript(): void {
        let promise = this.chrome.Runtime.compileScript({expression: 'let i = 4;\n while (true) {\n	let a = 3;\n	++a;\n	++i;\n }\n', sourceURL: 'test.js', persistScript: true, executionContextId: 1});
        promise.then(response => {
            this.chrome.Runtime.runScript({scriptId: response.scriptId, executionContextId: 1});
        });
    }
}
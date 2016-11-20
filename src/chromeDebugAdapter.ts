/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {ChromeDebugAdapter as CoreDebugAdapter, logger, utils as coreUtils, ISourceMapPathOverrides} from 'vscode-chrome-debug-core';
import {spawn, ChildProcess} from 'child_process';
import Crdp from 'chrome-remote-debug-protocol';
import {DebugProtocol} from 'vscode-debugprotocol';

import {ILaunchRequestArgs, IAttachRequestArgs} from './chromeDebugInterfaces';
import * as utils from './utils';

import * as os from 'os';
import * as path from 'path';

const DefaultWebSourceMapPathOverrides: ISourceMapPathOverrides = {
    'webpack:///./*': '${webRoot}/*',
    'webpack:///*': '*',
    'meteor://💻app/*': '${webRoot}/*',
};

function osDir(): string {
    if (os.platform() === 'darwin') {
        return path.join('macos', 'Krom.app', 'Contents', 'MacOS');
    } else if (os.platform() === 'win32') {
        return 'win32';
    } else {
        return 'linux';
    }
}

function osExt(): string {
    if (os.platform() === 'darwin') {
        return '';
    } else if (os.platform() === 'win32') {
        return '.exe';
    } else {
        return '';
    }
}

export class ChromeDebugAdapter extends CoreDebugAdapter {
    private static PAGE_PAUSE_MESSAGE = 'Paused in Visual Studio Code';

    private _chromeProc: ChildProcess;
    private _overlayHelper: utils.DebounceHelper;

    private _kha: string;

    public initialize(args: DebugProtocol.InitializeRequestArguments): DebugProtocol.Capabilities {
        this._overlayHelper = new utils.DebounceHelper(/*timeoutMs=*/200);
        return super.initialize(args);
    }

    public launch(args: ILaunchRequestArgs): Promise<void> {
        this._kha = args.kha;
        args.sourceMapPathOverrides = getSourceMapPathOverrides(args.webRoot, args.sourceMapPathOverrides);
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
                watch: true
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
                const port = args.port || Math.floor((Math.random() * 10000) + 10000);
                const kromArgs: string[] = [path.join(args.cwd, 'build', 'krom'), path.join(args.cwd, 'build', 'krom-resources'), '--debug', port.toString(), '--watch'];

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
                require(path.join(this._kha, 'Tools/khamake/out/main.js')).close();
                return new Promise<void>((resolve, reject) => {
                    reject({id: Math.floor(Math.random() * 100000), format: 'Compilation failed.'});
                });
            });
        });
    }

    public attach(args: IAttachRequestArgs): Promise<void> {
        args.sourceMapPathOverrides = getSourceMapPathOverrides(args.webRoot, args.sourceMapPathOverrides);
        return super.attach(args);
    }

    protected doAttach(port: number, targetUrl?: string, address?: string, timeout?: number): Promise<void> {
        return super.doAttach(port, targetUrl, address, timeout).then(() => {
            // this.runScript();
            this.chrome.Log.onEntryAdded(params => this.onEntryAdded(params));
            // this.chrome.Log.enable();
        });
    }

    protected onEntryAdded(event: Crdp.Log.EntryAddedEvent): void {
        logger.log(event.entry.text, true);
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

        require(path.join(this._kha, 'Tools/khamake/out/main.js')).close();

        return super.disconnect();
    }

    public runScript(): void {
        let promise = this.chrome.Runtime.compileScript({expression: 'let i = 4;\n while (true) {\n	let a = 3;\n	++a;\n	++i;\n }\n', sourceURL: 'test.js', persistScript: true, executionContextId: 1});
        promise.then(response => {
            this.chrome.Runtime.runScript({scriptId: response.scriptId, executionContextId: 1});
        });
    }
}

function getSourceMapPathOverrides(webRoot: string, sourceMapPathOverrides?: ISourceMapPathOverrides): ISourceMapPathOverrides {
    return sourceMapPathOverrides ? resolveWebRootPattern(webRoot, sourceMapPathOverrides, /*warnOnMissing=*/true) :
            resolveWebRootPattern(webRoot, DefaultWebSourceMapPathOverrides, /*warnOnMissing=*/false);
}

/**
 * Returns a copy of sourceMapPathOverrides with the ${webRoot} pattern resolved in all entries.
 */
export function resolveWebRootPattern(webRoot: string, sourceMapPathOverrides: ISourceMapPathOverrides, warnOnMissing: boolean): ISourceMapPathOverrides {
    const resolvedOverrides: ISourceMapPathOverrides = {};
    for (let pattern in sourceMapPathOverrides) {
        const replacePattern = sourceMapPathOverrides[pattern];
        resolvedOverrides[pattern] = replacePattern;

        const webRootIndex = replacePattern.indexOf('${webRoot}');
        if (webRootIndex === 0) {
            if (webRoot) {
                resolvedOverrides[pattern] = replacePattern.replace('${webRoot}', webRoot);
            } else if (warnOnMissing) {
                logger.log('Warning: sourceMapPathOverrides entry contains ${webRoot}, but webRoot is not set');
            }
        } else if (webRootIndex > 0) {
            logger.log('Warning: in a sourceMapPathOverrides entry, ${webRoot} is only valid at the beginning of the path');
        }
    }

    return resolvedOverrides;
}

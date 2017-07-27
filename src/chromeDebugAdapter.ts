/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';

import {ChromeDebugAdapter as CoreDebugAdapter, logger, utils as coreUtils, ISourceMapPathOverrides, stoppedEvent} from 'vscode-chrome-debug-core';
import {spawn, ChildProcess, fork, execSync} from 'child_process';
import {Crdp} from 'vscode-chrome-debug-core';
import {DebugProtocol} from 'vscode-debugprotocol';

import {ILaunchRequestArgs, IAttachRequestArgs, ICommonRequestArgs} from './chromeDebugInterfaces';
import * as utils from './utils';

const DefaultWebSourceMapPathOverrides: ISourceMapPathOverrides = {
    'webpack:///./~/*': '${webRoot}/node_modules/*',
    'webpack:///./*': '${webRoot}/*',
    'webpack:///*': '*',
    'webpack:///src/*': '${webRoot}/*',
    'meteor://💻app/*': '${webRoot}/*'
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
    private _chromePID: number;

    private _kha: string;

    public initialize(args: DebugProtocol.InitializeRequestArguments): DebugProtocol.Capabilities {
        this._overlayHelper = new utils.DebounceHelper(/*timeoutMs=*/200);
        const capabilities = super.initialize(args);
        capabilities.supportsRestartRequest = true;

        return capabilities;
    }

    public launch(args: ILaunchRequestArgs): Promise<void> {
        this._kha = args.kha;
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
                watch: true
            };

            require(path.join(args.kha, 'Tools/khamake/out/main.js')).run(options, {
                info: message => {
                    logger.log(message);
                }, error: message => {
                    logger.error(message);
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
                this._chromeProc = this.spawnChrome(kromPath, kromArgs, !!args.runtimeExecutable);
                this._chromeProc.on('error', (err) => {
                    const errMsg = 'Krom error: ' + err;
                    logger.error(errMsg);
                    this.terminateSession(errMsg);
                });

                /*return new Promise<void>((resolve, reject) => {
                    resolve();
                });*/
                return args.noDebug ? undefined :
                    this.doAttach(port, 'http://krom', args.address, args.timeout);
            }, (reason) => {
                logger.error('Launch canceled.');
                require(path.join(this._kha, 'Tools/khamake/out/main.js')).close();
                return new Promise<void>((resolve, reject) => {
                    reject({id: Math.floor(Math.random() * 100000), format: 'Compilation failed.'});
                });
            });
        });
    }

    public attach(args: IAttachRequestArgs): Promise<void> {
        if (args.urlFilter) {
            args.url = args.urlFilter;
        }

        return super.attach(args);
    }

    public commonArgs(args: ICommonRequestArgs): void {
        if (!args.webRoot && args.pathMapping && args.pathMapping['/']) {
            // Adapt pathMapping['/'] as the webRoot when not set, since webRoot is explicitly used in many places
            args.webRoot = args.pathMapping['/'];
        }

        args.sourceMaps = typeof args.sourceMaps === 'undefined' || args.sourceMaps;
        args.sourceMapPathOverrides = getSourceMapPathOverrides(args.webRoot, args.sourceMapPathOverrides);
        args.skipFileRegExps = ['^chrome-extension:.*'];

        super.commonArgs(args);
    }

    protected doAttach(port: number, targetUrl?: string, address?: string, timeout?: number, websocketUrl?: string, extraCRDPChannelPort?: number): Promise<void> {
        return super.doAttach(port, targetUrl, address, timeout, websocketUrl).then(() => {
            // this.runScript();
            this.chrome.Log.onEntryAdded(params => this.onEntryAdded(params));
            // this.chrome.Log.enable();
        });
    }

    protected runConnection(): Promise<void>[] {
        return [...super.runConnection()];//, this.chrome.Page.enable(), this.chrome.Network.enable({})];
    }

    protected onEntryAdded(event: Crdp.Log.EntryAddedEvent): void {
        logger.log(event.entry.text);
    }

    protected onPaused(notification: Crdp.Debugger.PausedEvent, expectingStopReason?: stoppedEvent.ReasonType): void {
        this._overlayHelper.doAndCancel(() => this.chrome.Page.configureOverlay({ message: ChromeDebugAdapter.PAGE_PAUSE_MESSAGE }).catch(() => { }));
        super.onPaused(notification, expectingStopReason);
    }

    protected threadName(): string {
        return 'Chrome';
    }

    protected onResumed(): void {
        this._overlayHelper.wait(() => this.chrome.Page.configureOverlay({ }).catch(() => { }));
        super.onResumed();
    }

    public disconnect(): void {
        const hadTerminated = this._hasTerminated;

        // Disconnect before killing Chrome, because running "taskkill" when it's paused sometimes doesn't kill it
        super.disconnect();

        if (this._chromeProc && !hadTerminated) {
            // Only kill Chrome if the 'disconnect' originated from vscode. If we previously terminated
            // due to Chrome shutting down, or devtools taking over, don't kill Chrome.
            if (coreUtils.getPlatform() === coreUtils.Platform.Windows && this._chromePID) {
                // Run synchronously because this process may be killed before exec() would run
                const taskkillCmd = `taskkill /F /T /PID ${this._chromePID}`;
                logger.log(`Killing Chrome process by pid: ${taskkillCmd}`);
                try {
                    execSync(taskkillCmd);
                } catch (e) {
                    // Can fail if Chrome was already open, and the process with _chromePID is gone.
                    // Or if it already shut down for some reason.
                }
            } else {
                logger.log('Killing Chrome process');
                this._chromeProc.kill('SIGINT');
            }
        }

        require(path.join(this._kha, 'Tools/khamake/out/main.js')).close();

        this._chromeProc = null;
    }

    public runScript(): void {
        let promise = this.chrome.Runtime.compileScript({expression: 'let i = 4;\n while (true) {\n	let a = 3;\n	++a;\n	++i;\n }\n', sourceURL: 'test.js', persistScript: true, executionContextId: 1});
        promise.then(response => {
            this.chrome.Runtime.runScript({scriptId: response.scriptId, executionContextId: 1});
        });
    }

    /**
     * Opt-in event called when the 'reload' button in the debug widget is pressed
     */
    public restart(): Promise<void> {
        return this.chrome.Page.reload({ ignoreCache: true });
    }

    private spawnChrome(chromePath: string, chromeArgs: string[], usingRuntimeExecutable: boolean): ChildProcess {
        if (coreUtils.getPlatform() === coreUtils.Platform.Windows && !usingRuntimeExecutable) {
            const chromeProc = fork(getChromeSpawnHelperPath(), [chromePath, ...chromeArgs], { execArgv: [], silent: true });
            chromeProc.unref();

            chromeProc.on('message', data => {
                const pidStr = data.toString();
                logger.log('got chrome PID: ' + pidStr);
                this._chromePID = parseInt(pidStr, 10);
            });

            chromeProc.on('error', (err) => {
                const errMsg = 'chromeSpawnHelper error: ' + err;
                logger.error(errMsg);
            });

            chromeProc.stderr.on('data', data => {
                logger.error('[chromeSpawnHelper] ' + data.toString());
            });

            chromeProc.stdout.on('data', data => {
                logger.log('[chromeSpawnHelper] ' + data.toString());
            });

            return chromeProc;
        } else {
            logger.log(`spawn('${chromePath}', ${JSON.stringify(chromeArgs) })`);
            const chromeProc = spawn(chromePath, chromeArgs, {
                detached: true,
                stdio: ['ignore'],
            });
            chromeProc.unref();
            return chromeProc;
        }
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

function getChromeSpawnHelperPath(): string {
    if (path.basename(__dirname) === 'src') {
        // For tests
        return path.join(__dirname, '../chromeSpawnHelper.js');
    } else {
        return path.join(__dirname, 'chromeSpawnHelper.js');
    }
}

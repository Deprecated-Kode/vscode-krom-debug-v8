/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as Core from 'vscode-chrome-debug-core';

export interface ILaunchRequestArgs extends Core.ILaunchRequestArgs {
    runtimeArgs?: string[];
    runtimeExecutable?: string;
    file?: string;
    url?: string;
    stopOnEntry?: boolean;
    address?: string;
    port?: number;
    userDataDir?: string;
    kha?: string;
    ffmpeg?: string;
    krom?: string;
    cwd?: string;
}

export interface IAttachRequestArgs extends Core.IAttachRequestArgs {
}
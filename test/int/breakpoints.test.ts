/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
const {createServer} = require('http-server');

import {DebugClient} from 'vscode-debugadapter-testsupport';
import * as ts from 'vscode-chrome-debug-core-testsupport';

import * as testSetup from './testSetup';

suite('Breakpoints', () => {
    const DATA_ROOT = testSetup.DATA_ROOT;

    let dc: ts.ExtendedDebugClient;
    setup(() => {
        return testSetup.setup()
            .then(_dc => dc = _dc);
    });

    let server: any;
    teardown(() => {
        if (server) {
            server.close();
        }

        return testSetup.teardown();
    });

    suite('Column BPs', () => {
        test('Column BP is hit on correct column', async () => {
            const testProjectRoot = path.join(DATA_ROOT, 'columns');
            const scriptPath = path.join(testProjectRoot, 'src/script.ts');

            server = createServer({ root: testProjectRoot });
            server.listen(7890);

            const url = 'http://localhost:7890/index.html';

            const bpLine = 4;
            const bpCol = 16;
            await dc.hitBreakpointUnverified({ url, webRoot: testProjectRoot }, { path: scriptPath, line: bpLine, column: bpCol });
        });

        test('Multiple column BPs are hit on correct columns', async () => {
            const testProjectRoot = path.join(DATA_ROOT, 'columns');
            const scriptPath = path.join(testProjectRoot, 'src/script.ts');

            server = createServer({ root: testProjectRoot });
            server.listen(7890);

            const url = 'http://localhost:7890/index.html';

            const bpLine = 4;
            const bpCol1 = 16;
            const bpCol2 = 24;
            await dc.hitBreakpointUnverified({ url, webRoot: testProjectRoot }, { path: scriptPath, line: bpLine, column: bpCol1 });
            await dc.setBreakpointsRequest({ source: { path: scriptPath }, breakpoints: [{ line: bpLine, column: bpCol2 }] });
            await dc.continueTo('breakpoint', { line: bpLine, column: bpCol2 });
        });

        test('BP col is adjusted to correct col', async () => {
            const testProjectRoot = path.join(DATA_ROOT, 'columns');
            const scriptPath = path.join(testProjectRoot, 'src/script.ts');

            server = createServer({ root: testProjectRoot });
            server.listen(7890);

            const url = 'http://localhost:7890/index.html';

            const bpLine = 4;
            const bpCol1 = 19;
            const correctBpCol1 = 16;
            const expectedLocation = { path: scriptPath, line: bpLine, column: correctBpCol1 };
            await dc.hitBreakpoint(
                { url, webRoot: testProjectRoot },
                { path: scriptPath, line: bpLine, column: bpCol1 },
                expectedLocation,
                expectedLocation);
        });
    });
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';

import {DebugClient} from 'vscode-debugadapter-testsupport';
import {DebugProtocol} from 'vscode-debugprotocol';

import * as testUtils from './testUtils';
import * as testSetup from './testSetup';

const DATA_ROOT = testSetup.DATA_ROOT;
const THREAD_ID = testUtils.THREAD_ID;

suite('Chrome Debug Adapter etc', () => {
    let dc: DebugClient;
    setup(() => {
        return testSetup.setup()
            .then(_dc => dc = _dc);
    });

    teardown(() => {
        return testSetup.teardown();
    });

    suite('basic', () => {
        test('unknown request should produce error', done => {
            dc.send('illegal_request').then(() => {
                done(new Error('does not report error on unknown request'));
            }).catch(() => {
                done();
            });
        });
    });

    suite('initialize', () => {
        test('should return supported features', () => {
            return dc.initializeRequest().then(response => {
                assert.equal(response.body.supportsConfigurationDoneRequest, true);
            });
        });
    });

    suite('launch', () => {
        test('should stop on debugger statement', () => {
            const testProjectRoot = `${path.join(DATA_ROOT, 'intervalDebugger')}`;
            const launchFile = path.join(testProjectRoot, 'index.html');
            const breakFile = path.join(testProjectRoot, 'app.js');
            const DEBUGGER_LINE = 2;

            return Promise.all([
                dc.configurationSequence(),
                dc.launch({ file: launchFile }),
                dc.assertStoppedLocation('debugger statement', { path: breakFile, line: DEBUGGER_LINE } )
            ]);
        });
    });
});
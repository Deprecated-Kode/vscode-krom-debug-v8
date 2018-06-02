# Krom debug extension

A VS Code extension to debug Krom applications. Actual debugging is not yet working though.

## Launch
Specify appDir to point to a Krom application, optionally specify resourcesDir for shader hot-reloading in Kha applications.
```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "krom",
            "request": "launch",
            "name": "Launch Krom",
            "appDir": "${workspaceFolder}/build/krom",
			"resourcesDir": "${workspaceFolder}/build/krom-resources",
            "sourceMaps": true
        }
    ]
}
```

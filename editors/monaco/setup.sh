#!/bin/sh

# This file is to setup the dev environment for monaco-editor UI.
# Normal users don't have to execute.

npm install
cp -rf node_modules/monaco-editor/min/vs .
rm -rf node_modules

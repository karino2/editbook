#!/bin/bash
set -ev

if [ "${TEST_FOR_SERVER}" = "true" ]; then
    go build
elif [ "${TEST_FOR_CLIENT}" = "true" ]; then
    cd editors/monaco/
    yarn install
    yarn run lint
else
    echo 'This code path is run unexpectedly' 1>&2
    exit 1
fi

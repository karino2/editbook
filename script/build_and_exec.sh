#!/bin/sh

# for docker


cd `dirname $0`/../ && go build && ./editbook "$@"

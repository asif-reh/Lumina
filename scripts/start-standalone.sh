#!/bin/sh
# Docker injects HOSTNAME as the container id. Next's standalone server treats
# HOSTNAME as the bind address, so force every interface. PORT is left to the host.
export HOSTNAME=0.0.0.0
exec node server.js

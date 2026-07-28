#!/usr/bin/env bash

# GitHub's Linux Docker runner can publish a port through iptables without a
# userspace listener visible to lsof. The Phase 7 smoke uses this fixture only
# on that platform-specific path to exercise preflight's conflict response.
exit 0

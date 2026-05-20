#!/bin/bash
# 包装脚本：在运行 electron 之前取消 ELECTRON_RUN_AS_NODE 环境变量
# 这个变量会导致 Electron 以 Node.js 模式运行，而不是主进程模式

unset ELECTRON_RUN_AS_NODE 2>/dev/null
npx electron .

#!/usr/bin/env bash
# adb 无线调试会不定时掉线，这里包一层自动重连。
#
# 用法：
#   FOLIO_ADB_TARGET=192.168.1.4:39660 tools/_adb.sh shell input tap 100 200
#
# 设备地址必须由环境变量给出：每台机器的无线调试端口都不一样，
# 而且手机重启后会换端口，写死在脚本里没有意义。
set -u
target="${FOLIO_ADB_TARGET:-}"

if [ -z "$target" ]; then
  echo "需要设置 FOLIO_ADB_TARGET=<手机IP>:<无线调试端口>" >&2
  exit 2
fi

for attempt in 1 2 3 4 5; do
  adb connect "$target" >/dev/null 2>&1
  if adb -s "$target" shell true >/dev/null 2>&1; then
    adb -s "$target" "$@"
    exit $?
  fi
  sleep 1
done

echo "adb 连不上 $target" >&2
exit 1

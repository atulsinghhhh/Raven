#!/bin/bash
# Launch the harness app so a NEW Flutter process really starts.
#
# `am start` alone returned START_TASK_TO_FRONT: the task record survived
# force-stop, so Android resumed the existing task and main() never ran —
# which is what invalidated the earlier viewer runs. -S force-stops the
# target first and --activity-clear-task drops the stale task record, and
# we then *verify* by waiting for the app's own first log line rather than
# trusting the launch result.
DEV=$1
PKG=com.example.pubdev_consumer
for attempt in 1 2 3; do
  adb -s "$DEV" shell am force-stop $PKG >/dev/null 2>&1
  adb -s "$DEV" logcat -c >/dev/null 2>&1
  adb -s "$DEV" shell am start -S -W \
      --activity-clear-task -n $PKG/.MainActivity >/dev/null 2>&1
  for _ in $(seq 1 20); do
    if adb -s "$DEV" logcat -d 2>/dev/null | grep -q '"phase":"booting"'; then
      echo "launched $DEV (attempt $attempt)"
      exit 0
    fi
    sleep 1
  done
done
echo "FAILED to start a fresh process on $DEV"
exit 1

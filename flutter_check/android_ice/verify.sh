#!/bin/bash
# $1 = label (baseline|fixed), $2 = runs
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
REPO="/Users/enfecatulsingh/Desktop/untitled folder/ideas/webrtrc"
cd "$REPO"; set -a; . ./test/.env; set +a
LABEL=$1; START=${2:-1}; END=${3:-5}; VIEWER=${4:-1}
for i in $(seq $START $END); do
  node -e '
   const fs=require("fs");
   const API=process.env.RAVEN_API_URL,KEY=process.env.RAVEN_API_KEY;
   const api=async(m,p,b)=>{const r=await fetch(API+p,{method:m,headers:{Authorization:"Bearer "+KEY,"Content-Type":"application/json"},body:b?JSON.stringify(b):undefined});const t=await r.text();if(!r.ok)throw new Error(m+" "+p+" "+r.status+" "+t.slice(0,120));return JSON.parse(t)};
   (async()=>{
     for(const s of (await api("GET","/v1/live-streams?limit=50")).filter(x=>x.status==="LIVE")) await api("POST",`/v1/live-streams/${s.id}/end`,{}).catch(()=>{});
     const s=await api("POST","/v1/live-streams",{title:"vrfy-"+Date.now(),hostIdentity:"v-host"});
     await api("POST",`/v1/live-streams/${s.id}/start`,{});
     const hc=await api("POST",`/v1/live-streams/${s.id}/hosts`,{identity:"v-host"});
     const vc=await api("POST",`/v1/live-streams/${s.id}/viewer-tokens`,{identity:"v-viewer"});
     const rid=JSON.parse(Buffer.from(hc.rtc.token.split(".")[1],"base64url").toString()).rid;
     fs.writeFileSync("/tmp/v_host.json",JSON.stringify(hc));
     fs.writeFileSync("/tmp/v_view.json",JSON.stringify(vc));
     fs.writeFileSync("/tmp/v_meta.json",JSON.stringify({streamId:s.id,roomId:rid}));
   })()'
  SID=$(node -e 'console.log(require("/tmp/v_meta.json").streamId)')
  ROOM=$(node -e 'console.log(require("/tmp/v_meta.json").roomId)')

  cd /tmp/pubdev_consumer
  flutter build apk --debug -t lib/main_android_live.dart --dart-define=CREDS="$(cat /tmp/v_host.json)" >/dev/null 2>&1
  adb -s emulator-5554 install -r build/app/outputs/flutter-apk/app-debug.apk >/dev/null 2>&1
  flutter build apk --debug -t lib/main_android_live.dart --dart-define=CREDS="$(cat /tmp/v_view.json)" >/dev/null 2>&1
  adb -s emulator-5556 install -r build/app/outputs/flutter-apk/app-debug.apk >/dev/null 2>&1
  for d in emulator-5554 emulator-5556; do
    adb -s $d shell pm grant com.example.pubdev_consumer android.permission.CAMERA >/dev/null 2>&1
    adb -s $d shell pm grant com.example.pubdev_consumer android.permission.RECORD_AUDIO >/dev/null 2>&1
  done

  T0=$(date -u +%H:%M:%S)
  /tmp/launch.sh emulator-5554 >> /tmp/launch.log 2>&1 || echo "HOST LAUNCH FAILED" >> /tmp/verify_results.txt
  sleep 12
  if [ "$VIEWER" = "1" ]; then
    /tmp/launch.sh emulator-5556 >> /tmp/launch.log 2>&1 || echo "VIEWER LAUNCH FAILED" >> /tmp/verify_results.txt
  fi
  sleep 48
  T1=$(date -u +%H:%M:%S)

  cd "$REPO"
  HM=$(adb -s emulator-5554 logcat -d 2>/dev/null | grep LIVETEST | grep -o '"media":"[a-z]*"' | tail -1 | cut -d'"' -f4)
  VT=$(adb -s emulator-5556 logcat -d 2>/dev/null | grep -o '"remoteVideoTrack":{[^}]*}' | tail -1)
  RESTART=$(adb -s emulator-5554 logcat -d 2>/dev/null | grep -c "attempting one ICE restart")
  DRAIN=$(adb -s emulator-5554 logcat -d 2>/dev/null | grep -oE "draining [0-9]+ buffered" | tail -1)
  SEL=$(adb -s emulator-5554 logcat -d 2>/dev/null | grep "New selected connection" | tail -1 | grep -oE "(host|srflx|relay):udp[^ ]*->[^ ]*" | head -1)
  SRV=$(node -e '
   const API=process.env.RAVEN_API_URL,KEY=process.env.RAVEN_API_KEY;const room=process.argv[1];
   const api=async(p)=>{const r=await fetch(API+p,{headers:{Authorization:"Bearer "+KEY}});const t=await r.text();return r.ok?JSON.parse(t):null};
   (async()=>{const ps=await api(`/v1/rooms/${room}/participants`);
    console.log(Array.isArray(ps)?ps.map(p=>`${p.identity}:${p.tracks.length}tr`).join(","):"null");})()' "$ROOM")
  VM=$(adb -s emulator-5556 logcat -d 2>/dev/null | grep LIVETEST | grep -o '"media":"[a-z]*"' | tail -1 | cut -d'"' -f4)
  PROBE=$(adb -s emulator-5556 logcat -d 2>/dev/null | grep -oE '"probeHasSrcObject":(true|false),"probeWidth":[0-9]+,"probeHeight":[0-9]+' | tail -1)
  VDRAIN=$(adb -s emulator-5556 logcat -d 2>/dev/null | grep -oE "draining [0-9]+ buffered" | tail -1)
  echo "[$LABEL $i] $T0->$T1 host=${HM:-none} viewer=${VM:-n/a} sfu=[$SRV] hostDrain=${DRAIN:-none} viewerDrain=${VDRAIN:-none} iceRestarts=$RESTART ${PROBE:-probe=none} $VT stream=$SID room=$ROOM" >> /tmp/verify_results.txt
  adb -s emulator-5554 logcat -d > /tmp/logs/$LABEL-$i-host.log 2>/dev/null
  adb -s emulator-5556 logcat -d > /tmp/logs/$LABEL-$i-view.log 2>/dev/null
done
echo "${LABEL}_DONE" >> /tmp/verify_results.txt

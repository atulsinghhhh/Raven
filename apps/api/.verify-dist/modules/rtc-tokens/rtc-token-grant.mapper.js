"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toLiveKitGrant = toLiveKitGrant;
exports.fromLiveKitGrant = fromLiveKitGrant;
const livekit_server_sdk_1 = require("livekit-server-sdk");
const rtc_token_permissions_dto_1 = require("./dto/rtc-token-permissions.dto");
function toLiveKitGrant(roomName, permissions) {
    const grant = {
        room: roomName,
        roomJoin: permissions.join ?? false,
        canSubscribe: permissions.subscribe ?? false,
        canPublish: permissions.publish ?? false,
        canPublishData: permissions.publishData ?? false,
    };
    if (grant.canPublish) {
        const sources = [];
        if (permissions.publishAudio)
            sources.push(livekit_server_sdk_1.TrackSource.MICROPHONE);
        if (permissions.publishVideo)
            sources.push(livekit_server_sdk_1.TrackSource.CAMERA);
        if (sources.length > 0) {
            grant.canPublishSources = sources;
        }
    }
    return grant;
}
function fromLiveKitGrant(grant) {
    const permissions = new rtc_token_permissions_dto_1.RtcTokenPermissionsDto();
    permissions.join = grant.roomJoin ?? false;
    permissions.subscribe = grant.canSubscribe ?? false;
    permissions.publish = grant.canPublish ?? false;
    permissions.publishData = grant.canPublishData ?? false;
    const sources = grant.canPublishSources ?? [];
    const allSourcesAllowed = permissions.publish && sources.length === 0;
    permissions.publishAudio = allSourcesAllowed || sources.includes(livekit_server_sdk_1.TrackSource.MICROPHONE);
    permissions.publishVideo = allSourcesAllowed || sources.includes(livekit_server_sdk_1.TrackSource.CAMERA);
    return permissions;
}
//# sourceMappingURL=rtc-token-grant.mapper.js.map
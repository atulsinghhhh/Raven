"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.presignS3Url = presignS3Url;
const crypto_1 = require("crypto");
function presignS3Url(input) {
    const now = input.now ?? new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const { host, basePath } = resolveHost(input);
    const canonicalUri = `${basePath}/${encodeS3Key(input.key)}`;
    const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;
    const query = {
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${input.accessKeyId}/${credentialScope}`,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': String(input.expiresInSeconds),
        'X-Amz-SignedHeaders': 'host',
    };
    if (input.contentType) {
        query['response-content-type'] = input.contentType;
    }
    const canonicalQueryString = Object.keys(query)
        .sort()
        .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(query[key])}`)
        .join('&');
    const canonicalRequest = [
        input.method,
        canonicalUri,
        canonicalQueryString,
        `host:${host}\n`,
        'host',
        'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = hmac(signingKey(input.secretAccessKey, dateStamp, input.region), stringToSign).toString('hex');
    const origin = new URL(input.endpoint);
    return `${origin.protocol}//${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}
function resolveHost(input) {
    const endpoint = new URL(input.endpoint);
    if (input.forcePathStyle) {
        return { host: endpoint.host, basePath: `/${encodeRfc3986(input.bucket)}` };
    }
    return { host: `${input.bucket}.${endpoint.host}`, basePath: '' };
}
function encodeS3Key(key) {
    return key.split('/').map(encodeRfc3986).join('/');
}
function encodeRfc3986(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
function signingKey(secretAccessKey, dateStamp, region) {
    const dateKey = hmac(Buffer.from(`AWS4${secretAccessKey}`, 'utf8'), dateStamp);
    const regionKey = hmac(dateKey, region);
    const serviceKey = hmac(regionKey, 's3');
    return hmac(serviceKey, 'aws4_request');
}
function hmac(key, data) {
    return (0, crypto_1.createHmac)('sha256', key).update(data, 'utf8').digest();
}
function sha256Hex(data) {
    return (0, crypto_1.createHash)('sha256').update(data, 'utf8').digest('hex');
}
function toAmzDate(date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}
//# sourceMappingURL=s3-presign.util.js.map
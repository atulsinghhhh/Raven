"""Minimal TURN Allocate over the long-term credential mechanism (RFC 5766).

Proves coturn accepts a credential minted by Livqeno's generateTurnCredential():
  username = "<unix-expiry>:<identity>"
  password = base64(HMAC-SHA1(TURN_SECRET, username))
which is coturn's `use-auth-secret` REST scheme.
"""
import hashlib, hmac, os, socket, struct, sys

HOST, PORT = sys.argv[1], int(sys.argv[2])
USER, PASSWD = sys.argv[3], sys.argv[4]
MAGIC = 0x2112A442

ALLOCATE, ALLOC_OK, ALLOC_ERR = 0x0003, 0x0103, 0x0113
A_USERNAME, A_MSGINT, A_ERRCODE = 0x0006, 0x0008, 0x0009
A_REALM, A_NONCE, A_XOR_RELAYED = 0x0014, 0x0015, 0x0016
A_REQ_TRANSPORT = 0x0019


def pad(b):
    return b + b"\x00" * ((4 - len(b) % 4) % 4)


def attr(t, v):
    return struct.pack("!HH", t, len(v)) + pad(v)


def parse(data):
    mtype, mlen = struct.unpack("!HH", data[:4])
    out, off = {}, 20
    while off < 20 + mlen:
        at, al = struct.unpack("!HH", data[off:off + 4])
        out[at] = data[off + 4:off + 4 + al]
        off += 4 + al + ((4 - al % 4) % 4)
    return mtype, out


def build(txid, attrs, key=None):
    body = b"".join(attrs)
    if key is None:
        return struct.pack("!HHI12s", ALLOCATE, len(body), MAGIC, txid) + body
    # MESSAGE-INTEGRITY is computed over the message with the length field
    # already counting the 24-byte integrity attribute itself.
    hdr = struct.pack("!HHI12s", ALLOCATE, len(body) + 24, MAGIC, txid)
    mac = hmac.new(key, hdr + body, hashlib.sha1).digest()
    return hdr + body + attr(A_MSGINT, mac)


s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(8)

# --- 1. unauthenticated Allocate: expect 401 with realm + nonce ----------
txid = os.urandom(12)
req = build(txid, [attr(A_REQ_TRANSPORT, struct.pack("!BBH", 17, 0, 0))])
s.sendto(req, (HOST, PORT))
try:
    data, _ = s.recvfrom(2048)
except socket.timeout:
    print("FAIL: no response to unauthenticated Allocate")
    sys.exit(1)

mtype, at = parse(data)
if mtype != ALLOC_ERR:
    print(f"FAIL: expected 401 error response, got 0x{mtype:04x}")
    sys.exit(1)
code = at.get(A_ERRCODE, b"\x00" * 4)
errno_ = code[2] * 100 + code[3]
realm = at.get(A_REALM, b"").decode(errors="replace")
nonce = at.get(A_NONCE, b"")
print(f"step 1: unauthenticated Allocate -> {errno_} (expected 401), realm={realm!r}")
if errno_ != 401:
    print(f"FAIL: expected 401, got {errno_}")
    sys.exit(1)

# --- 2. authenticated Allocate with Livqeno's credential -------------------
key = hashlib.md5(f"{USER}:{realm}:{PASSWD}".encode()).digest()
txid = os.urandom(12)
req = build(txid, [
    attr(A_REQ_TRANSPORT, struct.pack("!BBH", 17, 0, 0)),
    attr(A_USERNAME, USER.encode()),
    attr(A_REALM, realm.encode()),
    attr(A_NONCE, nonce),
], key=key)
s.sendto(req, (HOST, PORT))
try:
    data, _ = s.recvfrom(2048)
except socket.timeout:
    print("FAIL: no response to authenticated Allocate")
    sys.exit(1)

mtype, at = parse(data)
if mtype == ALLOC_OK:
    relayed = at.get(A_XOR_RELAYED)
    if relayed:
        rport = struct.unpack("!H", relayed[2:4])[0] ^ (MAGIC >> 16)
        rip = struct.unpack("!I", relayed[4:8])[0] ^ MAGIC
        ip = socket.inet_ntoa(struct.pack("!I", rip))
        print(f"step 2: authenticated Allocate -> SUCCESS")
        print(f"        XOR-RELAYED-ADDRESS = {ip}:{rport}")
        private = ip.startswith(("10.", "192.168.")) or ip.startswith("172.")
        print(f"        relay address is {'PRIVATE (external-ip misconfigured!)' if private else 'PUBLIC (external-ip correct)'}")
        print("PASS: coturn validated a credential minted by Livqeno's generateTurnCredential()")
        sys.exit(0 if not private else 1)
    print("PASS (allocated, but no XOR-RELAYED-ADDRESS attribute)")
    sys.exit(0)

code = at.get(A_ERRCODE, b"\x00" * 4)
errno_ = code[2] * 100 + code[3]
reason = code[4:].decode(errors="replace")
print(f"step 2: authenticated Allocate -> {errno_} {reason}")
print("FAIL: coturn rejected Livqeno's credential — shared secret mismatch?")
sys.exit(1)

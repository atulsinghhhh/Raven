import socket, struct, os, sys

host, port = sys.argv[1], int(sys.argv[2])
MAGIC = 0x2112A442
txid = os.urandom(12)
# STUN Binding Request: type=0x0001, length=0
req = struct.pack('!HHI12s', 0x0001, 0, MAGIC, txid)

s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(8)
s.sendto(req, (host, port))
try:
    data, addr = s.recvfrom(2048)
except socket.timeout:
    print("FAIL: no STUN response (timeout)")
    sys.exit(1)

mtype, mlen, magic, rtxid = struct.unpack('!HHI12s', data[:20])
if mtype != 0x0101:
    print(f"FAIL: not a Binding Success Response (type=0x{mtype:04x})")
    sys.exit(1)
if rtxid != txid:
    print("FAIL: transaction id mismatch")
    sys.exit(1)

# Walk attributes for XOR-MAPPED-ADDRESS (0x0020)
off, mapped = 20, None
while off < 20 + mlen:
    atype, alen = struct.unpack('!HH', data[off:off+4])
    val = data[off+4:off+4+alen]
    if atype == 0x0020:
        xport = struct.unpack('!H', val[2:4])[0] ^ (MAGIC >> 16)
        xip = struct.unpack('!I', val[4:8])[0] ^ MAGIC
        mapped = (socket.inet_ntoa(struct.pack('!I', xip)), xport)
    off += 4 + alen + ((4 - alen % 4) % 4)

print(f"PASS: STUN Binding Success from {addr[0]}:{addr[1]}")
print(f"      XOR-MAPPED-ADDRESS = {mapped[0]}:{mapped[1]}" if mapped else "      (no XOR-MAPPED-ADDRESS)")

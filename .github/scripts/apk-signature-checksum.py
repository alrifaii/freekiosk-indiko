#!/usr/bin/env python3
"""Signature checksum of an APK for the Android provisioning QR code.

Prints base64url(SHA-256 of the signing certificate), the value Android expects in
PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM. It is the same for every build signed with
the same key. Reads the APK signing block (v3, else v2) directly, so it needs neither
Java nor the Android build tools.

    python3 apk-signature-checksum.py FreeKiosk.apk
"""
import base64
import hashlib
import struct
import sys

V2, V3 = 0x7109871A, 0xF05368C0


def signer_cert(data: bytes) -> bytes:
    # End of central directory: the last "PK\5\6" within the last 64 KB + 22 bytes
    eocd = data.rfind(b"PK\x05\x06", max(0, len(data) - 65557))
    if eocd < 0:
        raise ValueError("not a ZIP/APK file")
    cd_offset = struct.unpack_from("<I", data, eocd + 16)[0]
    if data[cd_offset - 16:cd_offset] != b"APK Sig Block 42":
        raise ValueError("no APK signing block (only v1 signed?)")
    size = struct.unpack_from("<Q", data, cd_offset - 24)[0]
    start = cd_offset - size - 8
    if struct.unpack_from("<Q", data, start)[0] != size:
        raise ValueError("broken APK signing block")
    blocks, p = {}, start + 8
    while p < cd_offset - 24:
        length, block_id = struct.unpack_from("<QI", data, p)
        blocks[block_id] = (p + 12, length - 4)
        p += 8 + length
    off, _ = blocks.get(V3) or blocks.get(V2) or (None, None)
    if off is None:
        raise ValueError("no v2/v3 signature")

    def lp(o):  # length-prefixed field: (start of content, length)
        return o + 4, struct.unpack_from("<I", data, o)[0]

    signers, _ = lp(off)              # sequence of signers
    signer, _ = lp(signers)           # first signer
    signed_data, _ = lp(signer)       # signed data
    digests, digests_len = lp(signed_data)
    certs, _ = lp(digests + digests_len)
    cert, cert_len = lp(certs)        # first certificate (DER)
    return data[cert:cert + cert_len]


def main() -> None:
    with open(sys.argv[1], "rb") as f:
        der = signer_cert(f.read())
    digest = hashlib.sha256(der).digest()
    print(base64.urlsafe_b64encode(digest).decode().rstrip("="))


if __name__ == "__main__":
    main()

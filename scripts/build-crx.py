#!/usr/bin/env python3
"""
Build a CRX3 package signed with an RSA private key.

    build-crx.py --key private.pem --zip extension.zip --out extension.crx

Only the standard library plus the `openssl` binary are used, so it runs
unchanged on a GitHub runner and on a developer machine. The output carries a
single sha256_with_rsa proof from the given key, which is what the Chrome Web
Store's Verified CRX Uploads checks before re-signing with the item key.
"""

import argparse
import hashlib
import struct
import subprocess
import sys
import tempfile


def varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def field(number: int, payload: bytes) -> bytes:
    return varint((number << 3) | 2) + varint(len(payload)) + payload


def public_key_der(private_key_path: str) -> bytes:
    return subprocess.run(
        ["openssl", "rsa", "-in", private_key_path, "-pubout", "-outform", "DER"],
        check=True, capture_output=True,
    ).stdout


def sign(private_key_path: str, data: bytes) -> bytes:
    with tempfile.NamedTemporaryFile() as f:
        f.write(data)
        f.flush()
        return subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", private_key_path, f.name],
            check=True, capture_output=True,
        ).stdout


def build(private_key_path: str, zip_bytes: bytes) -> bytes:
    pub = public_key_der(private_key_path)
    crx_id = hashlib.sha256(pub).digest()[:16]
    signed_header_data = field(1, crx_id)                       # SignedData.crx_id

    to_sign = (b"CRX3 SignedData\x00"
               + struct.pack("<I", len(signed_header_data))
               + signed_header_data
               + zip_bytes)
    signature = sign(private_key_path, to_sign)

    proof = field(1, pub) + field(2, signature)                 # AsymmetricKeyProof
    header = field(2, proof) + field(10000, signed_header_data)  # CrxFileHeader

    return b"Cr24" + struct.pack("<II", 3, len(header)) + header + zip_bytes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--key", required=True, help="RSA private key (PEM)")
    ap.add_argument("--zip", required=True, help="zip of the extension root (manifest.json at top level)")
    ap.add_argument("--out", required=True, help="output .crx path")
    args = ap.parse_args()

    with open(args.zip, "rb") as f:
        zip_bytes = f.read()
    crx = build(args.key, zip_bytes)
    with open(args.out, "wb") as f:
        f.write(crx)

    pub = public_key_der(args.key)
    ext_id = "".join(chr(ord("a") + int(c, 16)) for c in hashlib.sha256(pub).hexdigest()[:32])
    print(f"wrote {args.out} ({len(crx)} bytes), signing-key id {ext_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

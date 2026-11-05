package com.freekiosk.speech;

import java.io.IOException;
import java.io.InputStream;

/**
 * Decompresses a .bz2 stream (also several streams one after another, as pbzip2 writes).
 *
 * The offline voices come as .tar.bz2 archives and Android has no bzip2 decoder. A
 * library would pull in a dozen optional dependencies that R8 then trips over, so this
 * is a small, plain decoder after the bzip2 format description: Huffman and MTF/RLE2
 * decoding, inverse Burrows-Wheeler transform, RLE1, with the block CRC checked so a
 * broken download fails instead of yielding a broken voice.
 */
public final class Bzip2InputStream extends InputStream {
    private static final int MAX_GROUPS = 6;
    private static final int MAX_ALPHA = 258;
    private static final int MAX_CODE_LEN = 23;
    private static final int GROUP_SIZE = 50;
    private static final int MAX_SELECTORS = 18002;
    private static final int[] CRC_TABLE = new int[256];

    static {
        for (int i = 0; i < 256; i++) {
            int c = i << 24;
            for (int k = 0; k < 8; k++) c = (c & 0x80000000) != 0 ? (c << 1) ^ 0x04c11db7 : c << 1;
            CRC_TABLE[i] = c;
        }
    }

    private final InputStream in;
    private final byte[] inBuf = new byte[65536];
    private int inPos, inLen;
    private long bitBuf;
    private int bitCount;

    private int blockSize100k;
    private int[] tt;
    private boolean streamEnd = true; // true: next thing to read is a stream header
    private boolean eof;

    // Output state of the current block
    private int tPos, nblock, used;
    private int lastByte = -1, runLength, repeat;
    private int blockCrc, expectedBlockCrc;
    private boolean blockActive;

    private final byte[] one = new byte[1];

    public Bzip2InputStream(InputStream in) throws IOException {
        this.in = in;
        if (!readStreamHeader(true)) throw new IOException("Not a bzip2 stream");
    }

    // ---------------------------------------------------------------- bits

    private int readByteRaw() throws IOException {
        if (inPos == inLen) {
            inLen = in.read(inBuf, 0, inBuf.length);
            inPos = 0;
            if (inLen <= 0) { inLen = 0; return -1; }
        }
        return inBuf[inPos++] & 0xff;
    }

    private int bits(int n) throws IOException {
        while (bitCount < n) {
            int b = readByteRaw();
            if (b < 0) throw new IOException("Unexpected end of bzip2 data");
            bitBuf = (bitBuf << 8) | b;
            bitCount += 8;
        }
        bitCount -= n;
        return (int) ((bitBuf >>> bitCount) & ((1L << n) - 1));
    }

    private int bit() throws IOException { return bits(1); }

    private void alignToByte() { bitCount -= bitCount % 8; }

    // ---------------------------------------------------------------- stream and blocks

    /** Reads "BZh1".."BZh9". Returns false at a clean end of input (only allowed after a stream). */
    private boolean readStreamHeader(boolean first) throws IOException {
        alignToByte();
        int b = bitCount >= 8 ? bits(8) : readByteRaw();
        if (b < 0) {
            if (first) throw new IOException("Empty input");
            return false;
        }
        int z = bits(8), h = bits(8), level = bits(8);
        if (b != 'B' || z != 'Z' || h != 'h' || level < '1' || level > '9') {
            if (first) throw new IOException("Not a bzip2 stream");
            // Trailing garbage after a complete stream: stop like bzip2 does
            return false;
        }
        blockSize100k = level - '0';
        if (tt == null || tt.length < blockSize100k * 100000) tt = new int[blockSize100k * 100000];
        streamEnd = false;
        return true;
    }

    /** Starts the next block; false when the stream (and every following stream) has ended. */
    private boolean nextBlock() throws IOException {
        while (true) {
            if (streamEnd) {
                if (!readStreamHeader(false)) return false;
            }
            long magic = ((long) bits(24) << 24) | bits(24);
            if (magic == 0x177245385090L) {
                bits(32); // combined CRC; every block CRC is checked already
                streamEnd = true;
                continue;
            }
            if (magic != 0x314159265359L) throw new IOException("Bad bzip2 block header");
            expectedBlockCrc = bits(32);
            if (bit() != 0) throw new IOException("Randomised bzip2 blocks are not supported");
            int origPtr = bits(24);
            decodeBlock(origPtr);
            return true;
        }
    }

    private void decodeBlock(int origPtr) throws IOException {
        // Symbol map
        boolean[] inUse = new boolean[256];
        int groupsUsed = bits(16);
        for (int i = 0; i < 16; i++) {
            if ((groupsUsed & (0x8000 >>> i)) != 0) {
                int w = bits(16);
                for (int j = 0; j < 16; j++) if ((w & (0x8000 >>> j)) != 0) inUse[i * 16 + j] = true;
            }
        }
        byte[] seqToUnseq = new byte[256];
        int numInUse = 0;
        for (int i = 0; i < 256; i++) if (inUse[i]) seqToUnseq[numInUse++] = (byte) i;
        if (numInUse == 0) throw new IOException("Empty bzip2 symbol map");
        int alphaSize = numInUse + 2;

        int nGroups = bits(3);
        if (nGroups < 2 || nGroups > MAX_GROUPS) throw new IOException("Bad bzip2 group count");
        int nSelectors = bits(15);
        if (nSelectors < 1) throw new IOException("Bad bzip2 selector count");

        // Selectors, MTF coded
        byte[] pos = new byte[MAX_GROUPS];
        for (int i = 0; i < nGroups; i++) pos[i] = (byte) i;
        byte[] selector = new byte[Math.min(nSelectors, MAX_SELECTORS)];
        for (int i = 0; i < nSelectors; i++) {
            int j = 0;
            while (bit() == 1) {
                j++;
                if (j >= nGroups) throw new IOException("Bad bzip2 selector");
            }
            byte v = pos[j];
            for (; j > 0; j--) pos[j] = pos[j - 1];
            pos[0] = v;
            if (i < MAX_SELECTORS) selector[i] = v;
        }
        if (nSelectors > MAX_SELECTORS) nSelectors = MAX_SELECTORS;

        // Code lengths and decode tables
        int[][] limit = new int[nGroups][MAX_CODE_LEN];
        int[][] base = new int[nGroups][MAX_CODE_LEN];
        int[][] perm = new int[nGroups][MAX_ALPHA];
        int[] minLens = new int[nGroups];
        int[] len = new int[MAX_ALPHA];
        for (int t = 0; t < nGroups; t++) {
            int curr = bits(5);
            int minLen = 32, maxLen = 0;
            for (int i = 0; i < alphaSize; i++) {
                while (true) {
                    if (curr < 1 || curr > 20) throw new IOException("Bad bzip2 code length");
                    if (bit() == 0) break;
                    if (bit() == 0) curr++; else curr--;
                }
                len[i] = curr;
                if (curr < minLen) minLen = curr;
                if (curr > maxLen) maxLen = curr;
            }
            createDecodeTables(limit[t], base[t], perm[t], len, minLen, maxLen, alphaSize);
            minLens[t] = minLen;
        }

        // MTF values, RLE2 runs, end of block
        int eob = numInUse + 1;
        int limitBlock = blockSize100k * 100000;
        int[] unzftab = new int[256];
        byte[] mtf = new byte[256];
        for (int i = 0; i < 256; i++) mtf[i] = (byte) i;
        int groupNo = -1, groupPos = 0;
        int count = 0;
        int[] gLimit = null, gBase = null, gPerm = null;
        int gMinLen = 0;
        int runAcc = 0, runN = 1;
        boolean inRun = false;

        while (true) {
            if (groupPos == 0) {
                groupNo++;
                if (groupNo >= nSelectors) throw new IOException("bzip2 selectors exhausted");
                groupPos = GROUP_SIZE;
                int g = selector[groupNo];
                gLimit = limit[g]; gBase = base[g]; gPerm = perm[g]; gMinLen = minLens[g];
            }
            groupPos--;
            int zn = gMinLen;
            int zvec = bits(zn);
            while (zn < 20 && zvec > gLimit[zn]) {
                zn++;
                zvec = (zvec << 1) | bit();
            }
            if (zvec > gLimit[zn]) throw new IOException("Bad bzip2 Huffman code");
            int idx = zvec - gBase[zn];
            if (idx < 0 || idx >= MAX_ALPHA) throw new IOException("Bad bzip2 Huffman code");
            int sym = gPerm[idx];

            if (sym == 0 || sym == 1) { // RUNA, RUNB
                if (!inRun) { inRun = true; runAcc = 0; runN = 1; }
                runAcc += (sym + 1) * runN;
                runN <<= 1;
                if (runAcc > limitBlock) throw new IOException("bzip2 run too long");
                continue;
            }
            if (inRun) {
                inRun = false;
                if (count + runAcc > limitBlock) throw new IOException("bzip2 block too large");
                int uc = seqToUnseq[mtf[0] & 0xff] & 0xff;
                unzftab[uc] += runAcc;
                for (int i = 0; i < runAcc; i++) tt[count++] = uc;
            }
            if (sym == eob) break;
            if (count >= limitBlock) throw new IOException("bzip2 block too large");
            int m = sym - 1;
            byte v = mtf[m];
            System.arraycopy(mtf, 0, mtf, 1, m);
            mtf[0] = v;
            int uc = seqToUnseq[v & 0xff] & 0xff;
            unzftab[uc]++;
            tt[count++] = uc;
        }
        if (origPtr < 0 || origPtr >= Math.max(count, 1)) throw new IOException("Bad bzip2 origin pointer");

        // Inverse BWT: tt[i] = (next index << 8) | byte
        int[] cftab = new int[257];
        for (int i = 0; i < 256; i++) cftab[i + 1] = cftab[i] + unzftab[i];
        for (int i = 0; i < count; i++) {
            int uc = tt[i] & 0xff;
            tt[cftab[uc]] |= (i << 8);
            cftab[uc]++;
        }
        nblock = count;
        used = 0;
        tPos = count > 0 ? tt[origPtr] >>> 8 : 0;
        lastByte = -1;
        runLength = 0;
        repeat = 0;
        blockCrc = 0xffffffff;
        blockActive = true;
    }

    private static void createDecodeTables(int[] limit, int[] base, int[] perm, int[] length,
                                           int minLen, int maxLen, int alphaSize) {
        int pp = 0;
        for (int i = minLen; i <= maxLen; i++)
            for (int j = 0; j < alphaSize; j++)
                if (length[j] == i) perm[pp++] = j;
        for (int i = 0; i < MAX_CODE_LEN; i++) base[i] = 0;
        for (int i = 0; i < alphaSize; i++) base[length[i] + 1]++;
        for (int i = 1; i < MAX_CODE_LEN; i++) base[i] += base[i - 1];
        for (int i = 0; i < MAX_CODE_LEN; i++) limit[i] = -1;
        int vec = 0;
        for (int i = minLen; i <= maxLen; i++) {
            vec += base[i + 1] - base[i];
            limit[i] = vec - 1;
            vec <<= 1;
        }
        for (int i = minLen + 1; i <= maxLen; i++) base[i] = ((limit[i - 1] + 1) << 1) - base[i];
    }

    // ---------------------------------------------------------------- output (RLE1)

    private void crc(int b) {
        blockCrc = (blockCrc << 8) ^ CRC_TABLE[((blockCrc >>> 24) ^ b) & 0xff];
    }

    /** Next output byte, -1 at the end of everything. */
    private int nextByte() throws IOException {
        while (true) {
            if (!blockActive) {
                if (eof) return -1;
                if (!nextBlock()) { eof = true; return -1; }
            }
            if (repeat > 0) {
                repeat--;
                crc(lastByte);
                return lastByte;
            }
            if (used >= nblock) {
                if (~blockCrc != expectedBlockCrc) throw new IOException("bzip2 CRC mismatch (download broken?)");
                blockActive = false;
                continue;
            }
            int entry = tt[tPos];
            int b = entry & 0xff;
            tPos = entry >>> 8;
            used++;
            if (runLength == 4) {
                // Count byte after four equal bytes
                runLength = 0;
                if (b > 0) {
                    repeat = b - 1;
                    crc(lastByte);
                    return lastByte;
                }
                lastByte = -1;
                continue;
            }
            if (b == lastByte) runLength++;
            else { runLength = 1; lastByte = b; }
            crc(b);
            return b;
        }
    }

    @Override
    public int read() throws IOException {
        int n = read(one, 0, 1);
        return n <= 0 ? -1 : one[0] & 0xff;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        if (len == 0) return 0;
        int n = 0;
        while (n < len) {
            int c = nextByte();
            if (c < 0) break;
            b[off + n++] = (byte) c;
        }
        return n == 0 ? -1 : n;
    }

    @Override
    public void close() throws IOException {
        in.close();
    }
}

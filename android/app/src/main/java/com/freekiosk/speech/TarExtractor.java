package com.freekiosk.speech;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Unpacks a .tar or .tar.bz2 archive into a folder. Understands ustar, GNU long names
 * and pax path records, which is what tar on Linux writes. Links and special files are
 * skipped, and no entry may leave the target folder.
 */
public final class TarExtractor {
    public interface Progress {
        /** Called with the bytes of the (compressed) archive read so far. Return false to cancel. */
        boolean onProgress(long archiveBytesRead);
    }

    private TarExtractor() {}

    /** Counts the bytes taken from the underlying file, for progress on the compressed size. */
    private static final class CountingInputStream extends InputStream {
        private final InputStream in;
        long count;

        CountingInputStream(InputStream in) { this.in = in; }

        @Override public int read() throws IOException {
            int b = in.read();
            if (b >= 0) count++;
            return b;
        }

        @Override public int read(byte[] b, int off, int len) throws IOException {
            int n = in.read(b, off, len);
            if (n > 0) count += n;
            return n;
        }

        @Override public void close() throws IOException { in.close(); }
    }

    /** Unpacks archive (".tar.bz2", ".tbz2" or ".tar") into target. Returns the number of files written. */
    public static int extract(File archive, File target, Progress progress) throws IOException {
        String name = archive.getName().toLowerCase();
        CountingInputStream counting = new CountingInputStream(new FileInputStream(archive));
        InputStream raw = new BufferedInputStream(counting, 1 << 16);
        InputStream in = name.endsWith(".tar") ? raw : new BufferedInputStream(new Bzip2InputStream(raw), 1 << 16);
        try {
            return extract(in, target, progress == null ? null : () -> counting.count, progress);
        } finally {
            in.close();
        }
    }

    interface Counter { long get(); }

    static int extract(InputStream in, File target, Counter counter, Progress progress) throws IOException {
        if (!target.isDirectory() && !target.mkdirs()) throw new IOException("Cannot create " + target);
        String root = target.getCanonicalPath() + File.separator;
        byte[] header = new byte[512];
        byte[] buf = new byte[1 << 16];
        String longName = null;
        String paxPath = null;
        int files = 0;
        int zeroBlocks = 0;
        while (true) {
            if (!readFully(in, header, 512)) {
                if (zeroBlocks > 0 || files > 0) break; // archive ended without the zero blocks
                throw new IOException("Archive is empty or truncated");
            }
            if (isZero(header)) {
                if (++zeroBlocks >= 2) break;
                continue;
            }
            zeroBlocks = 0;
            if (!checksumOk(header)) throw new IOException("Bad tar header (download broken?)");
            long size = parseNumber(header, 124, 12);
            char type = (char) header[156];
            String entryName = string(header, 0, 100);
            if (header[257] == 'u' && header[258] == 's' && header[259] == 't' && header[260] == 'a' && header[261] == 'r') {
                String prefix = string(header, 345, 155);
                if (!prefix.isEmpty() && header[263] != ' ') entryName = prefix + "/" + entryName; // not for old GNU
            }

            if (type == 'L') { // GNU long name for the next entry
                longName = trimNul(new String(readBytes(in, size), StandardCharsets.UTF_8));
                skipPadding(in, size);
                continue;
            }
            if (type == 'K') { // GNU long link name
                readBytes(in, size);
                skipPadding(in, size);
                continue;
            }
            if (type == 'x') { // pax header for the next entry
                String path = paxValue(new String(readBytes(in, size), StandardCharsets.UTF_8), "path");
                if (path != null) paxPath = path;
                skipPadding(in, size);
                continue;
            }
            if (type == 'g') { // global pax header
                skip(in, size);
                skipPadding(in, size);
                continue;
            }

            if (paxPath != null) entryName = paxPath;
            else if (longName != null) entryName = longName;
            paxPath = null;
            longName = null;

            File out = safeTarget(target, root, entryName);
            if (type == '5') {
                if (out != null && !out.isDirectory() && !out.mkdirs()) throw new IOException("Cannot create " + out);
                skip(in, size);
            } else if ((type == '0' || type == 0 || type == '7') && out != null) {
                File parent = out.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create " + parent);
                try (OutputStream os = new BufferedOutputStream(new FileOutputStream(out), 1 << 16)) {
                    long left = size;
                    while (left > 0) {
                        int n = in.read(buf, 0, (int) Math.min(buf.length, left));
                        if (n < 0) throw new IOException("Archive ends inside " + entryName);
                        os.write(buf, 0, n);
                        left -= n;
                        if (progress != null && counter != null && !progress.onProgress(counter.get())) throw new IOException("Cancelled");
                    }
                }
                files++;
            } else {
                skip(in, size); // links, devices, entries outside the folder
            }
            skipPadding(in, size);
            if (progress != null && counter != null && !progress.onProgress(counter.get())) throw new IOException("Cancelled");
        }
        return files;
    }

    /** The file an entry goes to, or null when it would leave the folder or has no name. */
    static File safeTarget(File target, String root, String entryName) throws IOException {
        String n = entryName.replace('\\', '/');
        while (n.startsWith("./")) n = n.substring(2);
        if (n.isEmpty() || n.startsWith("/") || n.equals(".")) return null;
        for (String part : n.split("/")) if (part.equals("..")) return null;
        File f = new File(target, n);
        String path = f.getCanonicalPath();
        if (!(path + File.separator).startsWith(root) || path.length() + 1 <= root.length()) return null;
        return f;
    }

    private static boolean readFully(InputStream in, byte[] b, int len) throws IOException {
        int off = 0;
        while (off < len) {
            int n = in.read(b, off, len - off);
            if (n < 0) {
                if (off == 0) return false;
                throw new IOException("Archive is truncated");
            }
            off += n;
        }
        return true;
    }

    private static byte[] readBytes(InputStream in, long size) throws IOException {
        if (size < 0 || size > (1 << 20)) throw new IOException("Tar header record too large");
        byte[] b = new byte[(int) size];
        if (size > 0 && !readFully(in, b, (int) size)) throw new IOException("Archive is truncated");
        return b;
    }

    private static void skip(InputStream in, long n) throws IOException {
        byte[] tmp = new byte[8192];
        while (n > 0) {
            int r = in.read(tmp, 0, (int) Math.min(tmp.length, n));
            if (r < 0) throw new IOException("Archive is truncated");
            n -= r;
        }
    }

    private static void skipPadding(InputStream in, long size) throws IOException {
        long pad = (512 - (size % 512)) % 512;
        skip(in, pad);
    }

    private static boolean isZero(byte[] h) {
        for (byte b : h) if (b != 0) return false;
        return true;
    }

    private static boolean checksumOk(byte[] h) {
        long stored = parseNumber(h, 148, 8);
        long unsigned = 0, signed = 0;
        for (int i = 0; i < 512; i++) {
            int v = (i >= 148 && i < 156) ? ' ' : h[i];
            unsigned += v & 0xff;
            signed += (byte) v;
        }
        return stored == unsigned || stored == signed;
    }

    /** Octal (space or NUL terminated) or GNU base-256 for large sizes. */
    static long parseNumber(byte[] h, int off, int len) {
        if ((h[off] & 0x80) != 0) {
            long v = h[off] & 0x7f;
            for (int i = 1; i < len; i++) v = (v << 8) | (h[off + i] & 0xff);
            return v;
        }
        long v = 0;
        int i = off, end = off + len;
        while (i < end && (h[i] == ' ' || h[i] == 0)) i++;
        for (; i < end; i++) {
            byte c = h[i];
            if (c < '0' || c > '7') break;
            v = (v << 3) + (c - '0');
        }
        return v;
    }

    private static String string(byte[] h, int off, int len) {
        int end = off;
        while (end < off + len && h[end] != 0) end++;
        return new String(h, off, end - off, StandardCharsets.UTF_8);
    }

    private static String trimNul(String s) {
        int i = s.indexOf('\0');
        return i >= 0 ? s.substring(0, i) : s;
    }

    /** Value of one key in pax records ("%d key=value\n"). */
    static String paxValue(String records, String key) {
        int i = 0;
        String found = null;
        while (i < records.length()) {
            int sp = records.indexOf(' ', i);
            if (sp < 0) break;
            int len;
            try { len = Integer.parseInt(records.substring(i, sp)); } catch (NumberFormatException e) { break; }
            if (len <= 0) break;
            // Lengths count bytes, not chars: walk the UTF-8 bytes of this record
            byte[] rest = records.substring(i).getBytes(StandardCharsets.UTF_8);
            if (len > rest.length) break;
            String rec = new String(rest, 0, len, StandardCharsets.UTF_8);
            int eq = rec.indexOf('=');
            if (eq > 0) {
                String k = rec.substring(rec.indexOf(' ') + 1, eq);
                String v = rec.substring(eq + 1);
                if (v.endsWith("\n")) v = v.substring(0, v.length() - 1);
                if (k.equals(key)) found = v;
            }
            i += rec.length();
        }
        return found;
    }
}

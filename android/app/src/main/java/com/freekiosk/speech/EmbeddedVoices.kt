package com.freekiosk.speech

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.PlaybackParams
import android.os.Build
import android.os.SystemClock
import android.util.Log
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Offline voices built into FreeKiosk (sherpa-onnx, VITS models such as Piper).
 *
 * A voice is a model folder under files/voices/<id>, loaded from a .tar.bz2 archive of the
 * sherpa-onnx model releases. FreeKiosk speaks with it itself, without any Android speech
 * engine, so it needs neither a second app nor a change of Android's default engine.
 * Synthesis runs on its own thread, one sentence after another, and plays through an
 * AudioTrack while the next sentence is computed.
 */
object EmbeddedVoices {
    private const val TAG = "EmbeddedVoices"
    private const val DIR = "voices"
    private const val MANIFEST = "voice.json"
    private val ID_RE = Regex("^[A-Za-z0-9._-]{1,120}$")

    data class Model(
        val id: String,
        val name: String,
        val lang: String,
        val dir: File,
        val model: String,
        val tokens: String,
        val dataDir: String,
        val lexicon: String,
        val ruleFsts: String,
        val size: Long,
        val source: String,
    )

    interface Playback {
        fun onStart()
        fun onEnd()
        fun onError(message: String)
    }

    @Volatile private var appContext: Context? = null
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "fk-voice").apply { priority = Thread.NORM_PRIORITY + 2 } }
    private val installer = Executors.newSingleThreadExecutor { r -> Thread(r, "fk-voice-install") }
    private val generation = AtomicInteger()
    @Volatile private var track: AudioTrack? = null

    // Worker thread only
    private var loadedId: String? = null
    private var loaded: OfflineTts? = null

    @Volatile private var cached: List<Model>? = null
    @Volatile private var libraryState: Int = 0 // 0 unknown, 1 ok, -1 missing
    @Volatile var libraryError: String = ""
        private set

    // Install progress, shown in the kit
    @Volatile var installing: String = ""
        private set
    @Volatile var installPhase: String = ""
        private set
    @Volatile var installDone: Long = 0
        private set
    @Volatile var installTotal: Long = 0
        private set
    @Volatile var lastAction: String = ""
        private set
    @Volatile var lastError: String = ""
        private set
    @Volatile var loadedName: String = ""
        private set

    fun init(context: Context) {
        if (appContext == null) appContext = context.applicationContext
    }

    private fun root(): File = File(appContext!!.filesDir, DIR)

    /** True when the speech library is in this APK for this device (arm64 only). */
    fun available(): Boolean {
        if (libraryState == 0) {
            libraryState = try {
                System.loadLibrary("sherpa-onnx-jni")
                1
            } catch (t: Throwable) {
                libraryError = if (Build.SUPPORTED_64_BIT_ABIS.none { it == "arm64-v8a" })
                    "Eingebaute Stimmen gehen nur auf 64-Bit-ARM-Tablets" else "Sprachbibliothek fehlt in dieser FreeKiosk-Version"
                Log.w(TAG, "sherpa-onnx not loadable: ${t.message}")
                -1
            }
        }
        return libraryState == 1
    }

    // ---------------------------------------------------------------- models

    fun models(): List<Model> {
        cached?.let { return it }
        val ctx = appContext ?: return emptyList()
        val out = ArrayList<Model>()
        val dirs = File(ctx.filesDir, DIR).listFiles() ?: emptyArray()
        for (d in dirs.sortedBy { it.name }) {
            if (!d.isDirectory || d.name.startsWith(".")) continue
            val m = readManifest(d) ?: continue
            out.add(m)
        }
        cached = out
        return out
    }

    fun model(id: String): Model? = models().firstOrNull { it.id == id }

    private fun readManifest(dir: File): Model? = try {
        val j = JSONObject(File(dir, MANIFEST).readText())
        fun path(key: String) = j.optString(key, "").takeIf { it.isNotEmpty() }?.let { File(dir, it).path } ?: ""
        Model(
            id = j.getString("id"),
            name = j.optString("name", dir.name),
            lang = j.optString("lang", ""),
            dir = dir,
            model = path("model"),
            tokens = path("tokens"),
            dataDir = path("dataDir"),
            lexicon = j.optString("lexicon", "").split(',').filter { it.isNotBlank() }.joinToString(",") { File(dir, it).path },
            ruleFsts = j.optString("ruleFsts", "").split(',').filter { it.isNotBlank() }.joinToString(",") { File(dir, it).path },
            size = j.optLong("size", 0L),
            source = j.optString("source", ""),
        )
    } catch (e: Exception) {
        null
    }

    fun statusJson(): JSONObject {
        val list = JSONArray()
        for (m in models()) {
            list.put(JSONObject().put("id", m.id).put("name", m.name).put("lang", m.lang)
                .put("size", m.size).put("source", m.source))
        }
        return JSONObject()
            .put("available", available())
            .put("error", libraryError)
            .put("voices", list)
            .put("loaded", loadedName)
            .put("installing", installing)
            .put("phase", installPhase)
            .put("done", installDone)
            .put("total", installTotal)
            .put("lastAction", lastAction)
            .put("lastError", lastError)
            .put("freeBytes", try { appContext?.filesDir?.usableSpace ?: 0L } catch (_: Exception) { 0L })
    }

    // ---------------------------------------------------------------- install / remove

    /** Language from a sherpa-onnx model name: vits-piper-de_DE-thorsten-medium -> de-DE. */
    fun langFromId(id: String): String {
        Regex("^vits-(?:piper|mimic3)-([a-z]{2,3})_([A-Z]{2})-").find(id)?.let { return "${it.groupValues[1]}-${it.groupValues[2]}" }
        Regex("^vits-coqui-([a-z]{2})-").find(id)?.let { return it.groupValues[1] }
        Regex("^vits-mms-([a-z]{3})").find(id)?.let { m ->
            val iso3 = m.groupValues[1]
            Locale.getISOLanguages().firstOrNull { l -> try { Locale(l).isO3Language == iso3 } catch (_: Exception) { false } }?.let { return it }
            return iso3
        }
        return ""
    }

    private fun nameFromId(id: String): String {
        Regex("^vits-(?:piper|mimic3)-[a-z]{2,3}_[A-Z]{2}-(.+?)(?:-(?:x_low|low|medium|high))?$").find(id)?.let { m ->
            return m.groupValues[1].replace('_', ' ').split(' ').joinToString(" ") { w -> w.replaceFirstChar { c -> c.titlecase() } }
        }
        return id.removePrefix("vits-")
    }

    fun install(id: String, name: String, lang: String, url: String, onChanged: () -> Unit) {
        if (!ID_RE.matches(id)) { fail("Name der Stimme ungültig", onChanged); return }
        if (!url.startsWith("https://")) { fail("Nur https-Adressen", onChanged); return }
        if (installing.isNotEmpty()) { fail("Es lädt schon eine Stimme ($installing)", onChanged); return }
        installing = id
        installPhase = "download"
        installDone = 0
        installTotal = 0
        lastError = ""
        lastAction = "Lädt „${name.ifBlank { nameFromId(id) }}“ …"
        onChanged()
        installer.execute {
            val base = root()
            val archive = File(base, ".dl-$id.tar.bz2")
            val tmp = File(base, ".tmp-$id")
            try {
                base.mkdirs()
                tmp.deleteRecursively()
                download(url, archive, onChanged)
                installPhase = "unpack"
                installDone = 0
                installTotal = archive.length()
                onChanged()
                var lastTick = 0L
                TarExtractor.extract(archive, tmp) { read ->
                    installDone = read
                    val now = SystemClock.elapsedRealtime()
                    if (now - lastTick > 1500) { lastTick = now; onChanged() }
                    true
                }
                archive.delete()
                val found = findModelDir(tmp) ?: throw IOException("Im Archiv ist keine passende Stimme (VITS)")
                val manifest = describe(found, id, name.ifBlank { nameFromId(id) }, lang.ifBlank { langFromId(id) }, url)
                File(found, MANIFEST).writeText(manifest.toString())
                // The model is ready: swap it in, in place of an older copy
                val target = File(base, id)
                worker.submit(Runnable { if (loadedId == id) release() }).get()
                target.deleteRecursively()
                if (!found.renameTo(target)) throw IOException("Konnte die Stimme nicht ablegen")
                tmp.deleteRecursively()
                cached = null
                lastAction = "Stimme „${manifest.optString("name")}“ geladen"
                lastError = ""
                Log.i(TAG, "Installed voice $id (${manifest.optLong("size")} bytes)")
            } catch (e: Throwable) {
                Log.w(TAG, "Voice install failed: ${e.message}")
                lastError = "Laden fehlgeschlagen: ${e.message ?: e.javaClass.simpleName}"
                lastAction = ""
                archive.delete()
                tmp.deleteRecursively()
            } finally {
                installing = ""
                installPhase = ""
                onChanged()
            }
        }
    }

    private fun download(address: String, file: File, onChanged: () -> Unit) {
        var url = URL(address)
        var conn: HttpURLConnection? = null
        // Follows redirects by hand: GitHub and Hugging Face send the file from another host
        for (hop in 0 until 8) {
            val c = url.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 20000
            c.readTimeout = 60000
            c.setRequestProperty("User-Agent", "FreeKiosk")
            val code = c.responseCode
            if (code in 300..399) {
                val loc = c.getHeaderField("Location") ?: throw IOException("Weiterleitung ohne Ziel")
                c.disconnect()
                url = URL(url, loc)
                if (url.protocol != "https") throw IOException("Unsichere Weiterleitung")
                continue
            }
            if (code != 200) { c.disconnect(); throw IOException("HTTP $code") }
            conn = c
            break
        }
        val c = conn ?: throw IOException("Zu viele Weiterleitungen")
        try {
            val total = c.contentLengthLong
            installTotal = if (total > 0) total else 0
            val free = file.parentFile?.usableSpace ?: 0L
            if (total > 0 && free < total * 3 + 50L * 1024 * 1024) {
                throw IOException("Zu wenig Speicher (${free / 1048576} MB frei, ${total * 3 / 1048576} MB nötig)")
            }
            var lastTick = 0L
            c.inputStream.use { input ->
                FileOutputStream(file).use { out ->
                    val buf = ByteArray(1 shl 16)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        installDone += n
                        val now = SystemClock.elapsedRealtime()
                        if (now - lastTick > 1500) { lastTick = now; onChanged() }
                    }
                }
            }
            if (total > 0 && file.length() != total) throw IOException("Download unvollständig")
        } finally {
            c.disconnect()
        }
    }

    /** The folder with tokens.txt and an .onnx model, at most three levels down. */
    private fun findModelDir(dir: File, depth: Int = 0): File? {
        val files = dir.listFiles() ?: return null
        if (files.any { it.name == "tokens.txt" } && files.any { it.isFile && it.name.endsWith(".onnx") }) return dir
        if (depth >= 3) return null
        for (f in files.sortedBy { it.name }) if (f.isDirectory) findModelDir(f, depth + 1)?.let { return it }
        return null
    }

    private fun describe(dir: File, id: String, name: String, lang: String, source: String): JSONObject {
        val files = dir.listFiles() ?: emptyArray()
        val model = files.filter { it.isFile && it.name.endsWith(".onnx") }.maxByOrNull { it.length() }
            ?: throw IOException("Kein Modell im Archiv")
        val espeak = File(dir, "espeak-ng-data")
        val dataDir = if (File(espeak, "phontab").isFile) "espeak-ng-data" else ""
        val lexicon = files.filter { it.isFile && it.name.startsWith("lexicon") && it.name.endsWith(".txt") }.joinToString(",") { it.name }
        val fsts = files.filter { it.isFile && it.name.endsWith(".fst") }.sortedBy { it.name }.joinToString(",") { it.name }
        if (dataDir.isEmpty() && lexicon.isEmpty() && !id.contains("coqui") && !id.contains("mms")) {
            Log.w(TAG, "Voice $id has neither espeak-ng-data nor a lexicon")
        }
        return JSONObject()
            .put("id", id).put("name", name).put("lang", lang)
            .put("model", model.name).put("tokens", "tokens.txt")
            .put("dataDir", dataDir).put("lexicon", lexicon).put("ruleFsts", fsts)
            .put("size", dir.walkTopDown().filter { it.isFile }.sumOf { it.length() })
            .put("source", source)
            .put("installedAt", System.currentTimeMillis())
    }

    fun remove(id: String, onChanged: () -> Unit) {
        val m = model(id)
        if (m == null) { fail("Stimme „$id“ ist nicht da", onChanged); return }
        stop()
        worker.execute {
            if (loadedId == id) release()
            m.dir.deleteRecursively()
            cached = null
            lastAction = "Stimme „${m.name}“ entfernt"
            lastError = ""
            onChanged()
        }
    }

    /** A refused command (signature), shown like an install error. */
    fun reportError(message: String) {
        lastError = message
        lastAction = ""
    }

    private fun fail(message: String, onChanged: () -> Unit) {
        lastError = message
        Log.w(TAG, message)
        onChanged()
    }

    // ---------------------------------------------------------------- speaking

    private fun release() {
        try { loaded?.release() } catch (_: Throwable) {}
        loaded = null
        loadedId = null
        loadedName = ""
    }

    private fun load(m: Model): OfflineTts {
        if (loadedId == m.id) loaded?.let { return it }
        release()
        // Checked here: the native side does not stop on missing files, it crashes later
        if (!File(m.model).isFile) throw IOException("Modell fehlt (${m.model})")
        if (!File(m.tokens).isFile) throw IOException("tokens.txt fehlt")
        if (m.dataDir.isNotEmpty() && listOf("phontab", "phonindex", "phondata", "intonations").any { !File(m.dataDir, it).isFile }) {
            throw IOException("espeak-ng-data unvollständig")
        }
        val config = OfflineTtsConfig(
            model = OfflineTtsModelConfig(
                vits = OfflineTtsVitsModelConfig(model = m.model, lexicon = m.lexicon, tokens = m.tokens, dataDir = m.dataDir),
                numThreads = Runtime.getRuntime().availableProcessors().coerceIn(1, 4),
                debug = false,
                provider = "cpu",
            ),
            ruleFsts = m.ruleFsts,
            maxNumSentences = 1,
        )
        val started = SystemClock.elapsedRealtime()
        val tts = OfflineTts(config = config)
        // A failed native setup leaves a null handle, and any call on it would crash the app
        val handle = try {
            OfflineTts::class.java.getDeclaredField("ptr").apply { isAccessible = true }.getLong(tts)
        } catch (_: Exception) { -1L }
        if (handle == 0L) throw IOException("Stimme ließ sich nicht starten")
        Log.i(TAG, "Loaded voice ${m.id} in ${SystemClock.elapsedRealtime() - started} ms, ${tts.sampleRate()} Hz")
        loaded = tts
        loadedId = m.id
        loadedName = m.name
        return tts
    }

    /** Loads the voice in the background so the first word comes quickly. */
    fun warmUp(id: String) {
        if (!available()) return
        val m = model(id) ?: return
        worker.execute { try { load(m) } catch (e: Throwable) { Log.w(TAG, "Warm-up failed: ${e.message}") } }
    }

    /** Sentences, so playback starts after the first one is computed. */
    internal fun sentences(text: String): List<String> {
        val out = ArrayList<String>()
        val sb = StringBuilder()
        for (i in text.indices) {
            val ch = text[i]
            sb.append(ch)
            val end = ch == '.' || ch == '!' || ch == '?' || ch == ';' || ch == '\n' || ch == '。' || ch == '؟' || ch == '۔'
            val next = if (i + 1 < text.length) text[i + 1] else ' '
            if ((end && next.isWhitespace()) || sb.length >= 400 && ch.isWhitespace()) {
                sb.toString().trim().takeIf { it.isNotEmpty() }?.let { out.add(it) }
                sb.setLength(0)
            }
        }
        sb.toString().trim().takeIf { it.isNotEmpty() }?.let { out.add(it) }
        return out
    }

    fun speak(id: String, text: String, rate: Float, pitch: Float, volume: Float, cb: Playback) {
        val gen = generation.incrementAndGet()
        stopTrack()
        worker.execute {
            var t: AudioTrack? = null
            try {
                if (gen != generation.get()) return@execute
                if (!available()) throw IOException(libraryError.ifEmpty { "Sprachbibliothek fehlt" })
                val m = model(id) ?: throw IOException("Stimme „$id“ ist nicht geladen")
                val tts = load(m)
                val rateHz = tts.sampleRate()
                val speed = rate.coerceIn(0.5f, 2.5f)
                val minBuf = AudioTrack.getMinBufferSize(rateHz, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
                val bufBytes = maxOf(minBuf, rateHz / 2 * 2) // about half a second
                var started = false
                var frames = 0L
                for (sentence in sentences(text)) {
                    if (gen != generation.get()) break
                    val audio = tts.generate(sentence, 0, speed)
                    if (gen != generation.get()) break
                    if (audio.samples.isEmpty()) continue
                    if (t == null) {
                        t = AudioTrack.Builder()
                            .setAudioAttributes(AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build())
                            .setAudioFormat(AudioFormat.Builder()
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .setSampleRate(rateHz)
                                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                                .build())
                            .setBufferSizeInBytes(bufBytes)
                            .setTransferMode(AudioTrack.MODE_STREAM)
                            .build()
                        track = t
                        try { t.setVolume(volume.coerceIn(0f, 1f)) } catch (_: Exception) {}
                        if (pitch != 1f) {
                            try { t.playbackParams = PlaybackParams().setPitch(pitch.coerceIn(0.5f, 2f)).setSpeed(1f) } catch (e: Exception) { Log.w(TAG, "Pitch not supported: ${e.message}") }
                        }
                    }
                    if (!started) {
                        if (gen != generation.get()) break
                        t.play()
                        started = true
                        cb.onStart()
                    }
                    frames += write(t, audio.samples, gen, bufBytes / 4)
                }
                if (gen == generation.get() && started && t != null) {
                    // Wait until the last sample is heard
                    val deadline = SystemClock.elapsedRealtime() + frames * 1000 / rateHz + 3000
                    while (gen == generation.get() && (t.playbackHeadPosition.toLong() and 0xffffffffL) < frames &&
                        SystemClock.elapsedRealtime() < deadline) {
                        Thread.sleep(20)
                    }
                }
                if (gen == generation.get()) cb.onEnd()
            } catch (e: Throwable) {
                Log.w(TAG, "Speaking failed: ${e.message}")
                if (gen == generation.get()) cb.onError(e.message ?: e.javaClass.simpleName)
            } finally {
                if (track === t) track = null
                try { t?.pause(); t?.flush(); t?.release() } catch (_: Exception) {}
            }
        }
    }

    /** Writes in small pieces so a stop takes effect within a fraction of a second. */
    private fun write(t: AudioTrack, samples: FloatArray, gen: Int, chunk: Int): Int {
        val pcm = ShortArray(samples.size)
        for (i in samples.indices) {
            val v = (samples[i] * 32767f).toInt()
            pcm[i] = (if (v > 32767) 32767 else if (v < -32768) -32768 else v).toShort()
        }
        var off = 0
        val step = maxOf(256, chunk)
        while (off < pcm.size && gen == generation.get()) {
            val n = t.write(pcm, off, minOf(step, pcm.size - off))
            if (n < 0) throw IOException("AudioTrack write $n")
            off += n
        }
        return off
    }

    private fun stopTrack() {
        val t = track ?: return
        try { t.pause(); t.flush() } catch (_: Exception) {}
    }

    fun stop() {
        generation.incrementAndGet()
        stopTrack()
    }
}

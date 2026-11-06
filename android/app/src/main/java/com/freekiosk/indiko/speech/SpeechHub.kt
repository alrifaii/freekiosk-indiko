package com.freekiosk.indiko.speech

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Log
import androidx.core.content.ContextCompat
import com.freekiosk.DeviceAdminReceiver
import com.freekiosk.LockTaskCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * One place where FreeKiosk speaks: web pages (AsTeRICS Grid through the WebView bridge),
 * the MQTT "tts" command and the REST API all come here.
 *
 * Voices come from two sides at once:
 *  - built in: sherpa-onnx models of [EmbeddedVoices], voiceURI "fk:emb:<id>"
 *  - Android speech engines (Samsung, Google, any other installed one), each bound by
 *    its package name, voiceURI "fk:sys:<package>:<voice name>"
 * Binding every engine by name makes Android's default engine irrelevant: nothing has to
 * be switched or hidden, and no restart is needed. Chrome's own speechSynthesis only knows
 * the default engine and leaves out engines that report languages without a country
 * (sherpa-onnx does), which is why AsTeRICS could not see offline voices before.
 *
 * Without a voice, a request goes by language: the preferred output first ("embedded" or
 * an engine package), then Android's default engine, then any voice of that language.
 * State lives on the main thread; synthesis of built-in voices runs on its own thread.
 */
object SpeechHub {
    private const val TAG = "SpeechHub"
    private const val PREFS = "FreeKioskSpeech"
    private const val KEY_PREFERRED = "preferred"
    const val PREFER_EMBEDDED = "embedded"
    const val EMB = "fk:emb:"
    const val SYS = "fk:sys:"

    private val main = Handler(Looper.getMainLooper())
    @Volatile private var app: Context? = null
    private val listeners = CopyOnWriteArrayList<(JSONObject) -> Unit>()
    private var onStatusChanged: (() -> Unit)? = null

    private class Engine(val pkg: String, val label: String) {
        var tts: TextToSpeech? = null
        var ready = false
        var failed = false
        var voices: List<Voice> = emptyList()
    }

    private val engines = LinkedHashMap<String, Engine>()

    private data class Current(val id: String, val uid: String, val engine: String, val voice: String)
    private var current: Current? = null
    private var uidSeq = 0

    // Result of the last utterance, for the kit's checks
    private var lastVoice = ""
    private var lastOk: Boolean? = null
    private var lastMessage = ""
    private var lastAt = 0L

    @Synchronized
    fun init(context: Context) {
        if (app != null) return
        app = context.applicationContext
        EmbeddedVoices.init(context)
        Thread { EmbeddedVoices.available() }.apply { name = "fk-voice-lib" }.start()
        unhideOldEngines(app!!)
        main.post { refreshEngines() }
        // A speech engine installed, updated or removed: list again
        try {
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_PACKAGE_ADDED)
                addAction(Intent.ACTION_PACKAGE_REPLACED)
                addAction(Intent.ACTION_PACKAGE_REMOVED)
                addDataScheme("package")
            }
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(c: Context?, intent: Intent?) { main.postDelayed({ refreshEngines() }, 1500) }
            }
            ContextCompat.registerReceiver(app!!, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        } catch (e: Exception) {
            Log.w(TAG, "Package receiver: ${e.message}")
        }
    }

    fun setStatusListener(fn: (() -> Unit)?) { onStatusChanged = fn }

    fun addListener(fn: (JSONObject) -> Unit) { listeners.add(fn) }
    fun removeListener(fn: (JSONObject) -> Unit) { listeners.remove(fn) }

    private fun emit(type: String, id: String, error: String? = null) {
        val ev = JSONObject().put("type", type).put("id", id)
        if (error != null) ev.put("error", error)
        for (l in listeners) try { l(ev) } catch (e: Exception) { Log.w(TAG, "listener: ${e.message}") }
    }

    private fun changed(voices: Boolean) {
        if (voices) emit("voices", "")
        try { onStatusChanged?.invoke() } catch (_: Exception) {}
    }

    /** For EmbeddedVoices installs and removals. */
    val embeddedChanged: () -> Unit = { main.post { changed(true) } }

    private fun prefs() = app!!.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun preferred(): String = try { prefs().getString(KEY_PREFERRED, PREFER_EMBEDDED) ?: PREFER_EMBEDDED } catch (_: Exception) { PREFER_EMBEDDED }

    fun setPreferred(value: String) {
        val v = value.trim().ifEmpty { PREFER_EMBEDDED }
        prefs().edit().putString(KEY_PREFERRED, v).apply()
        main.post { changed(true) }
    }

    // ---------------------------------------------------------------- Android engines

    private fun shortLabel(pkg: String, label: String) = when (pkg) {
        "com.samsung.SMT" -> "Samsung"
        "com.google.android.tts" -> "Google"
        else -> label
    }

    /** Android's default engine, when it is installed and visible. */
    fun defaultEngine(): String? {
        val ctx = app ?: return null
        val pkg = try { Settings.Secure.getString(ctx.contentResolver, "tts_default_synth") } catch (_: Exception) { null }
        return pkg?.takeIf { engines.containsKey(it) }
    }

    fun refreshEngines() {
        val ctx = app ?: return
        if (Looper.myLooper() != Looper.getMainLooper()) { main.post { refreshEngines() }; return }
        val found = try {
            val pm = ctx.packageManager
            pm.queryIntentServices(Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), PackageManager.GET_META_DATA)
                .mapNotNull { ri ->
                    val si = ri.serviceInfo ?: return@mapNotNull null
                    if (si.packageName == ctx.packageName) null
                    else si.packageName to (ri.loadLabel(pm)?.toString() ?: si.packageName)
                }
                .distinctBy { it.first }
        } catch (e: Exception) {
            Log.w(TAG, "Listing speech engines failed: ${e.message}")
            emptyList()
        }
        val wanted = found.map { it.first }.toSet()
        for (pkg in engines.keys.toList()) {
            if (pkg !in wanted) engines.remove(pkg)?.tts?.let { try { it.shutdown() } catch (_: Exception) {} }
        }
        for ((pkg, label) in found) {
            val e = engines[pkg]
            if (e != null && e.ready) { e.voices = readVoices(e); continue }
            if (e != null && !e.failed) continue // still starting
            if (e != null) { try { e.tts?.shutdown() } catch (_: Exception) {} }
            val fresh = Engine(pkg, label)
            engines[pkg] = fresh
            bind(ctx, fresh)
        }
        changed(true)
    }

    private fun bind(ctx: Context, e: Engine) {
        try {
            var created: TextToSpeech? = null
            created = TextToSpeech(ctx, { status ->
                main.post {
                    if (engines[e.pkg] !== e) { try { created?.shutdown() } catch (_: Exception) {}; return@post }
                    if (status == TextToSpeech.SUCCESS) {
                        e.ready = true
                        e.voices = readVoices(e)
                        e.tts?.setOnUtteranceProgressListener(progressFor())
                        Log.i(TAG, "Engine ${e.pkg} ready, ${e.voices.size} offline voices")
                    } else {
                        e.failed = true
                        Log.w(TAG, "Engine ${e.pkg} failed to start ($status)")
                    }
                    changed(true)
                }
            }, e.pkg)
            e.tts = created
        } catch (ex: Exception) {
            e.failed = true
            Log.w(TAG, "Binding ${e.pkg} failed: ${ex.message}")
        }
    }

    private fun readVoices(e: Engine): List<Voice> = try {
        (e.tts?.voices ?: emptySet<Voice>())
            .filter { v ->
                !v.isNetworkConnectionRequired &&
                    !(v.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) ?: false)
            }
            .sortedWith(compareBy<Voice>({ it.locale.toLanguageTag() }, { it.name }))
    } catch (ex: Exception) {
        Log.w(TAG, "Voices of ${e.pkg}: ${ex.message}")
        emptyList()
    }

    private fun progressFor() = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            main.post { current?.takeIf { it.uid == utteranceId }?.let { emit("start", it.id) } }
        }

        override fun onDone(utteranceId: String?) {
            main.post { finish(utteranceId, null) }
        }

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
            main.post { finish(utteranceId, "synthesis-failed") }
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            main.post { finish(utteranceId, if (errorCode == TextToSpeech.ERROR_NETWORK || errorCode == TextToSpeech.ERROR_NETWORK_TIMEOUT) "network" else "synthesis-failed") }
        }
    }

    private fun finish(uid: String?, error: String?) {
        val c = current ?: return
        if (c.uid != uid) return
        current = null
        record(c.voice, error == null, error ?: "", isKitTest(c.id))
        if (error == null) emit("end", c.id) else emit("error", c.id, error)
    }

    /** Only the kit's tests publish the state at once; page speech waits for the next status. */
    private fun isKitTest(id: String) = id.startsWith("mqtt-") || id.startsWith("rest-")

    private fun record(voice: String, ok: Boolean, message: String, publish: Boolean) {
        lastVoice = voice
        lastOk = ok
        lastMessage = message
        lastAt = System.currentTimeMillis()
        if (publish) changed(false)
    }

    // ---------------------------------------------------------------- voices

    private fun langOf(locale: Locale): String = locale.toLanguageTag().takeIf { it != "und" } ?: locale.language

    private fun displayName(locale: Locale): String = try {
        locale.getDisplayName(Locale.getDefault()).ifEmpty { locale.toLanguageTag() }
    } catch (_: Exception) { locale.toLanguageTag() }

    private class Entry(val uri: String, val name: String, val lang: String, val engine: String, val label: String)

    /** Voices in order: preferred output first, then the others. */
    private fun entries(): List<Entry> {
        val pref = preferred()
        val emb = if (EmbeddedVoices.available()) EmbeddedVoices.models().map {
            Entry(EMB + it.id, "${it.name} · eingebaut", it.lang.ifEmpty { "und" }, PREFER_EMBEDDED, "Eingebaut")
        } else emptyList()
        val sys = ArrayList<Entry>()
        val order = engines.values.sortedBy { if (it.pkg == pref) 0 else if (it.pkg == defaultEngine()) 1 else 2 }
        for (e in order) {
            if (!e.ready) continue
            val label = shortLabel(e.pkg, e.label)
            val perLang = HashMap<String, Int>()
            val counts = e.voices.groupingBy { langOf(it.locale) }.eachCount()
            for (v in e.voices) {
                val lang = langOf(v.locale)
                val n = (perLang[lang] ?: 0) + 1
                perLang[lang] = n
                val suffix = if ((counts[lang] ?: 0) > 1) " $n" else ""
                sys.add(Entry("$SYS${e.pkg}:${v.name}", "$label · ${displayName(v.locale)}$suffix", lang, e.pkg, label))
            }
            if (e.voices.isEmpty()) {
                val loc = try { e.tts?.defaultVoice?.locale } catch (_: Exception) { null } ?: Locale.getDefault()
                sys.add(Entry("$SYS${e.pkg}:", "$label · ${displayName(loc)}", langOf(loc), e.pkg, label))
            }
        }
        return if (pref == PREFER_EMBEDDED) emb + sys else sys + emb
    }

    /** The list for the WebView bridge: [{voiceURI, name, lang, localService, default}]. */
    fun voicesJson(): JSONArray {
        val out = JSONArray()
        val list = runOnMain { rereadVoices(); entries() } ?: emptyList()
        list.forEachIndexed { i, e ->
            out.put(JSONObject().put("voiceURI", e.uri).put("name", e.name).put("lang", e.lang)
                .put("localService", true).put("default", i == 0).put("engine", e.engine))
        }
        return out
    }

    private fun <T> runOnMain(block: () -> T): T? {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        val result = AtomicReference<T?>(null)
        val latch = CountDownLatch(1)
        main.post {
            try { result.set(block()) } catch (e: Exception) { Log.w(TAG, "runOnMain: ${e.message}") } finally { latch.countDown() }
        }
        latch.await(2, TimeUnit.SECONDS)
        return result.get()
    }

    private fun base(lang: String): String {
        val l = lang.lowercase(Locale.ROOT).replace('_', '-').substringBefore('-')
        if (l.length == 3) {
            // ISO 639-2 (deu) to 639-1 (de), as Android engines and the kit may use either
            ISO3[l]?.let { return it }
        }
        return l
    }

    private val ISO3: Map<String, String> by lazy {
        val m = HashMap<String, String>()
        for (l in Locale.getISOLanguages()) try { m[Locale(l).isO3Language] = l } catch (_: Exception) {}
        m["ger"] = "de"; m["fre"] = "fr"; m["chi"] = "zh"; m["per"] = "fa"; m["dut"] = "nl"
        m
    }

    private fun country(lang: String): String =
        lang.replace('_', '-').split('-').getOrNull(1)?.uppercase(Locale.ROOT)?.takeIf { it.length == 2 } ?: ""

    /** Picks a voice for a request without (or with an unknown) voice. */
    private fun pick(lang: String): Entry? {
        val all = entries()
        if (all.isEmpty()) return null
        val want = base(lang.ifBlank { Locale.getDefault().language })
        val cc = country(lang)
        val pref = preferred()
        val def = defaultEngine()
        fun rank(e: Entry): Int {
            val engineRank = when {
                e.engine == pref -> 0
                pref == PREFER_EMBEDDED && e.engine == def -> 1
                e.engine == def -> 2
                e.engine == PREFER_EMBEDDED -> 3
                else -> 4
            }
            val countryRank = if (cc.isNotEmpty() && country(e.lang) == cc) 0 else 1
            return engineRank * 2 + countryRank
        }
        val sameLang = all.filter { base(it.lang) == want }
        if (sameLang.isNotEmpty()) return sameLang.minByOrNull { rank(it) }
        // No voice for that language: the preferred output, with its own language handling
        return all.minByOrNull { rank(it) }
    }

    private fun entryFor(uri: String): Entry? {
        if (uri.isEmpty()) return null
        val list = entries()
        list.firstOrNull { it.uri == uri }?.let { return it }
        // An Android voice name (REST API) or the name shown in the list
        if (!uri.startsWith("fk:")) list.firstOrNull { it.uri.endsWith(":$uri") || it.name == uri }?.let { return it }
        return null
    }

    /** Re-reads the voice lists of running engines (after voice data was downloaded). */
    private fun rereadVoices() {
        for (e in engines.values) if (e.ready) e.voices = readVoices(e)
    }

    // ---------------------------------------------------------------- Samsung/Google voice data

    private fun dpm(ctx: Context) = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private fun admin(ctx: Context) = ComponentName(ctx, DeviceAdminReceiver::class.java)
    private var lockTaskBefore: Array<String>? = null
    private val restoreLockTask = Runnable {
        val ctx = app ?: return@Runnable
        val before = lockTaskBefore ?: return@Runnable
        lockTaskBefore = null
        try { dpm(ctx).setLockTaskPackages(admin(ctx), before) } catch (_: Exception) {}
    }

    /**
     * Samsung's and Google's engines download more languages only in their own screen, and
     * someone has to tap there. This opens that screen on the tablet, let through the kiosk
     * lock for five minutes. Returns null when it opened, otherwise the reason (German, for
     * the kit). The new voices then show up by themselves (rereadVoices).
     */
    fun openVoiceData(engine: String): String? {
        val ctx = app ?: return "Sprachausgabe noch nicht bereit"
        val target = engine.ifEmpty { defaultEngine() ?: engines.keys.firstOrNull() ?: "" }
        if (target.isEmpty()) return "Keine Sprachausgabe gefunden"
        val intent = Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA)
            .setPackage(target)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        @Suppress("DEPRECATION")
        val screen = ctx.packageManager.resolveActivity(intent, 0)
        if (screen == null) return "Diese Sprachausgabe hat keine Seite zum Laden von Stimmen"
        return try {
            if (dpm(ctx).isDeviceOwnerApp(ctx.packageName)) {
                val current = LockTaskCompat.readPackages(dpm(ctx), admin(ctx))
                if (current != null && target !in current) {
                    if (lockTaskBefore == null) lockTaskBefore = current
                    dpm(ctx).setLockTaskPackages(admin(ctx), (current.toList() + target).distinct().toTypedArray())
                }
                main.removeCallbacks(restoreLockTask)
                main.postDelayed(restoreLockTask, 5 * 60 * 1000L)
            }
            ctx.startActivity(intent)
            null
        } catch (e: Exception) {
            main.post(restoreLockTask)
            "Seite ließ sich nicht öffnen: ${e.message}"
        }
    }

    /**
     * qr6 to qr8 chose an offline voice by hiding Samsung's and Google's engines. Nothing
     * has to be hidden any more, so they come back once; a no-op on every other tablet.
     */
    private fun unhideOldEngines(ctx: Context) {
        try {
            val old = ctx.getSharedPreferences("FreeKioskAdmin", Context.MODE_PRIVATE)
            val hidden = old.getStringSet("hidden_tts_engines", null) ?: return
            for (pkg in hidden) try { dpm(ctx).setApplicationHidden(admin(ctx), pkg, false) } catch (_: Exception) {}
            old.edit().remove("hidden_tts_engines").apply()
            Log.i(TAG, "Speech engines visible again: $hidden")
        } catch (e: Exception) {
            Log.w(TAG, "Unhiding old engines: ${e.message}")
        }
    }

    // ---------------------------------------------------------------- speaking

    /** Speaks text; id identifies the utterance in the events (start, end, error). */
    fun speak(id: String, text: String, voiceUri: String, lang: String, rate: Float, pitch: Float, volume: Float) {
        main.post { doSpeak(id, text.take(4000), voiceUri, lang, rate, pitch, volume) }
    }

    private fun doSpeak(id: String, text: String, voiceUri: String, lang: String, rate: Float, pitch: Float, volume: Float) {
        interrupt()
        if (text.isBlank()) { emit("end", id); return }
        val entry = entryFor(voiceUri) ?: pick(lang)
        if (entry == null) {
            record("", false, "Keine Stimme", true)
            emit("error", id, "synthesis-unavailable")
            return
        }
        val uid = "fk-${++uidSeq}"
        val c = Current(id, uid, entry.engine, entry.name)
        current = c
        if (entry.engine == PREFER_EMBEDDED) {
            val modelId = entry.uri.removePrefix(EMB)
            EmbeddedVoices.speak(modelId, text, rate, pitch, volume, object : EmbeddedVoices.Playback {
                override fun onStart() { main.post { if (current?.uid == uid) emit("start", id) } }
                override fun onEnd() { main.post { finish(uid, null) } }
                override fun onError(message: String) {
                    main.post {
                        if (current?.uid != uid) return@post
                        current = null
                        record(entry.name, false, message, true)
                        emit("error", id, "synthesis-failed")
                    }
                }
            })
            return
        }
        val e = engines[entry.engine]
        val tts = e?.tts
        if (e == null || tts == null || !e.ready) {
            current = null
            record(entry.name, false, "Sprachausgabe nicht bereit", true)
            emit("error", id, "synthesis-unavailable")
            return
        }
        try {
            val voiceName = entry.uri.removePrefix("$SYS${e.pkg}:")
            val voice = e.voices.firstOrNull { it.name == voiceName }
            if (voice != null) tts.setVoice(voice)
            else if (lang.isNotBlank()) tts.setLanguage(Locale.forLanguageTag(lang.replace('_', '-')))
            tts.setSpeechRate(rate.coerceIn(0.1f, 4f))
            tts.setPitch(pitch.coerceIn(0.1f, 2f))
            val params = Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume.coerceIn(0f, 1f)) }
            val res = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, uid)
            if (res != TextToSpeech.SUCCESS) {
                current = null
                record(entry.name, false, "Android hat abgelehnt ($res)", true)
                emit("error", id, "synthesis-failed")
            }
        } catch (ex: Exception) {
            current = null
            record(entry.name, false, ex.message ?: "Fehler", true)
            emit("error", id, "synthesis-failed")
        }
    }

    /** Stops what is being spoken; the interrupted utterance gets an "interrupted" error. */
    private fun interrupt() {
        val c = current ?: return
        current = null
        if (c.engine == PREFER_EMBEDDED) EmbeddedVoices.stop()
        else try { engines[c.engine]?.tts?.stop() } catch (_: Exception) {}
        emit("error", c.id, "interrupted")
    }

    fun stop() {
        main.post { interrupt() }
    }

    /** MQTT tts command: text, optionally with a voice (voiceURI) and language. */
    fun say(text: String, voiceUri: String = "", lang: String = "") {
        speak("mqtt-${System.currentTimeMillis()}", text, voiceUri, lang.ifBlank { guessLang(text) }, 1f, 1f, 1f)
    }

    /** Script of the text when no language is given (Arabic letters, Cyrillic, ...). */
    private fun guessLang(text: String): String {
        var arabic = 0; var cyr = 0; var latin = 0
        for (ch in text) {
            if (!ch.isLetter()) continue
            when {
                ch.code in 0x0600..0x06FF -> arabic++
                ch.code in 0x0400..0x04FF -> cyr++
                else -> latin++
            }
        }
        return when {
            arabic > latin && arabic > cyr -> "ar"
            cyr > latin -> if (Locale.getDefault().language == "uk") "uk" else "ru"
            else -> ""
        }
    }

    // ---------------------------------------------------------------- status (MQTT)

    fun status(): JSONObject {
        val list = runOnMain {
            val engs = JSONArray()
            for (e in engines.values) {
                engs.put(JSONObject().put("package", e.pkg).put("label", shortLabel(e.pkg, e.label))
                    .put("ready", e.ready).put("failed", e.failed).put("voices", e.voices.size)
                    .put("langs", JSONArray(e.voices.map { base(langOf(it.locale)) }.distinct().sorted())))
            }
            val voices = JSONArray()
            for (v in entries()) voices.put(JSONObject().put("uri", v.uri).put("name", v.name).put("lang", v.lang).put("engine", v.engine))
            Triple(engs, voices, defaultEngine() ?: "")
        }
        val j = JSONObject()
            .put("preferred", preferred())
            .put("androidDefault", list?.third ?: "")
            .put("engines", list?.first ?: JSONArray())
            .put("voices", list?.second ?: JSONArray())
            .put("embedded", EmbeddedVoices.statusJson())
        if (lastAt > 0) {
            j.put("last", JSONObject().put("voice", lastVoice).put("ok", lastOk == true).put("message", lastMessage).put("at", lastAt))
        }
        return j
    }
}

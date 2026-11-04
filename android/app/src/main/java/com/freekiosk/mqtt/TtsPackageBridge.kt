package com.freekiosk.mqtt

import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import com.freekiosk.DeviceAdminReceiver
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL

/**
 * Offline voices over MQTT: which text-to-speech engines are on the tablet, install or
 * remove a voice package (an engine APK, e.g. a sherpa-onnx engine with one voice
 * built in), and pick the engine AsTeRICS Grid and FreeKiosk speak with.
 *
 * Installing apps silently is a Device Owner privilege, and the broker may be public,
 * so these commands must be signed: HMAC-SHA256 over "cmd|package|url|ts" with the
 * admin key that came with the provisioning QR (mqtt_admin_key). Commands older than
 * 15 minutes, or not newer than the last accepted one, are refused. On top of that only
 * known TTS packages from https URLs on known hosts are accepted.
 *
 * Android uses one preferred engine (Settings.Secure "tts_default_synth"). When
 * FreeKiosk was granted WRITE_SECURE_SETTINGS once over ADB (USB or wireless debugging),
 * it sets that preference directly. Otherwise it uses what a Device Owner can do: hide
 * the system engines, so the remaining engine is the one every app (the WebView
 * included) gets. "system" goes back to the tablet's own engine.
 */
class TtsPackageBridge(
    private val context: Context,
    /** Downloads [url] and installs it silently; calls back (ok, message). */
    private val installer: (url: String, pkg: String, done: (Boolean, String) -> Unit) -> Unit,
    private val onChanged: () -> Unit,
    /** Android's engine changed: speech objects bound to the old one must be rebuilt. */
    private val onEngineChanged: () -> Unit = {},
) {
    companion object {
        private const val TAG = "TtsPackages"
        const val PREFS = AdminSignature.PREFS
        const val KEY_ADMIN = AdminSignature.KEY_ADMIN
        private const val KEY_HIDDEN = "hidden_tts_engines"
        private const val KEY_SOURCE_PREFIX = "tts_source_"
        private const val KEY_CHANGED_AT = "tts_engine_changed_at"
        private const val UNINSTALL_ACTION = "com.freekiosk.TTS_UNINSTALL_RESULT"

        /** Engines that ship with the tablet and get hidden when another engine is chosen. */
        val SYSTEM_ENGINES = listOf("com.samsung.SMT", "com.google.android.tts")

        /** Packages that may be installed or removed over MQTT. */
        val INSTALLABLE = setOf(
            "com.k2fsa.sherpa.onnx.tts.engine",
            "com.CodeBySonu.VoxSherpa",
            "com.github.olga_yakovleva.rhvoice.android",
        )
        private val HOSTS = listOf(
            "huggingface.co", "github.com", "objects.githubusercontent.com",
            "release-assets.githubusercontent.com", "f-droid.org",
        )
    }

    private val handler = Handler(Looper.getMainLooper())
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private var busy: String? = null
    private var busyAction = ""
    private var lastAction = ""
    private var lastError = ""

    private fun dpm() = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private fun admin() = ComponentName(context, DeviceAdminReceiver::class.java)
    private fun isOwner() = try { dpm().isDeviceOwnerApp(context.packageName) } catch (_: Exception) { false }
    private fun canWriteSecure() =
        context.checkSelfPermission(android.Manifest.permission.WRITE_SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED

    private fun ok(action: String) { lastAction = action; lastError = ""; onChanged() }
    private fun engineChanged() {
        prefs.edit().putLong(KEY_CHANGED_AT, System.currentTimeMillis()).apply()
        try { onEngineChanged() } catch (e: Exception) { Log.w(TAG, "Rebuilding speech failed: ${e.message}") }
    }
    private fun fail(message: String) { lastError = message; Log.w(TAG, message); onChanged() }

    // ─── State ───────────────────────────────────────────────────────────────

    private fun hiddenSet(): MutableSet<String> = prefs.getStringSet(KEY_HIDDEN, emptySet())!!.toMutableSet()

    private fun installedPackage(pkg: String): ApplicationInfo? = try {
        @Suppress("DEPRECATION")
        context.packageManager.getApplicationInfo(pkg, PackageManager.MATCH_UNINSTALLED_PACKAGES)
    } catch (_: Exception) { null }

    private fun isHidden(pkg: String): Boolean = try {
        isOwner() && dpm().isApplicationHidden(admin(), pkg)
    } catch (_: Exception) { false }

    /** Visible TTS engines, as Android's own TtsEngines lists them. */
    private fun visibleEngines(): List<Pair<String, ApplicationInfo>> {
        val pm = context.packageManager
        val services = pm.queryIntentServices(Intent("android.intent.action.TTS_SERVICE"), PackageManager.GET_META_DATA)
        return services.mapNotNull { it.serviceInfo?.applicationInfo?.let { ai -> ai.packageName to ai } }
            .distinctBy { it.first }
    }

    fun status(): JSONObject {
        val pm = context.packageManager
        val out = JSONObject()
        val visible = visibleEngines()
        val engines = JSONArray()
        val seen = mutableSetOf<String>()
        for ((pkg, ai) in visible) {
            seen.add(pkg)
            engines.put(engineJson(pkg, ai, hidden = false))
        }
        // Hidden engines are invisible to the query above; list the ones we hid or know.
        for (pkg in hiddenSet() + SYSTEM_ENGINES + INSTALLABLE) {
            if (pkg in seen) continue
            val ai = installedPackage(pkg) ?: continue
            if (!isHidden(pkg)) continue
            seen.add(pkg)
            engines.put(engineJson(pkg, ai, hidden = true))
        }
        out.put("engines", engines)
        val preferred = try { Settings.Secure.getString(context.contentResolver, "tts_default_synth") } catch (_: Exception) { null }
        out.put("preferred", preferred ?: "")
        out.put("active", activeEngine(visible, preferred) ?: JSONObject.NULL)
        out.put("busy", busy ?: JSONObject.NULL)
        out.put("busyAction", busyAction)
        out.put("lastAction", lastAction)
        out.put("lastError", lastError)
        // The WebView binds its speech engine once per app start: a change after the last
        // boot is not heard in AsTeRICS until the tablet restarts
        out.put("changedAt", prefs.getLong(KEY_CHANGED_AT, 0L))
        out.put("bootAt", System.currentTimeMillis() - android.os.SystemClock.elapsedRealtime())
        out.put("signed", AdminSignature.hasKey(context))
        out.put("secureSettings", canWriteSecure())
        out.put("owner", isOwner())
        return out
    }

    /**
     * What TextToSpeech actually binds to: the preferred engine if it is visible,
     * otherwise the first system engine, otherwise the first one at all.
     */
    private fun activeEngine(
        visible: List<Pair<String, ApplicationInfo>> = visibleEngines(),
        preferred: String? = try { Settings.Secure.getString(context.contentResolver, "tts_default_synth") } catch (_: Exception) { null },
    ): String? =
        visible.firstOrNull { it.first == preferred }?.first
            ?: visible.firstOrNull { (it.second.flags and ApplicationInfo.FLAG_SYSTEM) != 0 }?.first
            ?: visible.firstOrNull()?.first

    private fun engineJson(pkg: String, ai: ApplicationInfo, hidden: Boolean): JSONObject {
        val pm = context.packageManager
        val label = try { pm.getApplicationLabel(ai).toString() } catch (_: Exception) { pkg }
        val version = try { pm.getPackageInfo(pkg, 0).versionName ?: "" } catch (_: Exception) { "" }
        return JSONObject()
            .put("package", pkg)
            .put("label", label)
            .put("version", version)
            .put("system", (ai.flags and ApplicationInfo.FLAG_SYSTEM) != 0)
            .put("hidden", hidden)
            .put("source", prefs.getString(KEY_SOURCE_PREFIX + pkg, "") ?: "")
    }

    // ─── Signature ───────────────────────────────────────────────────────────

    private fun verify(cmd: String, params: JSONObject?): String? =
        AdminSignature.verify(context, cmd, params?.optString("package", "") ?: "", params?.optString("url", "") ?: "", params)

    // ─── Install / uninstall ─────────────────────────────────────────────────

    fun install(params: JSONObject?) {
        verify("tts_install", params)?.let { return fail(it) }
        val pkg = params!!.optString("package", "")
        val url = params.optString("url", "")
        if (pkg !in INSTALLABLE) return fail("Dieses Paket ist nicht freigegeben: $pkg")
        val parsed = try { URL(url) } catch (_: Exception) { null }
        if (parsed == null || parsed.protocol != "https" || HOSTS.none { parsed.host == it || parsed.host.endsWith(".$it") }) {
            return fail("Download nur über https von bekannten Seiten")
        }
        if (!isOwner()) return fail("FreeKiosk ist keine Geräteverwaltung")
        if (busy != null) return fail("Es läuft schon eine Installation")
        busy = pkg
        busyAction = "install"
        ok("Lädt herunter …")
        installer(url, pkg) { success, message ->
            handler.post {
                busy = null
                busyAction = ""
                if (success) {
                    prefs.edit().putString(KEY_SOURCE_PREFIX + pkg, url).apply()
                    ok("Installiert")
                } else {
                    fail("Installation fehlgeschlagen: $message")
                }
            }
        }
    }

    fun uninstall(params: JSONObject?) {
        verify("tts_uninstall", params)?.let { return fail(it) }
        val pkg = params!!.optString("package", "")
        if (pkg !in INSTALLABLE) return fail("Dieses Paket ist nicht freigegeben: $pkg")
        if (installedPackage(pkg) == null) return ok("War nicht installiert")
        if (!isOwner()) return fail("FreeKiosk ist keine Geräteverwaltung")
        try {
            if (isHidden(pkg)) dpm().setApplicationHidden(admin(), pkg, false)
            val action = "$UNINSTALL_ACTION.${System.currentTimeMillis()}"
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(c: Context?, intent: Intent?) {
                    try { context.unregisterReceiver(this) } catch (_: Exception) {}
                    val status = intent?.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
                        ?: PackageInstaller.STATUS_FAILURE
                    busy = null
                    busyAction = ""
                    if (status == PackageInstaller.STATUS_SUCCESS) {
                        prefs.edit().remove(KEY_SOURCE_PREFIX + pkg).apply()
                        ok("Entfernt")
                    } else {
                        fail("Entfernen fehlgeschlagen: ${intent?.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: status}")
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(receiver, IntentFilter(action), Context.RECEIVER_NOT_EXPORTED)
            } else {
                context.registerReceiver(receiver, IntentFilter(action))
            }
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
            val pi = PendingIntent.getBroadcast(context, action.hashCode(), Intent(action).setPackage(context.packageName), flags)
            busy = pkg
            busyAction = "uninstall"
            context.packageManager.packageInstaller.uninstall(pkg, pi.intentSender)
            ok("Wird entfernt …")
        } catch (e: Exception) {
            busy = null
            busyAction = ""
            fail("Entfernen fehlgeschlagen: ${e.message}")
        }
    }

    // ─── Voice data of an engine (Samsung, Google) ───────────────────────────

    private var lockTaskBefore: Array<String>? = null
    private val restoreLockTask = Runnable {
        val before = lockTaskBefore ?: return@Runnable
        lockTaskBefore = null
        try { dpm().setLockTaskPackages(admin(), before) } catch (_: Exception) {}
    }

    /**
     * Samsung's and Google's engines download their voices only in their own screen, and
     * someone has to tap there. This opens that screen on the tablet (let through lock
     * task for a few minutes); the language is then usable offline.
     */
    fun openVoiceData(params: JSONObject?) {
        verify("tts_voice_data", params)?.let { return fail(it) }
        val target = params!!.optString("package", "").ifEmpty { activeEngine() ?: "" }
        if (target.isEmpty()) return fail("Keine Sprachausgabe gefunden")
        if (isHidden(target)) return fail("Diese Sprachausgabe ist versteckt. Erst „System-Stimme“ wählen.")
        val intent = Intent("android.speech.tts.engine.INSTALL_TTS_DATA")
            .setPackage(target)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        @Suppress("DEPRECATION")
        val resolved = context.packageManager.resolveActivity(intent, 0)
        if (resolved == null) return fail("Diese Sprachausgabe hat keine Seite zum Laden von Stimmen")
        try {
            if (isOwner()) {
                val current = com.freekiosk.LockTaskCompat.readPackages(dpm(), admin())
                if (current != null && target !in current) {
                    if (lockTaskBefore == null) lockTaskBefore = current
                    dpm().setLockTaskPackages(admin(), (current.toList() + target).distinct().toTypedArray())
                }
                handler.removeCallbacks(restoreLockTask)
                handler.postDelayed(restoreLockTask, 5 * 60 * 1000L)
            }
            context.startActivity(intent)
            ok("Am Tablet ist die Seite zum Laden der Stimmen offen")
        } catch (e: Exception) {
            handler.post(restoreLockTask)
            fail("Seite ließ sich nicht öffnen: ${e.message}")
        }
    }

    // ─── Engine choice ───────────────────────────────────────────────────────

    fun useEngine(params: JSONObject?) {
        verify("tts_engine", params)?.let { return fail(it) }
        val target = params!!.optString("package", "")
        if (canWriteSecure()) return useEngineBySetting(target)
        if (!isOwner()) return fail("FreeKiosk ist keine Geräteverwaltung")
        try {
            val dpm = dpm()
            val hidden = hiddenSet()
            if (target == "system") {
                for (pkg in hidden) try { dpm.setApplicationHidden(admin(), pkg, false) } catch (_: Exception) {}
                prefs.edit().putStringSet(KEY_HIDDEN, emptySet()).apply()
                engineChanged()
                return ok("Sprachausgabe des Systems")
            }
            val known = visibleEngines().map { it.first }.toSet() + hidden
            if (target !in known) return fail("Diese Sprachausgabe ist nicht installiert: $target")
            if (target in hidden) {
                dpm.setApplicationHidden(admin(), target, false)
                hidden.remove(target)
            }
            for (pkg in SYSTEM_ENGINES) {
                if (pkg == target || installedPackage(pkg) == null) continue
                if (dpm.setApplicationHidden(admin(), pkg, true)) hidden.add(pkg)
            }
            prefs.edit().putStringSet(KEY_HIDDEN, hidden).apply()
            engineChanged()
            ok("Sprachausgabe gewechselt")
        } catch (e: Exception) {
            fail("Wechseln fehlgeschlagen: ${e.message}")
        }
    }

    /** With WRITE_SECURE_SETTINGS: set Android's preferred engine, hide nothing. */
    private fun useEngineBySetting(target: String) {
        try {
            // Engines hidden by an earlier choice come back first
            val hidden = hiddenSet()
            if (hidden.isNotEmpty() && isOwner()) {
                for (pkg in hidden) try { dpm().setApplicationHidden(admin(), pkg, false) } catch (_: Exception) {}
                prefs.edit().putStringSet(KEY_HIDDEN, emptySet()).apply()
            }
            val engine = if (target == "system") {
                SYSTEM_ENGINES.firstOrNull { installedPackage(it) != null }
                    ?: return fail("Keine System-Sprachausgabe gefunden")
            } else {
                if (visibleEngines().none { it.first == target }) return fail("Diese Sprachausgabe ist nicht installiert: $target")
                target
            }
            Settings.Secure.putString(context.contentResolver, "tts_default_synth", engine)
            engineChanged()
            ok(if (target == "system") "Sprachausgabe des Systems" else "Sprachausgabe gewechselt")
        } catch (e: Exception) {
            fail("Wechseln fehlgeschlagen: ${e.message}")
        }
    }

}

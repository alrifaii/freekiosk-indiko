package com.freekiosk.indiko

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import com.freekiosk.DeviceAdminReceiver
import org.json.JSONArray
import org.json.JSONObject

/**
 * Spare Wi-Fi networks. The provisioning QR can only join one network; the kit adds
 * more (school network, staff network, a mobile hotspot) and Android switches to
 * another saved one by itself when the current one is gone.
 *
 * Saving networks for the whole device is a Device Owner privilege since Android 10
 * (WifiManager.addNetwork fails for normal apps). Networks come from:
 *  - the provisioning QR or an ADB intent: wifi_more = [{"s":"Name","p":"secret"}, ...]
 *    ("t": "WPA" (default with a password), "SAE" for WPA3 only, "WEP", "OPEN";
 *    "h": true for a hidden network)
 *  - MQTT wifi_add / wifi_remove, signed with the kit's admin key, the password
 *    encrypted with it (AdminSignature), because the broker may be public.
 *
 * The status lists network names only, never passwords.
 */
class WifiNetworksBridge(
    private val context: Context,
    private val onChanged: () -> Unit,
) {
    companion object {
        private const val TAG = "WifiNetworks"
        private const val PREFS = "FreeKioskWifi"
        private const val KEY_OURS = "ours" // JSON object: ssid -> networkId
        private const val MAX_NETWORKS = 12

        private fun wifi(context: Context) =
            context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

        private fun isOwner(context: Context) = try {
            (context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager)
                .isDeviceOwnerApp(context.packageName)
        } catch (_: Exception) { false }

        private fun ours(context: Context): JSONObject = try {
            JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_OURS, "{}") ?: "{}")
        } catch (_: Exception) { JSONObject() }

        private fun saveOurs(context: Context, map: JSONObject) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_OURS, map.toString()).apply()
        }

        private fun quoted(s: String) = "\"" + s + "\""
        private val HEX = Regex("^[0-9a-fA-F]+$")

        /**
         * Saves one network for the whole device. Returns null on success, otherwise
         * the reason in German (shown in the kit).
         */
        @SuppressLint("MissingPermission")
        @Suppress("DEPRECATION")
        fun addNetwork(context: Context, ssid: String, password: String, type: String, hidden: Boolean): String? {
            if (ssid.isBlank() || ssid.toByteArray(Charsets.UTF_8).size > 32) return "WLAN-Name ungültig"
            if (!isOwner(context)) return "FreeKiosk ist keine Geräteverwaltung"
            val kind = type.uppercase().ifBlank { if (password.isEmpty()) "OPEN" else "WPA" }
            val conf = WifiConfiguration()
            conf.SSID = quoted(ssid)
            conf.hiddenSSID = hidden
            when (kind) {
                "OPEN", "NONE" -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) conf.setSecurityParams(WifiConfiguration.SECURITY_TYPE_OPEN)
                    else conf.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE)
                }
                "WEP" -> {
                    if (password.isEmpty()) return "Passwort fehlt"
                    val hexKey = (password.length == 10 || password.length == 26) && HEX.matches(password)
                    conf.wepKeys[0] = if (hexKey) password else quoted(password)
                    conf.wepTxKeyIndex = 0
                    conf.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE)
                    conf.allowedAuthAlgorithms.set(WifiConfiguration.AuthAlgorithm.OPEN)
                    conf.allowedAuthAlgorithms.set(WifiConfiguration.AuthAlgorithm.SHARED)
                }
                else -> {
                    val rawPsk = password.length == 64 && HEX.matches(password)
                    if (!rawPsk && password.length !in 8..63) return "Passwort braucht 8 bis 63 Zeichen"
                    conf.preSharedKey = if (rawPsk) password else quoted(password)
                    val sae = kind == "SAE" || kind == "WPA3"
                    when {
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
                            conf.setSecurityParams(if (sae) WifiConfiguration.SECURITY_TYPE_SAE else WifiConfiguration.SECURITY_TYPE_PSK)
                        sae && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ->
                            conf.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.SAE)
                        else -> conf.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.WPA_PSK)
                    }
                }
            }
            val wm = wifi(context)
            val id = try { wm.addNetwork(conf) } catch (e: Exception) { Log.w(TAG, "addNetwork: ${e.message}"); -1 }
            if (id == -1) return "Android hat das WLAN nicht gespeichert"
            // Allowed to join automatically, without leaving the current network now
            try { wm.enableNetwork(id, false) } catch (_: Exception) {}
            val map = ours(context)
            map.put(ssid, id)
            saveOurs(context, map)
            Log.i(TAG, "Saved Wi-Fi network \"$ssid\" ($kind)")
            return null
        }

        @Volatile private var ssidAccessTried = false

        /**
         * Android shows the name of the current Wi-Fi network only to apps with location
         * permission while location is on. A Device Owner can grant itself the permission
         * and switch location on; tried once per app start.
         */
        fun ensureSsidAccess(context: Context) {
            if (ssidAccessTried) return
            ssidAccessTried = true
            if (!isOwner(context)) return
            try {
                val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                val admin = ComponentName(context, DeviceAdminReceiver::class.java)
                for (p in listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) {
                    if (context.checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                        dpm.setPermissionGrantState(admin, context.packageName, p, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
                    }
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
                    if (lm != null && !lm.isLocationEnabled) dpm.setLocationEnabled(admin, true)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not unlock the Wi-Fi name: ${e.message}")
            }
        }

        /** From the provisioning QR or an ADB intent. Returns how many networks were saved. */
        fun addFromConfig(context: Context, json: String): Int {
            val list = try { JSONArray(json) } catch (e: Exception) {
                Log.w(TAG, "wifi_more is not a JSON list: ${e.message}")
                return 0
            }
            var saved = 0
            for (i in 0 until minOf(list.length(), MAX_NETWORKS)) {
                val o = list.optJSONObject(i) ?: continue
                val error = addNetwork(
                    context,
                    o.optString("s", o.optString("ssid", "")),
                    o.optString("p", o.optString("password", "")),
                    o.optString("t", o.optString("type", "")),
                    o.optBoolean("h", o.optBoolean("hidden", false)),
                )
                if (error == null) saved++ else Log.w(TAG, "Wi-Fi network ${i + 1} not saved: $error")
            }
            return saved
        }
    }

    private var lastAction = ""
    private var lastError = ""

    private fun ok(action: String) { lastAction = action; lastError = ""; onChanged() }
    private fun fail(message: String) { lastError = message; Log.w(TAG, message); onChanged() }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun currentSsid(): String? = try {
        wifi(context).connectionInfo?.ssid?.removeSurrounding("\"")?.takeIf { it.isNotEmpty() && it != "<unknown ssid>" }
    } catch (_: Exception) { null }

    /** All saved networks Android tells a Device Owner about; null when it does not. */
    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun configured(): List<WifiConfiguration>? = try {
        wifi(context).configuredNetworks?.takeIf { it.isNotEmpty() }
    } catch (_: Exception) { null }

    fun status(): JSONObject {
        val mine = ours(context)
        val current = currentSsid()
        val seen = linkedSetOf<String>()
        val conf = configured()
        conf?.forEach { c -> c.SSID?.removeSurrounding("\"")?.takeIf { it.isNotEmpty() }?.let { seen.add(it) } }
        mine.keys().forEach { seen.add(it) }
        val saved = JSONArray()
        for (ssid in seen) {
            saved.put(JSONObject().put("ssid", ssid).put("ours", mine.has(ssid)).put("current", ssid == current))
        }
        return JSONObject()
            .put("saved", saved)
            .put("complete", conf != null)
            .put("current", current ?: JSONObject.NULL)
            .put("owner", isOwner(context))
            .put("signed", AdminSignature.hasKey(context))
            .put("lastAction", lastAction)
            .put("lastError", lastError)
    }

    /** MQTT wifi_add: {ssid, enc, type, hidden, ts, sig}; signed over "wifi_add|ssid|enc|type|0/1|ts". */
    fun add(params: JSONObject?) {
        val ssid = params?.optString("ssid", "") ?: ""
        val enc = params?.optString("enc", "") ?: ""
        val type = params?.optString("type", "") ?: ""
        val hidden = params?.optBoolean("hidden", false) ?: false
        AdminSignature.verify(context, "wifi_add", ssid, "$enc|$type|${if (hidden) 1 else 0}", params)?.let { return fail(it) }
        val password = if (enc.isEmpty()) "" else AdminSignature.decrypt(context, "wifi", enc)
            ?: return fail("Passwort nicht lesbar (anderer Schlüssel?)")
        if (ours(context).length() >= MAX_NETWORKS && !ours(context).has(ssid)) return fail("Schon $MAX_NETWORKS WLANs gespeichert")
        val error = addNetwork(context, ssid, password, type, hidden)
        if (error != null) fail(error) else ok("WLAN „$ssid“ gespeichert")
    }

    /** MQTT wifi_remove: {ssid, ts, sig}; signed over "wifi_remove|ssid||ts". Never the network in use. */
    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    fun remove(params: JSONObject?) {
        val ssid = params?.optString("ssid", "") ?: ""
        AdminSignature.verify(context, "wifi_remove", ssid, "", params)?.let { return fail(it) }
        if (!isOwner(context)) return fail("FreeKiosk ist keine Geräteverwaltung")
        if (ssid == currentSsid()) return fail("Mit „$ssid“ ist das Tablet gerade verbunden. Das bleibt.")
        val wm = wifi(context)
        val mine = ours(context)
        val ids = linkedSetOf<Int>()
        configured()?.filter { it.SSID == quoted(ssid) }?.forEach { ids.add(it.networkId) }
        if (mine.has(ssid)) ids.add(mine.optInt(ssid, -1))
        ids.remove(-1)
        if (ids.isEmpty()) return fail("WLAN „$ssid“ ist nicht gespeichert")
        var removed = false
        for (id in ids) removed = (try { wm.removeNetwork(id) } catch (_: Exception) { false }) || removed
        if (!removed) return fail("Android hat „$ssid“ nicht entfernt")
        mine.remove(ssid)
        saveOurs(context, mine)
        ok("WLAN „$ssid“ entfernt")
    }
}

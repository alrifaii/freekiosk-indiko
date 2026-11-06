package com.freekiosk.indiko

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Commands that change the tablet itself (installing apps, saving Wi-Fi networks) can
 * arrive over a public MQTT broker, so they must be signed by the kit that set the
 * tablet up. The kit's admin key reached the tablet in the provisioning QR
 * (mqtt_admin_key) and never travels over MQTT.
 *
 * Signature: HMAC-SHA256 over "cmd|a|b|ts" (hex), with a and b chosen per command
 * (package and url for voices, network name and encrypted password for Wi-Fi). A
 * command older than 15 minutes, or not newer than the last accepted one, is refused.
 *
 * Secrets inside a command (a Wi-Fi password) are encrypted with AES-256-GCM under
 * SHA-256("purpose|adminKey"); the data is base64(12-byte IV + ciphertext + tag).
 */
object AdminSignature {
    const val PREFS = "FreeKioskAdmin"
    const val KEY_ADMIN = "admin_key"
    private const val KEY_LAST_TS = "last_signed_ts"
    private const val MAX_AGE_MS = 15 * 60 * 1000L

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(context: Context): String? = prefs(context).getString(KEY_ADMIN, null)?.takeIf { it.isNotEmpty() }

    fun hasKey(context: Context): Boolean = key(context) != null

    fun storeKey(context: Context, value: String) {
        if (value.length >= 32) prefs(context).edit().putString(KEY_ADMIN, value).apply()
    }

    /** Returns null when the command is authentic and fresh, otherwise the reason (German, for the kit). */
    @Synchronized
    fun verify(context: Context, cmd: String, a: String, b: String, params: JSONObject?): String? {
        val key = key(context) ?: return "Kein Schlüssel auf dem Tablet. Mit einem neuen QR-Code einrichten."
        if (params == null) return "Befehl ohne Daten"
        val ts = params.optLong("ts", 0L)
        val sig = params.optString("sig", "")
        val now = System.currentTimeMillis()
        if (ts <= 0L || kotlin.math.abs(now - ts) > MAX_AGE_MS) return "Befehl abgelaufen (Uhrzeit von Laptop und Tablet prüfen)"
        val p = prefs(context)
        if (ts <= p.getLong(KEY_LAST_TS, 0L)) return "Befehl schon verwendet"
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        val expected = mac.doFinal("$cmd|$a|$b|$ts".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        if (!MessageDigest.isEqual(expected.toByteArray(), sig.lowercase().toByteArray())) {
            return "Unterschrift passt nicht (anderer Schlüssel?)"
        }
        p.edit().putLong(KEY_LAST_TS, ts).apply()
        return null
    }

    /** Decrypts a secret the kit encrypted for [purpose]; null if it cannot. */
    fun decrypt(context: Context, purpose: String, data: String): String? {
        val key = key(context) ?: return null
        return try {
            val raw = Base64.decode(data, Base64.DEFAULT)
            if (raw.size < 12 + 16) return null
            val k = MessageDigest.getInstance("SHA-256").digest("$purpose|$key".toByteArray(Charsets.UTF_8))
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(k, "AES"), GCMParameterSpec(128, raw, 0, 12))
            String(cipher.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }
}

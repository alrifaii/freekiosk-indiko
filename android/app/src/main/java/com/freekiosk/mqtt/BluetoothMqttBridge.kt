package com.freekiosk.mqtt

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.freekiosk.DeviceAdminReceiver
import com.freekiosk.LockTaskCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Bluetooth management over MQTT: power, scan, pair, unpair, and a "bluetooth" block in
 * the published state. Same platform calls as BluetoothControlModule (the PIN-screen
 * dialog), without the React bridge, so it works while the JS thread is suspended.
 *
 * Commands arrive on the main thread from KioskMqttClient; every change calls
 * [onChanged] so the state is republished right away.
 *
 * What Android still decides: pairing may show a confirmation dialog that someone has to
 * tap (the lock task whitelist is opened for it while pairing), and removeBond is a hidden
 * API reached through reflection.
 */
class BluetoothMqttBridge(private val context: Context, private val onChanged: () -> Unit) {

    companion object {
        private const val TAG = "BluetoothMqtt"
        private const val MAX_SCAN_SECONDS = 60
        private const val PAIR_TIMEOUT_MS = 60_000L
        private val MAC_RE = Regex("^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")
    }

    private val handler = Handler(Looper.getMainLooper())
    private val found = LinkedHashMap<String, JSONObject>()
    private var scanReceiver: BroadcastReceiver? = null
    private var bondReceiver: BroadcastReceiver? = null
    private var originalLockTaskPackages: Array<String>? = null
    private var scanning = false
    private var pairing: String? = null
    private var lastAction = ""
    private var lastError = ""

    private val stopScanRunnable = Runnable { stopScan() }
    private val pairTimeoutRunnable = Runnable {
        if (pairing != null) {
            fail("Koppeln abgebrochen (keine Antwort, Dialog am Tablet bestätigt?)")
            endPairing()
        }
    }

    private fun adapter(): BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private fun has(permission: String): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    /** As Device Owner, grant the runtime permissions this needs instead of failing. */
    private fun ensurePermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        try {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            if (!dpm.isDeviceOwnerApp(context.packageName)) return
            val admin = ComponentName(context, DeviceAdminReceiver::class.java)
            for (p in listOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)) {
                if (!has(p)) {
                    dpm.setPermissionGrantState(admin, context.packageName, p,
                        DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not grant Bluetooth permissions: ${e.message}")
        }
    }

    private fun ok(action: String) {
        lastAction = action
        lastError = ""
        onChanged()
    }

    private fun fail(message: String) {
        lastError = message
        Log.w(TAG, message)
        onChanged()
    }

    private fun normalize(raw: String?): String? {
        val value = raw?.trim()?.uppercase() ?: return null
        return if (MAC_RE.matches(value)) value else null
    }

    private fun displayName(device: BluetoothDevice, advertised: String? = null): String {
        advertised?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try { device.alias?.trim()?.takeIf { it.isNotEmpty() }?.let { return it } } catch (_: SecurityException) {}
        }
        try { device.name?.trim()?.takeIf { it.isNotEmpty() }?.let { return it } } catch (_: SecurityException) {}
        return ""
    }

    private fun isConnected(device: BluetoothDevice): Boolean = try {
        device.javaClass.getMethod("isConnected").invoke(device) as? Boolean ?: false
    } catch (_: Exception) { false }

    // ─── State ───────────────────────────────────────────────────────────────

    fun status(): JSONObject {
        val out = JSONObject()
        val adapter = adapter()
        out.put("supported", adapter != null)
        out.put("enabled", try { adapter?.isEnabled == true } catch (_: Exception) { false })
        out.put("scanning", scanning)
        out.put("pairing", pairing ?: JSONObject.NULL)
        out.put("lastAction", lastAction)
        out.put("lastError", lastError)

        val bonded = JSONArray()
        if (adapter != null && has(Manifest.permission.BLUETOOTH_CONNECT)) {
            try {
                adapter.bondedDevices?.forEach { d ->
                    bonded.put(JSONObject()
                        .put("address", d.address)
                        .put("name", displayName(d))
                        .put("connected", isConnected(d)))
                }
            } catch (_: SecurityException) {}
        }
        out.put("bonded", bonded)

        // status() runs on the publishing thread, scan results arrive on the main thread
        val list = JSONArray()
        synchronized(found) { found.values.forEach { list.put(it) } }
        out.put("found", list)
        return out
    }

    // ─── Power ───────────────────────────────────────────────────────────────

    @Suppress("DEPRECATION")
    fun setEnabled(on: Boolean) {
        ensurePermissions()
        val adapter = adapter() ?: return fail("Kein Bluetooth an diesem Gerät")
        if (!has(Manifest.permission.BLUETOOTH_CONNECT)) return fail("Bluetooth-Berechtigung fehlt")
        try {
            val done = if (on) adapter.enable() else adapter.disable()
            if (!done && adapter.isEnabled != on) {
                fail(if (on) "Android lässt Bluetooth nicht einschalten" else "Android lässt Bluetooth nicht ausschalten")
            } else {
                // The adapter switches asynchronously; publish again once it settled.
                ok(if (on) "Bluetooth an" else "Bluetooth aus")
                handler.postDelayed({ onChanged() }, 2500)
            }
        } catch (e: Exception) {
            fail("Bluetooth umschalten fehlgeschlagen: ${e.message}")
        }
    }

    // ─── Scan ────────────────────────────────────────────────────────────────

    fun scan(seconds: Int) {
        ensurePermissions()
        val adapter = adapter() ?: return fail("Kein Bluetooth an diesem Gerät")
        if (!adapter.isEnabled) return fail("Bluetooth ist aus")
        if (!has(Manifest.permission.BLUETOOTH_SCAN)) return fail("Berechtigung zum Suchen fehlt")

        stopScan(publish = false)
        synchronized(found) { found.clear() }

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                when (intent.action) {
                    BluetoothDevice.ACTION_FOUND -> {
                        val device = deviceFrom(intent) ?: return
                        val name = displayName(device, intent.getStringExtra(BluetoothDevice.EXTRA_NAME))
                        val rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE).toInt()
                        val bonded = try { device.bondState == BluetoothDevice.BOND_BONDED } catch (_: SecurityException) { false }
                        val entry = JSONObject()
                            .put("address", device.address)
                            .put("name", name)
                            .put("rssi", rssi)
                            .put("bonded", bonded)
                        synchronized(found) { found[device.address] = entry }
                        onChanged()
                    }
                    BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                        // Classic discovery ends after ~12 s; restart it until the requested time is up.
                        if (scanning) {
                            try { adapter.startDiscovery() } catch (_: Exception) {}
                        }
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_FOUND)
            addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                context.registerReceiver(receiver, filter)
            }
            scanReceiver = receiver
            if (adapter.isDiscovering) adapter.cancelDiscovery()
            if (!adapter.startDiscovery()) {
                stopScan(publish = false)
                return fail("Suche konnte nicht starten")
            }
            scanning = true
            handler.removeCallbacks(stopScanRunnable)
            handler.postDelayed(stopScanRunnable, seconds.coerceIn(5, MAX_SCAN_SECONDS) * 1000L)
            ok("Suche läuft")
        } catch (e: Exception) {
            stopScan(publish = false)
            fail("Suche fehlgeschlagen: ${e.message}")
        }
    }

    fun stopScan(publish: Boolean = true) {
        handler.removeCallbacks(stopScanRunnable)
        val wasScanning = scanning
        scanning = false
        scanReceiver?.let { r ->
            try { adapter()?.cancelDiscovery() } catch (_: Exception) {}
            try { context.unregisterReceiver(r) } catch (_: Exception) {}
        }
        scanReceiver = null
        if (publish && wasScanning) ok("Suche beendet")
    }

    // ─── Pair / unpair ───────────────────────────────────────────────────────

    fun pair(rawAddress: String?) {
        ensurePermissions()
        val address = normalize(rawAddress) ?: return fail("Ungültige Bluetooth-Adresse")
        val adapter = adapter() ?: return fail("Kein Bluetooth an diesem Gerät")
        if (!adapter.isEnabled) return fail("Bluetooth ist aus")
        if (!has(Manifest.permission.BLUETOOTH_CONNECT)) return fail("Bluetooth-Berechtigung fehlt")

        try {
            val device = adapter.getRemoteDevice(address)
            if (device.bondState == BluetoothDevice.BOND_BONDED) return ok("Schon gekoppelt")

            stopScan(publish = false)
            endPairing()
            allowPairingDialogs()

            val receiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    if (intent.action != BluetoothDevice.ACTION_BOND_STATE_CHANGED) return
                    if (deviceFrom(intent)?.address != address) return
                    when (intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE)) {
                        BluetoothDevice.BOND_BONDED -> {
                            endPairing()
                            synchronized(found) { found.remove(address) }
                            ok("Gekoppelt")
                        }
                        BluetoothDevice.BOND_NONE -> {
                            endPairing()
                            fail("Koppeln abgelehnt oder fehlgeschlagen")
                        }
                    }
                }
            }
            val filter = IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                context.registerReceiver(receiver, filter)
            }
            bondReceiver = receiver

            if (!device.createBond()) {
                endPairing()
                return fail("Koppeln konnte nicht starten")
            }
            pairing = address
            handler.postDelayed(pairTimeoutRunnable, PAIR_TIMEOUT_MS)
            ok("Koppeln läuft")
        } catch (e: Exception) {
            endPairing()
            fail("Koppeln fehlgeschlagen: ${e.message}")
        }
    }

    fun unpair(rawAddress: String?) {
        ensurePermissions()
        val address = normalize(rawAddress) ?: return fail("Ungültige Bluetooth-Adresse")
        val adapter = adapter() ?: return fail("Kein Bluetooth an diesem Gerät")
        try {
            val device = adapter.getRemoteDevice(address)
            if (device.bondState != BluetoothDevice.BOND_BONDED) return ok("War nicht gekoppelt")
            // removeBond is hidden API, reached through reflection
            val removed = device.javaClass.getMethod("removeBond").invoke(device) as? Boolean ?: false
            if (removed) {
                ok("Entfernt")
                handler.postDelayed({ onChanged() }, 1500)
            } else {
                fail("Android hat das Entfernen abgelehnt")
            }
        } catch (e: Exception) {
            fail("Entfernen fehlgeschlagen: ${e.message}")
        }
    }

    private fun endPairing() {
        handler.removeCallbacks(pairTimeoutRunnable)
        pairing = null
        bondReceiver?.let { try { context.unregisterReceiver(it) } catch (_: Exception) {} }
        bondReceiver = null
        restorePairingDialogs()
    }

    fun release() {
        stopScan(publish = false)
        endPairing()
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private fun deviceFrom(intent: Intent): BluetoothDevice? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        }

    /** Lock task blocks the pairing confirmation dialog; open the whitelist while pairing. */
    private fun allowPairingDialogs() {
        try {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            if (!dpm.isDeviceOwnerApp(context.packageName)) return
            val admin = ComponentName(context, DeviceAdminReceiver::class.java)
            val current = LockTaskCompat.readPackages(dpm, admin) ?: return
            if (originalLockTaskPackages == null) originalLockTaskPackages = current
            val extra = mutableSetOf("android", "com.android.settings", "com.android.bluetooth")
            try {
                val probe = Intent(BluetoothDevice.ACTION_PAIRING_REQUEST).addCategory(Intent.CATEGORY_DEFAULT)
                context.packageManager.queryIntentActivities(probe, PackageManager.MATCH_DEFAULT_ONLY)
                    .forEach { info -> info.activityInfo?.packageName?.let { extra.add(it) } }
            } catch (_: Exception) {}
            val updated = (current.toList() + extra).distinct()
            if (updated.toSet() != current.toSet()) dpm.setLockTaskPackages(admin, updated.toTypedArray())
        } catch (e: Exception) {
            Log.w(TAG, "Could not open lock task whitelist for pairing: ${e.message}")
        }
    }

    private fun restorePairingDialogs() {
        val original = originalLockTaskPackages ?: return
        try {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            if (dpm.isDeviceOwnerApp(context.packageName)) {
                dpm.setLockTaskPackages(ComponentName(context, DeviceAdminReceiver::class.java), original)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not restore lock task whitelist: ${e.message}")
        } finally {
            originalLockTaskPackages = null
        }
    }
}

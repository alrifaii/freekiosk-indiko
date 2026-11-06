package com.freekiosk.indiko.speech

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import org.json.JSONObject

/**
 * NativeModules.FreeKioskSpeech: the WebView's speechSynthesis bridge talks to [SpeechHub]
 * through this. Events go out as "FreeKioskSpeechEvent" with a JSON string
 * {type: start|end|error|voices, id, error?}.
 */
class SpeechModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val listener: (JSONObject) -> Unit = { ev -> send(ev) }

    init {
        SpeechHub.init(reactContext.applicationContext)
        SpeechHub.addListener(listener)
    }

    override fun getName() = "FreeKioskSpeech"

    private fun send(ev: JSONObject) {
        try {
            if (!reactContext.hasActiveReactInstance()) return
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("FreeKioskSpeechEvent", ev.toString())
        } catch (_: Exception) {}
    }

    /** Voices as a JSON string, handed to the page unchanged. */
    @ReactMethod
    fun getVoices(promise: Promise) {
        try { promise.resolve(SpeechHub.voicesJson().toString()) } catch (e: Exception) { promise.resolve("[]") }
    }

    @ReactMethod
    fun speak(id: String, text: String, voiceUri: String, lang: String, rate: Double, pitch: Double, volume: Double) {
        SpeechHub.speak(id, text, voiceUri, lang, rate.toFloat(), pitch.toFloat(), volume.toFloat())
    }

    @ReactMethod
    fun cancel() {
        SpeechHub.stop()
    }

    // Required by NativeEventEmitter
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    override fun invalidate() {
        SpeechHub.removeListener(listener)
        super.invalidate()
    }
}

class SpeechPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(SpeechModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

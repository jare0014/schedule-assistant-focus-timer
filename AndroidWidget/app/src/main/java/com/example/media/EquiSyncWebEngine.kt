package com.example.media

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class EquiSyncWebEngine(private val context: Context) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    var isPlaying: Boolean = false
        private set

    @SuppressLint("SetJavaScriptEnabled")
    private fun ensureWebView(): WebView {
        if (webView == null) {
            val wv = WebView(context.applicationContext)
            wv.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                databaseEnabled = true
                cacheMode = WebSettings.LOAD_DEFAULT
            }
            wv.webChromeClient = WebChromeClient()
            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    Log.d("EquiSyncWebEngine", "Page loaded: $url")
                    triggerPlayJs()
                }
            }
            webView = wv
        }
        return webView!!
    }

    fun play(url: String) {
        mainHandler.post {
            try {
                val wv = ensureWebView()
                Log.d("EquiSyncWebEngine", "Loading EquiSync URL: $url")
                wv.loadUrl(url)
                isPlaying = true
            } catch (e: Exception) {
                Log.e("EquiSyncWebEngine", "Error playing EquiSync: ${e.message}")
            }
        }
    }

    fun pause() {
        mainHandler.post {
            try {
                webView?.evaluateJavascript(
                    """
                    (function() {
                        var audios = document.querySelectorAll('audio, video');
                        audios.forEach(function(a) { a.pause(); });
                        var btns = document.querySelectorAll('.play-btn, .pause-btn, button[title*="Pause"], button[aria-label*="Pause"]');
                        btns.forEach(function(b) { b.click(); });
                    })();
                    """.trimIndent(), null
                )
                isPlaying = false
            } catch (e: Exception) {
                Log.e("EquiSyncWebEngine", "Error pausing EquiSync: ${e.message}")
            }
        }
    }

    fun resume() {
        mainHandler.post {
            triggerPlayJs()
            isPlaying = true
        }
    }

    private fun triggerPlayJs() {
        mainHandler.post {
            try {
                webView?.evaluateJavascript(
                    """
                    (function() {
                        var audios = document.querySelectorAll('audio, video');
                        audios.forEach(function(a) { a.play(); });
                        var btns = document.querySelectorAll('.play-btn, button[title*="Play"], button[aria-label*="Play"]');
                        btns.forEach(function(b) { b.click(); });
                    })();
                    """.trimIndent(), null
                )
            } catch (e: Exception) {
                Log.e("EquiSyncWebEngine", "Error resuming EquiSync: ${e.message}")
            }
        }
    }

    fun stop() {
        mainHandler.post {
            pause()
            try {
                webView?.loadUrl("about:blank")
                webView?.destroy()
                webView = null
                isPlaying = false
            } catch (e: Exception) {
                Log.e("EquiSyncWebEngine", "Error stopping EquiSync: ${e.message}")
            }
        }
    }
}

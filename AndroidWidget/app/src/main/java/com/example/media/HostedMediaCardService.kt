package com.example.media

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.VolumeProvider
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import com.example.MainActivity
import com.example.data.ObsidianSyncRepository
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** A system media card for audio hosted on kilPC. This service never plays audio locally. */
class HostedMediaCardService : Service() {
    private lateinit var session: MediaSession
    private lateinit var repository: ObsidianSyncRepository
    private val worker = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private var playing = false
    private var title = "kilPC Focus Media"
    private var source = "kilPC"
    private var available = false

    companion object {
        private const val CHANNEL = "hosted_media_card"
        private const val NOTIFICATION_ID = 2002
        private const val ACTION_PLAY = "com.example.media.HOSTED_PLAY"
        private const val ACTION_PAUSE = "com.example.media.HOSTED_PAUSE"
        private const val ACTION_NEXT_SOURCE = "com.example.media.HOSTED_NEXT_SOURCE"

        fun show(context: Context) {
            // Retire the old phone player and its saved-track notification when
            // entering hosted mode. Timer/media controls now belong to kilPC.
            context.stopService(Intent(context, FocusMediaService::class.java))
            val intent = Intent(context, HostedMediaCardService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }
    }

    override fun onCreate() {
        super.onCreate()
        repository = ObsidianSyncRepository(this)
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(
            NotificationChannel(CHANNEL, "kilPC media controls", NotificationManager.IMPORTANCE_LOW)
        )
        session = MediaSession(this, "kilPC-hosted-media")
        session.setCallback(object : MediaSession.Callback() {
            override fun onPlay() = control("play")
            override fun onPause() = control("pause")
            override fun onCustomAction(action: String, extras: Bundle?) {
                if (action == ACTION_NEXT_SOURCE) control("next-source")
            }
        })
        session.setPlaybackToRemote(object : VolumeProvider(VolumeProvider.VOLUME_CONTROL_FIXED, 100, 50) {})
        session.isActive = true
        publishState()
        handler.post(poll)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = notification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        when (intent?.action) {
            ACTION_PLAY -> control("play")
            ACTION_PAUSE -> control("pause")
            ACTION_NEXT_SOURCE -> control("next-source")
        }
        return START_STICKY
    }

    private fun control(action: String) {
        worker.execute {
            val success = try {
                kotlinx.coroutines.runBlocking { repository.controlHostedMedia(action) }
            } catch (e: Exception) {
                Log.e("HostedMediaCard", "Remote $action failed", e)
                false
            }
            if (success) handler.post {
                handler.removeCallbacks(poll)
                handler.post(poll)
            }
        }
    }

    private val poll = object : Runnable {
        override fun run() {
            worker.execute {
                try {
                    val connection = URL("${repository.getBaseUrl()}/api/media/status").openConnection() as HttpURLConnection
                    connection.connectTimeout = 1500
                    connection.readTimeout = 10000
                    val status = connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
                    connection.disconnect()
                    handler.post {
                        playing = status.optString("state") == "playing"
                        available = status.optBoolean("success", true) && status.optString("state") in listOf("playing", "paused", "stopped")
                        source = status.optString("source", "kilPC").ifEmpty { "kilPC" }
                        title = if (available) status.optString("title").ifEmpty { "kilPC media" } else "Selected source unavailable"
                        publishState()
                    }
                } catch (e: Exception) {
                    Log.d("HostedMediaCard", "kilPC status unavailable: ${e.message}")
                    handler.post {
                        available = false
                        playing = false
                        title = "kilPC unavailable"
                        publishState()
                    }
                }
            }
            handler.postDelayed(this, 3000)
        }
    }

    private fun publishState() {
        session.setPlaybackState(
            PlaybackState.Builder()
                .setActions(if (available) PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE else 0L)
                .addCustomAction(ACTION_NEXT_SOURCE, "Next source", android.R.drawable.ic_menu_rotate)
                .setState(if (!available) PlaybackState.STATE_ERROR else if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, 0, 1f)
                .build()
        )
        session.setMetadata(
            android.media.MediaMetadata.Builder()
                .putString(android.media.MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(android.media.MediaMetadata.METADATA_KEY_ARTIST, "$source on kilPC")
                .build()
        )
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, notification())
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val action = if (playing) ACTION_PAUSE else ACTION_PLAY
        val transport = PendingIntent.getService(
            this, 1, Intent(this, HostedMediaCardService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val nextSource = PendingIntent.getService(
            this, 2, Intent(this, HostedMediaCardService::class.java).setAction(ACTION_NEXT_SOURCE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText("$source on kilPC")
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1))
            .addAction(if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (playing) "Pause" else "Play", if (available) transport else null)
            .addAction(android.R.drawable.ic_menu_rotate, "Next source", nextSource)
            .build()
    }

    override fun onDestroy() {
        handler.removeCallbacks(poll)
        worker.shutdownNow()
        session.isActive = false
        session.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

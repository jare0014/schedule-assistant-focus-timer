package com.example.media

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.util.Log
import android.view.KeyEvent
import androidx.annotation.OptIn
import androidx.core.app.NotificationCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.example.MainActivity
import com.example.data.SyncPreferences

class FocusMediaService : MediaSessionService() {

    private var mediaSession: MediaSession? = null
    private lateinit var player: ExoPlayer
    private lateinit var prefs: SyncPreferences
    private var equiSyncEngine: EquiSyncWebEngine? = null

    companion object {
        const val ACTION_PLAY = "com.example.media.ACTION_PLAY"
        const val ACTION_PAUSE = "com.example.media.ACTION_PAUSE"
        const val ACTION_RESUME = "com.example.media.ACTION_RESUME"
        const val ACTION_TOGGLE = "com.example.media.ACTION_TOGGLE"
        const val ACTION_STOP = "com.example.media.ACTION_STOP"
        const val ACTION_DUCK = "com.example.media.ACTION_DUCK"
        const val ACTION_UNDUCK = "com.example.media.ACTION_UNDUCK"

        const val EXTRA_URL = "extra_url"
        const val EXTRA_STREAM_URL = "extra_stream_url"
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_TYPE = "extra_type"

        private const val CHANNEL_ID = "focus_audio_channel"
        private const val NOTIFICATION_ID = 2001

        fun playTrack(context: Context, label: String, url: String, streamUrl: String?, type: String) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_PLAY
                putExtra(EXTRA_TITLE, label)
                putExtra(EXTRA_URL, url)
                putExtra(EXTRA_STREAM_URL, streamUrl)
                putExtra(EXTRA_TYPE, type)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun pauseAudio(context: Context) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_PAUSE
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {}
        }

        fun resumeAudio(context: Context) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_RESUME
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {}
        }

        fun toggleAudio(context: Context) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_TOGGLE
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {}
        }

        fun duckAudio(context: Context) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_DUCK
            }
            try { context.startService(intent) } catch (e: Exception) {}
        }

        fun unduckAudio(context: Context) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_UNDUCK
            }
            try { context.startService(intent) } catch (e: Exception) {}
        }

        fun stopAudio(context: Context) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_STOP
            }
            try { context.startService(intent) } catch (e: Exception) {}
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Focus Audio Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Background audio streaming for focus tracks and podcasts"
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(title: String = prefs.selectedAudioTrackLabel, isPlaying: Boolean = prefs.isPhoneAudioPlaying): Notification {
        createNotificationChannel()

        val openIntent = Intent(this, MainActivity::class.java)
        val openPendingIntent = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val toggleIntent = Intent(this, FocusMediaService::class.java).apply { action = ACTION_TOGGLE }
        val togglePendingIntent = PendingIntent.getService(
            this, 1, toggleIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val stopIntent = Intent(this, FocusMediaService::class.java).apply { action = ACTION_STOP }
        val stopPendingIntent = PendingIntent.getService(
            this, 2, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val cleanTitle = title.ifEmpty { "Focus Audio" }.replace(Regex("^🎙️\\s*"), "")

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(cleanTitle)
            .setContentText(if (isPlaying) "Playing via kilPC Stream" else "Paused")
            .setContentIntent(openPendingIntent)
            .setOngoing(isPlaying)
            .setOnlyAlertOnce(true)
            .addAction(
                if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (isPlaying) "Pause" else "Play",
                togglePendingIntent
            )
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPendingIntent)
            .build()
    }

    private fun startForegroundCompat(notification: Notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.e("FocusMediaService", "startForeground failed: ${e.message}")
        }
    }

    private fun updateForegroundNotification(title: String = prefs.selectedAudioTrackLabel, isPlaying: Boolean = prefs.isPhoneAudioPlaying) {
        try {
            val notification = buildNotification(title, isPlaying)
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            Log.e("FocusMediaService", "updateNotification failed: ${e.message}")
        }
    }

    @OptIn(UnstableApi::class)
    override fun onCreate() {
        super.onCreate()
        prefs = SyncPreferences(applicationContext)
        equiSyncEngine = EquiSyncWebEngine(applicationContext)

        val audioAttributes = AudioAttributes.Builder()
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .setUsage(C.USAGE_MEDIA)
            .build()

        player = ExoPlayer.Builder(this)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .build()

        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                super.onIsPlayingChanged(isPlaying)
                prefs.isPhoneAudioPlaying = isPlaying || (equiSyncEngine?.isPlaying == true)
                prefs.addLog("Playback isPlaying: $isPlaying")
                updateForegroundNotification(isPlaying = prefs.isPhoneAudioPlaying)
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                super.onPlaybackStateChanged(playbackState)
                if (playbackState == Player.STATE_ENDED) {
                    prefs.isPhoneAudioPlaying = false
                    prefs.addLog("Track playback completed.")
                    updateForegroundNotification(isPlaying = false)
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                super.onPlayerError(error)
                prefs.isPhoneAudioPlaying = false
                prefs.addLog("ExoPlayer error: ${error.message} (${error.errorCodeName})")
                Log.e("FocusMediaService", "ExoPlayer error", error)
                updateForegroundNotification(isPlaying = false)
            }
        })

        val openAppIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        mediaSession = MediaSession.Builder(this, player)
            .setSessionActivity(pendingIntent)
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return mediaSession
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // ALWAYS start foreground immediately to satisfy Android 14+ FGS requirements
        startForegroundCompat(buildNotification())

        val action = intent?.action
        when (action) {
            ACTION_PLAY -> {
                val title = intent.getStringExtra(EXTRA_TITLE) ?: "Focus Audio"
                val url = intent.getStringExtra(EXTRA_URL) ?: ""
                val streamUrl = intent.getStringExtra(EXTRA_STREAM_URL)
                val type = intent.getStringExtra(EXTRA_TYPE) ?: "local"

                prefs.selectedAudioTrackLabel = title
                prefs.selectedAudioTrackUrl = url
                prefs.selectedAudioTrackStreamUrl = streamUrl ?: ""
                prefs.selectedAudioTrackType = type

                playTrackInternal(title, url, streamUrl, type)
            }
            ACTION_PAUSE -> {
                pauseInternal()
            }
            ACTION_RESUME -> {
                resumeInternal()
            }
            ACTION_TOGGLE -> {
                if (player.isPlaying || equiSyncEngine?.isPlaying == true) {
                    pauseInternal()
                } else {
                    resumeInternal()
                }
            }
            ACTION_STOP -> {
                stopInternal()
            }
            ACTION_DUCK -> {
                player.volume = 0.15f
            }
            ACTION_UNDUCK -> {
                player.volume = 1.0f
            }
        }

        return super.onStartCommand(intent, flags, startId)
    }

    private fun playTrackInternal(title: String, url: String, streamUrl: String?, type: String) {
        if (type == "external_web" && url.contains("equisync")) {
            // EquiSync Web Audio Engine
            player.pause()
            equiSyncEngine?.play(url)
            prefs.isPhoneAudioPlaying = true
            prefs.addLog("Playing EquiSync via Web Audio Engine: $title")
            updateForegroundNotification(title, true)
        } else if (type == "spotify" || type == "youtube" || url.contains("spotify.com") || url.contains("music.youtube.com") || url.contains("youtube.com") || url.contains("youtu.be")) {
            // Web/app links that cannot be parsed as raw byte streams by ExoPlayer
            player.pause()
            equiSyncEngine?.pause()
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
                prefs.isPhoneAudioPlaying = true
                prefs.addLog("Opened app for phone audio: $title")
                updateForegroundNotification(title, true)
            } catch (e: Exception) {
                prefs.addLog("Error opening app: ${e.message}")
            }
        } else {
            // Direct streaming with ExoPlayer (vault podcasts, MP3s, HTTP byte-range audio)
            equiSyncEngine?.pause()
            val playbackUrl = if (!streamUrl.isNullOrEmpty()) streamUrl else url
            if (playbackUrl.isNotEmpty()) {
                val cleanTitle = title.replace(Regex("^🎙️\\s*"), "")
                val metadata = MediaMetadata.Builder()
                    .setTitle(cleanTitle)
                    .setArtist("Obsidian Focus Session")
                    .setAlbumTitle("Schedule Assistant")
                    .build()

                val mediaItem = MediaItem.Builder()
                    .setUri(Uri.parse(playbackUrl))
                    .setMediaMetadata(metadata)
                    .build()

                player.setMediaItem(mediaItem)
                player.prepare()
                player.play()
                prefs.isPhoneAudioPlaying = true
                prefs.addLog("Streaming audio track: $title ($playbackUrl)")
                updateForegroundNotification(title, true)
            }
        }
    }

    private fun pauseInternal() {
        if (player.isPlaying) {
            player.pause()
        }
        equiSyncEngine?.pause()
        try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            audioManager?.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE))
            audioManager?.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PAUSE))
        } catch (e: Exception) {
            Log.e("FocusMediaService", "Error dispatching pause media key: ${e.message}")
        }
        prefs.isPhoneAudioPlaying = false
        prefs.addLog("Audio playback paused.")
        updateForegroundNotification(isPlaying = false)
    }

    private fun resumeInternal() {
        if (prefs.selectedAudioTrackType == "spotify" || (prefs.selectedAudioTrackType == "external_web" && !prefs.selectedAudioTrackUrl.contains("equisync")) || prefs.selectedAudioTrackType == "youtube") {
            try {
                val audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
                audioManager?.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY))
                audioManager?.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PLAY))
            } catch (e: Exception) {
                Log.e("FocusMediaService", "Error dispatching play media key: ${e.message}")
            }
            prefs.isPhoneAudioPlaying = true
        } else if (prefs.selectedAudioTrackType == "external_web" && prefs.selectedAudioTrackUrl.contains("equisync")) {
            equiSyncEngine?.resume()
            prefs.isPhoneAudioPlaying = true
        } else {
            if (player.mediaItemCount > 0) {
                player.play()
                prefs.isPhoneAudioPlaying = true
            } else {
                playTrackInternal(
                    prefs.selectedAudioTrackLabel,
                    prefs.selectedAudioTrackUrl,
                    prefs.selectedAudioTrackStreamUrl,
                    prefs.selectedAudioTrackType
                )
            }
        }
        prefs.addLog("Audio playback resumed.")
        updateForegroundNotification(isPlaying = true)
    }

    private fun stopInternal() {
        player.stop()
        player.clearMediaItems()
        equiSyncEngine?.stop()
        try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            audioManager?.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE))
            audioManager?.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PAUSE))
        } catch (e: Exception) {
            Log.e("FocusMediaService", "Error dispatching pause media key: ${e.message}")
        }
        prefs.isPhoneAudioPlaying = false
        prefs.addLog("Audio playback stopped.")
        try {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (e: Exception) {}
        stopSelf()
    }

    override fun onDestroy() {
        mediaSession?.run {
            player.release()
            release()
            mediaSession = null
        }
        equiSyncEngine?.stop()
        super.onDestroy()
    }
}

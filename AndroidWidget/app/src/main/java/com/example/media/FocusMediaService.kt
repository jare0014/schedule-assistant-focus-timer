package com.example.media

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
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

        fun playTrack(context: Context, label: String, url: String, streamUrl: String?, type: String) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_PLAY
                putExtra(EXTRA_TITLE, label)
                putExtra(EXTRA_URL, url)
                putExtra(EXTRA_STREAM_URL, streamUrl)
                putExtra(EXTRA_TYPE, type)
            }
            context.startService(intent)
        }

        fun pauseAudio(context: Context) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_PAUSE
            }
            context.startService(intent)
        }

        fun resumeAudio(context: Context) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_RESUME
            }
            context.startService(intent)
        }

        fun toggleAudio(context: Context) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_TOGGLE
            }
            context.startService(intent)
        }

        fun duckAudio(context: Context) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_DUCK
            }
            context.startService(intent)
        }

        fun unduckAudio(context: Context) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_UNDUCK
            }
            context.startService(intent)
        }

        fun stopAudio(context: Context) {
            val intent = Intent(context, FocusMediaService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
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
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                super.onPlaybackStateChanged(playbackState)
                if (playbackState == Player.STATE_ENDED) {
                    prefs.isPhoneAudioPlaying = false
                    prefs.addLog("Track playback completed.")
                }
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
        } else {
            // Direct streaming with ExoPlayer
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
            }
        }
    }

    private fun pauseInternal() {
        if (player.isPlaying) {
            player.pause()
        }
        equiSyncEngine?.pause()
        prefs.isPhoneAudioPlaying = false
        prefs.addLog("Audio playback paused.")
    }

    private fun resumeInternal() {
        if (prefs.selectedAudioTrackType == "external_web" && prefs.selectedAudioTrackUrl.contains("equisync")) {
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
    }

    private fun stopInternal() {
        player.stop()
        player.clearMediaItems()
        equiSyncEngine?.stop()
        prefs.isPhoneAudioPlaying = false
        prefs.addLog("Audio playback stopped.")
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

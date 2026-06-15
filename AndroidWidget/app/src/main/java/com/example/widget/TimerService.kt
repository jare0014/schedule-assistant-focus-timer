package com.example.widget

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.example.MainActivity
import com.example.R
import com.example.data.ObsidianSyncRepository
import com.example.data.SyncPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class TimerService : Service() {

    private lateinit var prefs: SyncPreferences
    private var timerJob: Job? = null
    private val serviceScope = CoroutineScope(Dispatchers.Main + Job())

    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null

    companion object {
        private const val CHANNEL_ID = "focus_timer_channel"
        private const val NOTIFICATION_ID = 1001

        fun checkAndSyncTimerService(context: Context) {
            val prefs = SyncPreferences(context)
            val intent = Intent(context, TimerService::class.java)
            if (prefs.activeTimerTaskName.isNotEmpty()) {
                intent.action = "START"
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } else {
                intent.action = "STOP"
                context.stopService(intent)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        prefs = SyncPreferences(applicationContext)
        
        // Initialize vibrator
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vibratorManager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: "START"
        Log.d("TimerService", "onStartCommand action: $action")

        when (action) {
            "START" -> {
                createNotificationChannel()
                startForeground(NOTIFICATION_ID, buildNotification())
                startCountdown()
            }
            "STOP" -> {
                stopTimerState()
            }
            "PAUSE" -> {
                prefs.activeTimerIsPaused = true
                updateNotificationAndWidget()
            }
            "RESUME" -> {
                prefs.activeTimerIsPaused = false
                updateNotificationAndWidget()
            }
            "CANCEL" -> {
                serviceScope.launch(Dispatchers.IO) {
                    val repo = ObsidianSyncRepository(applicationContext)
                    repo.cancelTimer()
                    launch(Dispatchers.Main) {
                        stopTimerState()
                    }
                }
            }
        }
        return START_STICKY
    }

    private fun startCountdown() {
        timerJob?.cancel()
        timerJob = serviceScope.launch {
            while (true) {
                delay(1000)
                if (prefs.activeTimerTaskName.isEmpty()) {
                    stopTimerState()
                    break
                }

                if (!prefs.activeTimerIsPaused && !prefs.isAlarming) {
                    var remaining = prefs.activeTimerRemainingSeconds
                    if (remaining > 0) {
                        remaining--
                        prefs.activeTimerRemainingSeconds = remaining
                        
                        // Update widget every minute, or when remaining seconds is 0
                        if (remaining % 60 == 0 || remaining == 0) {
                            updateWidget(applicationContext)
                        }
                        
                        updateNotificationOnly()
                    } else {
                        // Timer expired! Trigger Alarm!
                        triggerAlarm()
                    }
                }
            }
        }
    }

    private fun triggerAlarm() {
        prefs.isAlarming = true
        updateNotificationAndWidget()
        
        // Start playing alarm ringtone
        try {
            if (ringtone == null) {
                val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                ringtone = RingtoneManager.getRingtone(applicationContext, alarmUri)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    ringtone?.audioAttributes = AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                }
            }
            if (ringtone?.isPlaying == false) {
                ringtone?.play()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // Start vibrating
        try {
            vibrator?.let { v ->
                if (v.hasVibrator()) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 1000, 1000), 0))
                    } else {
                        @Suppress("DEPRECATION")
                        v.vibrate(longArrayOf(0, 1000, 1000), 0)
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun stopTimerState() {
        timerJob?.cancel()
        
        // Stop audio & vibration
        try {
            if (ringtone?.isPlaying == true) {
                ringtone?.stop()
            }
            ringtone = null
            vibrator?.cancel()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        
        prefs.isAlarming = false
        stopForeground(true)
        stopSelf()
        
        updateWidget(applicationContext)
    }

    private fun updateNotificationAndWidget() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification())
        updateWidget(applicationContext)
    }

    private fun updateNotificationOnly() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun updateWidget(context: Context) {
        val appWidgetManager = AppWidgetManager.getInstance(context)
        val ids = appWidgetManager.getAppWidgetIds(ComponentName(context, ObsidianTodoWidgetProvider::class.java))
        appWidgetManager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list_view)
        val provider = ObsidianTodoWidgetProvider()
        provider.onUpdate(context, appWidgetManager, ids)
    }

    private fun buildNotification(): Notification {
        val taskName = prefs.activeTimerTaskName
        val remaining = prefs.activeTimerRemainingSeconds
        val isPaused = prefs.activeTimerIsPaused
        val isAlarm = prefs.isAlarming

        val mins = remaining / 60
        val secs = remaining % 60
        
        val contentTitle = if (isAlarm) "Time's Up!" else "Focus: $taskName"
        val contentText = when {
            isAlarm -> "Focus session completed. Tap Dismiss to stop the alarm."
            isPaused -> String.format("%02d:%02d (Paused)", mins, secs)
            else -> String.format("%02d:%02d remaining", mins, secs)
        }

        // Open App Intent
        val openAppIntent = Intent(this, MainActivity::class.java)
        val openAppPendingIntent = PendingIntent.getActivity(
            this,
            201,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(contentTitle)
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setOngoing(true)
            .setContentIntent(openAppPendingIntent)
            .setPriority(if (isAlarm) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_LOW)
            .setCategory(if (isAlarm) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_SERVICE)

        if (isAlarm) {
            // Dismiss Action for Alarm
            val dismissIntent = Intent(this, TimerService::class.java).apply { action = "CANCEL" }
            val dismissPendingIntent = PendingIntent.getService(
                this,
                202,
                dismissIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Dismiss", dismissPendingIntent)
        } else {
            // Pause/Resume action
            val pauseIntent = Intent(this, TimerService::class.java).apply {
                action = if (isPaused) "RESUME" else "PAUSE"
            }
            val pausePendingIntent = PendingIntent.getService(
                this,
                203,
                pauseIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val pauseLabel = if (isPaused) "Resume" else "Pause"
            builder.addAction(
                if (isPaused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause,
                pauseLabel,
                pausePendingIntent
            )

            // Cancel action
            val cancelIntent = Intent(this, TimerService::class.java).apply { action = "CANCEL" }
            val cancelPendingIntent = PendingIntent.getService(
                this,
                204,
                cancelIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", cancelPendingIntent)
        }

        return builder.build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Active Focus Timer Channel",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows progress and controls for the active focus task timer."
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        serviceScope.launch(Dispatchers.Main) {
            stopTimerState()
        }
        super.onDestroy()
    }
}

package com.example.widget

import android.content.Intent
import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class PhoneWearSyncService : WearableListenerService() {

    override fun onMessageReceived(messageEvent: MessageEvent) {
        super.onMessageReceived(messageEvent)
        val path = messageEvent.path
        Log.d("PhoneWearSyncService", "Message received from watch: $path")

        val intent = Intent(applicationContext, TimerService::class.java)
        when (path) {
            "/pause" -> {
                intent.action = "PAUSE"
                startServiceOrForeground(intent)
            }
            "/resume" -> {
                intent.action = "RESUME"
                startServiceOrForeground(intent)
            }
            "/cancel" -> {
                intent.action = "CANCEL"
                startServiceOrForeground(intent)
            }
            else -> {
                if (path.startsWith("/quicklog/")) {
                    val foodId = path.substring("/quicklog/".length)
                    val repository = com.example.data.ObsidianSyncRepository(applicationContext)
                    CoroutineScope(Dispatchers.IO).launch {
                        repository.quickLog(foodId)
                    }
                }
            }
        }
    }

    private fun startServiceOrForeground(intent: Intent) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } catch (e: Exception) {
            Log.e("PhoneWearSyncService", "Failed to start TimerService: ${e.message}")
        }
    }
}

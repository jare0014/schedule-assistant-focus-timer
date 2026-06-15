package com.example.wear

import android.util.Log
import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

class WearDataListenerService : WearableListenerService() {

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        Log.d("WearDataListener", "onDataChanged triggered")
        for (event in dataEvents) {
            if (event.type == DataEvent.TYPE_CHANGED) {
                val path = event.dataItem.uri.path
                if (path == "/timer_state") {
                    val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                    val taskName = dataMap.getString("taskName", "No task selected")
                    val remainingSeconds = dataMap.getInt("remainingSeconds", 0)
                    val totalSeconds = dataMap.getInt("totalSeconds", 0)
                    val isPaused = dataMap.getBoolean("isPaused", false)
                    val isAlarming = dataMap.getBoolean("isAlarming", false)

                    Log.d("WearDataListener", "Received timer state: $taskName, $remainingSeconds, isPaused=$isPaused")

                    // Save to SharedPreferences
                    val prefs = getSharedPreferences("wear_prefs", MODE_PRIVATE)
                    prefs.edit().apply {
                        putString("taskName", taskName)
                        putInt("remainingSeconds", remainingSeconds)
                        putInt("totalSeconds", totalSeconds)
                        putBoolean("isPaused", isPaused)
                        putBoolean("isAlarming", isAlarming)
                        apply()
                    }

                    // Request Tile update
                    try {
                        TileService.getUpdater(applicationContext)
                            .requestUpdate(WearTimerTileService::class.java)
                        Log.d("WearDataListener", "Tile update requested successfully")
                    } catch (e: Exception) {
                        Log.e("WearDataListener", "Failed to trigger tile update: ${e.message}")
                    }
                }
            }
        }
    }
}

package com.example.wear

import android.app.Activity
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.widget.Toast
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray

abstract class BaseQuickLogActivity(private val foodId: String, private val foodName: String) : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            val vibrator = getSystemService(VIBRATOR_SERVICE) as? Vibrator
            vibrator?.vibrate(VibrationEffect.createOneShot(100, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Exception) {}

        Toast.makeText(this, "Logged $foodName! 🥑", Toast.LENGTH_SHORT).show()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val nodeClient = Wearable.getNodeClient(this@BaseQuickLogActivity)
                val nodes = Tasks.await(nodeClient.connectedNodes)
                for (node in nodes) {
                    Wearable.getMessageClient(this@BaseQuickLogActivity)
                        .sendMessage(node.id, "/quicklog/$foodId", ByteArray(0))
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
        finish()
    }
}

class QuickLogWaterActivity : BaseQuickLogActivity("water", "Water")
class QuickLogEspressoActivity : BaseQuickLogActivity("espresso", "Espresso")
class QuickLogWafflesActivity : BaseQuickLogActivity("protein_waffles", "Waffles")
class QuickLogShakeActivity : BaseQuickLogActivity("protein_shake", "Shake")
class QuickLogNutsActivity : BaseQuickLogActivity("mixed_nuts", "Nuts")

class StartNextTaskActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("wear_prefs", MODE_PRIVATE)
        val blocksJson = prefs.getString("schedule_blocks_json", "[]") ?: "[]"
        var nextTitle: String? = null
        try {
            val arr = JSONArray(blocksJson)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                if (!obj.optBoolean("isCompleted", false)) {
                    nextTitle = obj.optString("title", "")
                    break
                }
            }
        } catch (_: Exception) {}

        if (!nextTitle.isNullOrEmpty()) {
            try {
                val vibrator = getSystemService(VIBRATOR_SERVICE) as? Vibrator
                vibrator?.vibrate(VibrationEffect.createOneShot(120, VibrationEffect.DEFAULT_AMPLITUDE))
            } catch (_: Exception) {}

            Toast.makeText(this, "Starting $nextTitle... ⏱️", Toast.LENGTH_SHORT).show()

            val encodedTitle = android.net.Uri.encode(nextTitle)
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val nodeClient = Wearable.getNodeClient(this@StartNextTaskActivity)
                    val nodes = Tasks.await(nodeClient.connectedNodes)
                    for (node in nodes) {
                        Wearable.getMessageClient(this@StartNextTaskActivity)
                            .sendMessage(node.id, "/start_task/$encodedTitle", ByteArray(0))
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        } else {
            Toast.makeText(this, "No pending tasks found for today!", Toast.LENGTH_SHORT).show()
        }
        finish()
    }
}

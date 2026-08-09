package com.example.wear

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.widget.Toast
import androidx.wear.compose.material.*
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class WearMainActivity : ComponentActivity(), DataClient.OnDataChangedListener, MessageClient.OnMessageReceivedListener {

    private var taskName by mutableStateOf("No task selected")
    private var remainingSeconds by mutableIntStateOf(0)
    private var totalSeconds by mutableIntStateOf(0)
    private var isPaused by mutableStateOf(false)
    private var isAlarming by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            WearAppTheme {
                WearTimerScreen(
                    taskName = taskName,
                    remainingSeconds = remainingSeconds,
                    isPaused = isPaused,
                    isAlarming = isAlarming,
                    onPauseResumeClick = { sendControlMessage(if (isPaused) "/resume" else "/pause") },
                    onCancelClick = { sendControlMessage("/cancel") },
                    onQuickLogClick = { foodId ->
                        val foodName = when (foodId) {
                            "water" -> "Water"
                            "espresso" -> "Espresso"
                            "protein_waffles" -> "Waffle"
                            "protein_shake" -> "Shake"
                            "mixed_nuts" -> "Nuts"
                            else -> foodId
                        }
                        triggerVibration()
                        Toast.makeText(this@WearMainActivity, "Logging $foodName...", Toast.LENGTH_SHORT).show()
                        sendControlMessage("/quicklog/$foodId")
                    }
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        Wearable.getDataClient(this).addListener(this)
        Wearable.getMessageClient(this).addListener(this)
        queryCurrentTimerState()
    }

    override fun onPause() {
        super.onPause()
        Wearable.getDataClient(this).removeListener(this)
        Wearable.getMessageClient(this).removeListener(this)
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        for (event in dataEvents) {
            if (event.type == com.google.android.gms.wearable.DataEvent.TYPE_CHANGED) {
                val path = event.dataItem.uri.path
                if (path == "/timer_state") {
                    val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                    taskName = dataMap.getString("taskName", "No task selected")
                    remainingSeconds = dataMap.getInt("remainingSeconds", 0)
                    totalSeconds = dataMap.getInt("totalSeconds", 0)
                    isPaused = dataMap.getBoolean("isPaused", false)
                    isAlarming = dataMap.getBoolean("isAlarming", false)
                    Log.d("WearMainActivity", "Data changed: $taskName, $remainingSeconds, isPaused=$isPaused")
                    
                    saveToPrefsAndUpdateTile(taskName, remainingSeconds, totalSeconds, isPaused, isAlarming)
                }
            }
        }
    }

    private fun queryCurrentTimerState() {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val buffer = Wearable.getDataClient(this@WearMainActivity).dataItems.await()
                for (i in 0 until buffer.count) {
                    val item = buffer.get(i)
                    if (item.uri.path == "/timer_state") {
                        val dataMap = DataMapItem.fromDataItem(item).dataMap
                        taskName = dataMap.getString("taskName", "No task selected")
                        remainingSeconds = dataMap.getInt("remainingSeconds", 0)
                        totalSeconds = dataMap.getInt("totalSeconds", 0)
                        isPaused = dataMap.getBoolean("isPaused", false)
                        isAlarming = dataMap.getBoolean("isAlarming", false)
                        
                        saveToPrefsAndUpdateTile(taskName, remainingSeconds, totalSeconds, isPaused, isAlarming)
                        break
                    }
                }
                buffer.release()
            } catch (e: Exception) {
                Log.e("WearMainActivity", "Failed to query timer state: ${e.message}")
            }
        }
    }

    private fun saveToPrefsAndUpdateTile(
        taskName: String,
        remainingSeconds: Int,
        totalSeconds: Int,
        isPaused: Boolean,
        isAlarming: Boolean
    ) {
        val prefs = getSharedPreferences("wear_prefs", MODE_PRIVATE)
        prefs.edit().apply {
            putString("taskName", taskName)
            putInt("remainingSeconds", remainingSeconds)
            putInt("totalSeconds", totalSeconds)
            putBoolean("isPaused", isPaused)
            putBoolean("isAlarming", isAlarming)
            apply()
        }
        try {
            androidx.wear.tiles.TileService.getUpdater(applicationContext)
                .requestUpdate(WearTimerTileService::class.java)
        } catch (e: Exception) {
            Log.e("WearMainActivity", "Failed to update tile: ${e.message}")
        }
    }

    private fun sendControlMessage(path: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val nodes = Wearable.getNodeClient(this@WearMainActivity).connectedNodes.await()
                for (node in nodes) {
                    Wearable.getMessageClient(this@WearMainActivity)
                        .sendMessage(node.id, path, ByteArray(0)).await()
                    Log.d("WearMainActivity", "Control message sent: $path to node ${node.displayName}")
                }
            } catch (e: Exception) {
                Log.e("WearMainActivity", "Failed to send control message $path: ${e.message}")
            }
        }
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        val path = messageEvent.path
        Log.d("WearMainActivity", "Message received from phone: $path")
        if (path.startsWith("/quicklog_success/")) {
            val foodId = path.substring("/quicklog_success/".length)
            val foodLabel = getFoodLabel(foodId)
            triggerVibration()
            runOnUiThread {
                Toast.makeText(this, "$foodLabel logged successfully!", Toast.LENGTH_SHORT).show()
            }
        } else if (path.startsWith("/quicklog_fail/")) {
            val foodId = path.substring("/quicklog_fail/".length)
            val foodLabel = getFoodLabel(foodId)
            runOnUiThread {
                Toast.makeText(this, "Failed to log $foodLabel", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun getFoodLabel(foodId: String): String {
        return when (foodId) {
            "water" -> "🥤 Water"
            "espresso" -> "☕ Espresso"
            "protein_waffles" -> "🧇 Waffle"
            "protein_shake" -> "🥤 Shake"
            "mixed_nuts" -> "🥜 Nuts"
            else -> foodId
        }
    }

    private fun triggerVibration() {
        try {
            val vibrator = getSystemService(android.content.Context.VIBRATOR_SERVICE) as android.os.Vibrator
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                vibrator.vibrate(android.os.VibrationEffect.createOneShot(80, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                vibrator.vibrate(80)
            }
        } catch (e: Exception) {
            Log.e("WearMainActivity", "Vibration error: ${e.message}")
        }
    }
}

@Composable
fun WearTimerScreen(
    taskName: String,
    remainingSeconds: Int,
    isPaused: Boolean,
    isAlarming: Boolean,
    onPauseResumeClick: () -> Unit,
    onCancelClick: () -> Unit,
    onQuickLogClick: (String) -> Unit
) {
    val mins = remainingSeconds / 60
    val secs = remainingSeconds % 60
    val timeStr = String.format("%02d:%02d", mins, secs)

    val active = taskName.isNotEmpty() && taskName != "No task selected"

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
        contentAlignment = Alignment.Center
    ) {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Active Timer View
            item {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier.padding(bottom = 8.dp, top = 20.dp)
                ) {
                    // Task Name
                    Text(
                        text = if (active) {
                            if (isAlarming) "Time's Up!" else taskName
                        } else "No Active Task",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isAlarming) Color.Red else Color.LightGray,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)
                    )

                    Spacer(modifier = Modifier.height(4.dp))

                    // Time Display
                    Text(
                        text = if (active) timeStr else "--:--",
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isPaused) Color.Gray else Color(0xFFA882DD),
                        textAlign = TextAlign.Center
                    )

                    Spacer(modifier = Modifier.height(6.dp))

                    // Controls
                    if (active) {
                        Row(
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // Play/Pause circular button
                            Button(
                                onClick = onPauseResumeClick,
                                colors = ButtonDefaults.buttonColors(
                                    backgroundColor = if (isPaused) Color(0xFF10B981) else Color(0xFF27272A)
                                ),
                                modifier = Modifier.size(32.dp)
                            ) {
                                if (isPaused) {
                                    Icon(
                                        imageVector = Icons.Default.PlayArrow,
                                        contentDescription = "Resume",
                                        tint = Color.White,
                                        modifier = Modifier.size(14.dp)
                                    )
                                } else {
                                    Row(
                                        modifier = Modifier.size(10.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Box(modifier = Modifier.width(2.5.dp).fillMaxHeight().background(Color.White))
                                        Box(modifier = Modifier.width(2.5.dp).fillMaxHeight().background(Color.White))
                                    }
                                }
                            }

                            Spacer(modifier = Modifier.width(10.dp))

                            // Cancel circular button
                            Button(
                                onClick = onCancelClick,
                                colors = ButtonDefaults.buttonColors(backgroundColor = Color(0xFFEF4444)),
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = "Cancel",
                                    tint = Color.White,
                                    modifier = Modifier.size(14.dp)
                                )
                            }
                        }
                    } else {
                        Text(
                            text = "Select a task on phone",
                            fontSize = 9.sp,
                            color = Color.DarkGray,
                            textAlign = TextAlign.Center
                        )
                    }
                }
            }

            // Schedule Time Blocks Header & Items
            item {
                Text(
                    text = "SCHEDULE BLOCKS",
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFFA882DD),
                    modifier = Modifier.padding(top = 10.dp, bottom = 4.dp)
                )
            }

            item {
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.padding(horizontal = 8.dp)
                ) {
                    val sampleBlocks = listOf(
                        Pair("08:00 AM", "Morning Focus & Planning"),
                        Pair("10:30 AM", "Core Project Development"),
                        Pair("01:00 PM", "Review & Communications"),
                        Pair("04:30 PM", "Schedule & Routine Tasks")
                    )

                    sampleBlocks.forEach { (time, title) ->
                        Chip(
                            onClick = { },
                            label = {
                                Column {
                                    Text(
                                        text = title,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        text = time,
                                        fontSize = 9.sp,
                                        color = Color(0xFFA882DD)
                                    )
                                }
                            },
                            colors = ChipDefaults.chipColors(
                                backgroundColor = Color(0xFF1E1E24),
                                contentColor = Color.White
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(38.dp)
                        )
                    }
                }
            }

            // Quick Log Header
            item {
                Text(
                    text = "QUICK LOG",
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFFA882DD),
                    modifier = Modifier.padding(top = 12.dp, bottom = 4.dp)
                )
            }

            // Quick Log Buttons
            val quickLogFoods = listOf(
                Pair("water", "🥤 Water"),
                Pair("espresso", "☕ Espresso"),
                Pair("protein_waffles", "🧇 Waffle"),
                Pair("protein_shake", "🥤 Shake"),
                Pair("mixed_nuts", "🥜 Nuts")
            )

            items(quickLogFoods) { (foodId, label) ->
                Chip(
                    onClick = { onQuickLogClick(foodId) },
                    label = { Text(label, fontSize = 11.sp, fontWeight = FontWeight.Bold) },
                    colors = ChipDefaults.primaryChipColors(
                        backgroundColor = Color(0xFF1C1C1E),
                        contentColor = Color.White
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 10.dp, vertical = 2.dp)
                )
            }
            
            // Padding item to ensure circular scrolling doesn't cut off the last chip
            item {
                Spacer(modifier = Modifier.height(20.dp))
            }
        }
    }
}

@Composable
fun WearAppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = Colors(
            primary = Color(0xFFA882DD),
            primaryVariant = Color(0xFF8B5CF6),
            secondary = Color(0xFF10B981),
            background = Color.Black,
            onBackground = Color.White
        ),
        content = content
    )
}
